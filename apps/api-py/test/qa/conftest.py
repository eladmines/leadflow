"""QA tests reuse the API test fixtures (real test DB, tables emptied per test).

Run from apps/api-py: `uv run pytest test/qa`.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tests.conftest import *  # noqa: E402,F401,F403
from tests.conftest import clean_db  # noqa: E402,F401  (autouse fixture)
