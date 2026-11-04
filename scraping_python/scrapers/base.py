"""BaseScraper - common interface every source adapter must implement
(Python port of src/scrapers/BaseScraper.js).

A source adapter is responsible for:
  1. turning a search request into raw flight results (``search_flights``), and
  2. converting one raw flight result into a normalized fare object
     (``normalize_flight``).

``scrape()`` implements the retry glue and returns normalized fare objects.
"""

import time
from datetime import datetime, timezone

from ..utils.retry import NonRetriableError, with_retry


class BaseScraper:
    def __init__(self, config=None):
        config = dict(config or {})
        self.config = config
        self.source = config.get("source")

    @property
    def name(self):
        return self.source

    def search_flights(self, params):
        raise NotImplementedError("search_flights() must be implemented")

    def normalize_flight(self, raw_flight, context):
        raise NotImplementedError("normalize_flight() must be implemented")

    def scrape(self, params):
        """Run a full scrape for one route/date and return normalized fares.

        :returns: ``{"fares": [...], "attempts": int}``
        """
        origin = params.get("origin")
        destination = params.get("destination")
        travel_date = params.get("travelDate")

        context = dict(params)
        context["source"] = self.source
        context["collectionDate"] = datetime.now(timezone.utc)

        options = {}
        if self.config.get("maxRetries") is not None:
            options["max_retries"] = self.config["maxRetries"]
        if self.config.get("retryDelay") is not None:
            options["retry_delay"] = self.config["retryDelay"]
        options["label"] = f"scrape({self.source}) {origin}-{destination} {str(travel_date)}"

        attempts, result, last_error = with_retry(lambda: self.search_flights(params), options)

        if last_error is not None:
            if isinstance(last_error, NonRetriableError):
                raise last_error
            err = RuntimeError(
                f"Scrape failed for {self.source} {origin}-{destination}: {last_error}"
            )
            err.original = last_error
            raise err

        fares = [self.normalize_flight(raw, context) for raw in (result or [])]
        return {"fares": fares, "attempts": attempts}


__all__ = ["BaseScraper", "NonRetriableError"]