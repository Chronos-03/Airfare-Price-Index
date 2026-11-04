"""Scraper registry (Python port of src/scrapers/index.js).

Adding a new source is ONE step:
  1. create scrapers/<source>.py
  2. import and add it to the ``scrapers`` dict below

Nothing else in the CLI / job runner needs to change: they all look up sources
through ``get_scraper`` / ``list_sources``.
"""

from .akasa import AkasaScraper
from .base import BaseScraper
from .example import ExampleScraper

scrapers = {
    "example": ExampleScraper,
    "akasa": AkasaScraper,
}


def get_scraper(name, config=None):
    """Instantiate a registered source adapter with the given config."""
    factory = scrapers.get(name)
    if not factory:
        available = ", ".join(scrapers.keys())
        raise KeyError(f"Unknown scraper source '{name}'. Available: {available}")
    return factory(config or {})


def list_sources():
    """List all registered source keys."""
    return list(scrapers.keys())


def has_source(name):
    """True when the source is registered."""
    return name in scrapers


__all__ = ["scrapers", "get_scraper", "list_sources", "has_source", "BaseScraper"]