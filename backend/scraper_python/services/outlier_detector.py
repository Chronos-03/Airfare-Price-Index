"""Outlier detection (Python port of src/services/outlierDetector.js).

Flags suspicious fares (₹50, ₹999999, mixed-up components, ...) WITHOUT deleting
them. Flagged records keep ``dataQuality: 'OUTLIER'`` and are retained.
Rules are configurable via ``config.outlier``.
"""

import math

from ..config import config


def detect_outlier(fare, overrides=None):
    """Check a validated, normalized fare against outlier rules.

    :param overrides: inline rule overrides ``{min_fare, max_fare,
                      component_mismatch_tolerance, min_mismatch_abs}``.
    :returns: ``{"is_outlier": bool, "reasons": list}``
    """
    rules = {k: config.outlier[k] for k in config.outlier}
    rules.update(overrides or {})
    reasons = []

    total = fare.get("totalFare")
    base = fare.get("baseFare")

    min_fare = rules["min_fare"]
    max_fare = rules["max_fare"]

    if total is not None:
        if total < min_fare:
            reasons.append(f"totalFare {total} below minimum threshold {min_fare}")
        if total > max_fare:
            reasons.append(f"totalFare {total} above maximum threshold {max_fare}")

    if base is not None:
        if base < min_fare and base > 0:
            reasons.append(f"baseFare {base} below minimum threshold {min_fare}")
        if base > max_fare:
            reasons.append(f"baseFare {base} above maximum threshold {max_fare}")

    components = [
        fare.get("baseFare"),
        fare.get("taxes"),
        fare.get("udf"),
        fare.get("convenienceFee"),
    ]
    known = [
        c for c in components
        if c is not None and isinstance(c, (int, float)) and math.isfinite(c)
    ]

    if total is not None and known and isinstance(total, (int, float)) and math.isfinite(total):
        component_sum = sum(known)
        abs_diff = abs(total - component_sum)
        tolerance = (
            float("inf")
            if total == 0
            else abs(total) * rules["component_mismatch_tolerance"]
        )
        if abs_diff > rules["min_mismatch_abs"] and abs_diff > tolerance:
            reasons.append(
                f"totalFare {total} inconsistent with component sum {component_sum} (diff {abs_diff})"
            )

    for field in ("totalFare", "baseFare", "taxes", "udf", "convenienceFee"):
        value = fare.get(field)
        if value is not None and value < 0:
            reasons.append(f"{field} is negative")

    return {"is_outlier": len(reasons) > 0, "reasons": reasons}


__all__ = ["detect_outlier"]