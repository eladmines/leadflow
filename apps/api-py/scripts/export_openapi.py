"""Writes the API's OpenAPI schema (the source for the web app's generated TypeScript types).

uv run python scripts/export_openapi.py            # writes openapi.json
uv run python scripts/export_openapi.py --check    # exits 1 when openapi.json is out of date
"""

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.getcwd())
os.environ.setdefault("DATABASE_URL", "postgresql://u:p@localhost/db")  # never connected to

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402

PATH = Path("openapi.json")


def build() -> str:
    app = create_app(
        Settings(DATABASE_URL=os.environ["DATABASE_URL"], NODE_ENV="test", RUN_BACKGROUND_JOBS=False)
    )
    return json.dumps(app.openapi(), indent=1, ensure_ascii=False, sort_keys=True) + "\n"


if __name__ == "__main__":
    text = build()
    if "--check" in sys.argv:
        if not PATH.exists() or PATH.read_text(encoding="utf-8") != text:
            print("openapi.json is out of date: run `uv run python scripts/export_openapi.py`")
            sys.exit(1)
        print("openapi.json is up to date")
    else:
        PATH.write_text(text, encoding="utf-8")
        print(f"wrote {PATH} ({len(text)} bytes)")
