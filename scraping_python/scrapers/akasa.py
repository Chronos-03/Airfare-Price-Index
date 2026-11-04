"""AkasaScraper - REAL fare adapter for Akasa Air (www.akasaair.com)
(Python port of src/scrapers/akasa/AkasaScraper.js).

Every request below is the live contract captured from the Akasa booking IBE:

  POST /api/ibe/token/generateToken      -> { data: { token, ... } }
  POST /api/ibe/availability/search      -> fares/journeys
  GET  /api/nsk/v2/resources/markets     -> authoritative market list
"""

import json
import re
from datetime import datetime

import requests

from ..services.fare_normalizer import normalize_raw_fare
from ..utils.date_utils import format_utc_date
from ..utils.jsonutil import dumps
from ..utils.retry import NonRetriableError
from .base import BaseScraper

DEFAULT_CONFIG = {
    "base_url": "https://prod-bl.qp.akasaair.com",
    "device_type": "WEB",
    "booking_type": "BOOKING",
    "user_type": "GUEST",
    "channel": "WEB",
    "currency": "INR",
    "max_connections": 8,
    "product_classes": ["NB", "LB", "EC", "AV"],
    "fare_types": ["NB", "LB", "R", "V"],
}

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

REFERER_HOME = "https://www.akasaair.com/"
REFERER_SEARCH = "https://www.akasaair.com/flight-search"


class AkasaHttpError(IOError):
    """Non-2xx / transport error surfaced by the Akasa IBE API requests."""

    def __init__(self, message, status=None, body=None):
        super().__init__(message)
        self.status = status
        self.body = body


def _default_config():
    env = DEFAULT_CONFIG
    return env


def request(url, method="GET", headers=None, body=None, timeout=None):
    headers = {"user-agent": UA, **(headers or {})}
    return requests.request(method, url, headers=headers, data=body, timeout=timeout)


def request_json(url, method="GET", headers=None, json=None, timeout=None):
    request_headers = {
        "accept": "application/json",
        "content-type": "application/json",
        **(headers or {}),
    }
    body = None if json is None else dumps(json)
    res = request(url, method=method, headers=request_headers, body=body, timeout=timeout)

    parsed = None
    if res.text:
        try:
            parsed = res.json()
        except ValueError:
            parsed = None

    if res.status_code < 200 or res.status_code >= 300:
        message = (
            parsed.get("error", {}).get("message")
            if isinstance(parsed, dict) and isinstance(parsed.get("error"), dict) and parsed.get("error").get("message")
            else f"HTTP {res.status_code}"
        )
        err = AkasaHttpError(f"Akasa IBE {method} {url} -> {message}", status=res.status_code, body=res.text)
        raise err
    return parsed


def _normalize(points):
    """3-letter IATA-ish route code passed to the model ('AKASA' reserved)."""
    s = str(points or "").upper().strip()
    if not s:
        raise NonRetriableError("AkasaScraper: route point is required")
    if re.search(r"[^A-Z0-9]", s) or len(s) != 3:
        raise NonRetriableError(f"AkasaScraper: invalid IATA-like code '{s}'")
    return s


class AkasaScraper(BaseScraper):
    def __init__(self, config=None):
        merged = _default_config()
        merged.update(config or {})
        super().__init__({"source": "akasa", **merged})
        self.base_url = str(self.config.get("base_url", "")).rstrip("/")

    def get_guest_token(self, headers=None):
        """Authenticate a fresh guest session and return the ``authorization`` token."""
        res = request_json(
            f"{self.base_url}/api/ibe/token/generateToken",
            method="POST",
            headers={"origin": REFERER_HOME, "referer": REFERER_HOME, **(headers or {})},
            json={
                "deviceType": self.config.get("device_type", "WEB"),
                "bookingType": self.config.get("booking_type", "BOOKING"),
                "userType": self.config.get("user_type", "GUEST"),
            },
        )
        token = res and isinstance(res, dict) and res.get("data", {}).get("token")
        if not token:
            raise AkasaHttpError("Akasa IBE token response did not include a token")
        return token

    def build_search_body(self, origin, destination, travel_date):
        date = format_utc_date(travel_date)
        return {
            "criteria": [
                {
                    "stations": {
                        "originStationCodes": [origin],
                        "destinationStationCodes": [destination],
                        "searchDestinationMacs": True,
                        "searchOriginMacs": True,
                    },
                    "dates": {"beginDate": f"{date}T00:00:00"},
                    "filters": {
                        "compressionType": 1,
                        "maxConnections": self.config.get("max_connections", 8),
                        "productClasses": self.config.get("product_classes", ["NB", "LB", "EC", "AV"]),
                        "fareTypes": self.config.get("fare_types", ["NB", "LB", "R", "V"]),
                    },
                }
            ],
            "passengers": {"types": [{"count": 1, "type": "ADT"}], "residentCountry": "IN"},
            "codes": {
                "currencyCode": self.config.get("currency", "INR"),
                "currentSourceOrganization": "AK",
                "promotionCode": "",
            },
            "numberOfFaresPerJourney": 10,
            "taxesAndFees": 1,
        }

    def build_grid_body(self, origins, destinations, travel_date):
        date = format_utc_date(travel_date)
        return {
            "criteria": [
                {
                    "stations": {
                        "originStationCodes": origins,
                        "destinationStationCodes": destinations,
                        "searchDestinationMacs": True,
                        "searchOriginMacs": True,
                    },
                    "dates": {"beginDate": f"{date}T00:00:00"},
                    "filters": {
                        "compressionType": 1,
                        "maxConnections": self.config.get("max_connections", 8),
                        "productClasses": self.config.get("product_classes", ["NB", "LB", "EC", "AV"]),
                        "fareTypes": self.config.get("fare_types", ["NB", "LB", "R", "V"]),
                    },
                }
            ],
            "passengers": {"types": [{"count": 1, "type": "ADT"}], "residentCountry": "IN"},
            "codes": {
                "currencyCode": self.config.get("currency", "INR"),
                "currentSourceOrganization": "AK",
                "promotionCode": "",
            },
            "numberOfFaresPerJourney": 10,
            "taxesAndFees": 1,
        }

    def fetch_markets(self, token):
        res = request_json(
            f"{self.base_url}/api/nsk/v2/resources/markets",
            method="GET",
            headers={"authorization": token, "origin": REFERER_HOME, "referer": REFERER_HOME},
        )
        if isinstance(res, list):
            return res
        if isinstance(res, dict) and isinstance(res.get("data"), list):
            return res["data"]
        return []

    @staticmethod
    def active_directed_markets(markets):
        """Reduce raw market rows to the ACTIVE directed city-pair list."""
        if not isinstance(markets, list):
            return []
        seen = set()
        routes = []
        for m in markets:
            if not isinstance(m, dict) or m.get("inActive"):
                continue
            origin = str(m.get("locationCode") or "").upper().strip()
            destination = str(m.get("travelLocationCode") or "").upper().strip()
            if not origin or not destination or origin == destination:
                continue
            key = f"{origin}:{destination}"
            if key in seen:
                continue
            seen.add(key)
            routes.append({"origin": origin, "destination": destination})
        return routes

    def extract_journeys(self, json_payload, origin, destination):
        """Pure transformation of an availability/search response into raw journey
        rows for the requested route."""
        if not isinstance(json_payload, dict):
            return []
        data = json_payload.get("data")
        if not isinstance(data, dict) or not isinstance(data.get("faresAvailable"), list):
            return []

        fares_by_key = {}
        for entry in data.get("faresAvailable") or []:
            if isinstance(entry, dict) and entry.get("key"):
                fares_by_key[entry["key"]] = entry.get("value")

        trips = []
        if isinstance(data.get("results"), list):
            for r in data["results"]:
                if isinstance(r, dict) and isinstance(r.get("trips"), list):
                    trips.extend(r["trips"])

        raw_journeys = []
        for trip in trips:
            if not isinstance(trip, dict):
                continue
            for market in trip.get("journeysAvailableByMarket") or []:
                if not isinstance(market, dict):
                    continue
                for journey in market.get("value") or []:
                    if not isinstance(journey, dict):
                        continue
                    segments = journey.get("segments") or []
                    first = segments[0].get("designator") if segments else None
                    last = segments[-1].get("designator") if segments else None
                    if not isinstance(first, dict) or not isinstance(last, dict):
                        continue
                    if str(first.get("origin")).upper() != origin:
                        continue
                    if str(last.get("destination")).upper() != destination:
                        continue

                    buckets = []
                    for f in journey.get("fares") or []:
                        if isinstance(f, dict) and f.get("fareAvailabilityKey"):
                            value = fares_by_key.get(f["fareAvailabilityKey"])
                            if value is not None:
                                buckets.append(value)
                    fares = []
                    for b in buckets:
                        fares.extend(b.get("fares") or [])
                    if not fares:
                        continue

                    raw_journeys.append(
                        {
                            "journey": journey,
                            "tripDate": _parse_trip_date(trip.get("date")),
                            "_faresValue": buckets[0],
                        }
                    )
        return raw_journeys

    def extract_journeys_by_route(self, json_payload):
        """Pure transformation of an availability/search response into raw
        journeys grouped by the ACTUAL route codes (segment designators)."""
        result = {}
        if not isinstance(json_payload, dict):
            return result
        data = json_payload.get("data")
        if not isinstance(data, dict) or not isinstance(data.get("faresAvailable"), list):
            return result

        fares_by_key = {}
        for entry in data.get("faresAvailable") or []:
            if isinstance(entry, dict) and entry.get("key"):
                fares_by_key[entry["key"]] = entry.get("value")

        trips = []
        if isinstance(data.get("results"), list):
            for r in data["results"]:
                if isinstance(r, dict) and isinstance(r.get("trips"), list):
                    trips.extend(r["trips"])

        def journey_id(journey):
            if journey.get("journeyKey"):
                return journey["journeyKey"]
            parts = []
            for s in journey.get("segments") or []:
                if not isinstance(s, dict):
                    continue
                identifier = s.get("identifier") or {}
                if isinstance(identifier, dict):
                    seg_id = identifier.get("identifier")
                    parts.append(json.dumps(seg_id, separators=(",", ":")) if seg_id is not None else json.dumps(s.get("designator") or {}, separators=(",", ":")))
            return "|".join(parts)

        for trip in trips:
            if not isinstance(trip, dict):
                continue
            for market in trip.get("journeysAvailableByMarket") or []:
                if not isinstance(market, dict):
                    continue
                for journey in market.get("value") or []:
                    if not isinstance(journey, dict):
                        continue
                    segments = journey.get("segments") or []
                    first = segments[0].get("designator") if segments else None
                    last = segments[-1].get("designator") if segments else None
                    if not isinstance(first, dict) or not isinstance(last, dict):
                        continue
                    origin = str(first.get("origin")).upper()
                    destination = str(last.get("destination")).upper()
                    if not origin or not destination:
                        continue

                    buckets = []
                    for f in journey.get("fares") or []:
                        if isinstance(f, dict) and f.get("fareAvailabilityKey"):
                            value = fares_by_key.get(f["fareAvailabilityKey"])
                            if value is not None:
                                buckets.append(value)
                    bucket_fares = []
                    for b in buckets:
                        bucket_fares.extend(b.get("fares") or [])
                    if not bucket_fares:
                        continue

                    route_key = f"{origin}-{destination}"
                    id_key = journey_id(journey)
                    route_list = result.setdefault(route_key, [])
                    if any(journey_id(r["journey"]) == id_key for r in route_list):
                        continue
                    route_list.append(
                        {
                            "journey": journey,
                            "tripDate": _parse_trip_date(trip.get("date")),
                            "_faresValue": buckets[0],
                        }
                    )
        return result

    def search_grid(self, params):
        """ONE grid search (many origin x destination markets in one request)."""
        if not params:
            raise NonRetriableError("AkasaScraper: searchGrid requires params")
        if not isinstance(params.get("origins"), list) or not params.get("origins"):
            raise NonRetriableError("AkasaScraper: searchGrid requires origins[]")
        if not params.get("destinations"):
            raise NonRetriableError("AkasaScraper: searchGrid requires destinations[]")
        if not params.get("travelDate"):
            raise NonRetriableError("AkasaScraper: searchGrid requires travelDate")

        token = params.get("token") or self.get_guest_token()
        res = request_json(
            f"{self.base_url}/api/ibe/availability/search",
            method="POST",
            headers={"authorization": token, "origin": REFERER_HOME, "referer": REFERER_SEARCH},
            json=self.build_grid_body(
                origins=[_normalize(o) for o in params["origins"]],
                destinations=[_normalize(d) for d in params["destinations"]],
                travel_date=params["travelDate"],
            ),
        )
        return res

    @staticmethod
    def sum_service_charges(bucket, charge_type):
        """Sum a service-charge type across a fare bucket."""
        if not bucket or not isinstance(bucket.get("passengerFares"), list):
            return 0
        total = 0
        for pf in bucket["passengerFares"]:
            if not isinstance(pf, dict):
                continue
            for sc in pf.get("serviceCharges") or []:
                if isinstance(sc, dict) and sc.get("type") == charge_type and isinstance(sc.get("amount"), (int, float)):
                    total += sc["amount"]
        return total

    def reduce_fare_bucket(self, bucket):
        """Reduce one fare bucket to the all-in fare for one adult."""
        if not isinstance(bucket, dict) or not isinstance(bucket.get("fares"), list):
            return None
        best = None
        best_total = float("inf")
        for fare in bucket["fares"]:
            if not isinstance(fare, dict):
                continue
            pfs = fare.get("passengerFares") if isinstance(fare.get("passengerFares"), list) else None
            pf = pfs[0] if pfs else None
            if not isinstance(pf, dict):
                continue
            total = pf["fareAmount"] if isinstance(pf.get("fareAmount"), (int, float)) else pf.get("discountedFare")
            if not isinstance(total, (int, float)) or not _finite(total):
                continue
            if total < best_total:
                best_total = total
                best = fare
        if best is None:
            return None

        pf = best["passengerFares"][0]
        taxes = AkasaScraper.sum_service_charges({"passengerFares": best["passengerFares"]}, "Tax")
        travel_fee = AkasaScraper.sum_service_charges({"passengerFares": best["passengerFares"]}, "TravelFee")

        base = (
            pf["discountedFare"]
            if isinstance(pf.get("discountedFare"), (int, float))
            else pf["publishedFare"]
            if isinstance(pf.get("publishedFare"), (int, float))
            else best_total - taxes - travel_fee
        )

        return {
            "classOfService": best.get("classOfService"),
            "classType": best.get("classType"),
            "productClass": best.get("productClass"),
            "ruleNumber": best.get("ruleNumber"),
            "fareApplicationType": best.get("fareApplicationType"),
            "baseFare": base,
            "taxes": taxes,
            "travelFee": travel_fee,
            "totalFare": best_total,
            "discountedFare": pf.get("discountedFare"),
            "publishedFare": pf.get("publishedFare"),
        }

    def search_flights(self, params):
        origin = _normalize(params.get("origin"))
        destination = _normalize(params.get("destination"))
        if origin == destination:
            raise NonRetriableError("AkasaScraper: origin and destination must differ")
        if not params.get("travelDate"):
            raise NonRetriableError("AkasaScraper: travelDate is required")

        token = self.get_guest_token()
        res = request_json(
            f"{self.base_url}/api/ibe/availability/search",
            method="POST",
            headers={"authorization": token, "origin": REFERER_HOME, "referer": REFERER_SEARCH},
            json=self.build_search_body(origin, destination, params["travelDate"]),
        )

        return self.extract_journeys(res, origin, destination)

    def normalize_flight(self, raw_flight, context):
        journey = raw_flight["journey"]

        segments = []
        for seg in journey.get("segments") or []:
            leg = seg.get("legs")[0] if isinstance(seg.get("legs"), list) and seg.get("legs") else None
            identifier = seg.get("identifier") or (leg and leg.get("identifier")) or {}
            info = leg and leg.get("legInfo")
            d = seg.get("designator") or {}
            segments.append(
                {
                    "flightNumber": f"{identifier.get('carrierCode')}{identifier.get('identifier') or ''}"
                    if identifier.get("carrierCode")
                    else None,
                    "carrierCode": identifier.get("carrierCode") or None,
                    "flightReference": leg.get("flightReference") if leg and leg.get("flightReference") else None,
                    "origin": d.get("origin") or None,
                    "destination": d.get("destination") or None,
                    "departure": d.get("departure") or None,
                    "arrival": d.get("arrival") or None,
                    "departureTerminal": info.get("departureTerminal") if info else None,
                    "arrivalTerminal": info.get("arrivalTerminal") if info else None,
                    "equipmentType": info.get("equipmentType") if info else None,
                }
            )

        best = self.reduce_fare_bucket(raw_flight["_faresValue"])
        bucket_fares = (raw_flight["_faresValue"].get("fares") or []) if isinstance(raw_flight["_faresValue"], dict) else []
        buckets = []
        for fare in bucket_fares:
            pfs = fare.get("passengerFares") if isinstance(fare.get("passengerFares"), list) else None
            pf = pfs[0] if pfs else None
            buckets.append(
                {
                    "classOfService": fare.get("classOfService"),
                    "productClass": fare.get("productClass"),
                    "ruleNumber": fare.get("ruleNumber"),
                    "fareApplicationType": fare.get("fareApplicationType"),
                    "totalFare": pf["fareAmount"] if pf and isinstance(pf.get("fareAmount"), (int, float)) else None,
                    "discountedFare": pf.get("discountedFare") if pf else None,
                    "publishedFare": pf.get("publishedFare") if pf else None,
                }
            )

        first = segments[0] if segments else {}
        last = segments[-1] if segments else {}

        statuses = []
        jfares = journey.get("fares") or []
        details = jfares[0].get("details") if jfares and isinstance(jfares[0], dict) else None
        for d_info in details or []:
            if isinstance(d_info, dict) and d_info.get("status"):
                statuses.append(str(d_info["status"]).upper())

        if statuses and all(s == "ACTIVE" for s in statuses):
            availability = "AVAILABLE"
        elif statuses and any(s in ("SOLDOUT", "SOLD_OUT") for s in statuses):
            availability = "SOLD_OUT"
        else:
            availability = "NOT_FOUND" if statuses else "AVAILABLE"

        raw = {
            "origin": first.get("origin") or context.get("origin"),
            "destination": last.get("destination") or context.get("destination"),
            "travelDate": raw_flight.get("tripDate") or context.get("travelDate"),
            "airline": "Akasa Air",
            "flightNumber": first.get("flightNumber"),
            "fareClass": best.get("classOfService") if best else None,
            "baseFare": best.get("baseFare") if best else None,
            "taxes": best.get("taxes") if best else None,
            "udf": best.get("travelFee") if best else None,
            "convenienceFee": 0,
            "totalFare": best.get("totalFare") if best else None,
            "currency": self.config.get("currency", "INR"),
            "availability": availability,
        }

        fare = normalize_raw_fare(raw, context)

        journey_stops = journey.get("stops")
        fare["metric"] = {
            "platform": "akasa-air-ibe-api",
            "flightType": journey.get("flightType") or None,
            "stops": journey_stops if isinstance(journey_stops, (int, float)) else len(segments) - 1,
            "journeyKey": journey.get("journeyKey") or None,
            "currency": self.config.get("currency", "INR"),
            "segments": segments,
            "bestFare": (
                {
                    "classOfService": best.get("classOfService"),
                    "productClass": best.get("productClass"),
                    "fareApplicationType": best.get("fareApplicationType"),
                    "totalFare": best.get("totalFare"),
                    "baseFare": best.get("baseFare"),
                    "taxes": best.get("taxes"),
                    "travelFee": best.get("travelFee"),
                }
                if best
                else None
            ),
            "fares": buckets,
        }

        return fare


def _finite(value):
    import math

    if isinstance(value, bool):
        return False
    return math.isfinite(value)


def _parse_trip_date(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


__all__ = ["AkasaScraper", "DEFAULT_CONFIG", "UA", "AkasaHttpError"]