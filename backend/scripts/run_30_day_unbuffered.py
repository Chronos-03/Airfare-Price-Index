"""
Unbuffered 30-Day Live Batch Scraper
Scrapes live flight quotes across 20 routes x 30 dates x 4 airlines with live console logs.
"""

import sys
import os
import time
from datetime import datetime, timedelta

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from backend.scraper_python.jobs.scrape_job import run_scrape_job

AIRPORTS = ["DEL", "BOM", "BLR", "CCU", "HYD"]

def main():
    routes = []
    for orig in AIRPORTS:
        for dest in AIRPORTS:
            if orig != dest:
                routes.append({"origin": orig, "destination": dest})
                
    base_date = datetime.now()
    dates = [(base_date + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(30)]
    sources = ["airindia", "indigo", "akasa", "spicejet"]

    print(f"[STARTER] Starting 30-day live scrape for {len(routes)} routes across {len(dates)} dates...", flush=True)

    for i, dt in enumerate(dates):
        print(f"\n=======================================================", flush=True)
        print(f"  [DATE {i+1}/30] Scraping Travel Date: {dt}", flush=True)
        print(f"=======================================================", flush=True)
        
        for j, r in enumerate(routes):
            route_str = f"{r['origin']}-{r['destination']}"
            print(f" -> [{j+1}/{len(routes)}] Scraping Route: {route_str} on {dt}...", flush=True)
            
            payload = {
                "routes": [r],
                "travelDates": [dt],
                "sources": sources,
                "save": True
            }
            
            try:
                summary = run_scrape_job(payload)
                new_inserts = summary.get('mongoSaved', 0)
                total_found = summary.get('flightsFound', 0)
                dupes_matched = summary.get('duplicates', 0)
                print(f"    [OK] {route_str} ({dt}): {total_found} live flights found ({new_inserts} new inserted, {dupes_matched} updated in-place)", flush=True)
            except Exception as e:
                print(f"    [ERR] {route_str} ({dt}): {e}", flush=True)

    print("\n[COMPLETE] 30-Day Master Live Scrape Finished!", flush=True)

if __name__ == "__main__":
    main()
