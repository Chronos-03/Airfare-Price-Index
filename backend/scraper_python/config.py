"""Centralized application configuration (Python port of src/config/index.js).

Loads ``.env`` from the project root (if present) and exposes every runtime
value as attributes so nothing is hard-coded in scrapers/services.
"""

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
_ENV_FILE = PROJECT_ROOT / ".env"


def _parse_env_file(path):
    """Minimal .env parser (KEY=VALUE lines, '#' comments, optional quotes)."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] in ("'", '"') and value[-1] == value[0]:
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value


_parse_env_file(_ENV_FILE)

# Also honour a .env in the current working directory (e.g. running from the
# project root with `python -m backend.scraper_python` picks up SIH2026-main/.env).
_parse_env_file(Path.cwd() / ".env")


def _int(name, default):
    try:
        return int(os.environ.get(name, ""))
    except ValueError:
        return default


def _float(name, default):
    try:
        return float(os.environ.get(name, ""))
    except ValueError:
        return default


class Config:
    def __init__(self):
        self.env = os.environ.get("NODE_ENV", "development")

        self.server = {
            "port": _int("PORT", 5000),
        }

        self.database = {
            "uri": os.environ.get("MONGODB_URI", "mongodb://localhost:27017/flight_fares"),
            # MongoDB persistence is OPT-IN and NOT implemented in the Python
            # port; the JSON file store remains the only writer here.
            "enabled": os.environ.get("MONGO_WRITE_ENABLED") == "true",
        }

        self.scraper = {
            "timeout": _int("SCRAPER_TIMEOUT", 30000),
            "max_retries": _int("SCRAPER_MAX_RETRIES", 3),
            "retry_delay": _int("SCRAPER_RETRY_DELAY", 2000),
            "concurrency": _int("SCRAPER_CONCURRENCY", 2),
            "request_delay": _int("SCRAPER_REQUEST_DELAY", 1000),
        }

        self.akasa = {
            "base_url": os.environ.get("AKASA_BASE_URL", "https://prod-bl.qp.akasaair.com"),
            "device_type": os.environ.get("AKASA_DEVICE_TYPE", "WEB"),
            "booking_type": os.environ.get("AKASA_BOOKING_TYPE", "BOOKING"),
            "user_type": os.environ.get("AKASA_USER_TYPE", "GUEST"),
            "channel": os.environ.get("AKASA_CHANNEL", "WEB"),
            "currency": os.environ.get("AKASA_CURRENCY", "INR"),
            "max_connections": _int("AKASA_MAX_CONNECTIONS", 8),
        }

        self.dgca = {
            "report_period": os.environ.get("DGCA_REPORT_PERIOD", "2026-04"),
            "report_url": os.environ.get("DGCA_REPORT_URL") or None,
        }

        self.outlier = {
            "min_fare": _float("OUTLIER_MIN_FARE", 100),
            "max_fare": _float("OUTLIER_MAX_FARE", 100000),
            "component_mismatch_tolerance": _float("OUTLIER_COMPONENT_MISMATCH_TOLERANCE", 0.2),
            "min_mismatch_abs": _float("OUTLIER_MIN_MISMATCH_ABS", 100),
        }

        output_dir = os.environ.get("JSON_EXPORT_DIR")
        if output_dir:
            self.json_export = {
                "enabled": os.environ.get("JSON_EXPORT_ENABLED") != "false",
                "dir": str(Path(output_dir).resolve()),
            }
        else:
            self.json_export = {
                "enabled": os.environ.get("JSON_EXPORT_ENABLED") != "false",
                "dir": str(PROJECT_ROOT / "output"),
            }

        self.scheduler = {
            "enabled": os.environ.get("SCHEDULE_ENABLED") == "true",
            "interval_hours": _int("SCHEDULE_INTERVAL_HOURS", 1),
        }

        self.logging = {
            "level": os.environ.get("LOG_LEVEL", "info").lower(),
        }

        # Aliases kept for parity with the JS names where Python code reads them.
        self.akasa_max_connections = self.akasa["max_connections"]


config = Config()

__all__ = ["config", "Config", "PROJECT_ROOT"]