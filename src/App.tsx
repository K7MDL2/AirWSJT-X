import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StationInfo { callsign: string; locator: string }
interface WsjtxInfo {
  configured: boolean; mode: string | null;
  band_mhz: number | null; ptt_enabled: boolean;
}
interface SessionStatus {
  state: string;
  station_a: StationInfo | null;
  station_b: StationInfo | null;
  selected_aircraft_id: string | null;
  candidate_count: number;
  wsjtx: WsjtxInfo;
}
interface Candidate {
  aircraft_id: string;
  geometry_score: number;
  stability_score: number;
  total_score: number;
}
interface TrackingInfo {
  state: string;
  target_azimuth_deg: number;
  target_elevation_deg: number;
}

// ─── Sidecar RPC ──────────────────────────────────────────────────────────────

let _rpcId = 0;
const _pending = new Map<string, (r: { ok: boolean; result?: unknown; error?: string }) => void>();

async function rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const id = String(++_rpcId);
  const msg = JSON.stringify({ id, method, params });
  return new Promise((resolve, reject) => {
    _pending.set(id, (r) => r.ok ? resolve(r.result) : reject(new Error(r.error)));
    invoke("send_to_sidecar", { message: msg }).catch(reject);
  });
}

// ─── Colours ──────────────────────────────────────────────────────────────────

const STATE_COLOR: Record<string, string> = {
  idle: "#8b949e",
  stations_ready: "#d29922",
  candidates_available: "#d29922",
  plane_locked: "#58a6ff",
  tracking: "#58a6ff",
  ready: "#3fb950",
  active_qso: "#3fb950",
  completed: "#3fb950",
  aborted: "#f85149",
};

// ─── Demo tracks (replace with live Airscout feed) ────────────────────────────

const DEMO_TRACKS = [
  { aircraft_id: "A1", samples: [{ azimuth_deg: 120, elevation_deg: 18, slant_range_km: 240 }, { azimuth_deg: 122, elevation_deg: 19, slant_range_km: 250 }] },
  { aircraft_id: "B2", samples: [{ azimuth_deg: 60,  elevation_deg: 4,  slant_range_km: 480 }, { azimuth_deg: 75,  elevation_deg: 5,  slant_range_km: 500 }] },
  { aircraft_id: "C3", samples: [{ azimuth_deg: 200, elevation_deg: 11, slant_range_km: 310 }, { azimuth_deg: 198, elevation_deg: 11, slant_range_km: 315 }] },
];

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [tracking, setTracking] = useState<TrackingInfo | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [currentAz, setCurrentAz] = useState(0);
  const [currentEl, setCurrentEl] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((msg: string) => {
    setLog((l) => [...l.slice(-49), `${new Date().toLocaleTimeString()} ${msg}`]);
  }, []);

  // Wire sidecar messages to pending RPC resolvers
  useEffect(() => {
    const unlisten = listen<string>("sidecar-message", (ev) => {
      try {
        const data = JSON.parse(ev.payload) as { id?: string; ok: boolean; result?: unknown; error?: string };
        if (data.id && _pending.has(data.id)) {
          const resolver = _pending.get(data.id)!;
          _pending.delete(data.id);
          resolver(data);
        }
      } catch { /* ignore non-json */ }
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Poll status every 2 s once sidecar is ready
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const s = await rpc("get_status") as SessionStatus;
        setStatus(s);
      } catch { /* sidecar may not be up yet */ }
    }, 2000);
    return () => clearInterval(id);
  }, []);

  // Scroll log to bottom
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  async function beginSession() {
    try {
      const ranked = await rpc("rank_candidates", { tracks: DEMO_TRACKS }) as Candidate[];
      setCandidates(ranked);
      const result = await rpc("begin_session", {
        station_a: { callsign: "K1AAA", locator: "JN58" },
        station_b: { callsign: "K2BBB", locator: "JN68" },
        band_mhz: 1296.0,
        frequency_hz: 1296150000,
        tracks: DEMO_TRACKS,
      }) as { hint: string; state: string };
      addLog(`Session started — ${result.hint}`);
      setStatus((s) => s ? { ...s, state: result.state } : s);
    } catch (e) { addLog(`Error: ${e}`); }
  }

  async function sendTracking() {
    try {
      const t = await rpc("update_tracking", {
        current_azimuth_deg: currentAz,
        current_elevation_deg: currentEl,
      }) as TrackingInfo;
      setTracking(t);
      setStatus((s) => s ? { ...s, state: t.state } : s);
      addLog(`Tracking → az=${t.target_azimuth_deg}° el=${t.target_elevation_deg}° state=${t.state}`);
    } catch (e) { addLog(`Error: ${e}`); }
  }

  async function startQso() {
    try {
      const r = await rpc("start_qso") as { state: string };
      setStatus((s) => s ? { ...s, state: r.state } : s);
      addLog("QSO started — PTT ON");
    } catch (e) { addLog(`Error: ${e}`); }
  }

  async function finishQso(abort = false) {
    try {
      const r = await rpc("finish_qso", { abort }) as { state: string };
      setStatus((s) => s ? { ...s, state: r.state } : s);
      addLog(abort ? "QSO aborted — PTT OFF" : "QSO completed — PTT OFF");
    } catch (e) { addLog(`Error: ${e}`); }
  }

  const state = status?.state ?? "idle";
  const stateColor = STATE_COLOR[state] ?? "#8b949e";
  const azDeg = tracking?.target_azimuth_deg ?? 0;

  return (
    <div className="app">
      {/* Top bar */}
      <header className="topbar">
        <h1>AirWSJT-X</h1>
        <span className="badge" style={{ background: stateColor + "22", color: stateColor }}>
          {state.replace(/_/g, " ")}
        </span>
        {status?.wsjtx?.ptt_enabled && (
          <span className="badge" style={{ background: "#f8514922", color: "#f85149" }}>PTT ON</span>
        )}
      </header>

      {/* Sidebar */}
      <aside className="sidebar">
        {/* Session state */}
        <div className="card">
          <h3>Session</h3>
          <div className="state-row">
            <div className="dot" style={{ background: stateColor }} />
            {state.replace(/_/g, " ")}
          </div>
          {status?.station_a && (
            <div className="station-row">
              <div>Station A <span>{status.station_a.callsign}</span></div>
              <div>{status.station_a.locator}</div>
            </div>
          )}
          {status?.station_b && (
            <div className="station-row">
              <div>Station B <span>{status.station_b.callsign}</span></div>
              <div>{status.station_b.locator}</div>
            </div>
          )}
          {status?.selected_aircraft_id && (
            <div className="station-row">
              <div>Aircraft <span>{status.selected_aircraft_id}</span></div>
              <div>{status.candidate_count} candidates</div>
            </div>
          )}
        </div>

        {/* WSJT-X status */}
        <div className="card">
          <h3>WSJT-X</h3>
          <div className="wsjtx-status">
            <div>Mode: <span className={status?.wsjtx?.mode ? "on" : "off"}>{status?.wsjtx?.mode ?? "—"}</span></div>
            <div>Band: {status?.wsjtx?.band_mhz ? `${status.wsjtx.band_mhz} MHz` : "—"}</div>
            <div>PTT: <span className={status?.wsjtx?.ptt_enabled ? "on" : "off"}>{status?.wsjtx?.ptt_enabled ? "ON" : "OFF"}</span></div>
          </div>
        </div>

        {/* QSO controls */}
        <div className="card">
          <h3>Controls</h3>
          <div className="qso-controls">
            <button className="btn-primary" onClick={beginSession} disabled={state !== "idle"}>
              Begin Session
            </button>
            <button className="btn-success" onClick={startQso} disabled={state !== "ready"}>
              Start QSO
            </button>
            <button className="btn-danger" onClick={() => finishQso(true)} disabled={["idle","completed","aborted"].includes(state)}>
              Abort
            </button>
            <button className="btn-secondary" onClick={() => finishQso(false)} disabled={state !== "active_qso"}>
              Finish QSO
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="main">
        {/* Rotator */}
        <div className="card">
          <h3>Rotator</h3>
          <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
            <div className="rotator-gauge">
              <div className="compass">
                {tracking && (
                  <div
                    className="compass-target"
                    style={{ transform: `translateX(-50%) rotate(${azDeg}deg)`, left: "50%" }}
                  />
                )}
                <div
                  className="compass-needle"
                  style={{ transform: `translateX(-50%) rotate(${currentAz}deg)`, left: "50%" }}
                />
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                AZ {currentAz}° → {azDeg}°
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
                Elevation {currentEl}° → {tracking?.target_elevation_deg ?? 0}°
              </div>
              <div className="elevation-bar">
                <div className="elevation-fill" style={{ width: `${(currentEl / 90) * 100}%` }} />
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <label style={{ fontSize: 12 }}>
                  Current AZ&nbsp;
                  <input type="number" value={currentAz} onChange={(e) => setCurrentAz(+e.target.value)}
                    style={{ width: 64, background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px" }} />
                </label>
                <label style={{ fontSize: 12 }}>
                  Current EL&nbsp;
                  <input type="number" value={currentEl} onChange={(e) => setCurrentEl(+e.target.value)}
                    style={{ width: 64, background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px" }} />
                </label>
                <button className="btn-secondary" onClick={sendTracking} disabled={!["plane_locked","tracking","ready"].includes(state)}>
                  Update
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Candidates */}
        {candidates.length > 0 && (
          <div className="card">
            <h3>Aircraft Candidates</h3>
            <ul className="candidates-list">
              {candidates.map((c) => (
                <li key={c.aircraft_id}
                  className={`candidate-item${status?.selected_aircraft_id === c.aircraft_id ? " selected" : ""}`}>
                  <span style={{ fontWeight: 600 }}>{c.aircraft_id}</span>
                  <div className="score-bar-wrap">
                    <div className="score-bar" style={{ width: `${c.total_score * 100}%` }} />
                  </div>
                  <span style={{ color: "var(--text-muted)", minWidth: 40 }}>
                    {(c.total_score * 100).toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Log */}
        <div className="card" style={{ flex: 1 }}>
          <h3>Event Log</h3>
          <div className="log" ref={logRef}>
            {log.length === 0
              ? <div className="entry" style={{ color: "var(--text-muted)" }}>No events yet — click Begin Session to start.</div>
              : log.map((e, i) => <div key={i} className="entry">{e}</div>)
            }
          </div>
        </div>
      </main>
    </div>
  );
}
