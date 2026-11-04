"""Date helpers (Python port of src/utils/dateUtils.js).

Consistency strategy: all date arithmetic in this project is performed on UTC
calendar days. A travel date like ``2026-09-15`` is stored as midnight UTC
(``datetime(2026, 9, 15, tzinfo=timezone.utc)``). Otherwise local-time offsets
would make ``advance_days`` off by one.
"""

import datetime as _dt
import re

DAY_MS = 24 * 60 * 60 * 1000

_DATE_ONLY_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


class InvalidDateError(TypeError):
    """Raised when a date value cannot be parsed as a UTC calendar day."""


def parse_utc_date(value):
    """Parse a travel/collection date into a UTC midnight datetime.

    Accepts:
      - a ``datetime`` (or ``date``)
      - an ISO string such as '2026-09-15' or '2026-09-15T10:00:00.000Z'

    Date-only strings ('2026-09-15') are interpreted as a UTC date (NOT local).

    :raises InvalidDateError: if the value cannot be parsed
    """
    if isinstance(value, _dt.datetime):
        if value.year < 1 or value.year > 9999:
            raise InvalidDateError("out of range datetime")
        return _dt.datetime(value.year, value.month, value.day, tzinfo=_dt.timezone.utc)
    if isinstance(value, _dt.date):
        return _dt.datetime(value.year, value.month, value.day, tzinfo=_dt.timezone.utc)

    if isinstance(value, str):
        trimmed = value.strip()
        try:
            parsed = _dt.datetime.fromisoformat(trimmed.replace("Z", "+00:00"))
        except ValueError as exc:
            raise InvalidDateError(f"Invalid date string: {value}") from exc
        return _dt.datetime(parsed.year, parsed.month, parsed.day, tzinfo=_dt.timezone.utc)

    raise InvalidDateError(f"Invalid date value: {value!r}")


def compute_advance_days(travel_date, collection_date):
    """Whole UTC days between a collection date and a travel date.

    ``advance_days = travelDate - collectionDate``. A 0 or negative result
    (travel on/before collection) is intentional so callers can detect and flag
    nonsensical data.
    """
    travel = parse_utc_date(travel_date)
    collection = parse_utc_date(collection_date)
    return (travel - collection).days


def format_utc_date(value):
    """Format a date (or date string) as YYYY-MM-DD in UTC."""
    d = parse_utc_date(value)
    return f"{d.year:04d}-{d.month:02d}-{d.day:02d}"


def to_js_iso(value):
    """Serialise a date/datetime exactly like JS ``Date.toISOString()``.

    Produces ``2026-09-15T00:00:00.000Z`` (millisecond precision, UTC).
    """
    d = value
    if isinstance(d, _dt.date) and not isinstance(d, _dt.datetime):
        d = _dt.datetime(d.year, d.month, d.day, tzinfo=_dt.timezone.utc)
    if isinstance(d, _dt.datetime):
        if d.tzinfo is None:
            d = d.replace(tzinfo=_dt.timezone.utc)
        d = d.astimezone(_dt.timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"


def to_travel_date(value):
    """ISO date used by the Fare ``travelDate`` field (midnight UTC)."""
    return parse_utc_date(value)