"""Fare normalization (Python port of src/services/fareNormalizer.js).

Currency/amount parsing + construction of the canonical Fare record.
Currencies are NEVER silently converted; the detected currency is preserved.
"""

import math
import re
from datetime import datetime, timezone

from ..utils.date_utils import compute_advance_days, to_travel_date

_CURRENCY_PATTERNS = [
    (re.compile(r"rs\.?\s*", re.IGNORECASE), "INR"),
    (re.compile(r"\u20b9"), "INR"),  # ₹
    (re.compile(r"inr\s*", re.IGNORECASE), "INR"),
    (re.compile(r"usd\s*", re.IGNORECASE), "USD"),
    (re.compile(r"\$\s*"), "USD"),
    (re.compile(r"eur\s*", re.IGNORECASE), "EUR"),
    (re.compile(r"\u20ac\s*"), "EUR"),  # €
    (re.compile(r"gbp\s*", re.IGNORECASE), "GBP"),
    (re.compile(r"\u00a3\s*"), "GBP"),  # £
    (re.compile(r"aed\s*", re.IGNORECASE), "AED"),
    (re.compile(r"\u062f\.?\s?\.?\u0625", re.IGNORECASE), "AED"),  # د.إ
]


def _js_number(value):
    """Convert a float with an integral value to an int (JS number rendering).

    JS ``JSON.stringify(4599)`` prints ``4599`` (no trailing ``.0``); Python
    must do the same so stored JSON matches byte-for-byte where possible.
    """
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def parse_fare_amount(raw, fallback_currency="INR"):
    """Map a human-written price like ``₹4,599`` / ``INR 4,599`` / ``4,599``
    into ``{"amount", "currency"}``.

    Rules:
      - strip thousands separators (commas, spaces, NBSP)
      - remove currency symbols / ISO codes / suffix words
      - NEVER silently convert between currencies; the detected currency is kept
      - when no currency signal is present, use ``fallback_currency``
    """
    if raw is None or raw == "":
        return {"amount": None, "currency": fallback_currency}
    if isinstance(raw, (int, float)):
        if not isinstance(raw, bool):
            if not math.isfinite(raw):
                return {"amount": None, "currency": fallback_currency}
            return {"amount": _js_number(raw), "currency": fallback_currency}

    text = str(raw).replace("\u00a0", " ")

    detected = None
    cleaned = text
    for pattern, code in _CURRENCY_PATTERNS:
        if pattern.search(cleaned):
            detected = code
            cleaned = pattern.sub(" ", cleaned)
            break

    cleaned = re.sub(r"[^0-9.,\-]", "", cleaned).strip()

    normalized = cleaned
    if re.fullmatch(r"\d{1,3}(\.\d{3})+(,\d{2})", normalized):
        # European style "4.599,50" -> dots are thousands separators
        normalized = normalized.replace(".", "").replace(",", ".")
    else:
        # Standard style: strip commas, keep a single dot as the decimal separator.
        normalized = normalized.replace(",", "")
        if normalized.count(".") > 1:
            # "4.599.50" -> treat dots as thousands separators, keep last dot
            parts = normalized.split(".")
            normalized = "".join(parts[:-1]) + "." + parts[-1]

    if normalized == "" or normalized == "-":
        return {"amount": None, "currency": None}

    try:
        amount = float(normalized)
    except ValueError:
        return {"amount": None, "currency": None}

    if not math.isfinite(amount):
        return {"amount": None, "currency": None}

    return {"amount": _js_number(amount), "currency": detected or fallback_currency}


def _fk(raw, key):
    value = raw.get(key, None)
    return None if value is None else value


def normalize_raw_fare(raw, context=None):
    """Normalize a raw fare object into the canonical Fare record shape.

    :param raw: dict produced by a source adapter.
    :param context: dict with ``source``, ``origin``, ``destination``,
                    ``travelDate``, optional ``collectionDate``, ``currency``.
    :returns: normalized fare dict (as ``normalizeRawFare`` in JS).
    """
    context = context or {}
    collection_date = context.get("collectionDate") or datetime.now(timezone.utc)
    travel_date = to_travel_date(context.get("travelDate") or raw.get("travelDate"))

    total = parse_fare_amount(_fk(raw, "totalFare"), context.get("currency") or "INR")
    component_currency = total.get("currency") or context.get("currency") or "INR"
    base = parse_fare_amount(_fk(raw, "baseFare"), component_currency)
    taxes = parse_fare_amount(_fk(raw, "taxes"), component_currency)
    udf = parse_fare_amount(_fk(raw, "udf"), component_currency)
    conv = parse_fare_amount(_fk(raw, "convenienceFee"), component_currency)

    origin = str(raw.get("origin") or context.get("origin") or "").upper().strip()
    destination = str(raw.get("destination") or context.get("destination") or "").upper().strip()

    normalized = {
        "origin": origin,
        "destination": destination,
    }

    route = raw.get("route") or (f"{origin}-{destination}" if origin and destination else None)
    airline = str(raw.get("airline")).strip() if raw.get("airline") else None
    flight_number = (
        re.sub(r"\s+", "", str(raw.get("flightNumber"))).upper().strip()
        if raw.get("flightNumber")
        else None
    )
    fare_class = str(raw.get("fareClass")).strip() if raw.get("fareClass") else None
    source = context.get("source")

    if route:
        normalized["route"] = route
    if airline:
        normalized["airline"] = airline
    if flight_number:
        normalized["flightNumber"] = flight_number

    normalized["travelDate"] = travel_date
    normalized["collectionDate"] = to_travel_date(collection_date)
    normalized["advanceDays"] = compute_advance_days(travel_date, collection_date)

    if fare_class:
        normalized["fareClass"] = fare_class

    normalized["baseFare"] = base.get("amount")
    normalized["taxes"] = taxes.get("amount")
    normalized["udf"] = udf.get("amount")
    normalized["convenienceFee"] = conv.get("amount")
    normalized["totalFare"] = total.get("amount")
    normalized["currency"] = total.get("currency") or context.get("currency") or "INR"
    normalized["availability"] = str(raw.get("availability")).upper() if raw.get("availability") else "AVAILABLE"
    if source:
        normalized["source"] = source
    normalized["scrapedAt"] = datetime.now(timezone.utc)
    normalized["dataQuality"] = "VALID"

    return normalized


__all__ = ["parse_fare_amount", "normalize_raw_fare"]