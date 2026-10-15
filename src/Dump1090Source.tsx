import { useEffect, useState } from "react";

const DEFAULT_HOST = "127.0.0.1";
const HOST_PATTERN = /^[A-Za-z0-9._:-]{1,253}$/;

export interface Dump1090Host { host: string; port: number }

/**
 * Desktop: an empty host means the local receiver (127.0.0.1).
 * Mobile: there is no local receiver, so an empty host means dump1090 is disabled.
 */
export default function Dump1090Source({ load, save: persist, onLog, mobile = false }: {
  load: () => Promise<Dump1090Host>;
  save: (host: string) => Promise<Dump1090Host>;
  onLog: (message: string) => void;
  mobile?: boolean;
}) {
  const emptyHost = mobile ? "" : DEFAULT_HOST;
  const [host, setHost] = useState(emptyHost);
  const [savedHost, setSavedHost] = useState(emptyHost);
  const [port, setPort] = useState(30003);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let disposed = false;
    load()
      .then(result => {
        if (disposed) return;
        setHost(result.host);
        setSavedHost(result.host);
        setPort(result.port);
      })
      .catch(() => { if (!disposed) onLog("Cannot read dump1090 source address."); });
    return () => { disposed = true; };
  }, [load, onLog]);

  async function save(clear = false) {
    const next = clear ? emptyHost : host.trim();
    if (!(mobile && next === "") && !HOST_PATTERN.test(next)) {
      setMessage("Enter a valid IP address or hostname, e.g. 192.168.1.50.");
      return;
    }
    setBusy(true);
    try {
      const result = await persist(next);
      setHost(result.host);
      setSavedHost(result.host);
      const text = mobile && result.host === ""
        ? "dump1090 source disabled."
        : `dump1090 source set to ${result.host}:${result.port}. Applied to the aircraft feed.`;
      setMessage(text);
      onLog(text);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Cannot save dump1090 source address.";
      setMessage(text);
      onLog(text);
    } finally {
      setBusy(false);
    }
  }

  const heading = mobile
    ? `dump1090 / readsb ${savedHost ? `(${savedHost})` : "(disabled)"}`
    : `dump1090 / readsb ${savedHost === DEFAULT_HOST ? "(local)" : `(${savedHost})`}`;

  return (
    <details className="aircraft-accounts">
      <summary>dump1090 source</summary>
      <div className="account-fields">
        <strong>{heading}</strong>
        <label>dump1090 IP address or hostname
          <input value={host} onChange={e => setHost(e.target.value)} autoComplete="off" autoCapitalize="off"
            placeholder={mobile ? "e.g. 192.168.1.50" : DEFAULT_HOST} disabled={busy} />
        </label>
        <div>
          <button className="btn-secondary" disabled={busy} onClick={() => { void save(); }}>Save dump1090 source</button>
          <button className="btn-secondary" disabled={busy} onClick={() => { void save(true); }}>
            {mobile ? "Disable dump1090" : `Use local (${DEFAULT_HOST})`}
          </button>
        </div>
        <span>Connects to the SBS feed on port {port} of that address (unchanged).
          {mobile ? " Saving selects dump1090 as the aircraft source; disabling returns to OpenSky. The receiver must be reachable on your Wi-Fi network."
            : " Used when dump1090 is enabled in the aircraft source list."}</span>
        {message && <div role="status">{message}</div>}
      </div>
    </details>
  );
}
