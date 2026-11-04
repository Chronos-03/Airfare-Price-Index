"""ExampleScraper - MOCK / DEMO SOURCE. NOT a real website
(Python port of src/scrapers/example/ExampleScraper.js).

Deterministically generates realistic-looking domestic flight results so the
full pipeline (retrieval -> normalization -> validation -> dedup -> storage
-> summary + CLI) can be exercised end-to-end without hitting the network.
"""

import re

from ..services.fare_normalizer import normalize_raw_fare, parse_fare_amount
from ..utils.date_utils import format_utc_date
from ..utils.retry import NonRetriableError
from .base import BaseScraper

MOCK_AIRLINES = [
    {"airline": "Air North", "prefix": "AN", "multiplier": 1.0},
    {"airline": "SkyWay India", "prefix": "SW", "multiplier": 0.92},
    {"airline": "Deccan Flyer", "prefix": "DF", "multiplier": 1.12},
    {"airline": "Coastal Express", "prefix": "CX", "multiplier": 0.85},
]

MOCK_FARE_CLASSES = ["Economy", "Economy", "Economy", "Business"]

_MASK32 = 0xFFFFFFFF


def mulberry32(seed):
    """Deterministic pseudo-random generator (mulberry32). The same
    origin/destination/date yields the same sequence - useful for testing
    duplicates deterministically."""
    a = seed & _MASK32

    def _next():
        nonlocal a
        a = (a + 0x6D2B79F5) & _MASK32
        # Math.imul(x, y) == low 32 bits of (x * y)
        t = ((a ^ (a >> 15)) * (1 | a)) & _MASK32
        add = (t + (((t ^ (t >> 7)) * (61 | t)) & _MASK32)) & _MASK32
        t = add ^ t
        t = (t ^ (t >> 14)) & _MASK32
        return t / 4294967296.0

    return _next


def seed_for(origin, destination, travel_date):
    """Deterministic FNV-1a seed from route + UTC date."""
    hash_text = f"{origin}-{destination}-{format_utc_date(travel_date)}"
    h = 2166136261
    for ch in hash_text:
        h ^= ord(ch)
        h = (h * 16777619) & _MASK32
    return h


class ExampleScraper(BaseScraper):
    def __init__(self, config=None):
        super().__init__({"source": "example", **(config or {})})

    def generate_flights(self, origin, destination, travel_date):
        if not origin or not destination or not travel_date:
            raise NonRetriableError(
                "ExampleScraper: origin, destination and travelDate are required"
            )
        if str(origin).upper() == str(destination).upper():
            raise NonRetriableError(
                "ExampleScraper: origin and destination must differ"
            )

        rand = mulberry32(seed_for(origin, destination, travel_date))
        count = 6 + int(rand() * 9)  # 6..14

        flights = []
        for _ in range(count):
            airline = MOCK_AIRLINES[int(rand() * len(MOCK_AIRLINES))]
            fare_class = MOCK_FARE_CLASSES[int(rand() * len(MOCK_FARE_CLASSES))]

            base_fare = int(1400 + rand() * 7600 + 0.5)  # Math.round
            taxes = int(base_fare * 0.18 + 0.5)  # Math.round
            udf = 50 if rand() > 0.6 else 0
            fare_bin = parse_fare_amount(f"{base_fare + taxes + udf}", "INR")

            flights.append(
                {
                    "airline": airline["airline"],
                    "flightNumber": f"{airline['prefix']}{101 + int(rand() * 900)}",
                    "fareClass": fare_class,
                    "origin": str(origin).upper(),
                    "destination": str(destination).upper(),
                    "travelDate": travel_date,
                    "baseFare": base_fare,
                    "taxes": taxes,
                    "udf": udf,
                    "convenienceFee": 0,
                    "totalFare": fare_bin["amount"],
                    "currency": "INR",
                    "availability": "AVAILABLE",
                }
            )
        return flights

    def render_result_html(self, flights):
        rows = "\n  ".join(
            f'<div class="flight-result" '
            f'data-flight="{f["flightNumber"]}" '
            f'data-airline="{f["airline"]}" '
            f'data-fare-class="{f["fareClass"]}" '
            f'data-total="{f["totalFare"]}" '
            f'data-base="{f["baseFare"]}" '
            f'data-taxes="{f["taxes"]}" '
            f'data-udf="{f["udf"]}" '
            f'data-fee="{f["convenienceFee"]}" '
            f'data-availability="{f["availability"]}">'
            f'<span class="fare-total">\u20b9{f["totalFare"]}</span>'
            f"</div>"
            for f in flights
        )
        return (
            "<!doctype html>\n<html><head><title>Mock Results - "
            f"{flights[0]['origin']} to {flights[0]['destination']}"
            "</title></head>\n"
            f'<body>\n  <div class="fare-results">\n  {rows}\n  </div>\n</body></html>'
        )

    def parse_results_html(self, html):
        blocks = re.findall(
            r'<div class="flight-result"[^>]*>[\s\S]*?</div>', html or ""
        )
        flights = []
        for block in blocks:
            def get_attr(name):
                m = re.search(rf'data-{name}="([^"]*)"', block)
                return m.group(1) if m else None

            flights.append(
                {
                    "flightNumber": get_attr("flight"),
                    "airline": get_attr("airline"),
                    "fareClass": get_attr("fare-class"),
                    "totalFare": get_attr("total"),
                    "baseFare": get_attr("base"),
                    "taxes": get_attr("taxes"),
                    "udf": get_attr("udf"),
                    "convenienceFee": get_attr("fee"),
                    "availability": get_attr("availability"),
                }
            )
        return [f for f in flights if f["flightNumber"]]

    def search_flights(self, params):
        origin = str(params.get("origin")).upper()
        destination = str(params.get("destination")).upper()
        travel_date = params.get("travelDate")
        flights = self.generate_flights(origin, destination, travel_date)

        if self.config.get("fetchMode") == "html":
            html = self.render_result_html(flights)
            parsed = self.parse_results_html(html)
            for f in parsed:
                f["origin"] = origin
                f["destination"] = destination
                f["travelDate"] = travel_date
                f["currency"] = "INR"
            return parsed
        return flights

    def normalize_flight(self, raw, context):
        return normalize_raw_fare(raw, context)


__all__ = ["ExampleScraper", "MOCK_AIRLINES", "MOCK_FARE_CLASSES", "mulberry32", "seed_for"]