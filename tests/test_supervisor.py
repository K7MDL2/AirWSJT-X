from datetime import datetime, timedelta, timezone
import unittest

from airwsjtx.models import AircraftSample, AircraftTrack, Station
from airwsjtx.state_machine import SessionState
from airwsjtx.supervisor import AirWSJTXSupervisor
from airwsjtx.tracker import AircraftTracker


def track(
    aircraft_id: str,
    azimuths: list[float],
    elevations: list[float],
    ranges: list[float],
) -> AircraftTrack:
    now = datetime.now(timezone.utc)
    samples = tuple(
        AircraftSample(
            timestamp=now + timedelta(seconds=idx * 15),
            azimuth_deg=azimuths[idx],
            elevation_deg=elevations[idx],
            slant_range_km=ranges[idx],
        )
        for idx in range(len(azimuths))
    )
    return AircraftTrack(aircraft_id=aircraft_id, samples=samples)


class TrackerTests(unittest.TestCase):
    def test_ranking_prefers_strong_stable_track(self) -> None:
        strong = track("A1", [120, 122, 123], [18, 19, 20], [220, 230, 240])
        weak = track("B1", [60, 180, 260], [3, 10, 1], [420, 520, 590])
        ranked = AircraftTracker().rank_candidates([weak, strong])
        self.assertEqual(ranked[0].aircraft_id, "A1")


class SupervisorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.station_a = Station(callsign="K1AAA", locator="JN58")
        self.station_b = Station(callsign="K2BBB", locator="JN68")
        self.valid_track = track("A1", [100, 101, 102], [16, 17, 18], [250, 255, 260])
        self.supervisor = AirWSJTXSupervisor()

    def test_rejects_band_below_23cm(self) -> None:
        with self.assertRaises(ValueError):
            self.supervisor.begin_session(
                station_a=self.station_a,
                station_b=self.station_b,
                band_mhz=432.0,
                frequency_hz=432150000,
                tracks=[self.valid_track],
            )

    def test_qso_requires_rotator_lock_then_operator_start(self) -> None:
        hint = self.supervisor.begin_session(
            station_a=self.station_a,
            station_b=self.station_b,
            band_mhz=1296.0,
            frequency_hz=1296150000,
            tracks=[self.valid_track],
        )
        self.assertIn("WSJT-X native PSK Reporter", hint)

        self.supervisor.update_tracking(current_azimuth_deg=80, current_elevation_deg=5)
        self.assertEqual(self.supervisor.session.state, SessionState.TRACKING)

        self.supervisor.update_tracking(current_azimuth_deg=102, current_elevation_deg=18)
        self.supervisor.update_tracking(current_azimuth_deg=102, current_elevation_deg=18)
        self.supervisor.update_tracking(current_azimuth_deg=102, current_elevation_deg=18)
        self.assertEqual(self.supervisor.session.state, SessionState.READY)

        self.supervisor.operator_start_qso()
        self.assertEqual(self.supervisor.session.state, SessionState.ACTIVE_QSO)
        self.assertTrue(self.supervisor.wsjtx.status.ptt_enabled)

        self.supervisor.finish_qso()
        self.assertEqual(self.supervisor.session.state, SessionState.COMPLETED)
        self.assertFalse(self.supervisor.wsjtx.status.ptt_enabled)

    def test_cannot_start_qso_without_ready_gate(self) -> None:
        self.supervisor.begin_session(
            station_a=self.station_a,
            station_b=self.station_b,
            band_mhz=1296.0,
            frequency_hz=1296150000,
            tracks=[self.valid_track],
        )
        with self.assertRaises(ValueError):
            self.supervisor.operator_start_qso()


if __name__ == "__main__":
    unittest.main()
