import { useState } from "react";

interface StationInfo {
  callsign: string;
  name: string | null;
  grid: string | null;
  lat: number | null;
  lon: number | null;
  country: string | null;
  source: string;
}

interface StationPanelProps {
  myCallsign: string | null;
  myGrid: string | null;
  dxCallsign: string | null;
  dxGrid: string | null;
  onSetDx: (callsign: string, grid: string) => void;
  onSetMy: (callsign: string, grid: string) => void;
  onLookup: (callsign: string) => Promise<StationInfo>;
}

// Pre-seeded station book
const STATION_BOOK: { callsign: string; note: string }[] = [
  { callsign: "VE7NX", note: "CN89oh · Neil Olson, BC" },
  { callsign: "W7PUA", note: "CN84jq · Bob Larkin, OR" },
];

function StationCard({
  label, callsign, grid, name, source, color,
}: {
  label: string; callsign: string | null; grid: string | null;
  name?: string | null; source?: string; color: string;
}) {
  return (
    <div style={{
      padding: "8px 12px", borderRadius: 6,
      border: `1px solid ${color}44`,
      background: `${color}0a`,
      minWidth: 160,
    }}>
      <div style={{ fontSize: 10, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: "monospace" }}>
        {callsign ?? "—"}
      </div>
      {grid && (
        <div style={{ fontSize: 12, color: "#c9d1d9", fontFamily: "monospace", marginTop: 2 }}>
          {grid}
        </div>
      )}
      {name && (
        <div style={{ fontSize: 11, color: "#8b949e", marginTop: 2 }}>{name}</div>
      )}
      {source && source !== "known" && (
        <div style={{ fontSize: 10, color: "#8b949e44", marginTop: 1 }}>via {source}</div>
      )}
    </div>
  );
}

export default function StationPanel({
  myCallsign, myGrid, dxCallsign, dxGrid,
  onSetDx, onSetMy, onLookup,
}: StationPanelProps) {
  const [inputCall, setInputCall] = useState("");
  const [looking, setLooking] = useState(false);
  const [lookupResult, setLookupResult] = useState<StationInfo | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  async function doLookup(call: string) {
    const c = call.trim().toUpperCase();
    if (!c) return;
    setLooking(true);
    setLookupError(null);
    setLookupResult(null);
    try {
      const info = await onLookup(c);
      setLookupResult(info);
      if (!info.grid && info.source === "not-found") {
        setLookupError(`${c} not found in any database`);
      }
    } catch (e) {
      setLookupError(String(e));
    } finally {
      setLooking(false);
    }
  }

  function applyAsDx() {
    if (lookupResult?.grid) onSetDx(lookupResult.callsign, lookupResult.grid);
  }
  function applyAsMy() {
    if (lookupResult?.grid) onSetMy(lookupResult.callsign, lookupResult.grid);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* Current stations */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <StationCard label="My Station" callsign={myCallsign} grid={myGrid}
          color="#58a6ff" />
        <div style={{ display: "flex", alignItems: "center", color: "#30363d", fontSize: 18 }}>→</div>
        <StationCard label="DX Station" callsign={dxCallsign} grid={dxGrid}
          color="#3fb950" />
      </div>

      {/* Station book */}
      <div>
        <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Quick Select
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {STATION_BOOK.map(s => (
            <button
              key={s.callsign}
              className="btn-secondary"
              style={{ fontSize: 12, padding: "4px 10px", textAlign: "left" }}
              onClick={() => { setInputCall(s.callsign); doLookup(s.callsign); }}
            >
              <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{s.callsign}</span>
              <span style={{ color: "#8b949e", marginLeft: 6, fontSize: 11 }}>{s.note}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Callsign search */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={inputCall}
          onChange={e => setInputCall(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === "Enter" && doLookup(inputCall)}
          placeholder="Callsign e.g. VE7NX"
          style={{
            background: "#0d1117", color: "#c9d1d9",
            border: "1px solid #30363d", borderRadius: 4,
            padding: "5px 10px", fontFamily: "monospace",
            fontSize: 14, width: 160,
          }}
        />
        <button className="btn-secondary" style={{ fontSize: 12, padding: "5px 12px" }}
          onClick={() => doLookup(inputCall)} disabled={looking}>
          {looking ? "Looking up…" : "🔍 Look up"}
        </button>
      </div>

      {/* Lookup result */}
      {lookupError && (
        <div style={{ fontSize: 12, color: "#f85149" }}>{lookupError}</div>
      )}
      {lookupResult && !lookupError && (
        <div style={{
          padding: "10px 12px", borderRadius: 6,
          border: "1px solid #30363d", background: "#161b22",
          display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap",
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "monospace", color: "#c9d1d9" }}>
              {lookupResult.callsign}
            </div>
            {lookupResult.name && (
              <div style={{ fontSize: 12, color: "#8b949e" }}>{lookupResult.name}</div>
            )}
            <div style={{ fontSize: 13, fontFamily: "monospace", color: "#58a6ff", marginTop: 4 }}>
              {lookupResult.grid ?? "Grid unknown"}
            </div>
            {lookupResult.lat && lookupResult.lon && (
              <div style={{ fontSize: 11, color: "#8b949e" }}>
                {lookupResult.lat.toFixed(4)}, {lookupResult.lon.toFixed(4)}
              </div>
            )}
            {lookupResult.country && (
              <div style={{ fontSize: 11, color: "#8b949e" }}>{lookupResult.country}</div>
            )}
            <div style={{ fontSize: 10, color: "#8b949e44", marginTop: 2 }}>
              Source: {lookupResult.source}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignSelf: "center" }}>
            <button className="btn-success" style={{ fontSize: 11, padding: "4px 10px" }}
              onClick={applyAsDx} disabled={!lookupResult.grid}>
              Set as DX
            </button>
            <button className="btn-secondary" style={{ fontSize: 11, padding: "4px 10px" }}
              onClick={applyAsMy} disabled={!lookupResult.grid}>
              Set as My
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
