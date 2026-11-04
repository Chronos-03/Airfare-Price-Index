"""Rate limiters (Python port of src/utils/rateLimiter.js).

Used by source adapters and the job runner to avoid hammering a website:
  - configurable min delay between operations
  - per-source concurrency limit
  - no bypassing of CAPTCHA / anti-bot / paywalls
"""

import threading
import time
from collections import deque


def create_min_interval_limiter(fn, min_interval_ms):
    """Serialise calls to ``fn`` with a minimum delay between invocations."""
    last_start = 0.0
    lock = threading.Lock()

    def wrapped(*args, **kwargs):
        nonlocal last_start
        with lock:
            now = time.monotonic() * 1000
            since_last = now - last_start
            if since_last < min_interval_ms:
                time.sleep((min_interval_ms - since_last) / 1000.0)
            last_start = time.monotonic() * 1000
            return fn(*args, **kwargs)

    return wrapped


def create_concurrency_limiter(fn, concurrency):
    """Limit how many calls of ``fn`` can be in-flight concurrently."""
    semaphore = threading.BoundedSemaphore(max(1, concurrency))

    def wrapped(*args, **kwargs):
        with semaphore:
            return fn(*args, **kwargs)

    return wrapped


class PerSourceLimiter:
    """Map instance that picks (or lazily creates) the right limiter per source."""

    def __init__(self, min_interval_ms=0, concurrency=1):
        self.interval_ms = min_interval_ms or 0
        self.concurrency = concurrency or 1
        self._limiters = {}

    def run(self, source, fn, *args, **kwargs):
        if source not in self._limiters:
            inner = create_min_interval_limiter(fn, self.interval_ms)
            self._limiters[source] = create_concurrency_limiter(inner, self.concurrency)
        return self._limiters[source](*args, **kwargs)

    def reset(self):
        self._limiters.clear()


__all__ = ["create_min_interval_limiter", "create_concurrency_limiter", "PerSourceLimiter", "sleep"]


def sleep(ms):
    time.sleep(ms / 1000.0)