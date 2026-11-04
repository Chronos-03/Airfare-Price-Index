"""Deduplication (Python port of src/services/duplicateDetector.js).

A fare is a duplicate of another when ALL of these match:
  origin, destination, travelDate, airline, flightNumber, fareClass, source

The key is a deterministic SHA-1 over the normalized fields; a re-scrape of
the same flight updates the existing observation instead of inserting a row.
"""

import hashlib

from ..utils.date_utils import format_utc_date


def compute_dedupe_key(fare):
    """Deterministic hex digest keying on the 7 identifying fields."""
    canonical = "|".join(
        [
            str(fare.get("origin") or "").upper().strip(),
            str(fare.get("destination") or "").upper().strip(),
            format_utc_date(fare["travelDate"]) if fare.get("travelDate") else "",
            str(fare.get("airline") or "").upper().strip(),
            str(fare.get("flightNumber") or "").upper().strip(),
            str(fare.get("fareClass") or "").strip(),
            str(fare.get("source") or "").lower().strip(),
        ]
    )
    return hashlib.sha1(canonical.encode("utf-8")).hexdigest()


def attach_dedupe_keys(fares):
    """Attach ``dedupeKey`` to each provided fare (mutates and returns the list)."""
    for fare in fares:
        if fare:
            fare["dedupeKey"] = compute_dedupe_key(fare)
    return fares


__all__ = ["compute_dedupe_key", "attach_dedupe_keys"]