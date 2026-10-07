import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import RotatorPanel from "./RotatorPanel";

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
interface WsjtxLive {
  connected: boolean;
  app_id: string;
  freq_mhz: number | null;
  mode: string | null;
  sub_mode: string | null;
  de_call: string | null;
  de_grid: string | null;
  dx_call: string | null;
  transmitting: boolean;
  decoding: boolean;
  tr_period: number | null;
  rx_df: number | null;
  tx_df: number | null;
  config_name: string | null;
}
interface WsjtxDecodeEntry {
  message: string | null;
  snr: number;
  delta_freq_hz: number;
  mode: string | null;
  ts: string;
}
interface AircraftEntry {
  icao24: string;
  callsign: string;
  lat: number;
  lon: number;
  altitude_ft: number;
  velocity_kts: number | null;
  heading_deg: number | null;
  az_a: number;
  el_a: number;
  range_a_km: number;
  az_b: number;
  el_b: number;
  range_b_km: number;
  off_path_deg: number;
  scatter_score: number;
}
interface AirscoutUpdate {
  aircraft: AircraftEntry[];
  total: number;
  station_a: string | null;
  station_b: string | null;
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
  const [log, setLog] = useState<string[]>([]);
  const [wsjtxLive, setWsjtxLive] = useState<WsjtxLive>({
    connected: false, app_id: "", freq_mhz: null, mode: null,
    sub_mode: null, de_call: null, de_grid: null, dx_call: null,
    transmitting: false, decoding: false, tr_period: null,
    rx_df: null, tx_df: null, config_name: null,
  });
  const [decodes, setDecodes] = useState<WsjtxDecodeEntry[]>([]);
  const [airscout, setAirscout] = useState<AirscoutUpdate | null>(null);
  const [locatorB, setLocatorB] = useState("");
  const [rotatorConnected, setRotatorConnected] = useState(false);
  const [rotatorAz, setRotatorAz] = useState(0);
  const [rotatorEl, setRotatorEl] = useState(0);
  const [rotatorTargetAz, setRotatorTargetAz] = useState<number | null>(null);
  const [rotatorTargetEl, setRotatorTargetEl] = useState<number | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((msg: string) => {
    setLog((l) => [...l.slice(-49), `${new Date().toLocaleTimeString()} ${msg}`]);
  }, []);

  // Wire sidecar messages — handles both RPC responses and push events
  useEffect(() => {
    const unlisten = listen<string>("sidecar-message", (ev) => {
      try {
        const data = JSON.parse(ev.payload) as Record<string, unknown>;

        // Push event (no id)
        if (data.event) {
          const evt = data.event as string;
          const evtData = data.data as Record<string, unknown>;

          if (evt === "wsjtx_connected") {
            addLog(`WSJT-X connected: ${evtData.app_id}`);
            setWsjtxLive(w => ({ ...w, connected: true, app_id: evtData.app_id as string }));
          } else if (evt === "wsjtx_disconnected") {
            addLog("WSJT-X disconnected");
            setWsjtxLive(w => ({ ...w, connected: false }));
          } else if (evt === "wsjtx_status") {
            setWsjtxLive(w => ({
              ...w,
              connected: true,
              freq_mhz: evtData.freq_mhz as number,
              mode: evtData.mode as string | null,
              sub_mode: evtData.sub_mode as string | null,
              de_call: evtData.de_call as string | null,
              de_grid: evtData.de_grid as string | null,
              dx_call: evtData.dx_call as string | null,
              transmitting: evtData.transmitting as boolean,
              decoding: evtData.decoding as boolean,
              tr_period: evtData.tr_period as number | null,
              rx_df: evtData.rx_df as number | null,
              tx_df: evtData.tx_df as number | null,
              config_name: evtData.config_name as string | null,
            }));
          } else if (evt === "wsjtx_decode") {
            const entry: WsjtxDecodeEntry = {
              message: evtData.message as string | null,
              snr: evtData.snr as number,
              delta_freq_hz: evtData.delta_freq_hz as number,
              mode: evtData.mode as string | null,
              ts: new Date().toLocaleTimeString(),
            };
            setDecodes(d => [entry, ...d.slice(0, 49)]);
            addLog(`DX: ${entry.message ?? "?"} SNR ${entry.snr}dB`);
          } else if (evt === "airscout_update") {
            setAirscout(evtData as unknown as AirscoutUpdate);
          } else if (evt === "airscout_feed_started") {
            addLog(`AirScout feed started: ${evtData.source}`);
          } else if (evt === "airscout_error") {
            addLog(`AirScout error (${evtData.source}): ${evtData.message}`);
          } else if (evt === "rotator_position") {
            setRotatorAz(evtData.azimuth as number);
            setRotatorEl(evtData.elevation as number);
          } else if (evt === "rotator_connected") {
            setRotatorConnected(true);
            addLog(`Rotator connected (${evtData.host}:${evtData.port})`);
          } else if (evt === "rotator_disconnected") {
            setRotatorConnected(false);
            addLog("Rotator disconnected");
          } else if (evt === "rotator_error") {
            addLog(`Rotator: ${evtData.message}`);
          }
          return;
        }

        // RPC response
        if (data.id && _pending.has(data.id as string)) {
          const resolver = _pending.get(data.id as string)!;
          _pending.delete(data.id as string);
          resolver(data as { ok: boolean; result?: unknown; error?: string });
        }
      } catch { /* ignore */ }
    });
    return () => { unlisten.then((f) => f()); };
  }, [addLog]);

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
          <h3>WSJT-X {wsjtxLive.connected
            ? <span style={{color:"var(--green)",fontWeight:600}}>● LIVE</span>
            : <span style={{color:"var(--red)",fontWeight:600}}>○ offline</span>}
          </h3>
          <div className="wsjtx-status">
            {wsjtxLive.de_call && <div>Callsign: <span className="on">{wsjtxLive.de_call}</span>{wsjtxLive.de_grid ? ` / ${wsjtxLive.de_grid}` : ""}</div>}
            <div>Freq: <span className="on">{wsjtxLive.freq_mhz != null ? `${wsjtxLive.freq_mhz.toFixed(3)} MHz` : "—"}</span></div>
            <div>Mode: {wsjtxLive.mode ?? "—"}{wsjtxLive.sub_mode ? `-${wsjtxLive.sub_mode}` : ""}{wsjtxLive.tr_period ? ` ${wsjtxLive.tr_period}s` : ""}</div>
            <div>RX: {wsjtxLive.rx_df != null ? `${wsjtxLive.rx_df} Hz` : "—"} &nbsp; TX: {wsjtxLive.tx_df != null ? `${wsjtxLive.tx_df} Hz` : "—"}</div>
            <div>
              <span className={wsjtxLive.transmitting ? "on" : "off"}>TX {wsjtxLive.transmitting ? "ON" : "off"}</span>
              &nbsp;·&nbsp;
              <span className={wsjtxLive.decoding ? "on" : "off"}>Decoding {wsjtxLive.decoding ? "●" : "○"}</span>
            </div>
            {wsjtxLive.dx_call && <div>DX: <span className="on">{wsjtxLive.dx_call}</span></div>}
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
        {/* Rotator — PST Rotator style */}
        <div className="card">
          <h3>Rotator</h3>
          <RotatorPanel
            currentAz={rotatorAz}
            currentEl={rotatorEl}
            targetAz={rotatorTargetAz}
            targetEl={rotatorTargetEl}
            connected={rotatorConnected}
            onSetPosition={(az, el) => {
              setRotatorTargetAz(az);
              setRotatorTargetEl(el);
              rpc("rotator_set", { azimuth: az, elevation: el }).catch(e => addLog(`Rotator: ${e}`));
            }}
            onStop={() => rpc("rotator_stop", {}).catch(e => addLog(`Rotator: ${e}`))}
            onPark={() => { setRotatorTargetAz(0); setRotatorTargetEl(0); rpc("rotator_park", {}).catch(e => addLog(`Rotator: ${e}`)); }}
            onConnect={(host, port) => rpc("rotator_connect", { host, port }).catch(e => addLog(`Rotator: ${e}`))}
          />
        </div>

        {/* AirScout aircraft scatter table */}
        <div className="card">
          <h3>AirScout — Scatter Aircraft
            {airscout && <span style={{color:"var(--text-muted)",fontWeight:400,marginLeft:8,fontSize:11}}>
              {airscout.total} in view · {airscout.station_a ?? "?"} → {airscout.station_b ?? "set DX locator"}
            </span>}
          </h3>
          {!airscout && (
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              <input
                placeholder="DX locator e.g. IO91"
                value={locatorB}
                onChange={e => setLocatorB(e.target.value.toUpperCase())}
                style={{background:"var(--surface)",color:"var(--text)",border:"1px solid var(--border)",borderRadius:4,padding:"4px 8px",width:120,fontFamily:"monospace"}}
              />
              <button className="btn-secondary" onClick={async () => {
                try { await rpc("airscout_set_stations", { locator_a: wsjtxLive.de_grid, locator_b: locatorB || null }); }
                catch(e) { addLog(`Error: ${e}`); }
              }}>Set stations</button>
              <button className="btn-secondary" onClick={async () => {
                try { await rpc("airscout_fetch_now", {}); addLog("Fetching aircraft from OpenSky…"); }
                catch(e) { addLog(`Error: ${e}`); }
              }}>Fetch now</button>
            </div>
          )}
          {airscout && airscout.aircraft.length === 0 && (
            <div style={{color:"var(--text-muted)",fontSize:12,padding:"8px 0"}}>No aircraft with positive elevation in scatter path yet.</div>
          )}
          {airscout && airscout.aircraft.length > 0 && (
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,fontFamily:"monospace"}}>
                <thead>
                  <tr style={{color:"var(--text-muted)",borderBottom:"1px solid var(--border)"}}>
                    <th style={{textAlign:"left",padding:"2px 6px"}}>Call</th>
                    <th style={{padding:"2px 6px"}}>FL</th>
                    <th style={{padding:"2px 6px"}}>Score</th>
                    <th style={{padding:"2px 6px"}}>Az-A</th>
                    <th style={{padding:"2px 6px"}}>El-A</th>
                    <th style={{padding:"2px 6px"}}>Az-B</th>
                    <th style={{padding:"2px 6px"}}>El-B</th>
                    <th style={{padding:"2px 6px"}}>Off°</th>
                    <th style={{padding:"2px 6px"}}>km-A</th>
                  </tr>
                </thead>
                <tbody>
                  {airscout.aircraft.map((ac, i) => {
                    const scoreColor = ac.scatter_score >= 0.5 ? "var(--green)" : ac.scatter_score >= 0.25 ? "var(--yellow)" : "var(--text-muted)";
                    return (
                      <tr key={ac.icao24} style={{borderBottom:"1px solid var(--border)",background: i===0 ? "rgba(88,166,255,0.06)" : undefined}}>
                        <td style={{padding:"3px 6px",color:"var(--accent)",fontWeight:i===0?700:400}}>{ac.callsign}</td>
                        <td style={{padding:"3px 6px",textAlign:"center"}}>{Math.round(ac.altitude_ft/100)}</td>
                        <td style={{padding:"3px 6px",textAlign:"center",color:scoreColor,fontWeight:600}}>{(ac.scatter_score*100).toFixed(0)}%</td>
                        <td style={{padding:"3px 6px",textAlign:"center"}}>{ac.az_a}°</td>
                        <td style={{padding:"3px 6px",textAlign:"center",color: ac.el_a>0&&ac.el_a<20 ? "var(--green)" : "var(--text-muted)"}}>{ac.el_a}°</td>
                        <td style={{padding:"3px 6px",textAlign:"center"}}>{ac.az_b}°</td>
                        <td style={{padding:"3px 6px",textAlign:"center",color: ac.el_b>0&&ac.el_b<20 ? "var(--green)" : "var(--text-muted)"}}>{ac.el_b}°</td>
                        <td style={{padding:"3px 6px",textAlign:"center",color: ac.off_path_deg<30?"var(--green)":ac.off_path_deg<60?"var(--yellow)":"var(--text-muted)"}}>{ac.off_path_deg}°</td>
                        <td style={{padding:"3px 6px",textAlign:"center"}}>{ac.range_a_km}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{display:"flex",gap:8,marginTop:8}}>
                <button className="btn-secondary" style={{fontSize:11,padding:"4px 10px"}} onClick={async () => {
                  try { await rpc("airscout_fetch_now", {}); addLog("Refreshing aircraft…"); }
                  catch(e) { addLog(`Error: ${e}`); }
                }}>↻ Refresh</button>
                <input
                  placeholder="Override DX locator"
                  value={locatorB}
                  onChange={e => setLocatorB(e.target.value.toUpperCase())}
                  style={{background:"var(--surface)",color:"var(--text)",border:"1px solid var(--border)",borderRadius:4,padding:"2px 6px",width:110,fontFamily:"monospace",fontSize:11}}
                />
                <button className="btn-secondary" style={{fontSize:11,padding:"4px 10px"}} onClick={async () => {
                  try { await rpc("airscout_set_stations", { locator_a: wsjtxLive.de_grid, locator_b: locatorB || airscout?.station_b }); }
                  catch(e) { addLog(`Error: ${e}`); }
                }}>Set DX</button>
              </div>
            </div>
          )}
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

        {/* Decodes */}
        {decodes.length > 0 && (
          <div className="card">
            <h3>WSJT-X Decodes</h3>
            <div className="log" style={{maxHeight:160}} ref={null}>
              {decodes.map((d, i) => (
                <div key={i} className="entry" style={{display:"grid",gridTemplateColumns:"60px 50px 60px 1fr",gap:8,fontFamily:"monospace"}}>
                  <span style={{color:"var(--text-muted)"}}>{d.ts}</span>
                  <span style={{color: d.snr >= -10 ? "var(--green)" : d.snr >= -20 ? "var(--yellow)" : "var(--text-muted)"}}>
                    {d.snr >= 0 ? `+${d.snr}` : d.snr} dB
                  </span>
                  <span style={{color:"var(--text-muted)"}}>{d.delta_freq_hz} Hz</span>
                  <span>{d.message ?? ""}</span>
                </div>
              ))}
            </div>
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
