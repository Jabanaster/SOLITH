import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { sendRuntimeMessage } from "./lib/messaging";
import type { BackendAuthStatus, GoogleProfile, ScanJobStatus } from "./lib/types";
import "./styles.css";

function SidePanel() {
  const [scan, setScan] = useState<ScanJobStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [google, setGoogle] = useState<GoogleProfile | null>(null);
  const [auth, setAuth] = useState<BackendAuthStatus>({ state: "unpaired" });
  useEffect(() => {
    void sendRuntimeMessage<ScanJobStatus | null>({ type: "scan:getLatest" }).then(setScan);
    void sendRuntimeMessage<GoogleProfile>({ type: "auth:getProfile" }).then(setGoogle).catch(() => undefined);
    void sendRuntimeMessage<BackendAuthStatus>({ type: "backend:authStatus" }).then(setAuth).catch(() => setAuth({ state: "unavailable" }));
  }, []);
  async function scanInbox() {
    setBusy(true); setError("");
    try { setScan(await sendRuntimeMessage<ScanJobStatus>({ type: "scan:previewInbox" })); }
    catch (e) { setError(e instanceof Error ? e.message : "Scan failed"); setScan(await sendRuntimeMessage<ScanJobStatus | null>({ type: "scan:getLatest" }).catch(() => null)); }
    finally { setBusy(false); }
  }
  return <main className="app">
    <p className="eyebrow">Google Email Organizer</p><h1>Review desk</h1><p className="muted">Proposals stay previews until Gmail mutations are deliberately added in Phase 5.</p>
    <section className="card stack"><div className="row"><div><h2>Connections</h2><div className="muted">Gmail: {google?.email ?? "disconnected"}</div><div className="muted">Organizer: {auth.state}</div>{auth.session && <><div className="muted">Device: {auth.session.deviceName}</div><div className="muted">Environment: {auth.session.environment}</div></>}</div></div>{auth.error && <div className="error">{auth.error}</div>}</section>
    <section className="card stack">
      <div className="row"><div><h2>Inbox scan</h2><span className="status"><i className={`dot ${busy ? "busy" : scan?.state === "completed" ? "ok" : scan?.state === "failed" ? "bad" : ""}`} />{busy ? "Scanning" : scan?.state ?? "Not started"}</span></div><button className="button" disabled={busy || !google || auth.state !== "paired"} onClick={scanInbox}>Run preview</button></div>
      {scan && <div className="muted">Processed {scan.processed} of {scan.total} messages · Updated {new Date(scan.updatedAt).toLocaleString()}</div>}
      {error && <div className="error">{error}</div>}
    </section>
    <section className="card"><h2>Proposed labels</h2>
      {!scan?.proposals.length && <p className="muted">No proposals yet. Connect the FastAPI backend and run a preview.</p>}
      {scan?.proposals.map((item) => <div className="proposal" key={item.messageId}><div className="row"><strong>{item.proposedLabel}</strong><span className="confidence">{Math.round(item.confidence * 100)}%</span></div>{item.reason && <div className="muted">{item.reason}</div>}<div className="muted">Message {item.messageId}</div></div>)}
    </section>
    <section className="card stack"><h2>Apply changes</h2><p className="muted">Disabled by design in Phase 1. Every future Gmail mutation will require review and explicit approval.</p><button className="button" disabled>Approve and apply</button></section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><SidePanel /></React.StrictMode>);
