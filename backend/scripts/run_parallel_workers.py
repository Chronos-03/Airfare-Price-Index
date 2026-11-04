"""
run_parallel_workers.py - Multi-Threaded Scraper Worker Pool
Executes multi-route, multi-carrier, multi-date flight scraping using concurrent background workers.
"""

import sys
import os
import time
import argparse
from datetime import datetime, timedelta
import concurrent.futures

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from backend.scraper_python.jobs.scrape_job import scrape_one
from backend.scraper_python.config import config
from backend.scraper_python.utils.date_utils import to_travel_date

AIRPORTS = ["DEL", "BOM", "BLR", "CCU", "HYD"]
DEFAULT_SOURCES = ["airindia", "indigo", "akasa", "spicejet"]

def parse_cli_args():
    parser = argparse.ArgumentParser(description="Run parallel multi-carrier scraper workers.")
    parser.add_argument("--workers", type=int, default=4, help="Number of concurrent worker threads (default: 4)")
    parser.add_argument("--days", type=int, default=7, help="Number of forward travel days (default: 7)")
    parser.add_argument("--sources", type=str, default="airindia,indigo,akasa,spicejet", help="Comma-separated airline sources")
    parser.add_argument("--routes", type=str, default="DEL-BOM,BOM-BLR,DEL-BLR,DEL-HYD,DEL-CCU", help="Comma-separated routes")
    parser.add_argument("--dry-run", action="store_true", help="Run without persisting to disk/database")
    return parser.parse_args()

def generate_task_matrix(routes_str, days, sources_str):
    route_pairs = []
    for r in routes_str.split(","):
        parts = r.strip().upper().split("-")
        if len(parts) == 2 and parts[0] != parts[1]:
            route_pairs.append({"origin": parts[0], "destination": parts[1]})

    sources = [s.strip().lower() for s in sources_str.split(",") if s.strip()]
    base_date = datetime.now()
    dates = [(base_date + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days)]

    tasks = []
    for dt in dates:
        for r in route_pairs:
            for src in sources:
                tasks.append({
                    "origin": r["origin"],
                    "destination": r["destination"],
                    "travelDate": dt,
                    "source": src
                })
    return tasks

def main():
    args = parse_cli_args()
    tasks = generate_task_matrix(args.routes, args.days, args.sources)
    save = not args.dry_run

    print("\n" + "=" * 65, flush=True)
    print("  APIx DISTRIBUTED MULTI-WORKER SCRAPING ENGINE", flush=True)
    print("=" * 65, flush=True)
    print(f"  * Concurrent Workers : {args.workers}", flush=True)
    print(f"  * Total Tasks        : {len(tasks)} combinations", flush=True)
    print(f"  * Airlines           : {args.sources}", flush=True)
    print(f"  * Routes             : {args.routes}", flush=True)
    print(f"  * Forward Horizon    : {args.days} Days", flush=True)
    print(f"  * Mode               : {'DRY RUN (No Persist)' if args.dry_run else 'LIVE PRODUCTION (Saving to MongoDB & JSONL)'}", flush=True)
    print("=" * 65 + "\n", flush=True)

    start_time = time.time()
    completed_count = 0
    total_flights = 0
    total_saved = 0
    total_mongo = 0
    total_errors = 0

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        future_to_task = {
            executor.submit(scrape_one, task, config, save): task
            for task in tasks
        }

        for future in concurrent.futures.as_completed(future_to_task):
            task = future_to_task[future]
            completed_count += 1
            route_label = f"{task['origin']}-{task['destination']}"
            
            try:
                res = future.result()
                if res.get("status") == "SUCCESS":
                    found = res.get("results", 0)
                    saved = res.get("saved", 0)
                    mongo = res.get("mongoSaved", 0)
                    dur = res.get("durationMs", 0) / 1000.0
                    
                    total_flights += found
                    total_saved += saved
                    total_mongo += mongo

                    print(f"[{completed_count:03d}/{len(tasks):03d}] [WORKER-OK] {task['source']:<10} | {route_label} | {task['travelDate']} | {found:2d} flights found ({dur:.1f}s)", flush=True)
                else:
                    total_errors += 1
                    err = res.get("error", "Unknown error")
                    print(f"[{completed_count:03d}/{len(tasks):03d}] [WORKER-ERR] {task['source']:<10} | {route_label} | {task['travelDate']} | Error: {err}", flush=True)
            except Exception as exc:
                total_errors += 1
                print(f"[{completed_count:03d}/{len(tasks):03d}] [WORKER-EXC] {task['source']:<10} | {route_label} | Exception: {exc}", flush=True)

    elapsed = time.time() - start_time
    print("\n" + "=" * 65, flush=True)
    print("  WORKER POOL EXECUTION SUMMARY", flush=True)
    print("=" * 65, flush=True)
    print(f"  * Total Time Elapsed : {elapsed:.2f} seconds ({elapsed/60:.2f} mins)", flush=True)
    print(f"  * Processed Tasks    : {completed_count}/{len(tasks)} (Errors: {total_errors})", flush=True)
    print(f"  * Total Live Flights : {total_flights}", flush=True)
    print(f"  * MongoDB Upserts    : {total_mongo}", flush=True)
    print(f"  * JSONL Records Saved: {total_saved}", flush=True)
    print(f"  * Average Throughput : {total_flights / max(0.1, elapsed):.1f} quotes/second", flush=True)
    print("=" * 65 + "\n", flush=True)

if __name__ == "__main__":
    main()
