"""Retry helper with exponential backoff + optional jitter (port of
src/utils/retry.js).

Rules:
  - max_retries / retry_delay are configurable.
  - Backoff between attempts.
  - Deterministic / parse / input errors (NonRetriableError) are never retried.
"""

import random
import time

from .logger import logger


class NonRetriableError(TypeError):
    """Marker for deterministic failures that must never be retried."""


def with_retry(fn, options=None):
    """Run ``fn`` with exponential backoff.

    :param fn: Callable returning a value (or raising).
    :param options: ``{max_retries, retry_delay, backoff_factor, jitter,
                      should_retry, label}``
    :returns: ``(attempts, result, last_error)``
    """
    options = options or {}
    max_retries = options.get("max_retries", 3)
    retry_delay = options.get("retry_delay", 2000)
    backoff_factor = options.get("backoff_factor", 2)
    jitter = options.get("jitter", True)
    should_retry = options.get("should_retry")
    label = options.get("label", "operation")

    attempts = 0
    delay = retry_delay
    last_error = None

    while attempts <= max_retries:
        attempts += 1
        try:
            result = fn()
            return attempts, result, None
        except Exception as err:
            last_error = err
            retryable = bool(should_retry(err)) if should_retry else True
            if not retryable or attempts > max_retries:
                logger.error(f"{label} failed after {attempts} attempt(s): {err}")
                return attempts, None, err
            wait = round(delay * (0.75 + random.random() * 0.5)) if jitter else delay
            logger.warn(f"{label} attempt {attempts}/{max_retries} failed ({err}). Retrying in {wait}ms")
            time.sleep(wait / 1000.0)
            delay = delay * backoff_factor

    return attempts, None, last_error


def sleep(ms):
    time.sleep(ms / 1000.0)


__all__ = ["with_retry", "NonRetriableError", "sleep"]