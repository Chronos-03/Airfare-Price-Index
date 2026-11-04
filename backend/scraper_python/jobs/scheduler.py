"""Minimal scheduling layer (Python port of src/jobs/scheduler.js, spec #18/#28).

Scheduling is fully separate from scraping logic: a schedule is just an object
with routes/dates/sources + a cadence, and the scheduler invokes
run_scrape_job() on that cadence.

 - hourly: runs every SCHEDULE_INTERVAL_HOURS
 - daily:  runs once per day at a given hour/minute
 - fixed:  runs N times separated by `intervalMinutes`
 - once:   one-shot

Enabled through SCHEDULE_ENABLED=true.
"""

import time

from ..config import config
from ..utils.logger import logger
from .scrape_job import run_scrape_job

HOUR_MS = 60 * 60 * 1000
DAY_MS = 24 * HOUR_MS


def run_scheduled_scrape(schedule_def):
    """Run one scheduled scrape iteration (mirrors JS runScheduledScrape)."""
    cadence = schedule_def.get("cadence", "hourly")
    logger.info("[SCHEDULER] running scrape", {
        "cadence": cadence,
        "routes": len(schedule_def.get("routes") or []),
        "dates": len(schedule_def.get("travelDates") or []),
    })
    return run_scrape_job({
        "routes": schedule_def.get("routes"),
        "travelDates": schedule_def.get("travelDates"),
        "sources": schedule_def.get("sources"),
    })


def _ms_before_today_at(hour, minute):
    """Milliseconds until (hour:minute) local today; if that already passed,
    until that same time tomorrow."""
    now = time.localtime()
    target_ms = _local_ms_at(hour, minute)
    now_ms = _local_now_ms()
    delta = target_ms - now_ms
    if delta <= 0:
        delta += DAY_MS
    return delta


def _local_now_ms():
    return time.time() * 1000.0


def _local_ms_at(hour, minute):
    struct = time.localtime()
    t = time.mktime((struct.tm_year, struct.tm_mon, struct.tm_mday, hour, minute, 0, struct.tm_wday, struct.tm_yday, struct.tm_isdst))
    return t * 1000.0


def create_scheduler(schedule_def, runner=None):
    """Create a schedule runner. Does not start anything until ``.start()``.

    :param runner: injectable runner (defaults to run_scheduled_scrape).
    :returns: ``{"start": callable, "stop": callable}``
    """
    execute = runner or run_scheduled_scrape
    stop_flag = {"stopped": False}
    timer_state = {"handle": None}
    interval_state = {}

    cadence = schedule_def.get("cadence", "hourly")

    if cadence == "hourly":
        interval_state["ms"] = int((schedule_def.get("intervalHours") or config.scheduler["intervalHours"]) * HOUR_MS)
    elif cadence == "fixed":
        interval_state["ms"] = int((schedule_def.get("intervalMinutes") or 60) * 60 * 1000)
    elif cadence == "daily":
        interval_state["ms"] = int(_ms_before_today_at(schedule_def.get("hour", 0) or 0, schedule_def.get("minute", 0) or 0))
    else:  # once
        interval_state["ms"] = 0

    elapsed = {"n": 0}

    def tick():
        if stop_flag["stopped"]:
            return
        try:
            execute(schedule_def)
        except Exception as err:
            logger.error("[SCHEDULER] scheduled scrape failed", {"error": str(err)})

        elapsed["n"] += 1
        if cadence == "daily" and elapsed["n"] >= 1:
            interval_state["ms"] = DAY_MS
        if cadence == "once" or (schedule_def.get("repeat") and elapsed["n"] >= schedule_def["repeat"]):
            stop()
            return
        timer_state["handle"] = _set_timeout(tick, interval_state["ms"])

    def start():
        if timer_state["handle"] is not None:
            return
        logger.info("[SCHEDULER] started", {"cadence": cadence})
        if cadence == "once":
            timer_state["handle"] = _set_timeout(tick, int(schedule_def.get("startInMs", 0) or 0))
        else:
            timer_state["handle"] = _set_timeout(tick, interval_state["ms"])

    def stop():
        stop_flag["stopped"] = True
        if timer_state["handle"] is not None:
            # A dormant handle (with remaining sleep) cannot be cancelled
            # portably without breaking other threads; wake the sleep and
            # let tick() see the stopped flag.
            import threading

            _wake(timer_state["handle"])
        timer_state["handle"] = None

    return {"start": start, "stop": stop}


# --- tiny background-timer implementation ---------------------------------
# Python has no awaitable one-shot timers; run ticks on a daemon thread that
# sleeps for the interval. `stop()` wakes the sleeping thread via a shared
# event so the process can exit promptly.

import threading

def _set_timeout(callback, delay_ms):
    state = {"event": threading.Event(), "lock": threading.Lock()}

    def run():
        if state["event"].wait(delay_ms / 1000.0):
            return  # woken for cancellation
        callback()

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return state


def _wake(state):
    state["event"].set()


def start_scheduler_from_env(default_schedule=None):
    """IF scheduling is enabled in .env, start a default hourly schedule."""
    if not config.scheduler["enabled"]:
        logger.debug("SCHEDULER disabled (SCHEDULE_ENABLED not true)")
        return None

    schedule_def = {"cadence": "hourly", "intervalHours": config.scheduler["intervalHours"]}
    schedule_def.update(default_schedule or {})
    scheduler = create_scheduler(schedule_def)
    scheduler["start"]()
    return scheduler


__all__ = ["create_scheduler", "start_scheduler_from_env", "run_scheduled_scrape"]