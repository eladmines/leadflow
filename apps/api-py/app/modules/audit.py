"""Audit log writes (apps/api/src/modules/audit/service.ts)."""

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AuditLog

log = logging.getLogger("simplecatch")


def add_audit(
    db: AsyncSession,
    action: str,
    *,
    business_id: uuid.UUID | None = None,
    actor_user_id: uuid.UUID | None = None,
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Adds one audit row to the session (written with the surrounding transaction).

    Never put passwords, tokens, hashes, cookies or a failed login's email in `metadata`.
    """
    db.add(
        AuditLog(
            id=uuid.uuid4(),
            action=action,
            business_id=business_id,
            actor_user_id=actor_user_id,
            entity_type=entity_type,
            entity_id=entity_id,
            metadata_=metadata or {},
            created_at=datetime.now(UTC),
        )
    )


async def record_audit_safe(db: AsyncSession, action: str, **kwargs: Any) -> None:
    """Best-effort audit: a failure is logged (action only) and never changes the response."""
    try:
        add_audit(db, action, **kwargs)
        await db.commit()
    except Exception as err:
        await db.rollback()
        log.error("audit write failed", extra={"action": action, "errName": type(err).__name__})
