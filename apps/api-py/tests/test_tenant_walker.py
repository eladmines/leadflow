"""Cross-tenant route walker (docs/ARCHITECTURE.md §4): every registered tenant route answers 404
to a member of another business, so new routes are covered automatically."""

import re
import uuid

from app.deps import TENANT_PREFIX
from tests.conftest import owner_with_business, req


async def test_a_member_of_another_business_gets_404_on_every_tenant_route(app, client):
    """Every route under /businesses/{business_id}: a member of another business gets 404."""
    a = await owner_with_business(client, "walk-a")
    b = await owner_with_business(client, "walk-b")
    seen: set[tuple[str, str]] = set()
    # Every documented route (FastAPI nests included routers, so read them from the schema).
    for route_path, ops in app.openapi()["paths"].items():
        if not route_path.startswith(TENANT_PREFIX):
            continue
        path = route_path.replace("{business_id}", a["business"]["id"])
        path = re.sub(r"\{[^}]+\}", str(uuid.uuid4()), path)
        for method in sorted(k.upper() for k in ops if k in ("get", "post", "put", "patch", "delete")):
            res = await req(client, method, path, b["token"], {} if method != "GET" else None)
            assert res.status_code == 404, (method, route_path, res.status_code)
            seen.add((method, route_path))
    lf_prefix = f"{TENANT_PREFIX}/lead-fields"
    assert {
        ("GET", lf_prefix),
        ("POST", lf_prefix),
        ("PUT", f"{lf_prefix}/order"),
        ("PATCH", f"{lf_prefix}/{{field_id}}"),
    } <= seen
    assert len(seen) > 40
