from __future__ import annotations

from dataclasses import dataclass
from statistics import mean

from .models import AircraftTrack


@dataclass(frozen=True)
class CandidateScore:
    aircraft_id: str
    geometry_score: float
    stability_score: float
    total_score: float


class AircraftTracker:
    """Ranks aircraft tracks for airplane-scatter usage."""

    def __init__(self, max_range_km: float = 600.0) -> None:
        self.max_range_km = max_range_km

    def rank_candidates(self, tracks: list[AircraftTrack]) -> list[CandidateScore]:
        scored = [self._score_track(track) for track in tracks if track.samples]
        return sorted(scored, key=lambda item: item.total_score, reverse=True)

    def select_best(self, tracks: list[AircraftTrack]) -> CandidateScore | None:
        ranked = self.rank_candidates(tracks)
        return ranked[0] if ranked else None

    def _score_track(self, track: AircraftTrack) -> CandidateScore:
        elevations = [sample.elevation_deg for sample in track.samples]
        ranges = [sample.slant_range_km for sample in track.samples]
        azimuths = [sample.azimuth_deg for sample in track.samples]

        avg_elevation = max(0.0, mean(elevations))
        avg_range = max(1.0, mean(ranges))
        geometry_score = min(avg_elevation / 30.0, 1.0) * 0.7 + max(
            0.0, (self.max_range_km - avg_range) / self.max_range_km
        ) * 0.3

        elev_span = max(elevations) - min(elevations) if len(elevations) > 1 else 0.0
        az_span = max(azimuths) - min(azimuths) if len(azimuths) > 1 else 0.0
        range_span = max(ranges) - min(ranges) if len(ranges) > 1 else 0.0
        stability_penalty = min(1.0, (elev_span / 20.0) + (az_span / 90.0) + (range_span / 200.0))
        stability_score = 1.0 - stability_penalty

        total_score = geometry_score * 0.65 + stability_score * 0.35
        return CandidateScore(
            aircraft_id=track.aircraft_id,
            geometry_score=geometry_score,
            stability_score=stability_score,
            total_score=total_score,
        )
