import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { sendRuntimeMessage } from "./lib/messaging";
import type { BackendAuthStatus, GoogleProfile, ScanJobStatus } from "./lib/types";
import "./styles.css";

function Popup() {
  const [profile, setProfile] = useState<GoogleProfile | null>(null);
  const [scan, setScan] = useState<ScanJobStatus | null>(null);
  const [backendAuth, setBackendAuth] = useState<BackendAuthStatus>({ state: "unpaired" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void sendRuntimeMessage<GoogleProfile>({ type: "auth:getProfile" }).then(setProfile).catch(() => undefined);
    void sendRuntimeMessage<ScanJobStatus | null>({ type: "scan:getLatest" }).then(setScan).catch(() => undefined);
    void sendRuntimeMessage<BackendAuthStatus>({ type: "backend:authStatus" }).then(setBackendAuth).catch(() => setBackendAuth({ state: "unavailable" }));
  }, []);

  async function connect() {
    setBusy(true); setError("");
    try { setProfile(await sendRuntimeMessage({ type: "auth:getProfile", interactive: true })); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not connect"); }
    finally { setBusy(false); }
  }

  async function startScan() {
    setBusy(true); setError("");
    try { setScan(await sendRuntimeMessage<ScanJobStatus>({ type: "scan:previewInbox" })); }
    catch (e) { setError(e instanceof Error ? e.message : "Scan failed"); setScan(await sendRuntimeMessage<ScanJobStatus | null>({ type: "scan:getLatest" }).catch(() => null)); }
    finally { setBusy(false); }
  }

  const ready = Boolean(profile) && backendAuth.state === "paired";
  const stateLabel = !profile ? "Google disconnected" : backendAuth.state === "unpaired" ? "Google connected / backend unpaired" : backendAuth.state === "expired" ? "Backend session expired" : backendAuth.state === "unavailable" ? "Backend unavailable" : "Fully ready";

  return <main className="app popup">
    <p className="eyebrow">Companion app</p><h1>Inbox, meet order.</h1>
    <section className="card">
      <div className="row"><span className="status"><i className={`dot ${profile ? "ok" : ""}`} />{profile ? profile.email : "Gmail not connected"}</span>
        {!profile && <button className="button secondary" disabled={busy} onClick={connect}>Connect</button>}</div>
    </section>
    <section className="card stack"><div className="row"><span className="status"><i className={`dot ${ready ? "ok" : backendAuth.state === "unavailable" || backendAuth.state === "expired" ? "bad" : ""}`} />{stateLabel}</span></div>
      {profile && backendAuth.state === "unpaired" && <><div className="row"><button className="button secondary" onClick={() => void sendRuntimeMessage({ type: "backend:openDashboard" })}>Open dashboard</button><button className="button secondary" onClick={() => chrome.runtime.openOptionsPage()}>Pair backend</button></div><div className="muted">Generate a code from your signed-in dashboard, then enter it in Settings.</div></>}
      {backendAuth.state === "paired" && <button className="button secondary" onClick={async () => { await sendRuntimeMessage({ type: "backend:disconnect" }); setBackendAuth({ state: "unpaired" }); }}>Disconnect organizer backend</button>}
      {(backendAuth.state === "expired" || backendAuth.state === "unavailable") && <button className="button secondary" onClick={() => void sendRuntimeMessage<BackendAuthStatus>({ type: "backend:authStatus" }).then(setBackendAuth)}>Retry connection</button>}
    </section>
    <section className="card stack">
      <div><h2>Classification preview</h2><div className="muted">Reads recent metadata and asks your backend for proposals. Nothing is changed.</div></div>
      <button className="button" disabled={busy || !ready} onClick={startScan}>{busy ? "Working…" : "Preview inbox scan"}</button>
      {scan && <div className="muted">Latest: {scan.state} · {scan.processed}/{scan.total} · {scan.proposals.length} proposals</div>}
      {error && <div className="error">{error}</div>}
    </section>
    <button className="button secondary" style={{ width: "100%", marginTop: 14 }} onClick={() => void sendRuntimeMessage({ type: "sidepanel:open" }).catch((e) => setError(e.message))}>Open side panel</button>
  </main>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><Popup /></React.StrictMode>);
