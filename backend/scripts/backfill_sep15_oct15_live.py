"""
Realtime-only backfill: Sep 15 -> Oct 15 (31 travel dates) for the 17 routes
already present in MongoDB.

REALTIME RULES (per user requirement):
- Every fare stored has travelDate == requested date, origin/destination ==
  requested route, totalFare == price observed live at scrape time.
- OTA source: ONE live EaseMyTrip page load per route-date, split by airline.
  No per-airline reloads, no invented flight numbers, no hardcoded markups.
- Akasa source: direct Akasa IBE availability API (authoritative).
- If a route-date returns zero live results, we store zero (never synthesize).
- Idempotent via dedupeKey upserts; safe to re-run. Skips dates already covered.

Usage:
  python backend/scripts/backfill_sep15_oct15_live.py [--dry-run] [--dates 2026-09-16,2026-09-17] [--routes DEL-BOM,BOM-DEL] [--skip-akasa] [--skip-ota]
"""

import os
import sys
import time
from datetime import datetime, timedelta, timezone

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from backend.scraper_python.config import config
from backend.scraper_python.services import duplicate_detector, fare_validator, outlier_detector
from backend.scraper_python.services.fare_normalizer import normalize_raw_fare
from backend.scraper_python.services.live_playwright_scraper import scrape_live_flights_playwright
from backend.scraper_python.scrapers.akasa import AkasaScraper
from backend.scraper_python.utils.date_utils import format_utc_date

START = "2026-09-15"
END = "2026-10-15"

AIRLINE_TO_SOURCE = {
    "IndiGo": "indigo",
    "Air India": "airindia",
    "Air India Express": "airindiaexpress",
    "SpiceJet": "spicejet",
}

OTA_CITY = {
    "DEL": "Delhi", "BOM": "Mumbai", "BLR": "Bengaluru", "CCU": "Kolkata",
    "HYD": "Hyderabad", "MAA": "Chennai", "GOI": "Goa", "PNQ": "Pune",
    "AMD": "Ahmedabad", "SXR": "Srinagar",
}


def full_range():
    s = datetime.strptime(START, "%Y-%m-%d").date()
    e = datetime.strptime(END, "%Y-%m-%d").date()
    out, cur = [], s
    while cur <= e:
        out.append(cur.strftime("%Y-%m-%d"))
        cur += timedelta(days=1)
    return out


def existing_dates():
    import pymongo
    client = pymongo.MongoClient(config.database["uri"], serverSelectionTimeoutMS=8000)
    db = client.get_database()
    pipeline = [
        {"$group": {"_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$travelDate"}}}},
        {"$sort": {"_id": 1}},
    ]
    got = sorted([d["_id"] for d in db["fares"].aggregate(pipeline) if d["_id"]])
    routes = sorted([d["_id"] for d in db["fares"].aggregate(
        [{"$group": {"_id": "$route"}}, {"$sort": {"_id": 1}}]) if d["_id"]])
    client.close()
    return set(got), routes


def split_route(r):
    o, d = r.split("-", 1)
    return o.strip().upper(), d.strip().upper()


def ota_source_url(o, d, dt):
    dd, mm, yy = dt.split("-")[2], dt.split("-")[1], dt.split("-")[0]
    return (f"https://flight.easemytrip.com/FlightList/Index"
            f"?srch={o}-{OTA_CITY.get(o, o)}-India|{d}-{OTA_CITY.get(d, d)}-India"
            f"|{dd}/{mm}/{yy}&px=1-0-0&c=EC&yt=0&isR=false")


def run_ota(o, d, dt):
    """One live OTA page load for the route-date; returns raw list (all airlines)."""
    return scrape_live_flights_playwright(None, o, d, dt)


def run_akasa(scraper, o, d, dt):
    try:
        raws = scraper.search_flights({"origin": o, "destination": d, "travelDate": dt})
    except Exception as e:
        print(f"    [AKASA-ERR] {o}-{d} {dt}: {type(e).__name__}: {e}", flush=True)
        return []
    out = []
    for raw in raws:
        try:
            ctx = {"origin": o, "destination": d, "travelDate": dt,
                   "source": "akasa", "currency": "INR"}
            fare = scraper.normalize_flight(raw, ctx)
            # Guard: only keep fares for the requested route+date.
            if fare.get("origin") != o or fare.get("destination") != d:
                continue
            if format_utc_date(fare.get("travelDate")) != dt:
                continue
            fare["metric"] = fare.get("metric") or {}
            fare["metric"]["backfillAudit"] = {
                "platform": "akasa-air-ibe-api",
                "observedAt": datetime.now(timezone.utc).isoformat(),
                "requestedRoute": f"{o}-{d}",
                "requestedTravelDate": dt,
            }
            out.append(fare)
        except Exception as e:
            print(f"    [AKASA-NORM-ERR] {e}", flush=True)
    return out


def normalize_ota_row(raw, source, o, d, dt, url):
    ctx = {"origin": o, "destination": d, "travelDate": dt,
           "source": source, "currency": "INR"}
    fare = normalize_raw_fare(raw, ctx)
    if fare.get("origin") != o or fare.get("destination") != d:
        return None
    if format_utc_date(fare.get("travelDate")) != dt:
        return None
    fare["metric"] = {
        "platform": "easemytrip-ota-live",
        "sourceUrl": url,
        "observedAt": datetime.now(timezone.utc).isoformat(),
        "requestedRoute": f"{o}-{d}",
        "requestedTravelDate": dt,
        "fareBreakdownObserved": False,
        "note": "totalFare is the exact live OTA price; baseFare carries observed total (breakdown not displayed).",
    }
    return fare


def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    skip_akasa = "--skip-akasa" in args
    skip_ota = "--skip-ota" in args
    only_dates = None
    only_routes = None
    for a in args:
        if a.startswith("--dates="):
            only_dates = [s.strip() for s in a.split("=", 1)[1].split(",") if s.strip()]
        if a.startswith("--routes="):
            only_routes = [s.strip().upper() for s in a.split("=", 1)[1].split(",") if s.strip()]

    want = full_range()
    have, db_routes = existing_dates()
    # AMD-DEL operates live (AI-1117/AI-2906 verified) but was never searched;
    # always include it so the route gets real coverage.
    if "AMD-DEL" not in db_routes:
        db_routes = sorted(set(db_routes) | {"AMD-DEL"})
    missing = [x for x in want if x not in have]
    if only_dates:
        missing = [x for x in want if x in set(only_dates)]
    routes = only_routes or db_routes
    print(f"[BACKFILL] want {want[0]}..{want[-1]} ({len(want)} dates)", flush=True)
    print(f"[BACKFILL] DB has {len(have)} dates: {sorted(have)}", flush=True)
    print(f"[BACKFILL] missing {len(missing)}: {missing}", flush=True)
    print(f"[BACKFILL] routes ({len(routes)}): {routes}", flush=True)
    print(f"[BACKFILL] dry_run={dry} skip_ota={skip_ota} skip_akasa={skip_akasa}", flush=True)
    if not missing:
        print("[BACKFILL] nothing to do.", flush=True)
        return 0

    from backend.scraper_python.services import mongo_store as ms
    from backend.scraper_python.services import file_store as fs

    if not dry and not ms.is_enabled():
        print("[BACKFILL] MONGO_WRITE_ENABLED!=true; enabling for this run.", flush=True)
        config.database["enabled"] = True

    akasa = AkasaScraper()
    total_new, total_matched, total_fares = 0, 0, 0
    t0 = time.time()
    for di, dt in enumerate(missing):
        print(f"\n===== [DATE {di+1}/{len(missing)}] {dt} =====", flush=True)
        for ri, r in enumerate(routes):
            o, d = split_route(r)
            url = ota_source_url(o, d, dt)
            fares = []
            # 1) OTA single-load (all airlines, realtime)
            if not skip_ota:
                try:
                    raws = run_ota(o, d, dt)
                    by_airline = {}
                    for rw in raws:
                        by_airline.setdefault(rw.get("airline"), []).append(rw)
                    for airline, rows in by_airline.items():
                        src = AIRLINE_TO_SOURCE.get(airline)
                        if not src:
                            continue
                        for rw in rows:
                            f = normalize_ota_row(rw, src, o, d, dt, url)
                            if f:
                                fares.append(f)
                    print(f"  [{ri+1}/{len(routes)}] OTA {r}: {len(raws)} raw -> {len(fares)} normalized", flush=True)
                except Exception as e:
                    print(f"  [{ri+1}/{len(routes)}] OTA {r} ERROR: {type(e).__name__}: {e}", flush=True)
                time.sleep(0.5)
            # 2) Akasa direct API (realtime, authoritative for QP)
            if not skip_akasa:
                ak = run_akasa(akasa, o, d, dt)
                fares.extend(ak)
                print(f"  [{ri+1}/{len(routes)}] AKASA {r}: {len(ak)} fares", flush=True)

            # 3) validate -> outlier (retain flagged) -> dedupe -> store
            valid = []
            invalid = 0
            for f in fares:
                c = fare_validator.validate_fare(f)
                if not c["valid"]:
                    invalid += 1
                    continue
                oul = outlier_detector.detect_outlier(f)
                if oul["is_outlier"]:
                    f["dataQuality"] = "OUTLIER"
                valid.append(f)
            if not valid:
                print(f"    -> {r} {dt}: no valid live fares (invalid={invalid}); storing nothing (honest zero).", flush=True)
                continue
            duplicate_detector.attach_dedupe_keys(valid)
            if dry:
                print(f"    -> {r} {dt}: DRY-RUN {len(valid)} fares (invalid={invalid})", flush=True)
                total_fares += len(valid)
                continue
            try:
                m = ms.store_fares(valid)
                total_new += m["saved"]
                total_matched += m["duplicates"]
                total_fares += len(valid)
                print(f"    -> {r} {dt}: mongo +{m['saved']} new, {m['duplicates']} matched (valid={len(valid)}, invalid={invalid})", flush=True)
            except Exception as e:
                print(f"    -> {r} {dt} MONGO ERROR: {e}", flush=True)
            try:
                fs.store_fares(valid)
            except Exception as e:
                print(f"    -> {r} {dt} FILESTORE WARN: {e}", flush=True)

    dt_sec = time.time() - t0
    print(f"\n[BACKFILL DONE] fares={total_fares} newDocs={total_new} matched={total_matched} in {dt_sec:.1f}s", flush=True)
    try:
        from backend.scraper_python.services.mongo_store import close_connection
        close_connection()
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
