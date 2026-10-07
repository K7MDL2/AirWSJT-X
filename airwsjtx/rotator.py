from __future__ import annotations

from dataclasses import dataclass


@dataclass
class RotatorCommand:
    target_azimuth_deg: float
    target_elevation_deg: float


class RotatorController:
    def __init__(self, tolerance_deg: float = 2.0, stable_samples_required: int = 3) -> None:
        self.tolerance_deg = tolerance_deg
        self.stable_samples_required = stable_samples_required
        self._stable_samples = 0

    def reset(self) -> None:
        self._stable_samples = 0

    def create_command(self, target_azimuth_deg: float, target_elevation_deg: float) -> RotatorCommand:
        return RotatorCommand(
            target_azimuth_deg=target_azimuth_deg,
            target_elevation_deg=target_elevation_deg,
        )

    def update_lock(
        self,
        current_azimuth_deg: float,
        current_elevation_deg: float,
        target_azimuth_deg: float,
        target_elevation_deg: float,
    ) -> bool:
        az_ok = abs(current_azimuth_deg - target_azimuth_deg) <= self.tolerance_deg
        el_ok = abs(current_elevation_deg - target_elevation_deg) <= self.tolerance_deg
        if az_ok and el_ok:
            self._stable_samples += 1
        else:
            self._stable_samples = 0
        return self._stable_samples >= self.stable_samples_required
