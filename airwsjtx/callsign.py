"""
Callsign lookup — resolves callsign → (name, grid, lat, lon).

Priority:
  1. Built-in known stations (instant, no network)
  2. callook.info (US callsigns, free JSON API)
  3. qrzcq.com scrape (international, no auth)
  4. Infer grid from call area prefix as last resort
"""
from __future__ import annotations

import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


@dataclass
class StationInfo:
    callsign: str
    name: str | None
    grid: str | None          # Maidenhead (4 or 6 char)
    lat: float | None
    lon: float | None
    country: str | None
    source: str               # where the data came from


# ─── Known stations (pre-seeded) ─────────────────────────────────────────────

_KNOWN: dict[str, StationInfo] = {
    "VE7NX": StationInfo("VE7NX", "Neil Olson", "CN89oh", 49.300, -122.810, "Canada", "known"),
    "W7PUA": StationInfo("W7PUA", "Bob Larkin", "CN84jq", 44.677, -123.227, "USA", "known"),
}


# ─── callook.info (US callsigns) ─────────────────────────────────────────────

def _callook(callsign: str) -> StationInfo | None:
    url = f"https://callook.info/{callsign.upper()}/json"
    try:
        import json
        req = urllib.request.Request(url, headers={"User-Agent": "AirWSJT-X/0.1"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            d: dict[str, Any] = json.loads(resp.read())
        if d.get("status") != "VALID":
            return None
        loc = d.get("location", {})
        lat = float(loc["latitude"]) if loc.get("latitude") else None
        lon = float(loc["longitude"]) if loc.get("longitude") else None
        grid = loc.get("gridsquare") or (_latlon_to_grid(lat, lon) if lat and lon else None)
        name_parts = d.get("name", {})
        name = (
            f"{name_parts.get('first','')} {name_parts.get('last','')}".strip()
            if isinstance(name_parts, dict)
            else str(name_parts)
        ) or None
        return StationInfo(
            callsign=callsign.upper(),
            name=name,
            grid=grid,
            lat=lat,
            lon=lon,
            country="USA",
            source="callook.info",
        )
    except Exception:
        return None


# ─── qrzcq.com scrape (international) ────────────────────────────────────────

def _qrzcq(callsign: str) -> StationInfo | None:
    url = f"https://www.qrzcq.com/call/{callsign.upper()}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "AirWSJT-X/0.1"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            html = resp.read().decode("utf-8", "ignore")
        lat_m = re.search(r'"latitude":\s*"([0-9.-]+)"', html)
        lon_m = re.search(r'"longitude":\s*"([0-9.-]+)"', html)
        grid_m = re.search(r"Grid.*?([A-R]{2}[0-9]{2}[a-x]{2})", html, re.I | re.S)
        name_m = re.search(r'<title>[^<]*?([A-Z0-9/]+)\s*-\s*([^<]+)</title>', html)
        lat = float(lat_m.group(1)) if lat_m else None
        lon = float(lon_m.group(1)) if lon_m else None
        grid = grid_m.group(1) if grid_m else (_latlon_to_grid(lat, lon) if lat and lon else None)
        name = name_m.group(2).strip() if name_m else None
        if not lat and not grid:
            return None
        return StationInfo(
            callsign=callsign.upper(),
            name=name,
            grid=grid,
            lat=lat,
            lon=lon,
            country=None,
            source="qrzcq.com",
        )
    except Exception:
        return None


# ─── Lat/lon → Maidenhead ─────────────────────────────────────────────────────

def _latlon_to_grid(lat: float, lon: float) -> str:
    lon2 = lon + 180
    lat2 = lat + 90
    field_lon = chr(ord("A") + int(lon2 / 20))
    field_lat = chr(ord("A") + int(lat2 / 10))
    sq_lon = int((lon2 % 20) / 2)
    sq_lat = int(lat2 % 10)
    sub_lon = chr(ord("a") + int((lon2 % 2) / (2 / 24)))
    sub_lat = chr(ord("a") + int((lat2 % 1) / (1 / 24)))
    return f"{field_lon}{field_lat}{sq_lon}{sq_lat}{sub_lon}{sub_lat}"


# ─── Call-prefix fallback ─────────────────────────────────────────────────────

_PREFIX_GRID: dict[str, str] = {
    # US call areas (approximate grid centres)
    "W1": "FN42", "K1": "FN42", "N1": "FN42",
    "W2": "FN20", "K2": "FN20", "N2": "FN20",
    "W3": "FM19", "K3": "FM19",
    "W4": "EM73", "K4": "EM73",
    "W5": "EM30", "K5": "EM30",
    "W6": "DM04", "K6": "DM04",
    "W7": "CN87", "K7": "CN87",
    "W8": "EN82", "K8": "EN82",
    "W9": "EN61", "K9": "EN61",
    "W0": "DN70", "K0": "DN70",
    # Canada
    "VE1": "FN74", "VA1": "FN74",
    "VE2": "FN35", "VA2": "FN35",
    "VE3": "EN93", "VA3": "EN93",
    "VE4": "EN19", "VA4": "EN19",
    "VE5": "DO33", "VA5": "DO33",
    "VE6": "DO33",
    "VE7": "CN89", "VA7": "CN89",
    "VE8": "CP18",
    # Europe
    "G": "IO91", "GM": "IO88",
    "DL": "JO51", "OK": "JO70",
    "F": "JN03", "I": "JN53",
    "PA": "JO22", "SM": "JP80",
    "OH": "KP30", "OZ": "JO55",
    "SP": "KO02", "HA": "JN97",
    "CT": "IM57",
    "EA": "IM98",
}


def _prefix_fallback(callsign: str) -> StationInfo | None:
    call = callsign.upper()
    for prefix, grid in _PREFIX_GRID.items():
        if call.startswith(prefix):
            return StationInfo(
                callsign=call,
                name=None,
                grid=grid,
                lat=None,
                lon=None,
                country=None,
                source="prefix-fallback",
            )
    return None


# ─── Public entry point ───────────────────────────────────────────────────────

def lookup(callsign: str) -> StationInfo:
    """Look up a callsign. Never raises — returns best-effort result."""
    call = callsign.strip().upper()

    # 1. Known stations
    if call in _KNOWN:
        return _KNOWN[call]

    # 2. callook.info (works well for US)
    result = _callook(call)
    if result:
        return result

    # 3. qrzcq scrape (international)
    result = _qrzcq(call)
    if result:
        return result

    # 4. Prefix fallback
    result = _prefix_fallback(call)
    if result:
        return result

    # 5. Unknown
    return StationInfo(callsign=call, name=None, grid=None, lat=None, lon=None,
                       country=None, source="not-found")
