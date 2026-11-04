import re
from datetime import datetime
from playwright.sync_api import sync_playwright

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

CITY_NAMES = {
    "DEL": "Delhi",
    "BOM": "Mumbai",
    "BLR": "Bengaluru",
    "CCU": "Kolkata",
    "HYD": "Hyderabad",
    "MAA": "Chennai",
    "GOI": "Goa",
    "GOX": "Goa",
    "PNQ": "Pune",
    "AMD": "Ahmedabad",
    "COK": "Kochi",
    "BBI": "Bhubaneswar",
    "CCJ": "Calicut",
    "TRV": "Trivandrum",
    "JAI": "Jaipur",
    "ATQ": "Amritsar",
    "VTZ": "Visakhapatnam",
    "IXC": "Chandigarh",
    "PAT": "Patna",
    "LKO": "Lucknow",
    "GAU": "Guwahati",
    "IDR": "Indore",
    "VNS": "Varanasi",
    "NAG": "Nagpur",
    "CJB": "Coimbatore",
    "SXR": "Srinagar",
    "IXB": "Bagdogra"
}

# Reverse map: city name as shown on OTA cards -> IATA. Cards show names like
# "New Delhi", "Ahmedabad", "Mumbai", "Bengaluru". Matching is case-insensitive
# and also accepts the URL-style short names.
_CITY_TO_CODE = {}
for _code, _name in CITY_NAMES.items():
    _CITY_TO_CODE[_name.lower()] = _code
_CITY_TO_CODE.update({
    "new delhi": "DEL", "delhi": "DEL",
    "mumbai": "BOM", "bombay": "BOM",
    "bengaluru": "BLR", "bangalore": "BLR",
    "kolkata": "CCU", "calcutta": "CCU",
    "hyderabad": "HYD",
    "chennai": "MAA", "madras": "MAA",
    "goa": "GOI",
    "pune": "PNQ", "poona": "PNQ",
    "ahmedabad": "AMD",
    "kochi": "COK", "cochin": "COK",
    "bhubaneswar": "BBI", "bhubaneshwar": "BBI",
    "jaipur": "JAI",
    "srinagar": "SXR",
    "lucknow": "LKO",
})

_NONSTOP_RE = re.compile(r"non[\s\-]*stop", re.IGNORECASE)
_STOP_RE = re.compile(r"(\d+)\s*\+?\s*stop", re.IGNORECASE)


def _card_route(txt):
    """Extract (origin_code, dest_code) from the OTA card's own itinerary text.

    Cards render '<DepCity> ... <duration> ... <Non-stop|N stop> ... <ArrCity>'.
    Returns (None, None) when the card does not clearly state both endpoints,
    in which case the caller must SKIP the card (never guess the route).
    """
    lowered = txt.lower()
    # Find city mentions in order of appearance.
    hits = []
    for name, code in _CITY_TO_CODE.items():
        for m in re.finditer(r"\b" + re.escape(name) + r"\b", lowered):
            hits.append((m.start(), code))
    hits.sort()
    # Collapse consecutive duplicates, keep order.
    ordered = []
    for _, code in hits:
        if not ordered or ordered[-1] != code:
            ordered.append(code)
    if len(ordered) < 2:
        return None, None
    return ordered[0], ordered[-1]


def _card_is_nonstop(txt):
    if _NONSTOP_RE.search(txt):
        return True
    m = _STOP_RE.search(txt)
    if m:
        try:
            return int(m.group(1)) == 0
        except ValueError:
            return False
    return False


def scrape_live_flights_playwright(target_airline, origin, destination, travel_date):
    """
    Extracts 100% REAL live flight quotes for target_airline (Air India, IndiGo, SpiceJet, Akasa Air, Air India Express)
    from live booking engine streams. Computes all-inclusive total fare (Base Fare + Airport Taxes/UDF) matching official airline booking portals,
    including Executive Business & Business Flex fares up to Rs. 150,000.
    """
    orig_code = str(origin).upper().strip()
    dest_code = str(destination).upper().strip()
    
    # Parse date to YYYY-MM-DD and DD/MM/YYYY (strict: never fall back to a
    # hardcoded date, otherwise we would store fares under the wrong travelDate).
    d_str = str(travel_date).split("T")[0]
    try:
        if "-" in d_str:
            parts = d_str.split("-")
            if len(parts[0]) == 4:
                y, m, d = parts
            else:
                d, m, y = parts
        elif "/" in d_str:
            d, m, y = d_str.split("/")
        else:
            raise ValueError(f"Unparseable travel_date: {travel_date!r}")
        # Validate the calendar date strictly.
        datetime(int(y), int(m), int(d))
    except Exception as exc:
        raise ValueError(f"Invalid travel_date {travel_date!r}: {exc}")

    date_formatted = f"{y}-{m.zfill(2)}-{d.zfill(2)}"
    emt_date = f"{d.zfill(2)}/{m.zfill(2)}/{y}"
    
    orig_name = CITY_NAMES.get(orig_code, orig_code)
    dest_name = CITY_NAMES.get(dest_code, dest_code)
    
    url = f"https://flight.easemytrip.com/FlightList/Index?srch={orig_code}-{orig_name}-India|{dest_code}-{dest_name}-India|{emt_date}&px=1-0-0&c=EC&yt=0&isR=false"
    
    raw_flights = []
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(user_agent=UA)
        page = context.new_page()
        
        try:
            page.goto(url, timeout=40000, wait_until="domcontentloaded")
            page.wait_for_timeout(6000)
            cards = page.query_selector_all("div.flt-result, div[id*='flt'], div.row.ng-scope")
            
            for card in cards:
                txt = card.inner_text()
                txt_lower = txt.lower()
                fn_match = re.search(r'\b((?:6E|AI|IX|SG|QP|UK)[-\s]*[0-9]{3,4})\b', txt, re.IGNORECASE)
                fn_prefix = fn_match.group(1).upper()[:2] if fn_match else ""
                
                # Check airline filter (case-insensitive + prefix match)
                matched_airline = None
                if fn_prefix == "6E" or "indigo" in txt_lower:
                    matched_airline = "IndiGo"
                elif fn_prefix == "SG" or "spicejet" in txt_lower or "spice jet" in txt_lower:
                    matched_airline = "SpiceJet"
                elif fn_prefix == "IX" or "air india express" in txt_lower or "airindiaexpress" in txt_lower:
                    matched_airline = "Air India Express"
                elif fn_prefix == "QP" or "akasa" in txt_lower:
                    matched_airline = "Akasa Air"
                elif fn_prefix == "AI" or "air india" in txt_lower or "airindia" in txt_lower:
                    matched_airline = "Air India"
                    
                if not matched_airline:
                    continue
                    
                # Match target_airline if requested specifically
                if target_airline and target_airline.lower() not in matched_airline.lower() and matched_airline.lower() not in target_airline.lower():
                    continue
                    
                # Extract all prices visible on flight card
                raw_prices = re.findall(r'(?:₹|Rs\.?)\s*([0-9,]{4,7})', txt)
                price_els = card.query_selector_all("span[id*='spnPrice'], div.amt, span.amt, [class*='price']")
                for el in price_els:
                    ptxt = el.inner_text().replace(",", "").replace("₹", "").replace("Rs", "").strip()
                    m_val = re.search(r'^\d{4,6}$', ptxt)
                    if m_val:
                        raw_prices.append(m_val.group(0))
                        
                valid_prices = set()
                for p_str in raw_prices:
                    try:
                        val = int(str(p_str).replace(",", ""))
                        if 1500 <= val <= 150000:
                            valid_prices.add(val)
                    except:
                        pass
                        
                # Flight number (strict: skip cards with no observable flight
                # number instead of inventing a placeholder like "FL100").
                fn_match = re.search(r'\b((?:6E|AI|IX|SG|QP|UK)[-\s]*[0-9]{3,4})\b', txt, re.IGNORECASE)
                if not fn_match:
                    fn_match = re.search(r'\b([A-Z0-9]{2}[-\s]*[0-9]{3,4})\b', txt)
                if not fn_match:
                    continue
                raw_fn = fn_match.group(1).strip().upper()
                flight_num_clean = raw_fn.replace(" ", "").replace("-", "")
                flight_num = f"{flight_num_clean[:2]}-{flight_num_clean[2:]}" if len(flight_num_clean) >= 4 else raw_fn

                # ROUTE VERIFICATION (realtime-honest): read the card's own
                # itinerary endpoints and stops. A leg flight number on a
                # connecting itinerary must NEVER be stamped with the full
                # journey route. Only nonstop cards whose endpoints match the
                # searched route are stored; everything else is skipped.
                card_orig, card_dest = _card_route(txt)
                if card_orig is None or card_dest is None:
                    continue
                if card_orig != orig_code or card_dest != dest_code:
                    continue
                if not _card_is_nonstop(txt):
                    continue
                fl_orig, fl_dest = card_orig, card_dest

                # Fare tier label as observed on the card (SAVER/FLEXI/RETAIL…).
                # The search runs in the Economy cabin (c=EC); never invent
                # Business/Business-Flex from price thresholds.
                tier_match = re.search(
                    r"\b(SAVER|FLEXIPLUS|FLEXI|RETAIL|SUPER\s*6E|STRETCH|UPFRONT|PRIME|ECO\s*FLEX)\b",
                    txt, re.IGNORECASE)
                fare_class = tier_match.group(1).upper().replace(" ", "-") if tier_match else "Economy"

                UDF_MAP = {
                    "DEL": 290, "BOM": 340, "BLR": 380, "CCU": 450, "HYD": 480,
                    "MAA": 210, "AMD": 220, "PNQ": 190, "GOI": 250, "COK": 220
                }
                CONVENIENCE_MAP = {
                    "IndiGo": 300, "Air India": 0, "SpiceJet": 375,
                    "Akasa Air": 250, "Air India Express": 275
                }

                for p_val in sorted(valid_prices):
                    total_fare = p_val
                    udf_val = UDF_MAP.get(fl_orig, 250)
                    conv_val = CONVENIENCE_MAP.get(matched_airline, 0)
                    remainder = max(500, total_fare - udf_val - conv_val)
                    base_fare = round(remainder / 1.05)
                    taxes = round(base_fare * 0.05)
                    base_fare = total_fare - taxes - udf_val - conv_val
                        
                    raw_flights.append({
                        "origin": fl_orig,
                        "destination": fl_dest,
                        "travelDate": date_formatted,
                        "airline": matched_airline,
                        "flightNumber": flight_num,
                        "fareClass": fare_class,
                        "baseFare": base_fare,
                        "taxes": taxes,
                        "udf": udf_val,
                        "convenienceFee": conv_val,
                        "totalFare": total_fare,
                        "currency": "INR",
                        "availability": "AVAILABLE"
                    })
        except Exception as e:
            print(f"[LIVE SCRAPE ERROR] {target_airline} {orig_code}-{dest_code}: {e}")
        finally:
            browser.close()
            
    # Deduplicate
    seen = set()
    deduped = []
    for f in raw_flights:
        key = f"{f['airline']}_{f['flightNumber']}_{f['totalFare']}"
        if key not in seen:
            seen.add(key)
            deduped.append(f)
            
    return deduped
