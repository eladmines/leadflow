"""Roles and the permission matrix, ported from packages/shared/src/permissions.ts."""

from typing import Literal

Role = Literal["OWNER", "MANAGER", "EMPLOYEE"]
ROLES: tuple[Role, ...] = ("OWNER", "MANAGER", "EMPLOYEE")

_ALL: tuple[Role, ...] = ("OWNER", "MANAGER", "EMPLOYEE")
_OM: tuple[Role, ...] = ("OWNER", "MANAGER")
_O: tuple[Role, ...] = ("OWNER",)

# Enforced on the server (`require_permission`). The web uses `can()` only to hide controls.
PERMISSIONS: dict[str, tuple[Role, ...]] = {
    "business.view": _ALL,
    "business.update": _O,
    "members.view": _OM,
    "members.manage": _O,
    "site.view": _ALL,
    "site.edit": _O,
    "site.publish": _O,
    "leads.view": _ALL,
    "leads.view.all": _OM,
    "leads.create": _ALL,
    "leads.update": _ALL,
    "leads.assign": _OM,
    "leads.export": _O,
    "customers.import": _OM,
    "leads.delete": _O,
    "tasks.view": _ALL,
    "tasks.view.all": _OM,
    # F35 (D-213): switch the automatic follow-up tasks on or off; reading follows `tasks.view`.
    "automations.manage": _OM,
    "appointments.view": _ALL,
    "appointments.view.all": _OM,
    "services.manage": _OM,
    # D-203 (F34): manage the business's custom lead fields; filling follows `leads.update`.
    "leadFields.manage": _OM,
    "quotes.view": _ALL,
    "reports.view": _OM,
    "whatsapp.inbox": _OM,
}


def can(role: str, permission: str) -> bool:
    return role in PERMISSIONS[permission]
