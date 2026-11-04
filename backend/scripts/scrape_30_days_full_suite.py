"""
30-Day Master Live Scraper Suite
Scrapes live flight quotes for all 20 origin-destination route pairs across the next 30 days
for all 4 registered airlines (Air India, IndiGo, Akasa Air, SpiceJet).
Stores all valid live fare records into MongoDB Atlas.
"""

import sys
import os
from datetime import datetime, timedelta

# Ensure project root is in sys.path
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from backend.scraper_python.jobs.scrape_job import run_scrape_job

AIRPORTS = ["DEL", "BOM", "BLR", "CCU", "HYD"]

def generate_route_matrix():
    routes = []
    for orig in AIRPORTS:
        for dest in AIRPORTS:
            if orig != dest:
                routes.append({"origin": orig, "destination": dest})
    return routes

def generate_30_day_dates():
    base_date = datetime.now()
    dates = []
    for i in range(30):
        dt = base_date + timedelta(days=i)
        dates.append(dt.strftime("%Y-%m-%d"))
    return dates

def main():
    routes = generate_route_matrix()
    dates = generate_30_day_dates()
    sources = ["airindia", "indigo", "akasa", "spicejet"]

    route_names = [f"{r['origin']}-{r['destination']}" for r in routes[:5]]
    print("================================================================")
    print("      30-DAY MASTER REAL LIVE FLIGHT SCRAPER SUITE             ")
    print("================================================================")
    print(f"Total Routes ({len(routes)}): {route_names}...")
    print(f"Total Dates  ({len(dates)}): {dates[0]} to {dates[-1]}")
    print(f"Airlines     ({len(sources)}): {', '.join(sources)}")
    print(f"Total Combos : {len(routes)} routes x {len(dates)} dates = {len(routes)*len(dates)} route-dates")
    print("----------------------------------------------------------------\n")

    input_payload = {
        "routes": routes,
        "travelDates": dates,
        "sources": sources,
        "save": True
    }

    summary = run_scrape_job(input_payload)

    print("\n================================================================")
    print("                   SCRAPE JOB COMPLETE                         ")
    print("================================================================")
    print(f"Job ID           : {summary['jobId']}")
    print(f"Duration         : {summary['durationMs']/1000:.1f} seconds")
    print(f"Total Flights    : {summary['flightsFound']}")
    print(f"MongoDB Saved    : {summary['mongoSaved']}")
    print(f"Duplicate Fares  : {summary['duplicates']}")
    print("================================================================")

if __name__ == "__main__":
    main()
