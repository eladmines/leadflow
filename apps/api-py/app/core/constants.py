"""Auth constants, ported from packages/shared/src/auth.ts."""

import re

DAY_S = 24 * 60 * 60

SESSION_COOKIE_NAME = "lf_session"
SESSION_IDLE_TTL_S = 30 * DAY_S
# Hard cap on a session's lifetime, regardless of activity. Also the cookie Max-Age.
SESSION_ABSOLUTE_TTL_S = 90 * DAY_S
# last_seen_at / expires_at are written at most once per hour per session.
SESSION_TOUCH_INTERVAL_S = 60 * 60

AUTH_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")

CSRF_HEADER_NAME = "X-Requested-With"
CSRF_HEADER_VALUE = "SimpleCatch"
