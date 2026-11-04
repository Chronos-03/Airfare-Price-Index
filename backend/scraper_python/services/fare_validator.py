"""Validation layer (Python port of src/services/fareValidator.js + model enums).

A record is either ``valid`` (can be stored as-is) or ``invalid`` (violates
schema constraints and must not be stored). Reasons are logged/counted.
"""

import math
import re
from datetime import datetime

AVAILABILITY = [
    "AVAILABLE",
    "SOLD_OUT",
    "CANCELLED",
    "NOT_FOUND",
    "SCRAPE_ERROR",
    "INVALID",
]

DATA_QUALITY = ["VALID", "OUTLIER", "INVALID", "DUPLICATE"]

IATA_CODE = re.compile(r"^[A-Z0-9]{3}$")

VALID_CURRENCIES = {
    "INR", "USD", "EUR", "GBP", "AED", "SGD", "JPY", "CAD", "AUD", "CNY",
}


def _assert_non_negative(fare, field, errors):
    value = fare.get(field)
    if value is None or value == "":
        return  # absent components are allowed (null)
    try:
        num = float(value)
    except (TypeError, ValueError):
        errors.append(f"{field} must be a finite number")
        return
    if not math.isfinite(num):
        errors.append(f"{field} must be a finite number")
    elif num < 0:
        errors.append(f"{field} must be non-negative")


def validate_fare(fare):
    """Validate a normalized fare.

    :returns: ``{"valid": bool, "errors": list, "warnings": list}``
    """
    errors = []
    warnings = []

    origin = fare.get("origin")
    if not origin or not isinstance(origin, str):
        errors.append("origin is required")
    elif not IATA_CODE.match(origin.strip().upper()):
        errors.append(f"origin '{origin}' is not a valid 3-letter IATA-like code")

    destination = fare.get("destination")
    if not destination or not isinstance(destination, str):
        errors.append("destination is required")
    elif not IATA_CODE.match(destination.strip().upper()):
        errors.append(f"destination '{destination}' is not a valid 3-letter IATA-like code")

    if origin and destination:
        if origin.strip().upper() == destination.strip().upper():
            errors.append("origin must differ from destination")

    travel_date = fare.get("travelDate")
    if not travel_date:
        errors.append("travelDate is required")
    elif isinstance(travel_date, datetime):
        pass  # a real datetime is always valid
    else:
        try:
            from ..utils.date_utils import parse_utc_date

            parse_utc_date(travel_date)
        except (TypeError, ValueError):
            errors.append(f"travelDate '{travel_date}' is not a valid date")

    for field in ("totalFare", "baseFare", "taxes", "udf", "convenienceFee"):
        _assert_non_negative(fare, field, errors)

    currency = str(fare.get("currency") or "").upper()
    if not currency:
        errors.append("currency is required")
    elif currency not in VALID_CURRENCIES:
        errors.append(f"currency '{fare.get('currency')}' is not supported")

    availability = str(fare.get("availability") or "").upper()
    if not availability:
        errors.append("availability is required")
    elif availability not in AVAILABILITY:
        errors.append(
            f"availability '{availability}' must be one of: {', '.join(AVAILABILITY)}"
        )

    source = fare.get("source")
    if not source or not isinstance(source, str):
        errors.append("source is required")

    return {"valid": len(errors) == 0, "errors": errors, "warnings": warnings}


__all__ = ["validate_fare", "IATA_CODE", "AVAILABILITY", "DATA_QUALITY"]