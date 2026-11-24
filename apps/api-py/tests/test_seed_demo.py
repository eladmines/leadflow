"""The demo-data script (scripts/seed_demo.py): fills a business, refuses twice, removes cleanly."""

import importlib.util
from pathlib import Path

from sqlalchemy import func, select

from app.db import models
from tests.conftest import business_url, owner_with_business, req


def _load():
    spec = importlib.util.spec_from_file_location(
        "seed_demo", Path(__file__).parent.parent / "scripts" / "seed_demo.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


async def count(db, model, *where):
    return (await db.execute(select(func.count()).select_from(model).where(*where))).scalar_one()


async def test_seed_and_remove(client, db, capsys):
    seed = _load()
    o = await owner_with_business(client, "seed")
    email = (await db.execute(select(models.User.email).where(models.User.id == o["user_id"]))).scalar_one()
    assert await seed.run(db, email, False) == 0
    assert "Added to" in capsys.readouterr().out
    assert await count(db, models.Lead) == 20
    assert await count(db, models.Task) == 9
    assert await count(db, models.Appointment) == 11
    assert await count(db, models.Quote) == 4
    assert await count(db, models.WhatsAppNumber) == 4

    # What the app shows from it.
    leads = (await req(client, "GET", business_url(o["business"]["id"], "/leads"), o["token"])).json()[
        "leads"
    ]
    assert len(leads) == 20 and "דוגמה" in leads[0]["tags"]
    assert (
        await req(client, "GET", business_url(o["business"]["id"], "/quotes"), o["token"])
    ).status_code == 200

    await seed.run(db, email, False)
    assert "already has sample data" in capsys.readouterr().out
    assert await count(db, models.Lead) == 20

    assert await seed.run(db, email, True) == 0
    assert await count(db, models.Task) == 0 and await count(db, models.WhatsAppNumber) == 0
