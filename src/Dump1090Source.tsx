import { useEffect, useState } from "react";

const DEFAULT_HOST = "127.0.0.1";
const HOST_PATTERN = /^[A-Za-z0-9._:-]{1,253}$/;

interface Dump1090Host { host: string; port: number }

export default function Dump1090Source({ rpc, onLog }: {
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  onLog: (message: string) => void;
}) {
  const [host, setHost] = useState(DEFAULT_HOST);
  const [savedHost, setSavedHost] = useState(DEFAULT_HOST);
  const [port, setPort] = useState(30003);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let disposed = false;
    rpc("airscout_get_dump1090_host")
      .then(value => {
        if (disposed) return;
        const result = value as Dump1090Host;
        setHost(result.host);
        setSavedHost(result.host);
        setPort(result.port);
      })
      .catch(() => { if (!disposed) onLog("Cannot read dump1090 source address."); });
    return () => { disposed = true; };
  }, [rpc, onLog]);

  async function save(reset = false) {
    const next = reset ? DEFAULT_HOST : host.trim();
    if (!HOST_PATTERN.test(next)) {
      setMessage("Enter a valid IP address or hostname, e.g. 192.168.1.50.");
      return;
    }
    setBusy(true);
    try {
      const result = await rpc("airscout_set_dump1090_host", { host: next }) as Dump1090Host;
      setHost(result.host);
      setSavedHost(result.host);
      const text = `dump1090 source set to ${result.host}:${result.port}. Applied to the aircraft feed.`;
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

  return (
    <details className="aircraft-accounts">
      <summary>dump1090 source</summary>
      <div className="account-fields">
        <strong>dump1090 / readsb {savedHost === DEFAULT_HOST ? "(local)" : `(${savedHost})`}</strong>
        <label>dump1090 IP address or hostname
          <input value={host} onChange={e => setHost(e.target.value)} autoComplete="off"
            placeholder={DEFAULT_HOST} disabled={busy} />
        </label>
        <div>
          <button className="btn-secondary" disabled={busy} onClick={() => { void save(); }}>Save dump1090 source</button>
          <button className="btn-secondary" disabled={busy} onClick={() => { void save(true); }}>Use local ({DEFAULT_HOST})</button>
        </div>
        <span>Connects to the SBS feed on port {port} of that address (unchanged). Used when dump1090 is enabled in the aircraft source list.</span>
        {message && <div role="status">{message}</div>}
      </div>
    </details>
  );
}
