"""DGCA monthly air-traffic sync service (Python port of
src/services/dgcaService.js).

Downloads the published monthly PDF (S3 re-written key + referer), runs the
text through ``parse_monthly_report`` and writes one JSON document per report
period (``output/dgca-<YYYY-MM>.json`) containing a row per airline plus a
'TOTAL' summary row. No database is involved.
"""

import io
from pathlib import Path

from ..scrapers.dgca import (
    MONTH_NAMES,
    S3_BASE,
    month_name_from_period,
    parse_monthly_report,
    request_buffer,
)
from ..services.file_store import write_dgca_report
from ..utils.logger import logger
from ..utils.retry import NonRetriableError, with_retry


def monthly_report_url(report_period, url=None):
    """Build the S3 URL for a report period. Pass ``url`` to override months
    whose S3 file name deviates (observed e.g. for January)."""
    if url:
        return url
    month_key = month_name_from_period(report_period)
    if not month_key:
        raise NonRetriableError(
            f"Invalid DGCA report period '{report_period}' (expected YYYY-MM)"
        )
    return (
        f"{S3_BASE}/InventoryList/dataReports/aviationDataStatistics/"
        f"airTransport/domestic/airTraffic/TrafficReport{month_key}.pdf"
    )


def pdf_text(buffer):
    """Extract text from a downloaded monthly PDF (pypdf)."""
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(buffer))
    parts = []
    for page in reader.pages:
        text = page.extract_text() or ""
        parts.append(text)
    return "\n".join(parts)


def download_and_parse_monthly(report_period, url=None):
    """Download + parse one monthly report.

    :returns: ``{"buffer", "text", "parsed", "reportPeriod", "reportUrl"}``
    """
    if not report_period:
        raise NonRetriableError("dgcaService: reportPeriod is required")
    report_url = monthly_report_url(report_period, url)

    attempts, buffer, last_error = with_retry(
        lambda: request_buffer(report_url),
        {"max_retries": 2, "retry_delay": 1500, "label": f"DGCA download {report_period}"},
    )
    if last_error is not None:
        raise last_error
    if not buffer:
        raise NonRetriableError(f"DGCA download failed: {report_url}")

    text = pdf_text(buffer)
    parsed = parse_monthly_report(text, report_period)
    if not parsed["airlines"]:
        raise NonRetriableError(
            f"DGCA parse: no airline rows extracted for {report_period} "
            "(file downloaded but table not found)"
        )
    return {"buffer": buffer, "text": text, "parsed": parsed, "reportPeriod": report_period, "reportUrl": report_url}


def dedupe_key(report_type, report_period, airline):
    """Deterministic unique key for a period+airline row."""
    return f"dgca|{report_type}|{report_period}|{airline}"


def _default_title(period):
    month_index = int(period[5:]) - 1
    return f"Performance of scheduled domestic airlines for the month of {MONTH_NAMES[month_index]} {period[:4]}"


def sync_monthly_report(report_period, url=None, save=True, report_title=None, output_dir=None):
    """Full sync for one month: download -> parse -> (optional) write JSON.

    :returns: ``{"reportPeriod", "reportUrl", "overall", "airlines", "summary"}``
    """
    result = download_and_parse_monthly(report_period, url)
    period = result["reportPeriod"]
    report_url = result["reportUrl"]
    text = result["text"]
    buffer = result["buffer"]
    parsed = result["parsed"]

    if save and output_dir:
        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=True)
        (out / f"dgca-{period}.pdf").write_bytes(buffer)
        (out / f"dgca-{period}.txt").write_text(text, encoding="utf-8")

    title = report_title or _default_title(period)

    summary = None
    if save:
        summary = write_dgca_report(
            parsed,
            {
                "reportPeriod": period,
                "reportType": "MONTHLY_AIR_TRAFFIC",
                "reportTitle": title,
                "reportUrl": report_url,
            },
            {"dir": output_dir},
        )

        # OPT-IN MongoDB persistence (MONGO_WRITE_ENABLED=true / --mongo).
        try:
            from ..services.mongo_store import is_enabled as _mongo_is_enabled
            from ..services.mongo_store import write_dgca_report as _mongo_write_dgca

            if _mongo_is_enabled():
                ms = _mongo_write_dgca(
                    parsed,
                    {
                        "reportPeriod": period,
                        "reportType": "MONTHLY_AIR_TRAFFIC",
                        "reportTitle": title,
                        "reportUrl": report_url,
                    },
                )
                summary["mongoSaved"] = ms["saved"] + ms["duplicates"]
        except Exception as err:
            logger.warn("[DGCA] mongo store failed (continuing)", {"error": str(err)})

        logger.info("[DGCA] synced", {"reportPeriod": period, **summary})
    else:
        logger.info("[DGCA] parsed (dry-run)", {"reportPeriod": period, "airlines": len(parsed["airlines"])})

    return {
        "reportPeriod": period,
        "reportUrl": report_url,
        "overall": parsed["overall"],
        "airlines": parsed["airlines"],
        "summary": summary,
    }


__all__ = ["monthly_report_url", "pdf_text", "download_and_parse_monthly", "dedupe_key", "sync_monthly_report"]