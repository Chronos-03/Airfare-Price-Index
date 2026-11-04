"""Scrape job runner (Python port of src/jobs/scrapeJob.js, spec #26/#27).

Expands route x date x source combinations and runs every cell through the
pipeline:

    retrieve (source adapter) -> normalize -> validate -> outlier detect
        -> dedupe -> store

A failure on ONE route must not terminate the whole job: each combination is
isolated and its error is captured in the per-route result.

Dry-run: pass ``save=False`` to run the full pipeline without persisting
anything and without dedupe-key/JSON-store bookkeeping (test mode used by the
CLI's --dry-run).
"""

import re
from datetime import datetime, timezone

from ..config import config
from ..scrapers import get_scraper, list_sources
from ..services import duplicate_detector, file_store, fare_validator, outlier_detector
from ..utils.date_utils import format_utc_date, to_travel_date
from ..utils.job_id import generate_job_id
from ..utils.logger import logger
from ..utils.rate_limiter import create_concurrency_limiter

_IATA_RE = re.compile(r"^[A-Z0-9]{3}$")


def normalize_input(input_data):
    """Expand raw input into route cells.
    Accepted shapes (mirrors the JS helper):
      { origin, destination, travelDate }                    (single)
      { routes: [{origin, destination}], travelDates: [...] }(matrix)
      { origin, destination, travelDates: [...] }            (single route, many dates)
    """
    if not input_data:
        raise ValueError("runScrapeJob: input is required")

    routes = None
    if isinstance(input_data.get("routes"), list) and input_data["routes"]:
        routes = input_data["routes"]
    elif input_data.get("origin") and input_data.get("destination"):
        routes = [{"origin": input_data["origin"], "destination": input_data["destination"]}]
    else:
        raise ValueError("runScrapeJob: provide { origin, destination } or { routes: [...] }")

    travel_dates = None
    if isinstance(input_data.get("travelDates"), list) and input_data["travelDates"]:
        travel_dates = input_data["travelDates"]
    elif input_data.get("travelDate"):
        travel_dates = [input_data["travelDate"]]
    else:
        raise ValueError("runScrapeJob: provide travelDate or travelDates")

    return {
        "routes": [
            {"origin": str(r["origin"]).upper().strip(), "destination": str(r["destination"]).upper().strip()}
            for r in routes
        ],
        "travelDates": travel_dates,
    }


def validate_scrape_input(input_data):
    """Validate routes/dates/sources well-formedness WITHOUT running anything.
    Throws on bad input (mirrors JS validateScrapeInput)."""
    normalized = normalize_input(input_data)
    routes = normalized["routes"]
    travel_dates = normalized["travelDates"]

    if input_data.get("sources"):
        known = set(list_sources())
        for source in input_data["sources"]:
            if source not in known:
                raise ValueError(
                    f"Unknown source '{source}'. Available: {', '.join(list_sources())}"
                )

    for route in routes:
        if not _IATA_RE.match(route["origin"]):
            raise ValueError(f"Invalid origin IATA code: '{route['origin']}'")
        if not _IATA_RE.match(route["destination"]):
            raise ValueError(f"Invalid destination IATA code: '{route['destination']}'")
        if route["origin"] == route["destination"]:
            raise ValueError(f"origin and destination must differ for {route['origin']}")

    for date in travel_dates:
        try:
            to_travel_date(date)
        except ValueError:
            raise ValueError(f"Invalid travel date: '{date}'")


def scrape_one(combo, global_config, save):
    """Run one (route, date, source) cell. NEVER raises: errors are captured in
    the returned dict so a single failing cell cannot kill the whole job."""
    route = f"{combo['origin']}-{combo['destination']}"
    start = _now_ms()

    base_result = {
        "source": combo["source"],
        "origin": combo["origin"],
        "destination": combo["destination"],
        "route": route,
        "travelDate": to_travel_date(combo["travelDate"]),
        "status": "SUCCESS",
        "results": 0,
        "saved": 0,
        "exported": 0,
        "mongoSaved": 0,
        "valid": 0,
        "invalid": 0,
        "outliers": 0,
        "duplicates": 0,
        "startTime": _now_iso(),
        "error": None,
    }

    try:
        logger.info("[SCRAPE] start", {"source": combo["source"], "route": route, "date": format_utc_date(combo["travelDate"])})

        scraper = get_scraper(
            combo["source"],
            {
                "timeout": global_config.scraper["timeout"],
                "maxRetries": global_config.scraper["max_retries"],
                "retryDelay": global_config.scraper["retry_delay"],
            },
        )

        result = scraper.scrape(
            {
                "origin": combo["origin"],
                "destination": combo["destination"],
                "travelDate": combo["travelDate"],
                "currency": "INR",
            }
        )
        fares = result["fares"]

        base_result["results"] = len(fares)
        logger.debug("[SCRAPE] raw results", {"source": combo["source"], "route": route, "results": len(fares)})

        # Pipeline: validate -> outlier -> dedupe -> store
        valid_fares = []
        invalid_count = 0

        for fare in fares:
            check = fare_validator.validate_fare(fare)
            if not check["valid"]:
                invalid_count += 1
                logger.warn("[SCRAPE] invalid fare", {
                    "route": route, "source": combo["source"], "errors": "; ".join(check["errors"]),
                })
                continue

            outlier = outlier_detector.detect_outlier(fare)
            if outlier["is_outlier"]:
                fare["dataQuality"] = "OUTLIER"
                logger.warn("[SCRAPE] outlier fare retained", {
                    "route": route, "source": combo["source"],
                    "totalFare": fare["totalFare"], "reasons": "; ".join(outlier["reasons"]),
                })
            valid_fares.append(fare)

        base_result["invalid"] = invalid_count
        base_result["outliers"] = sum(1 for f in valid_fares if f.get("dataQuality") == "OUTLIER")

        # JSON file store: attach dedupe keys and append one fare per line to
        # output/<collectionDate>-fares-<travelDate>.jsonl (default persistence).
        storage = None
        if save:
            duplicate_detector.attach_dedupe_keys(valid_fares)
            try:
                storage = file_store.store_fares(valid_fares)
                base_result["exported"] = storage["saved"]
            except Exception as err:
                logger.warn("[SCRAPE] json store failed (continuing)", {"route": route, "source": combo["source"], "error": str(err)})

            # OPT-IN MongoDB persistence (MONGO_WRITE_ENABLED=true / --mongo).
            try:
                from ..services.mongo_store import is_enabled as _mongo_is_enabled
                from ..services.mongo_store import store_fares as _mongo_store_fares

                if _mongo_is_enabled() and valid_fares:
                    ms = _mongo_store_fares(valid_fares)
                    base_result["mongoSaved"] = ms["saved"]
            except Exception as err:
                logger.warn("[SCRAPE] mongo store failed (continuing)", {"route": route, "source": combo["source"], "error": str(err)})

        base_result["saved"] = storage["saved"] if storage else 0
        base_result["duplicates"] = storage["duplicates"] if storage else 0
        base_result["valid"] = (
            storage["saved"] + storage["duplicates"] if storage else len(valid_fares)
        )

        base_result["durationMs"] = _now_ms() - start
        base_result["endTime"] = _now_iso()

        logger.info("[SCRAPE] success", {
            "source": combo["source"], "route": route, "date": format_utc_date(combo["travelDate"]),
            "results": base_result["results"], "valid": base_result["valid"],
            "invalid": base_result["invalid"], "outliers": base_result["outliers"],
            "saved": base_result["saved"], "exported": base_result["exported"],
            "mongoSaved": base_result["mongoSaved"], "duplicates": base_result["duplicates"],
            "duration": f"{(base_result['durationMs'] / 1000):.1f}s",
        })
    except Exception as err:
        base_result["status"] = "ERROR"
        base_result["error"] = str(err)
        base_result["durationMs"] = _now_ms() - start
        base_result["endTime"] = _now_iso()
        logger.error("[SCRAPE] error", {"source": combo["source"], "route": route, "error": str(err)})

    return base_result


def _now_ms():
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _now_iso():
    now = datetime.now(timezone.utc)
    return f"{now.strftime('%Y-%m-%dT%H:%M:%S')}.{now.microsecond // 1000:03d}Z"


def aggregate(job_id, started_at, ended_at, results, total_combos):
    """Collapse per-route results into a single job summary (spec #27)."""
    successful = [r for r in results if r["status"] == "SUCCESS"]
    failed = [r for r in results if r["status"] == "ERROR"]

    summary = {
        "jobId": job_id,
        "startedAt": started_at,
        "endedAt": ended_at,
        "durationMs": _ms_between(started_at, ended_at),
        "totalCombos": total_combos,
        "totalRoutes": total_combos,
        "successfulRoutes": len(successful),
        "failedRoutes": len(failed),
        "flightsFound": sum(r.get("results") or 0 for r in results),
        "recordsSaved": sum(r.get("saved") or 0 for r in results),
        "mongoSaved": sum(r.get("mongoSaved") or 0 for r in results),
        "exported": sum(r.get("exported") or 0 for r in results),
        "duplicates": sum(r.get("duplicates") or 0 for r in results),
        "invalidRecords": sum(r.get("invalid") or 0 for r in results),
        "outliers": sum(r.get("outliers") or 0 for r in results),
        "routes": results,
    }
    return summary


def _ms_between(started_iso, ended_iso):
    from datetime import datetime

    fmt = "%Y-%m-%dT%H:%M:%S.%fZ"
    s = datetime.strptime(started_iso, fmt)
    e = datetime.strptime(ended_iso, fmt)
    return int((e - s).total_seconds() * 1000)


def run_scrape_job(input_data=None):
    """Run the full job. ``input`` accepts the same shapes as JS runScrapeJob
    plus ``save=False`` for dry-run. Returns the job summary."""
    input_data = input_data or {}
    normalized = normalize_input(input_data)
    routes = normalized["routes"]
    travel_dates = normalized["travelDates"]
    sources = input_data.get("sources") if input_data.get("sources") else list_sources()
    save = input_data.get("save", True)

    job_id = generate_job_id()
    started_at = _now_iso()

    logger.info("[JOB] starting", {
        "jobId": job_id, "sources": ",".join(sources),
        "routes": len(routes), "dates": len(travel_dates),
    })

    combos = []
    for route in routes:
        for travel_date in travel_dates:
            for source in sources:
                combos.append(
                    {"origin": route["origin"], "destination": route["destination"], "travelDate": travel_date, "source": source}
                )

    max_workers = input_data.get("concurrency") or config.scraper.get("concurrency", 4)
    try:
        max_workers = max(1, min(int(max_workers), 16))
    except (ValueError, TypeError):
        max_workers = 4

    results = []
    if len(combos) <= 1:
        for combo in combos:
            results.append(scrape_one(combo, config, save))
    else:
        import concurrent.futures
        logger.info("[WORKER_POOL] Dispatching tasks across concurrent workers", {"activeWorkers": max_workers, "totalCombos": len(combos)})
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_combo = {executor.submit(scrape_one, combo, config, save): combo for combo in combos}
            for future in concurrent.futures.as_completed(future_to_combo):
                try:
                    res = future.result()
                    results.append(res)
                except Exception as err:
                    combo = future_to_combo[future]
                    logger.error("[WORKER] Unhandled worker exception", {"route": f"{combo.get('origin')}-{combo.get('destination')}", "source": combo.get('source'), "error": str(err)})

    job = aggregate(job_id, started_at, _now_iso(), results, total_combos=len(combos))

    logger.info("[JOB] finished", {
        "jobId": job_id, "totalCombos": len(combos),
        "successful": job["successfulRoutes"], "failed": job["failedRoutes"],
        "flightsFound": job["flightsFound"], "recordsSaved": job["recordsSaved"],
        "mongoSaved": job["mongoSaved"], "exported": job["exported"],
        "duplicates": job["duplicates"], "invalidRecords": job["invalidRecords"],
        "outliers": job["outliers"], "durationMs": job["durationMs"],
    })

    return job


__all__ = ["run_scrape_job", "validate_scrape_input", "normalize_input", "scrape_one"]