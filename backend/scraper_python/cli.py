"""CLI entrypoint (Python port of src/cli/cli.js).

Usage: python -m scraping_python --origin DEL --destination BOM --date 2026-09-15

Supports single and multi-route scraping. Multi-route runs can use
--config ./routes.json with:
    { "routes": [ { "origin": "DEL", "destination": "BOM" } ],
      "travelDates": ["2026-09-15", "2026-09-16"],
      "sources": ["example"] }

Subcommands:
    dgca       monthly DGCA air-traffic statistics sync
    network    scrape every Akasa city pair across a rolling window
"""

import sys
from pathlib import Path

from .config import config
from .jobs.scrape_job import run_scrape_job, validate_scrape_input
from .scrapers import list_sources
from .services.akasa_network import run_network_scrape
from .services.dgca_service import sync_monthly_report
from .utils.jsonutil import dumps
from .utils.logger import logger

HELP = """
Usage:
  python -m scraping_python -- [options]

Options:
  --origin <CODE>        Origin IATA code (e.g. DEL)
  --destination <CODE>   Destination IATA code (e.g. BOM)
  --date <YYYY-MM-DD>    Travel date (repeatable, or use --dates)
  --dates <a,b,c>        Comma-separated travel dates
  --source <name>        Scraper source key (repeatable; default: all)
  --config <file.json>   Multi-route JSON input:
                         { "routes": [...], "travelDates": [...], "sources": [...] }
  --dry-run              Scrape + normalize + validate but do not write files
  --mongo                Also upsert records into MongoDB (default: off unless
                         MONGO_WRITE_ENABLED=true)
  --no-json              Skip the JSON file store (use with --mongo to persist
                         ONLY to MongoDB)
  --concurrency <n>      Override SCRAPER_CONCURRENCY
  --max-retries <n>      Override SCRAPER_MAX_RETRIES
  --timeout <ms>         Override SCRAPER_TIMEOUT
  --no-db                Legacy alias: do not write files (same as --dry-run)
  --help                 Show this help

DGCA statistics:
  python -m scraping_python dgca [--month 2026-04] [--url <pdf>] [--no-db] [--output ./output]

Akasa NETWORK (every city pair Akasa serves, rolling window):
  python -m scraping_python network [--source akasa] [--from 2026-08-28] [--days 30]
                          [--output ./output] [--dry-run] [--refresh-network]

Examples:
  python -m scraping_python -- --origin DEL --destination BOM --date 2026-09-15
  python -m scraping_python -- --origin DEL --destination BOM --date 2026-09-15 --source example
  python -m scraping_python -- --config ./multi-route.json
  python -m scraping_python -- --origin DEL --destination BLR --dates 2026-09-15,2026-09-16 --source example --dry-run
"""


def parse_args(argv):
    """Replicates the JS arg parser: flags can appear in any order, subcommand
    tokens ('dgca'/'network') are ignored wherever they appear."""
    args = {"sources": [], "dates": [], "configPath": None, "flags": {}}
    i = 0
    while i < len(argv):
        arg = argv[i]

        def next_value():
            nonlocal i
            i += 1
            return argv[i]

        if arg in ("--help", "-h"):
            args["help"] = True
        elif arg == "--origin":
            args["origin"] = next_value()
        elif arg == "--destination":
            args["destination"] = next_value()
        elif arg == "--date":
            args["dates"].append(next_value())
        elif arg == "--dates":
            args["dates"].extend([s.strip() for s in next_value().split(",") if s.strip()])
        elif arg == "--source":
            args["sources"].extend([s.strip().lower() for s in next_value().split(",") if s.strip()])
        elif arg == "--config":
            args["configPath"] = next_value()
        elif arg == "--dry-run":
            args["flags"]["dryRun"] = True
        elif arg == "--mongo":
            args["flags"]["mongo"] = True
        elif arg == "--no-json":
            args["flags"]["noJson"] = True
        elif arg == "--no-db":
            args["flags"]["noDb"] = True
        elif arg == "--concurrency":
            args["flags"]["concurrency"] = int(next_value())
        elif arg == "--max-retries":
            args["flags"]["maxRetries"] = int(next_value())
        elif arg == "--timeout":
            args["flags"]["timeout"] = int(next_value())
        elif arg == "--month":
            args["month"] = next_value()
        elif arg == "--url":
            args["url"] = next_value()
        elif arg == "--output":
            args["output"] = next_value()
        elif arg == "--from":
            args["from"] = next_value()
        elif arg == "--days":
            args["days"] = int(next_value())
        elif arg == "--refresh-network":
            args["flags"]["refreshNetwork"] = True
        elif arg == "--list-sources":
            args["flags"]["listSources"] = True
        elif arg == "--api-run":
            args["apiRun"] = next_value()
        elif arg == "--api-out":
            args["apiOut"] = next_value()
        elif arg in ("dgca", "network"):
            pass  # subcommand token (dispatched by main())
        else:
            logger.warn(f"Unknown CLI argument ignored: {arg}")
        i += 1
    return args


def build_scrape_input(args):
    """Build scrape input from CLI args or a config file."""
    if args.get("configPath"):
        resolved = (Path(args["configPath"])).resolve()
        if not resolved.exists():
            raise ValueError(f"Config file not found: {resolved}")
        file_data = _read_json(resolved)
        if isinstance(file_data.get("sources"), list):
            args["sources"] = file_data["sources"]
        return {
            "routes": file_data["routes"],
            "travelDates": file_data["travelDates"],
            "sources": file_data["sources"],
        }

    if not args.get("origin") or not args.get("destination"):
        raise ValueError("Provide --origin/--destination/--date OR --config file.json")
    if not args["dates"]:
        raise ValueError("No travel date provided. Use --date 2026-09-15")
    return {
        "routes": [{"origin": args["origin"], "destination": args["destination"]}],
        "travelDates": args["dates"],
        "sources": args["sources"] if args["sources"] else list_sources(),
    }


def run_dgca_sync(args):
    """DGCA statistics subcommand: download the monthly air-traffic PDF, parse
    the airline market-share table + report totals and write dgca-<period>.json
    (plus the raw PDF/text audit trail when --output is given)."""
    dry_run = args["flags"].get("noDb")
    report_period = args.get("month") or config.dgca["report_period"]
    report_url = args.get("url") or config.dgca["report_url"]

    try:
        result = sync_monthly_report(
            report_period,
            url=report_url,
            save=not dry_run,
            output_dir=str(Path(args["output"]).resolve()) if args.get("output") else None,
        )
        sys.stdout.write("\n" + dumps(result, indent=2) + "\n")
        return 0
    except Exception as err:
        logger.error("DGCA sync failed", {"error": str(err)})
        return 1


def run_network_sync(args):
    """Akasa network subcommand: scrape every city pair in the Akasa network
    across a rolling window (default next 30 days)."""
    dry_run = args["flags"].get("dryRun") or args["flags"].get("noDb")
    days = args.get("days") if args.get("days") and args["days"] > 0 else 30

    try:
        summary = run_network_scrape(
            {
                "source": args["sources"][0] if args["sources"] else "akasa",
                "fromDate": args.get("from") or None,
                "days": days,
                "outputDir": str(Path(args["output"]).resolve()) if args.get("output") else None,
                "refreshNetwork": bool(args["flags"].get("refreshNetwork")),
                "save": not dry_run,
            }
        )
        sys.stdout.write("\n" + dumps(summary, indent=2) + "\n")
        return 0
    except Exception as err:
        logger.error("Akasa network scrape failed", {"error": str(err)})
        return 1


def run_api_mode(args):
    """Machine-readable scrape runner used by the (Express) API server.

    Reads a scrape config JSON (``{routes/travelDate, travelDates, sources,
    save}``), validates + runs it, and writes ``{"ok", "summary"|"error"}`` to
    ``--api-out`` so the Node controller can return 202/400/500 cleanly.
    """
    from pathlib import Path as _Path

    out_path = args.get("apiOut")
    exit_code = 0
    try:
        input_data = _read_json(args["apiRun"])
        validate_scrape_input(input_data)
        save = input_data.get("save", True)
        input_data["save"] = save
        if save:
            config.database["enabled"] = True
        summary = run_scrape_job(input_data)
        result = {"ok": True, "summary": summary}
    except ValueError as err:
        result = {"ok": False, "status": 400, "error": str(err)}
        exit_code = 2
    except Exception as err:
        result = {"ok": False, "status": 500, "error": str(err)}
        exit_code = 1
    finally:
        try:
            from .services.mongo_store import close_connection

            close_connection()
        except Exception:
            pass

    if out_path:
        _Path(out_path).write_text(dumps(result, indent=2), encoding="utf-8")
    else:
        sys.stdout.write(dumps(result, indent=2) + "\n")
    return exit_code


def main(argv=None):
    argv = sys.argv[1:] if argv is None else list(argv)

    args = parse_args(argv)

    if args.get("help"):
        sys.stdout.write(HELP)
        return 0

    # --mongo enables the optional MongoDB persistence layer for this run.
    if args["flags"].get("mongo"):
        config.database["enabled"] = True

    # --no-json disables the JSON file store for this run.
    if args["flags"].get("noJson"):
        config.json_export["enabled"] = False

    # Machine-readable modes used by the Express API server.
    if args.get("apiRun"):
        return run_api_mode(args)
    if args["flags"].get("listSources"):
        sys.stdout.write(dumps(list_sources(), indent=2) + "\n")
        return 0

    try:
        # Subcommand dispatch (matches `npm run scrape -- dgca ...`).
        subcommand = argv[0] if argv and argv[0] in ("dgca", "network") else None
        if subcommand == "dgca":
            return run_dgca_sync(args)
        if subcommand == "network":
            return run_network_sync(args)

        input_data = build_scrape_input(args)
        validate_scrape_input(input_data)

        dry_run = args["flags"].get("dryRun") or args["flags"].get("noDb")

        # Apply runtime overrides directly on the shared config so scrapers and
        # the job runner see them (same singleton approach as the JS CLI).
        if args["flags"].get("concurrency"):
            config.scraper["concurrency"] = args["flags"]["concurrency"]
        if args["flags"].get("maxRetries"):
            config.scraper["max_retries"] = args["flags"]["maxRetries"]
        if args["flags"].get("timeout"):
            config.scraper["timeout"] = args["flags"]["timeout"]

        input_data["save"] = not dry_run
        summary = run_scrape_job(input_data)
        sys.stdout.write("\n" + dumps(summary, indent=2) + "\n")
        return 0
    except Exception as err:
        logger.error("CLI fatal error", {"error": str(err)})
        return 1


def _read_json(path):
    import json

    with open(path, "r", encoding="utf-8-sig") as fh:
        return json.load(fh)


if __name__ == "__main__":
    sys.exit(main())