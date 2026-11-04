"""DgcaScraper - REAL source adapter for DGCA monthly air-traffic statistics
(Python port of src/scrapers/dgca/DgcaScraper.js).

Source: DGCA "Air Transport Operating and Traffic Statistics"
  https://www.dgca.gov.in/digigov-portal/

Monthly PDFs live on the DGCA S3 bucket; direct S3 GETs require the re-written
key and the page referer (the site's own showPdf() does exactly this).
"""

import math
import re

import requests

S3_BASE = "https://public-prd-dgca.s3.ap-south-1.amazonaws.com"
PDF_REFERER = "https://www.dgca.gov.in/digigov-portal/jsp/dgca/homePage/viewPDF.jsp"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

# Column order of the airline market-share table (from the report header).
REPORT_AIRLINES = [
    "Alliance Air",
    "Air India Group",
    "Akasa Air",
    "Indigo",
    "Spice Jet",
    "Fly91",
    "Indiaone Air",
    "Star Air",
]

_PERIOD_RE = re.compile(r"^(\d{4})-(\d{2})$")
_MONTH_MARKER_RE = re.compile(
    r"^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|IstQtr|IIndQtr|IIIrdQtr|IVthQtr|TOTAL)$",
    re.IGNORECASE,
)
_MONTH_PROSE_RE = re.compile(r"month\s+of\s+([A-Za-z]+)\s+(\d{4})", re.IGNORECASE)
_CANCELLATION_RE = re.compile(
    r"cancellation\s+rate\s+of\s+scheduled\s+domestic\s+airlines\s+for\s+the\s+month\s+of\s+[A-Za-z]+\s+\d{4}\s+has\s+been\s+([0-9.]+)\s*%",
    re.IGNORECASE,
)
_COMPLAINTS_RE = re.compile(r"total\s+of\s+([\d,]+)\s+passenger-related\s+complaints", re.IGNORECASE)
_PER10K_RE = re.compile(
    r"complaints\s+per\s+10,000\s+passengers\s+carried\s+for\s+the\s+month\s+of\s+[A-Za-z]+\s+\d{4}\s+has\s+been\s+around\s+([0-9.]+)",
    re.IGNORECASE,
)
_PAX_MARKER_RE = re.compile(r"^(Pax|Carried)$", re.IGNORECASE)


def _finite(n):
    return math.isfinite(n)


def month_name_from_period(report_period):
    """'2026-04' -> 'April2026' (for the standard TrafficReport<Month><Year>.pdf key)."""
    m = _PERIOD_RE.match(str(report_period).strip())
    if not m:
        return None
    month_index = int(m.group(2)) - 1
    if month_index < 0 or month_index > 11:
        return None
    return f"{MONTH_NAMES[month_index]}{m.group(1)}"


class DgcaHttpError(IOError):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


def request_buffer(url, headers=None, timeout=None):
    """Download a raw buffer with the UA + report referer headers."""
    res = requests.get(
        url,
        headers={"user-agent": UA, "referer": PDF_REFERER, **(headers or {})},
        timeout=timeout,
    )
    if res.status_code < 200 or res.status_code >= 300:
        err = DgcaHttpError(f"DGCA download {url} -> HTTP {res.status_code}", status=res.status_code)
        raise err
    return res.content


def tokenize(text):
    """Split report text into a stream of trimmed, non-empty tokens."""
    tokens = []
    for line in str(text or "").splitlines():
        line = line.strip()
        if line:
            tokens.extend(line.split())
    return tokens


def _collect_numbers(tokens, start, count):
    """Collect up to ``count`` floats starting at ``start``, stopping at a month
    marker. Mirrors the JS ``nums(from, count)`` helper."""
    out = []
    i = start
    guard = 0
    while len(out) < count and i < len(tokens) and guard < 64:
        tok = tokens[i]
        if out and _MONTH_MARKER_RE.match(tok):
            break
        try:
            n = float(tok)
            if _finite(n):
                out.append(n)
        except ValueError:
            pass
        i += 1
        guard += 1
    return out


def parse_market_share_month(text, short_month):
    """Parse the airline market-share table for one month (e.g. 'Apr').

    :returns: list of ``{airline, passengersCarriedLakhs, marketSharePct}`` or None.
    """
    tokens = tokenize(text)
    try:
        idx = tokens.index(short_month)
    except ValueError:
        return None

    pax_start = idx + 1
    cursor = pax_start
    while cursor < len(tokens) and not _PAX_MARKER_RE.match(tokens[cursor]):
        cursor += 1
    nums_after = _collect_numbers(tokens, cursor + 1, 8)
    if len(nums_after) < 8:
        return None
    pax = list(nums_after)

    cursor = pax_start + 2 + len(nums_after)
    share = _collect_numbers(tokens, cursor, 8)

    return [
        {
            "airline": REPORT_AIRLINES[i],
            "passengersCarriedLakhs": pax[i],
            "marketSharePct": share[i] if len(share) == 8 else None,
        }
        for i in range(8)
    ]


def parse_monthly_report(text, report_period=None):
    """Parse the monthly report text into ``{reportPeriod, overall, airlines}``."""
    body = str(text or "")

    detected_period = report_period
    if not detected_period:
        m = _MONTH_PROSE_RE.search(body)
        if m:
            month_index = next(
                (i for i, n in enumerate(MONTH_NAMES) if n.lower().startswith(m.group(1).lower())),
                -1,
            )
            if month_index >= 0:
                detected_period = f"{m.group(2)}-{month_index + 1:02d}"

    cancellation = _CANCELLATION_RE.search(body)
    complaints = _COMPLAINTS_RE.search(body)
    per10k = _PER10K_RE.search(body)

    short_month = (
        MONTH_NAMES[int(detected_period[5:]) - 1][:3] if detected_period else "Apr"
    )
    market_rows = parse_market_share_month(body, short_month)

    overall = {
        "passengersCarriedTotalLakhs": (
            round(sum(r["passengersCarriedLakhs"] for r in market_rows), 2)
            if market_rows
            else None
        ),
        "cancellationRatePct": float(cancellation.group(1)) if cancellation else None,
        "complaintsTotal": int(complaints.group(1).replace(",", "")) if complaints else None,
        "complaintsPer10kPassengers": float(per10k.group(1)) if per10k else None,
    }

    return {
        "reportPeriod": detected_period,
        "overall": overall,
        "airlines": market_rows or [],
    }


__all__ = [
    "S3_BASE",
    "PDF_REFERER",
    "UA",
    "REPORT_AIRLINES",
    "MONTH_NAMES",
    "month_name_from_period",
    "request_buffer",
    "tokenize",
    "parse_market_share_month",
    "parse_monthly_report",
]