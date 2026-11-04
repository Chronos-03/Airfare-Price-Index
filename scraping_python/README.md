# scraping_python

Python port of the Node.js **national-flight-fare-scraper** (`../scraping`),
JSON-first. MongoDB is OPT-IN in the JS project and **not implemented here**;
the JSON file store is the only writer.

```
scraping_python/
  cli.py                entrypoint: python -m scraping_python [options]
  config.py             .env-driven config (JSON_EXPORT_DIR, SCRAPER_*, ...)
  utils/                dateUtils / jsonutil / logger / retry / rateLimiter / jobId
  scrapers/             source adapters: example (mock), akasa (live IBE API), dgca (monthly PDF)
  services/             fareNormalizer, fareValidator, outlierDetector,
                        duplicateDetector, fileStore, akasaNetwork, dgcaService
  jobs/                 scrapeJob (pipeline runner), scheduler
```

## Quick start

```bash
pip install -r requirements.txt          # requests, pypdf
cp .env.example .env                     # optional; defaults are sensible

python -m scraping_python --origin DEL --destination BOM --date 2026-09-15 --source example --dry-run
```

Scrape a route (writes `output/fares-<travelDate>.jsonl`):

```bash
python -m scraping_python --origin DEL --destination BOM --date 2026-09-15
```

Multi-route via a config file:

```bash
python -m scraping_python --config ./multi-route.json
```

```json
{ "routes": [ { "origin": "DEL", "destination": "BOM" } ],
  "travelDates": ["2026-09-15", "2026-09-16"],
  "sources": ["example"] }
```

## Sources

| source    | type       | notes                                                        |
|-----------|------------|--------------------------------------------------------------|
| `example` | mock       | deterministic multi-route mock (no network)                  |
| `akasa`   | live       | real Akasa Air IBE API (`fetchMode` html/parse not required) |
| `dgca`    | monthly PDF | DGCA air-traffic statistics via S3 (`dgca` subcommand)       |

## Subcommands

DGCA monthly stats (one JSON doc per period, `output/dgca-YYYY-MM.json`):

```bash
python -m scraping_python dgca [--month 2026-04] [--url <pdf>] [--output ./output] [--no-db]
```

Akasa full-network sweep (every directed market x rolling N days):

```bash
python -m scraping_python network [--source akasa] [--from 2026-08-28] [--days 30]
                          [--output ./output] [--dry-run] [--refresh-network]
```

## Output

- `output/fares-YYYY-MM-DD.jsonl` - one normalized fare per line:
  `origin, destination, route, airline, flightNumber, travelDate,
  collectionDate, advanceDays, fareClass, baseFare, taxes, udf,
  convenienceFee, totalFare, currency, availability, source, scrapedAt,
  dataQuality, metric?, dedupeKey` (dates as `2026-09-15T00:00:00.000Z`).
- `output/dgca-YYYY-MM.json` - DGCA monthly stats doc + raw PDF/text audit
  trail (`dgca-YYYY-MM.pdf/.txt`) when `--output` is given.
- `output/dgca-YYYY-MM.json` contains the downloaded monthly PDF and its
  extracted text beside it for re-derivation.

## Determinism

`example` uses mulberry32 + FNV-1a seeding on `origin-destination-2026-09-15`
- the same route/date always generates the same fares on any platform
(verified byte-for-byte against the JS implementation).

## Tests

No test framework is bundled. Sanity checks are run manually:

```bash
python -m scraping_python --origin DEL --destination BOM --date 2026-09-15 --source example --dry-run
```