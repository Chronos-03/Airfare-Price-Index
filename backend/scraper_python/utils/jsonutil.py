"""JSON datetime-safe serialiser matching the JS store output.

JS serialises ``Date`` values via ``Date.toISOString()`` (e.g.
``"2026-09-15T00:00:00.000Z"``); this module keeps that format on disk.
"""

import datetime as _dt
import json

from .date_utils import to_js_iso


def _default(obj):
    if isinstance(obj, _dt.datetime) or isinstance(obj, _dt.date):
        return to_js_iso(obj)
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def dumps(obj, indent=None):
    """Like ``json.dumps`` but with JS-compatible date serialisation."""
    return json.dumps(obj, default=_default, sort_keys=False, indent=indent)


def loads(text):
    """json.loads wrapper kept for symmetry."""
    return json.loads(text)