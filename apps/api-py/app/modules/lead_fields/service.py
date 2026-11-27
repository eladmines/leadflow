"""Custom lead fields (F34, D-203, D-204): a business's own lead field definitions.

Every query filters by `ctx.business_id`; a field of another business is a 404. Changes that can
break the 20-active limit or label uniqueness run under a per-business advisory lock, and the
partial unique index `lead_field_definitions_active_label_key` backs label uniqueness under races.
"""

import re
import uuid
from collections.abc import Iterable
from decimal import Decimal
from typing import Any

from sqlalchemy import Text, and_, bindparam, cast, func, not_, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import iso, now_ms
from app.db.models import Lead, LeadFieldDefinition
from app.deps import TenantContext
from app.errors import AppError
from app.modules.audit import add_audit
from app.modules.lead_fields import schemas as s
from app.shared.lead_fields import (
    LEAD_FIELD_FILTER_PARAM_RE,
    LEAD_FIELD_FILTER_VALUE_MAX,
    LEAD_FIELD_OPTIONS_TOTAL_MAX,
    MAX_ACTIVE_LEAD_FIELDS,
    MAX_LEAD_FIELD_FILTERS,
    LeadFieldOptionRule,
    LeadFieldRule,
    has_unstorable_chars,
    is_number,
    is_valid_iso_date,
    js_len,
    js_lower,
    js_number_str,
    js_trim,
    plain_number,
)
from app.shared.lead_fields import M as MSG

_LABEL_INDEX = "lead_field_definitions_active_label_key"


def _sort_key(d: LeadFieldDefinition) -> tuple[int, int, Any]:
    """Active by position, then archived by position."""
    return (1 if d.archived_at else 0, d.position, d.created_at)


def to_field_dto(d: LeadFieldDefinition) -> s.LeadFieldOut:
    return s.LeadFieldOut(
        id=str(d.id),
        label=d.label,
        type=d.type,  # type: ignore[arg-type]
        options=[
            s.LeadFieldOptionOut(id=o["id"], label=o["label"], archivedAt=o.get("archived_at"))
            for o in (d.options or [])
        ],
        required=d.required,
        min=plain_number(d.number_min) if d.number_min is not None else None,
        max=plain_number(d.number_max) if d.number_max is not None else None,
        position=d.position,
        archivedAt=iso(d.archived_at) if d.archived_at else None,
        createdAt=iso(d.created_at),
        updatedAt=iso(d.updated_at),
    )


def to_rule(d: LeadFieldDefinition) -> LeadFieldRule:
    return LeadFieldRule(
        id=str(d.id),
        type=d.type,
        required=d.required,
        min=d.number_min,
        max=d.number_max,
        archived=d.archived_at is not None,
        options=[
            LeadFieldOptionRule(id=o["id"], archived=bool(o.get("archived_at"))) for o in (d.options or [])
        ],
    )


async def load_definitions(db: AsyncSession, business_id: uuid.UUID) -> list[LeadFieldDefinition]:
    """All of a business's definitions (active and archived), in display order."""
    rows = await db.execute(select(LeadFieldDefinition).where(LeadFieldDefinition.business_id == business_id))
    return sorted(rows.scalars().all(), key=_sort_key)


def _conflict(message: str) -> AppError:
    return AppError("CONFLICT", message, {"label": message})


def _is_label_violation(err: IntegrityError) -> bool:
    return _LABEL_INDEX in str(err.orig)


class LeadFieldService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _lock(self, business_id: uuid.UUID) -> None:
        """Serialises definition changes per business (the 20-active limit, positions)."""
        await self.db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"lead_fields:{business_id}"}
        )

    async def _active(self, business_id: uuid.UUID) -> list[LeadFieldDefinition]:
        rows = await self.db.execute(
            select(LeadFieldDefinition)
            .where(LeadFieldDefinition.business_id == business_id, LeadFieldDefinition.archived_at.is_(None))
            .order_by(LeadFieldDefinition.position.asc(), LeadFieldDefinition.created_at.asc())
        )
        return list(rows.scalars().all())

    async def _find(self, ctx: TenantContext, field_id: str) -> LeadFieldDefinition:
        try:
            fid = uuid.UUID(field_id)
        except ValueError as err:
            raise AppError("NOT_FOUND") from err
        row = (
            await self.db.execute(
                select(LeadFieldDefinition)
                .where(LeadFieldDefinition.id == fid, LeadFieldDefinition.business_id == ctx.business_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if row is None:
            raise AppError("NOT_FOUND")
        return row

    @staticmethod
    def _label_taken(active: list[LeadFieldDefinition], label: str, self_id: uuid.UUID | None) -> bool:
        key = js_lower(label)
        return any(js_lower(d.label) == key for d in active if d.id != self_id)

    async def _commit(self) -> None:
        try:
            await self.db.commit()
        except IntegrityError as err:
            await self.db.rollback()
            if _is_label_violation(err):
                raise _conflict(MSG["labelTaken"]) from err
            raise

    # -- read ------------------------------------------------------------------------------

    async def list_fields(self, ctx: TenantContext) -> list[s.LeadFieldOut]:
        return [to_field_dto(d) for d in await load_definitions(self.db, ctx.business_id)]

    # -- create ----------------------------------------------------------------------------

    async def create(self, ctx: TenantContext, data: s.CreateLeadFieldRequest) -> s.LeadFieldOut:
        errors = s.option_duplicate_errors(data.options)
        # The shared schema's checkTypeRules. A select needs 2–30 options: none at all, or `[]`
        # (let through by the schema for the other types), is refused (QA-F34-01).
        if data.type == "select" and not data.options:
            errors.setdefault("options", MSG["optionsCount"])
        if data.type != "select" and data.options:
            errors.setdefault("options", MSG["optionsNotAllowed"])
        if data.type != "number" and (data.min is not None or data.max is not None):
            errors.setdefault("min", MSG["rangeNotAllowed"])
        if data.min is not None and data.max is not None and data.min > data.max:
            errors.setdefault("min", MSG["rangeInvalid"])
        if data.type == "boolean" and data.required:
            errors.setdefault("required", MSG["booleanNotRequired"])
        if errors:
            raise AppError("VALIDATION_ERROR", None, errors)

        await self._lock(ctx.business_id)
        active = await self._active(ctx.business_id)
        if len(active) >= MAX_ACTIVE_LEAD_FIELDS:
            raise _conflict(MSG["tooManyFields"])
        if self._label_taken(active, data.label, None):
            raise _conflict(MSG["labelTaken"])
        now = now_ms()
        row = LeadFieldDefinition(
            id=uuid.uuid4(),
            business_id=ctx.business_id,
            label=data.label,
            type=data.type,
            options=(
                [{"id": str(uuid.uuid4()), "label": o.label} for o in data.options or []]
                if data.type == "select"
                else []
            ),
            required=data.required,
            number_min=data.min if data.type == "number" else None,
            number_max=data.max if data.type == "number" else None,
            position=(max(d.position for d in active) + 1) if active else 0,
            created_at=now,
            updated_at=now,
        )
        self.db.add(row)
        add_audit(
            self.db,
            "leadField.created",
            business_id=ctx.business_id,
            actor_user_id=ctx.user_id,
            entity_type="lead_field",
            entity_id=row.id,
            metadata={"type": data.type},
        )
        await self._commit()
        return to_field_dto(row)

    # -- update ----------------------------------------------------------------------------

    def _merge_options(
        self, stored: list[dict[str, Any]], wanted: list[s.UpdateLeadFieldOption], now: str
    ) -> tuple[list[dict[str, Any]], dict[str, str]]:
        """The new options list: the wanted active ones in order, then every other stored option
        archived (never deleted). Returns (options, errors)."""
        errors = s.option_duplicate_errors(wanted)
        by_id = {o["id"]: o for o in stored}
        used: set[str] = set()
        active: list[dict[str, Any]] = []
        for o in wanted:
            if o.id is None:
                active.append({"id": str(uuid.uuid4()), "label": o.label})
                continue
            if o.id not in by_id or o.id in used:
                errors.setdefault("options", MSG["optionUnknown"])
                continue
            used.add(o.id)
            active.append({"id": o.id, "label": o.label})  # renamed / restored
        archived = [
            {"id": o["id"], "label": o["label"], "archived_at": o.get("archived_at") or now}
            for o in stored
            if o["id"] not in used
        ]
        if len(active) + len(archived) > LEAD_FIELD_OPTIONS_TOTAL_MAX:
            errors.setdefault("options", MSG["optionsTotal"])
        return active + archived, errors

    async def update(
        self, ctx: TenantContext, field_id: str, data: s.UpdateLeadFieldRequest
    ) -> s.LeadFieldOut:
        given = data.model_fields_set
        await self._lock(ctx.business_id)
        row = await self._find(ctx, field_id)
        now = now_ms()

        errors: dict[str, str] = {}
        new_options: list[dict[str, Any]] | None = None
        if "options" in given and data.options is not None:
            if row.type != "select":
                errors["options"] = MSG["optionsNotAllowed"]
            else:
                new_options, opt_errors = self._merge_options(list(row.options or []), data.options, iso(now))
                errors.update(opt_errors)
        sets_bound = ("min" in given and data.min is not None) or ("max" in given and data.max is not None)
        if row.type != "number" and sets_bound:
            errors.setdefault("min", MSG["rangeNotAllowed"])
        elif row.type == "number":
            lo = data.min if "min" in given else row.number_min
            hi = data.max if "max" in given else row.number_max
            if lo is not None and hi is not None and lo > hi:
                errors.setdefault("min", MSG["rangeInvalid"])
        if data.required is True and row.type == "boolean":
            errors["required"] = MSG["booleanNotRequired"]
        if errors:
            raise AppError("VALIDATION_ERROR", None, errors)

        changed = False
        restoring = data.archived is False and row.archived_at is not None
        label = data.label if "label" in given and data.label is not None else row.label
        if (restoring or row.archived_at is None) and (label != row.label or restoring):
            active = await self._active(ctx.business_id)
            if restoring and len(active) >= MAX_ACTIVE_LEAD_FIELDS:
                raise _conflict(MSG["tooManyFields"])
            if self._label_taken(active, label, row.id):
                raise _conflict(MSG["labelTaken"])
            if restoring:
                row.archived_at = None
                row.position = (max(d.position for d in active) + 1) if active else 0
                changed = True
        if label != row.label:
            row.label = label
            changed = True
        if new_options is not None and new_options != (row.options or []):
            row.options = new_options
            changed = True
        if data.required is not None and data.required != row.required:
            row.required = data.required
            changed = True
        if row.type == "number":
            if "min" in given and data.min != row.number_min:
                row.number_min = data.min
                changed = True
            if "max" in given and data.max != row.number_max:
                row.number_max = data.max
                changed = True
        archiving = data.archived is True and row.archived_at is None
        if archiving:
            row.archived_at = now
            changed = True

        if changed:
            row.updated_at = now
            action = (
                "leadField.archived"
                if archiving
                else "leadField.restored"
                if restoring
                else "leadField.updated"
            )
            add_audit(
                self.db,
                action,
                business_id=ctx.business_id,
                actor_user_id=ctx.user_id,
                entity_type="lead_field",
                entity_id=row.id,
            )
        await self._commit()
        return to_field_dto(row)

    # -- reorder ---------------------------------------------------------------------------

    async def reorder(self, ctx: TenantContext, data: s.ReorderLeadFieldsRequest) -> list[s.LeadFieldOut]:
        """Rewrites the active fields' positions to 0..n-1 in the given order."""
        await self._lock(ctx.business_id)
        active = await self._active(ctx.business_id)
        wanted = [uuid.UUID(i) for i in data.ids]
        by_id = {d.id: d for d in active}
        if len(wanted) != len(active) or set(wanted) != set(by_id):
            raise AppError("CONFLICT", MSG["orderStale"])
        now = now_ms()
        moved = False
        for i, fid in enumerate(wanted):
            d = by_id[fid]
            if d.position != i:
                d.position = i
                d.updated_at = now
                moved = True
        if moved:
            add_audit(
                self.db,
                "leadFields.reordered",
                business_id=ctx.business_id,
                actor_user_id=ctx.user_id,
                entity_type="lead_field",
            )
        await self._commit()
        return await self.list_fields(ctx)


# ---------------------------------------------------------------------------- leads list filters


def _like(value: str) -> str:
    esc = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{esc}%"


def has_filter_params(params: Iterable[tuple[str, str]]) -> bool:
    return any(k[:3].lower() == "cf[" for k, _ in params)


def filter_conditions(defs: list[LeadFieldDefinition], params: Iterable[tuple[str, str]]) -> list[Any]:
    """`cf[<fieldId>]=…` / `cf[<fieldId>][from|to]=…` → SQL conditions on `leads.custom_fields`.
    An unknown, foreign or archived field, a part that doesn't fit the field's type or a malformed
    value is a 400 with `fields["cf[<id>]"]` (D-204); empty values are ignored."""
    bad = MSG["filterInvalid"]
    errors: dict[str, str] = {}
    wanted: dict[str, dict[str, str]] = {}
    for key, raw in params:
        if key[:3].lower() != "cf[":
            continue
        m = LEAD_FIELD_FILTER_PARAM_RE.match(key)
        if not m:
            errors.setdefault(key[:60], bad)
            continue
        value = js_trim(raw)
        if not value:
            continue
        fid = m.group(1).lower()
        if has_unstorable_chars(value):
            errors.setdefault(f"cf[{fid}]", MSG["invalidCharacters"])
        elif js_len(value) > LEAD_FIELD_FILTER_VALUE_MAX:
            errors.setdefault(f"cf[{fid}]", bad)
        wanted.setdefault(fid, {})[(m.group(2) or "value").lower()] = value

    by_id = {str(d.id): d for d in defs}
    conds: list[Any] = []
    for n, (fid, parts) in enumerate(wanted.items()):
        key = f"cf[{fid}]"
        d = by_id.get(fid)
        if n >= MAX_LEAD_FIELD_FILTERS or d is None or d.archived_at is not None or key in errors:
            errors.setdefault(key, bad)
            continue
        col = Lead.custom_fields[fid]
        wanted_value = parts.get("value")
        ranged = "from" in parts or "to" in parts
        if d.type in ("text", "select", "boolean"):
            if ranged or wanted_value is None:
                errors[key] = bad
            elif d.type == "text":
                conds.append(col.astext.ilike(_like(wanted_value), escape="\\"))
            elif d.type == "select":
                if wanted_value not in {o["id"] for o in d.options or []}:
                    errors[key] = bad
                else:
                    conds.append(Lead.custom_fields.contains({fid: wanted_value}))
            elif wanted_value == "true":
                conds.append(Lead.custom_fields.contains({fid: True}))
            elif wanted_value == "false":
                conds.append(not_(Lead.custom_fields.contains({fid: True})))
            else:
                errors[key] = bad
            continue
        # number / date: inclusive range.
        if wanted_value is not None or not ranged:
            errors[key] = bad
            continue
        for part, op in (("from", ">="), ("to", "<=")):
            bound = parts.get(part)
            if bound is None:
                continue
            if d.type == "number":
                if not _NUMBER_BOUND.match(bound):
                    errors[key] = bad
                    break
                literal = cast(bindparam(None, str(Decimal(bound)), type_=Text), JSONB)
                # jsonb compares numbers numerically; non-numbers are left out first.
                conds.append(and_(func.jsonb_typeof(col) == "number", col.op(op)(literal)))
            else:
                if not is_valid_iso_date(bound):
                    errors[key] = bad
                    break
                conds.append(and_(func.jsonb_typeof(col) == "string", col.astext.collate("C").op(op)(bound)))
    if errors:
        raise AppError("VALIDATION_ERROR", None, errors)
    return conds


_NUMBER_BOUND = re.compile(r"^-?[0-9]+(\.[0-9]+)?\Z")


# ---------------------------------------------------------------------------- export


def export_columns(defs: list[LeadFieldDefinition]) -> list[LeadFieldDefinition]:
    """Active fields in position order: one CSV column each."""
    return [d for d in defs if d.archived_at is None]


def export_cell(d: LeadFieldDefinition, value: Any) -> str:
    """select → option label (archived too), boolean → כן / empty, number as is, date ISO."""
    if value is None:
        return ""
    if d.type == "select":
        return next((o["label"] for o in d.options or [] if o["id"] == value), "")
    if d.type == "boolean":
        return "כן" if value is True else ""
    if d.type == "number" and is_number(value):
        return js_number_str(value)
    return str(value)
