"""Keeps personal data out of the server's logs (rule 5).

Uvicorn's access log prints each request's path with its query string, which can hold personal
data: the leads search (`q`) and the custom lead field filters (`cf[<fieldId>]=…`, F34). The filter
below logs the path only.
"""

import logging


class DropQueryString(logging.Filter):
    """For `uvicorn.access` records: args are (client, method, full_path, http_version, status)."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3 and isinstance(args[2], str) and "?" in args[2]:
            record.args = (*args[:2], args[2].split("?", 1)[0], *args[3:])
        return True


_FILTER = DropQueryString()


def install_log_privacy() -> None:
    """Idempotent: adds the filter to the access logger once per process."""
    access = logging.getLogger("uvicorn.access")
    if _FILTER not in access.filters:
        access.addFilter(_FILTER)
