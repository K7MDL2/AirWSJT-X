from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class Station:
    callsign: str
    locator: str


@dataclass(frozen=True)
class AircraftSample:
    timestamp: datetime
    azimuth_deg: float
    elevation_deg: float
    slant_range_km: float


@dataclass(frozen=True)
class AircraftTrack:
    aircraft_id: str
    samples: tuple[AircraftSample, ...]
