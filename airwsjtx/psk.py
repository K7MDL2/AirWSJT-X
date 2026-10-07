from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AirscatterOperatingProfile:
    name: str = "AirScatter-Q65-15s"
    recommended_mode: str = "Q65"
    recommended_period_s: int = 15

    def discoverability_hint(self, band_mhz: float) -> str:
        return (
            f"{self.name}: use WSJT-X native PSK Reporter on {band_mhz:.0f} MHz+, "
            "with consistent mode/band/time filters for station discovery."
        )
