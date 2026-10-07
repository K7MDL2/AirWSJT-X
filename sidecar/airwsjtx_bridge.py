#!/usr/bin/env python3
"""
JSON-RPC bridge between Tauri and the airwsjtx supervisor.
Reads newline-delimited JSON from stdin, writes responses to stdout.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent.parent))

from airwsjtx.models import AircraftSample, AircraftTrack, Station
from airwsjtx.supervisor import AirWSJTXSupervisor

supervisor = AirWSJTXSupervisor()


def _ok(id_: str | None, result: object) -> None:
    print(json.dumps({"id": id_, "ok": True, "result": result}), flush=True)


def _err(id_: str | None, message: str) -> None:
    print(json.dumps({"id": id_, "ok": False, "error": message}), flush=True)


def _parse_tracks(raw: list[dict]) -> list[AircraftTrack]:
    tracks = []
    for t in raw:
        samples = tuple(
            AircraftSample(
                timestamp=datetime.now(timezone.utc),
                azimuth_deg=s["azimuth_deg"],
                elevation_deg=s["elevation_deg"],
                slant_range_km=s["slant_range_km"],
            )
            for s in t["samples"]
        )
        tracks.append(AircraftTrack(aircraft_id=t["aircraft_id"], samples=samples))
    return tracks


def handle(msg: dict) -> None:
    method = msg.get("method", "")
    params = msg.get("params", {})
    id_ = msg.get("id")

    try:
        if method == "begin_session":
            station_a = Station(**params["station_a"])
            station_b = Station(**params["station_b"])
            tracks = _parse_tracks(params["tracks"])
            hint = supervisor.begin_session(
                station_a=station_a,
                station_b=station_b,
                band_mhz=params["band_mhz"],
                frequency_hz=params["frequency_hz"],
                tracks=tracks,
            )
            _ok(id_, {"hint": hint, "state": supervisor.session.state.value})

        elif method == "update_tracking":
            cmd = supervisor.update_tracking(
                current_azimuth_deg=params["current_azimuth_deg"],
                current_elevation_deg=params["current_elevation_deg"],
            )
            _ok(id_, {
                "state": supervisor.session.state.value,
                "target_azimuth_deg": cmd.target_azimuth_deg,
                "target_elevation_deg": cmd.target_elevation_deg,
            })

        elif method == "start_qso":
            supervisor.operator_start_qso()
            _ok(id_, {"state": supervisor.session.state.value})

        elif method == "finish_qso":
            supervisor.finish_qso(abort=params.get("abort", False))
            _ok(id_, {"state": supervisor.session.state.value})

        elif method == "get_status":
            s = supervisor.session
            _ok(id_, {
                "state": s.state.value,
                "station_a": {"callsign": s.station_a.callsign, "locator": s.station_a.locator} if s.station_a else None,
                "station_b": {"callsign": s.station_b.callsign, "locator": s.station_b.locator} if s.station_b else None,
                "selected_aircraft_id": s.selected_aircraft_id,
                "candidate_count": s.candidate_count,
                "wsjtx": {
                    "configured": supervisor.wsjtx.status.configured,
                    "mode": supervisor.wsjtx.status.mode,
                    "band_mhz": supervisor.wsjtx.status.band_mhz,
                    "ptt_enabled": supervisor.wsjtx.status.ptt_enabled,
                },
            })

        elif method == "rank_candidates":
            tracks = _parse_tracks(params["tracks"])
            ranked = supervisor.tracker.rank_candidates(tracks)
            _ok(id_, [
                {
                    "aircraft_id": c.aircraft_id,
                    "geometry_score": round(c.geometry_score, 3),
                    "stability_score": round(c.stability_score, 3),
                    "total_score": round(c.total_score, 3),
                }
                for c in ranked
            ])

        else:
            _err(id_, f"Unknown method: {method}")

    except Exception as exc:
        _err(id_, str(exc))


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as e:
            _err(None, f"Invalid JSON: {e}")
            continue
        handle(msg)


if __name__ == "__main__":
    main()
