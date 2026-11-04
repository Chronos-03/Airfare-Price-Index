"""JSON file store / default persistence layer (Python port of
src/services/fileStore.js).

Fares are appended to JSON Lines files rolled per travel date:
  ``output/fares-YYYY-MM-DD.jsonl`` (one complete fare object per line).
DGCA statistics are written as a single JSON document per report period:
  ``output/dgca-YYYY-MM.json``.

Writing is skipped when ``config.json_export['enabled']`` is False
(``JSON_EXPORT_ENABLED=false`` in the env) or ``opts['enabled']`` is False.
"""

import threading
from datetime import datetime, timezone
from pathlib import Path

from ..config import config
from ..utils.date_utils import format_utc_date
from ..utils.jsonutil import dumps
from ..utils.logger import logger

_append_lock = threading.Lock()


def _json_export_enabled(opts):
    if "enabled" in opts and opts["enabled"] is not None:
        return opts["enabled"]
    return config.json_export["enabled"]


def _resolve_dir(opts):
    return opts.get("dir") or config.json_export["dir"]


def _fare_file_for(fare, output_dir):
    date = format_utc_date(fare["travelDate"]) if fare and fare.get("travelDate") else format_utc_date(datetime.now(timezone.utc))
    return str(Path(output_dir) / f"fares-{date}.jsonl")


def store_fares(fares, opts=None):
    """Append fares to ``output/fares-<travelDate>.jsonl``, one JSON per line.

    :returns: ``{"attempted", "saved", "duplicates", "invalid", "disabled"?"}``
    """
    opts = opts or {}
    if not fares:
        return {"attempted": 0, "saved": 0, "duplicates": 0, "invalid": []}
    if not _json_export_enabled(opts):
        return {"attempted": len(fares), "saved": 0, "duplicates": 0, "invalid": [], "disabled": True}

    output_dir = Path(_resolve_dir(opts))
    output_dir.mkdir(parents=True, exist_ok=True)

    rows = "\n".join(dumps(fare) for fare in fares) + "\n"
    with _append_lock:
        with open(_fare_file_for(fares[0], output_dir), "a", encoding="utf-8") as fh:
            fh.write(rows)

    logger.debug("storeFares wrote", {"count": len(fares), "dir": str(output_dir)})
    return {"attempted": len(fares), "saved": len(fares), "duplicates": 0, "invalid": []}


def store_fare(fare, opts=None):
    """Write a normalized fare as a single JSON line into its date file."""
    if not fare:
        return {"saved": 0}
    result = store_fares([fare], opts)
    return {"saved": result["saved"], "duplicate": False}


def count_fares_for_date(travel_date, opts=None):
    """Number of lines currently stored for a given travel date (0 if absent)."""
    opts = opts or {}
    output_dir = _resolve_dir(opts)
    file_path = Path(output_dir) / f"fares-{format_utc_date(travel_date)}.jsonl"
    if not file_path.exists():
        return 0
    text = file_path.read_text(encoding="utf-8")
    if not text:
        return 0
    return len(text.rstrip().split("\n"))


def write_dgca_report(parsed, meta, opts=None):
    """Write a parsed DGCA report as one JSON document per period.

    :param meta: ``{"reportPeriod", "reportType", "reportTitle", "reportUrl"}``
    :returns: ``{"saved", "duplicates", "airlines", "file"}``
    """
    opts = opts or {}
    report_period = meta.get("reportPeriod")
    report_type = meta.get("reportType")
    report_title = meta.get("reportTitle")
    report_url = meta.get("reportUrl")

    if not report_period:
        raise ValueError("writeDgcaReport: reportPeriod is required")

    if not _json_export_enabled(opts):
        return {
            "saved": 0,
            "duplicates": 0,
            "airlines": len(parsed["airlines"]),
            "file": None,
            "disabled": True,
        }

    output_dir = Path(_resolve_dir(opts))
    output_dir.mkdir(parents=True, exist_ok=True)

    overall = parsed["overall"]

    def lakhs_to_pax(value):
        return None if value is None else value * 100000

    rows = []
    for r in parsed["airlines"]:
        rows.append(
            {
                "reportPeriod": report_period,
                "reportType": report_type,
                "reportTitle": report_title,
                "reportUrl": report_url,
                "airline": r["airline"],
                "passengersCarried": lakhs_to_pax(r["passengersCarriedLakhs"]),
                "passengersCarriedLakhs": r["passengersCarriedLakhs"],
                "marketSharePct": r["marketSharePct"],
                "overall": overall,
                "dedupeKey": f"dgca|{report_type}|{report_period}|{r['airline']}",
            }
        )

    rows.append(
        {
            "reportPeriod": report_period,
            "reportType": report_type,
            "reportTitle": report_title,
            "reportUrl": report_url,
            "airline": "TOTAL",
            "passengersCarried": lakhs_to_pax(overall["passengersCarriedTotalLakhs"]),
            "passengersCarriedLakhs": overall["passengersCarriedTotalLakhs"],
            "marketSharePct": 100,
            "overall": overall,
            "dedupeKey": f"dgca|{report_type}|{report_period}|TOTAL",
        }
    )

    doc = {
        "reportPeriod": report_period,
        "reportType": report_type,
        "reportTitle": report_title,
        "reportUrl": report_url,
        "source": "dgca",
        "scrapedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z",
        "overall": overall,
        "stats": rows,
    }

    file_path = Path(output_dir) / f"dgca-{report_period}.json"
    file_path.write_text(dumps(doc, indent=2) + "\n", encoding="utf-8")

    logger.debug("writeDgcaReport wrote", {"file": str(file_path), "rows": len(rows)})
    return {"saved": len(rows), "duplicates": 0, "airlines": len(parsed["airlines"]), "file": str(file_path)}


__all__ = ["store_fares", "store_fare", "count_fares_for_date", "write_dgca_report"]