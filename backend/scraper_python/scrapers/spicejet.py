"""SpiceJetScraper - REAL live web scraper for SpiceJet.

Extracts real live flight quotes for SpiceJet using Playwright live search.
"""

from ..services.fare_normalizer import normalize_raw_fare
from ..services.live_playwright_scraper import scrape_live_flights_playwright
from ..utils.date_utils import format_utc_date
from ..utils.retry import NonRetriableError
from .base import BaseScraper

class SpiceJetScraper(BaseScraper):
    def __init__(self, config=None):
        super().__init__({"source": "spicejet", **(config or {})})

    def search_flights(self, params):
        origin = str(params.get("origin")).upper()
        destination = str(params.get("destination")).upper()
        travel_date = params.get("travelDate")

        if not origin or not destination or not travel_date:
            raise NonRetriableError("SpiceJetScraper: origin, destination and travelDate are required")

        date_str = format_utc_date(travel_date)

        # Live extraction using Playwright web scraper
        flights = scrape_live_flights_playwright("SpiceJet", origin, destination, date_str)
        return flights

    def normalize_flight(self, raw, context):
        return normalize_raw_fare(raw, context)

__all__ = ["SpiceJetScraper"]
