import React, { FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_SETTINGS, getSettings, saveSettings } from "./lib/chrome-storage";
import { isLocalDevelopmentUrl, normalizeBackendUrl } from "./lib/backend-url";
import { sendRuntimeMessage } from "./lib/messaging";
import type { BackendAuthStatus, ExtensionSettings } from "./lib/types";
import "./styles.css";

function Options() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [pairingCode, setPairingCode] = useState("");
  const [deviceName, setDeviceName] = useState(`${navigator.platform || "Desktop"} Chrome`);
  const [auth, setAuth] = useState<BackendAuthStatus>({ state: "unpaired" });
  const [message, setMessage] = useState("");
  const refreshStatus = () => sendRuntimeMessage<BackendAuthStatus>({ type: "backend:authStatus" }).then(setAuth).catch(() => setAuth({ state: "unavailable" }));
  useEffect(() => { void getSettings().then(setSettings); void refreshStatus(); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage("");
    try {
      const clean = { ...settings, backendBaseUrl: normalizeBackendUrl(settings.backendBaseUrl), scanLimit: Math.min(Math.max(settings.scanLimit, 1), 50) };
      if (!isLocalDevelopmentUrl(clean.backendBaseUrl)) {
        const granted = await chrome.permissions.request({ origins: [`${clean.backendBaseUrl}/*`] });
        if (!granted) throw new Error("Chrome access to this backend origin was not granted");
      }
      await saveSettings(clean); setSettings(clean); setMessage("Settings saved. Backend credentials were cleared if the URL changed."); await refreshStatus();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save settings"); }
  }
  async function pair() {
    setMessage("");
    try { setAuth(await sendRuntimeMessage({ type: "backend:pair", pairingCode, deviceName })); setPairingCode(""); setMessage("Backend paired."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Pairing failed"); }
  }
  async function disconnect() { await sendRuntimeMessage({ type: "backend:disconnect" }); setAuth({ state: "unpaired" }); setMessage("Backend disconnected."); }
  async function testConnection() { setMessage(""); try { await sendRuntimeMessage({ type: "backend:health" }); setMessage("Backend is reachable."); } catch (error) { setMessage(error instanceof Error ? error.message : "Backend unavailable"); } }
  let devMode = false; try { devMode = isLocalDevelopmentUrl(settings.backendBaseUrl); } catch { /* shown during validation */ }
  return <main className="app"><p className="eyebrow">Google Email Organizer</p><h1>Settings</h1>
    <form className="card stack" onSubmit={submit}>
      <label>FastAPI backend URL<input type="url" required value={settings.backendBaseUrl} onChange={(e) => setSettings({ ...settings, backendBaseUrl: e.target.value })} /></label>
      <div className="muted">Transport: {devMode ? "localhost development HTTP" : "production HTTPS required"}</div>
      <label>Messages per preview (1–50)<input type="number" min="1" max="50" value={settings.scanLimit} onChange={(e) => setSettings({ ...settings, scanLimit: Number(e.target.value) })} /></label>
      <label className="switch"><input type="checkbox" checked={settings.dryRunMode} onChange={(e) => setSettings({ ...settings, dryRunMode: e.target.checked })} />Dry-run mode</label>
      <div className="row"><button className="button" type="submit">Save settings</button><button className="button secondary" type="button" onClick={testConnection}>Test connection</button></div>
    </form>
    <section className="card stack"><h2>Organizer backend pairing</h2><div className="muted">State: {auth.state}{auth.session ? ` · ${auth.session.deviceName} · ${auth.session.environment}` : ""}</div>
      {auth.state !== "paired" ? <><label>One-time pairing code<input value={pairingCode} maxLength={9} placeholder="ABCD-EFGH" onChange={(e) => setPairingCode(e.target.value.toUpperCase())} /></label><label>Device name<input value={deviceName} maxLength={100} onChange={(e) => setDeviceName(e.target.value)} /></label><button className="button" type="button" onClick={pair}>Pair backend</button><div className="muted">Generate the code from the authenticated web dashboard. It is sent only to the pairing endpoint.</div></> : <button className="button secondary" type="button" onClick={disconnect}>Disconnect backend</button>}
      {message && <div className={message.includes("failed") || message.includes("invalid") || message.includes("unavailable") ? "error" : "success"}>{message}</div>}
    </section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><Options /></React.StrictMode>);
