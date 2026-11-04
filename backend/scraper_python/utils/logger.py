"""Structured key=value logger (Python port of src/utils/logger.js).

Emits one line with ``[LEVEL] key=value key=value message`` so output can be
piped/parsed. NEVER log passwords, cookies, auth tokens or other secrets.
"""

import json
import re
import sys
from datetime import datetime, timezone

from .date_utils import to_js_iso

LEVELS = {"debug": 10, "info": 20, "warn": 30, "error": 40}

_SECRET_KEYS = re.compile(
    r"(password|passwd|token|secret|api[_-]?key|cookie|authorization|session)",
    re.IGNORECASE,
)


def _redact(value):
    if isinstance(value, dict):
        return {k: ("[REDACTED]" if _SECRET_KEYS.search(str(k)) else _redact(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact(v) for v in value]
    return value


def _serialize(value):
    if value is None:
        return "None"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (datetime,)):
        return json.dumps(to_js_iso(value), ensure_ascii=False)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    return json.dumps(value, ensure_ascii=False)


class Logger:
    def __init__(self, level="info"):
        self.level = LEVELS.get(str(level).lower(), LEVELS["info"])

    def set_level(self, level):
        new = LEVELS.get(str(level).lower())
        if new is not None:
            self.level = new

    def _write(self, entry_level, message, fields):
        if LEVELS[entry_level] < self.level:
            return
        now = datetime.now(timezone.utc)
        record = {
            "ts": now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z",
            "level": entry_level.upper(),
            "msg": message,
        }
        payload = _redact(fields) if isinstance(fields, dict) else {}
        field_text = " ".join(
            f"{k}={_serialize(v)}" for k, v in payload.items() if k not in ("ts", "level", "msg")
        )
        line = sys.stderr if entry_level == "error" else sys.stdout
        prefix = f"[{record['level']}]"
        line.write(f"{prefix} {field_text + ' ' if field_text else ''}{message or ''}\n")

    def debug(self, message, fields=None):
        self._write("debug", message, fields)

    def info(self, message, fields=None):
        self._write("info", message, fields)

    def warn(self, message, fields=None):
        self._write("warn", message, fields)

    def error(self, message, fields=None):
        self._write("error", message, fields)


def create_logger(level="info"):
    return Logger(level)


logger = create_logger()

__all__ = ["Logger", "create_logger", "logger"]