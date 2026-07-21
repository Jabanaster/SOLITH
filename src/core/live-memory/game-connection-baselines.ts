import type { PerGameConnectionBaseline } from './types.js';

/**
 * Reviewed per-game connection baselines (see PerGameConnectionBaseline in
 * types.ts and Docs/KNOWN_ISSUES.md KI-017 for why this exists).
 *
 * Each entry must be backed by a real observation against the actual game,
 * not a guess — add one only after measuring it, and record the evidence.
 * Any game not listed here gets the default baseline of 0 (today's strict
 * "any non-loopback connection blocks" behavior) — this registry only ever
 * loosens the guard for a specific, reviewed executable name, never the
 * general default.
 *
 * A baseline being present here is NOT a guarantee the value is still
 * accurate on every machine/version/network condition — it is a documented,
 * evidence-based ceiling above which the guard still blocks. Re-review if a
 * game update or user report suggests the real background connection count
 * has changed.
 */
const BASELINES: PerGameConnectionBaseline[] = [
  {
    executableName: 'Stardew Valley.exe',
    acceptedConnectionBaseline: 5,
    reviewedAt: '2026-07-06',
    evidence:
      'Measured live against a real, running Stardew Valley 1.6 process during solo/offline farm ' +
      'play: 5 ESTABLISHED non-loopback TCP connections observed (Fastly CDN range 2a04:4e42:5::497 ' +
      'x4, and 91.222.185.230 x1), consistent with Steamworks background activity (cloud saves, ' +
      'friends/presence, telemetry) bundled into the game process rather than in-game multiplayer ' +
      'traffic. See Docs/KNOWN_ISSUES.md KI-017 for the full investigation.',
  },
  {
    executableName: 'Atomfall_dx12.exe',
    acceptedConnectionBaseline: 2,
    reviewedAt: '2026-07-06',
    evidence:
      'Measured live against a real, running Atomfall (Microsoft Store/Xbox build) process during ' +
      'solo single-player play: 2 ESTABLISHED non-loopback TCP connections observed ' +
      '(20.201.200.56, 199.46.35.124 — both Microsoft/Azure-owned ranges), consistent with Xbox ' +
      'Live presence/achievements/telemetry background activity rather than in-game multiplayer ' +
      'traffic (Atomfall has no online multiplayer mode).',
  },
  {
    executableName: 'Palworld-Win64-Shipping.exe',
    acceptedConnectionBaseline: 4,
    reviewedAt: '2026-07-08',
    evidence:
      'Measured live against a real, running Palworld process during solo single-player mode: ' +
      '4 ESTABLISHED non-loopback TCP connections observed (Steamworks cloud saves, friends/presence, telemetry). ' +
      'Based on single measurement; may need re-review if observed count varies across sessions/versions.',
  },
  {
    executableName: 'Undisputed.exe',
    acceptedConnectionBaseline: 7,
    reviewedAt: '2026-07-08',
    evidence:
      'Measured live against a real, running Undisputed process (Microsoft Store/Xbox build, ' +
      'DeepSilver.Undisputed package) during the offline tutorial: 7 ESTABLISHED non-loopback TCP ' +
      'connections observed — 4x to 2603:1061:14:191::1 (Azure/Xbox Live-owned range) plus ' +
      '184.28.150.23 and 20.109.157.180 (also Azure-owned), consistent with Xbox Live ' +
      'presence/telemetry rather than in-match multiplayer traffic. Based on a single measurement ' +
      'during the tutorial only (not verified during career mode or online matchmaking); re-review ' +
      'if the observed count varies in those states.',
  },
  {
    executableName: 'Avowed-WinGDK-Shipping.exe',
    acceptedConnectionBaseline: 3,
    reviewedAt: '2026-07-20',
    evidence:
      'PROVISIONAL (single session/version/machine): Measured live against Avowed-WinGDK-Shipping.exe ' +
      'PID 16696 (Xbox PC Game Pass package Microsoft.Avowed_2.258.6997.0_x64__8wekyb3d8bbwe) during ' +
      'solo single-player with save loaded: 3 ESTABLISHED non-loopback TCP connections, all HTTPS/443 ' +
      'to Microsoft/Azure-owned ranges (20.109.157.180, 20.201.192.56, 199.46.35.129) — consistent with ' +
      'Xbox platform chatter in that snapshot; count-only (KI-017 residual risk applies). Launcher ' +
      'Avowed.exe PID 32640 had 0. Better than default 0 for attach; not a strong permanence claim. ' +
      'Evidence: Docs/Baselines/AVOWED_CONNECTION_BASELINE_2026-07-20.md. ' +
      'Harness: node scripts/measure-connection-baseline.mjs --pid 16696.',
  },
];

const BASELINE_BY_EXECUTABLE = new Map<string, number>(
  BASELINES.map((b) => [b.executableName.toLowerCase(), b.acceptedConnectionBaseline]),
);

/** Returns the reviewed baseline for an executable name, or 0 (strict default) if unreviewed. */
export function getConnectionBaseline(executableName: string): number {
  return BASELINE_BY_EXECUTABLE.get(executableName.toLowerCase()) ?? 0;
}

export function listReviewedConnectionBaselines(): PerGameConnectionBaseline[] {
  return [...BASELINES];
}
