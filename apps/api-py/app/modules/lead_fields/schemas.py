"""Custom lead fields contract (packages/shared/src/leadFields.ts, F34, D-203/D-204).

Field-level rules (label, options list, bounds) live in the request models with the shared Hebrew
messages; rules that depend on the field's type (the posted one on create, the stored one on
update) are checked in the service, after the body parsed, like the shared schemas' superRefine.
"""

import re
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict

from app.shared.lead_fields import (
    LEAD_FIELD_LABEL_MAX,
    LEAD_FIELD_NUMBER_ABS_MAX,
    LEAD_FIELD_OPTION_ID_MAX,
    LEAD_FIELD_OPTION_LABEL_MAX,
    LEAD_FIELD_OPTIONS_MAX,
    LEAD_FIELD_OPTIONS_MIN,
    LEAD_FIELD_TYPES,
    MAX_ACTIVE_LEAD_FIELDS,
    has_unstorable_chars,
    is_finite_within,
    js_len,
    js_lower,
    js_trim,
)
from app.shared.lead_fields import M as MSG

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z", re.I)


def _label(v: Any) -> str:
    if not isinstance(v, str):
        raise ValueError(MSG["labelRequired"])
    s = js_trim(v)
    if not s:
        raise ValueError(MSG["labelRequired"])
    if js_len(s) > LEAD_FIELD_LABEL_MAX:
        raise ValueError(MSG["labelTooLong"])
    # A NUL or a lone surrogate can't be stored (QA-F34-03), checked last like the shared refine.
    if has_unstorable_chars(s):
        raise ValueError(MSG["invalidCharacters"])
    return s


def _option_label(v: Any) -> str:
    if not isinstance(v, str):
        raise ValueError(MSG["optionLabelRequired"])
    s = js_trim(v)
    if not s:
        raise ValueError(MSG["optionLabelRequired"])
    if js_len(s) > LEAD_FIELD_OPTION_LABEL_MAX:
        raise ValueError(MSG["optionLabelTooLong"])
    if has_unstorable_chars(s):
        raise ValueError(MSG["invalidCharacters"])
    return s


def _option_id(v: Any) -> str:
    if not isinstance(v, str) or not v or len(v) > LEAD_FIELD_OPTION_ID_MAX:
        raise ValueError(MSG["optionUnknown"])
    return v


def _type(v: Any) -> str:
    if v not in LEAD_FIELD_TYPES:
        raise ValueError(MSG["typeInvalid"])
    return v


def _bound(v: Any) -> float | int | None:
    if v is None:
        return None
    if isinstance(v, bool) or not isinstance(v, int | float):
        raise ValueError(MSG["numberInvalid"])
    if not is_finite_within(v, LEAD_FIELD_NUMBER_ABS_MAX):
        raise ValueError(MSG["numberInvalid"])
    return v


def _option_list(v: Any) -> Any:
    if not isinstance(v, list) or not (LEAD_FIELD_OPTIONS_MIN <= len(v) <= LEAD_FIELD_OPTIONS_MAX):
        raise ValueError(MSG["optionsCount"])
    return v


def _create_options(v: Any) -> Any:
    """Optional on create; `[]` is fine for non-select types (the service checks by type)."""
    if v is None or v == []:
        return v
    return _option_list(v)


def _strict_bool(v: Any) -> bool:
    if not isinstance(v, bool):
        raise ValueError("Expected boolean")
    return v


def _type_locked(v: Any) -> None:
    # Any `type` on an update is refused, null included (the shared schema has `z.undefined()`).
    raise ValueError(MSG["typeLocked"])


Label = Annotated[str, BeforeValidator(_label)]
OptionLabel = Annotated[str, BeforeValidator(_option_label)]
FieldType = Annotated[Literal["text", "number", "date", "select", "boolean"], BeforeValidator(_type)]
Bound = Annotated[float | int | None, BeforeValidator(_bound)]


class CreateLeadFieldOption(BaseModel):
    model_config = ConfigDict(validate_default=True)

    label: OptionLabel = ""


class UpdateLeadFieldOption(BaseModel):
    """`id` = an existing option of this field (rename/restore); no id = a new option."""

    model_config = ConfigDict(validate_default=True)

    id: Annotated[str | None, BeforeValidator(lambda v: None if v is None else _option_id(v))] = None
    label: OptionLabel = ""


def _duplicates(options: list[Any]) -> list[int]:
    """Indexes of options whose label repeats an earlier one (case-insensitive)."""
    seen: set[str] = set()
    dup: list[int] = []
    for i, o in enumerate(options):
        key = js_lower(o.label)
        if key in seen:
            dup.append(i)
        seen.add(key)
    return dup


class CreateLeadFieldRequest(BaseModel):
    """POST /lead-fields. The server assigns ids (field and options) and puts the field last."""

    model_config = ConfigDict(validate_default=True)

    label: Label = ""
    type: FieldType = ""  # type: ignore[assignment]
    # select: 2–30 options. Other types: omit (or `[]`).
    options: Annotated[list[CreateLeadFieldOption] | None, BeforeValidator(_create_options)] = None
    required: Annotated[bool, BeforeValidator(_strict_bool)] = False
    # number only.
    min: Bound = None
    max: Bound = None


class UpdateLeadFieldRequest(BaseModel):
    """PATCH /lead-fields/:fieldId. Every key optional; `type` is refused (it can't change).
    `options` is the full list of active options in order: a listed id renames or restores, no
    id adds, an option left out is archived. `archived` archives (true) or restores (false)."""

    model_config = ConfigDict(validate_default=False)

    label: Annotated[str | None, BeforeValidator(_label)] = None
    options: Annotated[list[UpdateLeadFieldOption] | None, BeforeValidator(_option_list)] = None
    required: Annotated[bool | None, BeforeValidator(_strict_bool)] = None
    min: Bound = None
    max: Bound = None
    archived: Annotated[bool | None, BeforeValidator(_strict_bool)] = None
    # Present only to refuse it with a Hebrew message.
    type: Annotated[None, BeforeValidator(_type_locked)] = None


def _ids(v: Any) -> Any:
    if not isinstance(v, list):
        raise ValueError(MSG["orderStale"])
    if len(v) > MAX_ACTIVE_LEAD_FIELDS:
        raise ValueError(MSG["orderStale"])
    for item in v:
        if not isinstance(item, str) or not _UUID.match(item):
            raise ValueError(MSG["orderStale"])
    if len(set(v)) != len(v):
        raise ValueError(MSG["orderDuplicate"])
    return v


class ReorderLeadFieldsRequest(BaseModel):
    """PUT /lead-fields/order: every active field id, once, in the new order."""

    ids: Annotated[list[str], BeforeValidator(_ids)]


# ---------------------------------------------------------------------------- responses


class LeadFieldOptionOut(BaseModel):
    id: str
    label: str
    archivedAt: str | None


class LeadFieldOut(BaseModel):
    id: str
    label: str
    type: Literal["text", "number", "date", "select", "boolean"]
    options: list[LeadFieldOptionOut]
    required: bool
    min: int | float | None
    max: int | float | None
    position: int
    archivedAt: str | None
    createdAt: str
    updatedAt: str


class LeadFieldListResponse(BaseModel):
    fields: list[LeadFieldOut]


class LeadFieldResponse(BaseModel):
    field: LeadFieldOut


def option_duplicate_errors(options: list[Any] | None) -> dict[str, str]:
    """Labels repeated within an options list: `options.<i>.label` (as the shared superRefine)."""
    return {f"options.{i}.label": MSG["optionDuplicate"] for i in _duplicates(options or [])}
