"""MongoDB store (OPT-IN persistence layer) - Python port of
src/services/mongoStore.js from the SIH2026 project.

The JSON file store is the default writer; this service mirrors its interface
so the pipeline can ALSO upsert normalized records into MongoDB when
``config.database['enabled']`` is true (``MONGO_WRITE_ENABLED=true`` or the CLI
``--mongo`` flag).

Writes are idempotent: every record carries a ``dedupeKey`` (guarded by a
unique sparse index), so re-scraping the same flight/class/date/source (or
re-syncing the same DGCA period) updates the existing document instead of
inserting a duplicate.

The connection is lazy and shared across callers.
"""

import threading
from datetime import datetime, timezone

from ..config import config
from ..utils.logger import logger

_client = None
_connected_uri = None
_lock = threading.Lock()

# Fields that Mongoose stores as BSON dates (the dashboard queries them with
# $gte/$lte on travelDate, so they must be real dates, not strings).
_DATE_FIELDS = ("travelDate", "collectionDate", "scrapedAt")


def _ensure_indexes(db):
    db["fares"].create_index([("dedupeKey", 1)], unique=True, sparse=True)
    db["dgcastats"].create_index([("dedupeKey", 1)], unique=True, sparse=True)


def _connect():
    """Establish the shared lazy MongoDB connection (idempotent)."""
    import pymongo

    global _client, _connected_uri
    uri = config.database.get("uri") or "mongodb://localhost:27017/flight_fares"
    with _lock:
        if _client is not None:
            return _client.get_database()
        client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=8000)
        try:
            db = client.get_database()
            db.command("ping")
            _ensure_indexes(db)
        except Exception:
            client.close()
            raise
        _client = client
        _connected_uri = uri
        logger.debug("mongoStore connected", {"uri": _connected_uri})
        return db


def is_enabled():
    """Whether the scrape pipeline is configured to write to MongoDB."""
    return bool(config.database and config.database.get("enabled"))


def close_connection():
    """Tear down any open connection (CLI shutdown)."""
    global _client, _connected_uri
    with _lock:
        if _client is not None:
            _client.close()
        _client = None
        _connected_uri = None


def _to_bson_dates(fare):
    """Convert JS-style ISO date strings to datetime so Mongo indexes/range
    queries work exactly like the Mongoose docs did."""
    out = dict(fare)
    for field in _DATE_FIELDS:
        value = out.get(field)
        if isinstance(value, str):
            try:
                out[field] = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                pass
    return out


def store_fares(fares):
    """Upsert normalized fares into MongoDB, keyed by dedupeKey.

    :returns: ``{"attempted", "saved", "duplicates", "invalid"}`` where
        ``saved`` counts newly-inserted docs and ``duplicates`` counts docs
        that already existed for that dedupeKey (updated in place).
    """
    list_to_write = [f for f in (fares or []) if f and f.get("dedupeKey")]
    if not list_to_write:
        return {"attempted": len(fares) if fares else 0, "saved": 0, "duplicates": 0, "invalid": []}

    db = _connect()
    collection = db["fares"]
    now = datetime.now(timezone.utc)

    upserted = 0
    matched = 0
    for fare in list_to_write:
        doc = _to_bson_dates(fare)
        doc.setdefault("createdAt", now)
        doc["updatedAt"] = now
        result = collection.update_one(
            {"dedupeKey": fare["dedupeKey"]},
            {"$set": doc},
            upsert=True,
        )
        if result.upserted_id is not None:
            upserted += 1
        else:
            matched += 1

    logger.debug("mongoStore.storeFares", {"attempted": len(list_to_write), "upserted": upserted, "matched": matched})
    return {"attempted": len(list_to_write), "saved": upserted, "duplicates": matched, "invalid": []}


def write_dgca_report(parsed, meta=None):
    """Upsert a parsed DGCA report into MongoDB, one DgcaStat document per
    airline plus a 'TOTAL' summary row (same row shape as the JSON store).

    :returns: ``{"saved", "duplicates", "airlines"}``
    """
    meta = meta or {}
    report_period = meta.get("reportPeriod")
    if not report_period:
        raise ValueError("mongoStore.writeDgcaReport: reportPeriod is required")

    db = _connect()
    collection = db["dgcastats"]
    now = datetime.now(timezone.utc)

    def row(r, airline):
        return {
            "airline": airline,
            "reportPeriod": report_period,
            "reportType": meta.get("reportType"),
            "reportTitle": meta.get("reportTitle"),
            "reportUrl": meta.get("reportUrl"),
            "passengersCarried": None if r.get("passengersCarriedLakhs") is None else r["passengersCarriedLakhs"] * 100000,
            "passengersCarriedLakhs": r.get("passengersCarriedLakhs"),
            "marketSharePct": r.get("marketSharePct"),
            "overall": parsed.get("overall"),
            "dedupeKey": f"dgca|{meta.get('reportType')}|{report_period}|{airline}",
        }

    rows = [row(r, r["airline"]) for r in parsed.get("airlines") or []]
    overall = parsed.get("overall") or {}
    rows.append(row(overall, "TOTAL"))
    # 'passengersCarriedTotalLakhs' is the total field name in `overall`.
    rows[-1]["passengersCarriedLakhs"] = overall.get("passengersCarriedTotalLakhs")
    rows[-1]["passengersCarried"] = (
        None if overall.get("passengersCarriedTotalLakhs") is None else overall["passengersCarriedTotalLakhs"] * 100000
    )

    upserted = 0
    matched = 0
    for doc in rows:
        doc.setdefault("createdAt", now)
        doc["updatedAt"] = now
        result = collection.update_one({"dedupeKey": doc["dedupeKey"]}, {"$set": doc}, upsert=True)
        if result.upserted_id is not None:
            upserted += 1
        else:
            matched += 1

    logger.debug("mongoStore.writeDgcaReport", {"reportPeriod": report_period, "upserted": upserted, "matched": matched})
    return {"saved": upserted, "duplicates": matched, "airlines": len(rows) - 1}


__all__ = ["store_fares", "write_dgca_report", "is_enabled", "close_connection", "_connect"]