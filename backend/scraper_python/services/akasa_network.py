"""Akasa network scrape service (Python port of src/services/akasaNetwork.js).

Scrapes fares for EVERY city pair in the Akasa route network (the live
``/api/nsk/v2/resources/markets`` list, not a hardcoded guess) across a
rolling window of dates (default: next 30 days).

Efficiency:
  - One availability/search request covers a GRID of origin x destination
    markets (station codes chunked at 30 per axis).
  - Journeys are grouped by actual route codes (segment designators), not the
    API's MAC-expanded market keys, and de-duplicated by journeyKey.
  - Everything flows through the same clean-data pipeline (validate -> outlier
    -> dedupe -> JSON file store) as a normal scrape.
"""

import json
import os
import re
import time
from datetime import datetime, timedelta, timezone

from ..config import config
from ..scrapers.akasa import AkasaHttpError, AkasaScraper
from ..utils.date_utils import DAY_MS, format_utc_date, parse_utc_date, to_travel_date
from ..utils.jsonutil import loads
from ..utils.logger import logger
from .duplicate_detector import attach_dedupe_keys
from .file_store import store_fares
from .fare_validator import validate_fare
from .outlier_detector import detect_outlier

# Grid request safety limit (server rejects > ~34 station codes per axis).
MAX_GRID_DIMENSION = 30

# Max retries per grid request for transient server/rate-limit failures.
MAX_GRID_RETRIES = 5

# Backoff base; observed throttle windows are ~10-30s, so use 1s steps.
_env_backoff = os.environ.get("AKASA_NETWORK_BACKOFF_MS")
GRID_BACKOFF_BASE_MS = float(_env_backoff) if _env_backoff and _env_backoff.isdigit() else 1000

# Pacing between grid requests so the real IBE survives a 30-day sweep.
_env_delay = os.environ.get("AKASA_NETWORK_DELAY_MS")
GRID_DELAY_MS = float(_env_delay) if _env_delay and _env_delay.isdigit() else 300

# Cache schema version; bump to invalidate stale caches.
NETWORK_CACHE_SCHEMA = 3

# Reference partner for the station probe (see JS source comments).
PROBE_DEST = "BOM"
PROBE_FALLBACK = ["BOM", "DEL", "BLR", "MAA"]

_INVALID_REQUEST_RE = re.compile(r"INVALID_REQUEST")


def _sleep(ms):
    time.sleep(ms / 1000.0)


def _base36(value):
    if value == 0:
        return "0"
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = []
    while value > 0:
        value, rem = divmod(value, 36)
        out.append(digits[rem])
    return "".join(reversed(out))


def chunk(arr, size):
    """Split ``arr`` into chunks of at most ``size``."""
    out = []
    for i in range(0, len(arr), size):
        out.append(arr[i : i + size])
    return out


def build_grids(routes):
    """Expand the directed market list into grid requests
    (one origin-chunk x one destination-chunk)."""
    origins = sorted({r["origin"] for r in routes})
    destinations = sorted({r["destination"] for r in routes})
    o_chunks = chunk(origins, MAX_GRID_DIMENSION)
    d_chunks = chunk(destinations, MAX_GRID_DIMENSION)

    grids = []
    for o_chunk in o_chunks:
        for d_chunk in d_chunks:
            o_set = set(o_chunk)
            d_set = set(d_chunk)
            grids.append(
                {
                    "origins": o_chunk,
                    "destinations": d_chunk,
                    "routes": [r for r in routes if r["origin"] in o_set and r["destination"] in d_set],
                }
            )
    return grids


def network_cache_file(output_dir=None):
    """Deterministic cache of the Akasa network list, keyed on a market fetch."""
    from pathlib import Path

    return str(Path(output_dir or config.json_export["dir"]) / "akasa-network.json")


def is_transient_failure(err):
    """A transient failure is a 5xx, a 429, network trouble, or the server's
    own INVALID_REQUEST when the (identical) body works on a fresh attempt."""
    status = getattr(err, "status", None)
    if status is not None:
        try:
            if status >= 500:
                return True
            if status == 429:
                return True
        except TypeError:
            pass
    if status is None:
        return True
    return bool(_INVALID_REQUEST_RE.search(str(getattr(err, "message", "") or str(err))))


def probe_pair(scraper, origin, destination, token, travel_date):
    """True when a 1x1 grid search resolves (transient failures are retried)."""
    for attempt in range(1, MAX_GRID_RETRIES + 1):
        try:
            scraper.search_grid(
                {"origins": [origin], "destinations": [destination], "travelDate": travel_date, "token": token}
            )
            return True
        except Exception as err:
            if not is_transient_failure(err) or attempt == MAX_GRID_RETRIES:
                return False
            _sleep(GRID_BACKOFF_BASE_MS * (2 ** (attempt - 1)))
    return False


def is_station_searchable(scraper, code, partner, token, travel_date):
    """Strict both-directions rule: a station is reachable if EITHER direction works."""
    return probe_pair(scraper, code, partner, token, travel_date) or probe_pair(
        scraper, partner, code, token, travel_date
    )


def probe_unsearchable_stations(scraper, stations, token, travel_date):
    """Determine which stations are accepted by the fare-search engine."""
    unsearchable = []
    for code in stations:
        partner = next((p for p in PROBE_FALLBACK if p != code), PROBE_DEST)
        if not is_station_searchable(scraper, code, partner, token, travel_date):
            unsearchable.append(code)
    return unsearchable


def refresh_cache_classification(scraper, cache_file, cached, token=None):
    """Re-probe the stations a cached pass classified as unreachable; restore
    those that now answer OK and rewrite the cache."""
    guest_token = token or scraper.get_guest_token()
    travel_date = format_utc_date(datetime.now(timezone.utc) + timedelta(days=1))
    still_unsearchable = []
    restored = []

    for code in cached.get("unsearchableStations") or []:
        partner = next((p for p in PROBE_FALLBACK if p != code), PROBE_DEST)
        if is_station_searchable(scraper, code, partner, guest_token, travel_date):
            restored.append(code)
        else:
            still_unsearchable.append(code)

    if not restored:
        logger.debug("akasaNetwork: cached classification confirmed")
        return cached

    logger.warn("[NETWORK] restored stations previously dropped", {"codes": ",".join(restored)})
    all_routes = cached.get("allRoutes") if isinstance(cached.get("allRoutes"), list) else cached.get("routes")
    routes = [
        r for r in all_routes
        if r.get("origin") not in still_unsearchable and r.get("destination") not in still_unsearchable
    ]
    doc = dict(cached)
    doc["fetchedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"
    doc["stations"] = sorted({r.get("origin") for r in all_routes} | {r.get("destination") for r in all_routes})
    doc["unsearchableStations"] = still_unsearchable
    doc["routes"] = routes

    import os

    os.makedirs(os.path.dirname(cache_file) or ".", exist_ok=True)
    with open(cache_file, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(doc, indent=2) + "\n")
    return doc


def get_active_markets(scraper, output_dir=None, refresh_network=False, verify_unsearchable=False, token=None):
    """Load the active directed market list (live API or cached file).

    :returns: ``{"schema", "fetchedAt", "allRoutes", "stations",
                 "unsearchableStations", "routes"}``
    """
    import os

    cache_file = network_cache_file(output_dir)

    if not refresh_network and os.path.exists(cache_file):
        try:
            with open(cache_file, "r", encoding="utf-8") as fh:
                cached = json.load(fh)
            if (
                isinstance(cached, dict)
                and cached.get("schema") == NETWORK_CACHE_SCHEMA
                and cached.get("fetchedAt")
                and isinstance(cached.get("routes"), list)
                and cached["routes"]
            ):
                if verify_unsearchable and isinstance(cached.get("unsearchableStations"), list) and cached["unsearchableStations"]:
                    return refresh_cache_classification(scraper, cache_file, cached, token)
                logger.debug("akasaNetwork: using cached market list", {"file": cache_file})
                return cached
        except Exception:
            pass  # fall through to a fresh fetch

    guest_token = token or scraper.get_guest_token()
    markets = scraper.fetch_markets(guest_token)
    routes = AkasaScraper.active_directed_markets(markets)
    if not routes:
        raise RuntimeError("Akasa network: no active markets returned")

    all_stations = sorted({r["origin"] for r in routes} | {r["destination"] for r in routes})
    travel_date = format_utc_date(datetime.now(timezone.utc) + timedelta(days=1))
    unsearchable = probe_unsearchable_stations(scraper, all_stations, guest_token, travel_date)
    if unsearchable:
        logger.warn("[NETWORK] dropping stations the fare engine rejects", {"codes": ",".join(sorted(unsearchable))})

    filtered_routes = [
        r for r in routes
        if r["origin"] not in unsearchable and r["destination"] not in unsearchable
    ]

    doc = {
        "schema": NETWORK_CACHE_SCHEMA,
        "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z",
        "allRoutes": routes,
        "stations": all_stations,
        "unsearchableStations": sorted(unsearchable),
        "routes": filtered_routes,
    }

    os.makedirs(os.path.dirname(cache_file) or ".", exist_ok=True)
    with open(cache_file, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(doc, indent=2) + "\n")

    return doc


def process_route(scraper, raw_list, route_context):
    """Normalize + validate + outlier-flag one route's raw journeys.

    :returns: ``{"fares": [], "invalid": int, "outliers": int}``
    """
    fares = []
    context = dict(route_context)
    context["source"] = "akasa"
    context["currency"] = config.akasa["currency"]
    invalid = 0
    outliers = 0

    for raw in raw_list:
        fare = scraper.normalize_flight(raw, context)
        check = validate_fare(fare)
        if not check["valid"]:
            invalid += 1
            logger.warn("[NETWORK] invalid fare", {
                "route": f"{route_context['origin']}-{route_context['destination']}",
                "errors": "; ".join(check["errors"]),
            })
            continue
        outlier = detect_outlier(fare)
        if outlier["is_outlier"]:
            fare["dataQuality"] = "OUTLIER"
            outliers += 1
        fares.append(fare)

    return {"fares": fares, "invalid": invalid, "outliers": outliers}


def run_grid(scraper, grid, travel_date, token_state, process_fare):
    """Run one grid request for one date (401 -> token refresh; bounded backoff
    for transient failures; paced so the real API is not hammered).

    :returns: ``{"requests", "fares", "invalid", "outliers", "marketsFound"}``
    """
    attempts = 0
    res = None
    while True:
        attempts += 1
        try:
            res = scraper.search_grid(
                {
                    "origins": grid["origins"],
                    "destinations": grid["destinations"],
                    "travelDate": travel_date,
                    "token": token_state["value"],
                }
            )
            break
        except Exception as err:
            if getattr(err, "status", None) == 401:
                logger.warn("[NETWORK] grid request 401, refreshing token", {"route": travel_date})
                token_state["value"] = scraper.get_guest_token()
                if attempts >= MAX_GRID_RETRIES + 1:
                    raise err
                continue
            if is_transient_failure(err) and attempts <= MAX_GRID_RETRIES:
                wait = GRID_BACKOFF_BASE_MS * (2 ** (attempts - 1))
                logger.warn("[NETWORK] grid request transient failure, backing off", {
                    "route": travel_date,
                    "status": getattr(err, "status", None),
                    "attempt": attempts,
                    "wait_ms": wait,
                })
                _sleep(wait)
                continue
            raise err

    by_route = scraper.extract_journeys_by_route(res)
    fares = []
    invalid = 0
    outliers = 0
    for route in grid["routes"]:
        route_key = f"{route['origin']}-{route['destination']}"
        raw_list = by_route.get(route_key) or []
        if not raw_list:
            continue
        result = process_fare(raw_list, {"origin": route["origin"], "destination": route["destination"], "travelDate": travel_date})
        fares.extend(result["fares"])
        invalid += result["invalid"]
        outliers += result["outliers"]

    return {
        "requests": attempts,
        "fares": fares,
        "invalid": invalid,
        "outliers": outliers,
        "marketsFound": sum(
            1 for r in grid["routes"] if f"{r['origin']}-{r['destination']}" in by_route
        ),
    }


def run_network_scrape(opts=None):
    """Full Akasa network scrape.

    :param opts: ``{source, fromDate, days, outputDir, refreshNetwork, save, deps}``
    :returns: summary dict (same shape as the JS implementation).
    """
    opts = opts or {}
    source = opts.get("source", "akasa")
    from_date = opts.get("fromDate")
    days = opts.get("days", 30)
    output_dir = opts.get("outputDir")
    refresh_network = opts.get("refreshNetwork", False)
    save = opts.get("save", True)
    deps = opts.get("deps") or {}

    if source != "akasa":
        raise ValueError(f"Akasa network scrape requires source='akasa' (got '{source}')")

    scraper = deps.get("scraper") or AkasaScraper()
    store = deps.get("storeFares") or store_fares

    started_at = datetime.now(timezone.utc)

    base_date = to_travel_date(from_date) if from_date else parse_utc_date(datetime.now(timezone.utc))
    travel_dates = [format_utc_date(base_date + timedelta(days=i)) for i in range(days)]

    logger.info("[NETWORK] starting", {
        "source": source,
        "from": travel_dates[0],
        "to": travel_dates[-1] if travel_dates else None,
        "dates": len(travel_dates),
    })

    markets_doc = get_active_markets(
        scraper,
        output_dir=output_dir,
        refresh_network=refresh_network,
        verify_unsearchable=True,
    )
    routes = markets_doc["routes"]
    stations = markets_doc["stations"]
    grids = build_grids(routes)
    logger.info("[NETWORK] network loaded", {"markets": len(routes), "stations": len(stations), "grids": len(grids)})

    by_date = []
    all_by_route = {}
    dates_done = 0
    grids_failed = 0

    for travel_date in travel_dates:
        date_start = time.time() * 1000
        date_fares = []
        invalid = 0
        outliers = 0
        requests = 0
        failed = 0

        token_state = {"value": scraper.get_guest_token()}
        logger.debug("[NETWORK] token acquired")

        for gi, grid in enumerate(grids):
            if GRID_DELAY_MS > 0 and (gi > 0 or dates_done > 0):
                _sleep(GRID_DELAY_MS)
            try:
                result = run_grid(scraper, grid, travel_date, token_state, process_route)
                requests += result["requests"]
                invalid += result["invalid"]
                outliers += result["outliers"]
                date_fares.extend(result["fares"])
            except Exception as err:
                # A throttled grid must not kill the whole sweep.
                failed += 1
                grids_failed += 1
                logger.error("[NETWORK] grid failed after retries, continuing", {
                    "route": travel_date,
                    "grid": f"{len(grid['origins'])}x{len(grid['destinations'])}",
                    "message": str(err),
                })

        for fare in date_fares:
            key = f"{fare['origin']}-{fare['destination']}"
            all_by_route.setdefault(key, []).append(fare)

        saved = 0
        mongo_saved = 0
        if save and date_fares:
            attach_dedupe_keys(date_fares)
            st = store(date_fares, {"dir": output_dir})
            saved = st["saved"]

            # OPT-IN MongoDB persistence (MONGO_WRITE_ENABLED=true / --mongo).
            try:
                from ..services.mongo_store import is_enabled as _mongo_is_enabled
                from ..services.mongo_store import store_fares as _mongo_store_fares

                if _mongo_is_enabled():
                    ms = _mongo_store_fares(date_fares)
                    mongo_saved = ms["saved"] + ms["duplicates"]
            except Exception as err:
                logger.warn("[NETWORK] mongo store failed (continuing)", {"error": str(err)})

        by_date.append(
            {
                "travelDate": travel_date,
                "grids": len(grids),
                "requests": requests,
                "failed": failed,
                "marketsFound": len({f"{f['origin']}-{f['destination']}" for f in date_fares}),
                "fares": len(date_fares),
                "invalid": invalid,
                "outliers": outliers,
                "saved": saved if save else 0,
                "mongoSaved": mongo_saved if save else 0,
            }
        )

        logger.info("[NETWORK] date done", {
            "date": travel_date,
            "grids": len(grids),
            "requests": requests,
            "failed": failed,
            "fares": len(date_fares),
            "durationSec": f"{((time.time() * 1000 - date_start) / 1000):.1f}",
        })
        dates_done += 1

    ended_at = datetime.now(timezone.utc)

    def _sum(key):
        return sum(d.get(key, 0) for d in by_date)

    if travel_dates:
        first = to_travel_date(travel_dates[0])
        last = to_travel_date(travel_dates[-1])
    else:
        first = last = None

    summary = {
        "jobId": f"network-{_base36(int(time.time() * 1000))}",
        "source": source,
        "from": format_utc_date(first) if first else None,
        "to": format_utc_date(last) if last else None,
        "dates": len(travel_dates),
        "markets": len(routes),
        "stations": len(stations),
        "grids": len(grids),
        "requests": _sum("requests"),
        "gridsFailed": grids_failed,
        "marketsFound": len(all_by_route),
        "totalFares": _sum("fares"),
        "totalInvalid": _sum("invalid"),
        "totalOutliers": _sum("outliers"),
        "totalSaved": _sum("saved") if save else 0,
        "totalMongoSaved": _sum("mongoSaved") if save else 0,
        "startedAt": started_at.strftime("%Y-%m-%dT%H:%M:%S.") + f"{started_at.microsecond // 1000:03d}Z",
        "endedAt": ended_at.strftime("%Y-%m-%dT%H:%M:%S.") + f"{ended_at.microsecond // 1000:03d}Z",
        "durationMs": int((ended_at - started_at).total_seconds() * 1000),
        "byDate": by_date,
    }

    logger.info("[NETWORK] finished", {
        "dates": summary["dates"],
        "requests": summary["requests"],
        "marketsFound": summary["marketsFound"],
        "totalFares": summary["totalFares"],
        "totalSaved": summary["totalSaved"],
    })

    return summary


__all__ = [
    "MAX_GRID_DIMENSION",
    "MAX_GRID_RETRIES",
    "GRID_DELAY_MS",
    "NETWORK_CACHE_SCHEMA",
    "is_transient_failure",
    "probe_unsearchable_stations",
    "chunk",
    "build_grids",
    "get_active_markets",
    "run_network_scrape",
]