"""IndiGoScraper - REAL live web scraper for IndiGo Airlines.

Extracts real live flight quotes for IndiGo using Playwright live search.
"""

from ..services.fare_normalizer import normalize_raw_fare
from ..services.live_playwright_scraper import scrape_live_flights_playwright
from ..utils.date_utils import format_utc_date
from ..utils.retry import NonRetriableError
from .base import BaseScraper

class IndiGoScraper(BaseScraper):
    def __init__(self, config=None):
        super().__init__({"source": "indigo", **(config or {})})

    def search_flights(self, params):
        origin = str(params.get("origin")).upper()
        destination = str(params.get("destination")).upper()
        travel_date = params.get("travelDate")

        if not origin or not destination or not travel_date:
            raise NonRetriableError("IndiGoScraper: origin, destination and travelDate are required")

        date_str = format_utc_date(travel_date)

        # Live extraction using Playwright web scraper
        flights = scrape_live_flights_playwright("IndiGo", origin, destination, date_str)
        return flights

    def normalize_flight(self, raw, context):
        return normalize_raw_fare(raw, context)

__all__ = ["IndiGoScraper"]
