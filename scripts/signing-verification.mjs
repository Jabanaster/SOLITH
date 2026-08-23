// Finding: artifact-signing verification gap (independent security review,
// d3397bb). electron-builder's build log prints "signing with signtool.exe"
// for the packaged exe/installer, but the actual on-disk artifacts were
// found to be NotSigned — nothing in the release pipeline verified the
// *artifact* itself, only trusted the log wording. This module is the
// verification gate: it inspects real Authenticode state and, in release
// mode, fails the build if a required first-party executable is unsigned or
// missing.
//
// evaluateSigningStatus() is pure (no filesystem/process access) so it can be
// unit-tested deterministically with injected statuses, without requiring a
// real signing certificate. getAuthenticodeStatus() is the Windows-only I/O
// side that calls PowerShell's Get-AuthenticodeSignature against a real file.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

/**
 * @param {Array<{ name: string, path: string, status: string }>} artifacts
 *   status is one of: 'Valid', 'NotSigned', 'HashMismatch', 'NotTrusted',
 *   'UnknownError', or 'Missing' (file does not exist).
 * @param {{ releaseMode: boolean }} options
 */
export function evaluateSigningStatus(artifacts, { releaseMode }) {
  const results = artifacts.map((artifact) => {
    const missing = artifact.status === 'Missing';
    const unsigned = artifact.status === 'NotSigned';
    const blocking = missing || unsigned;
    const severity = blocking ? (releaseMode ? 'fail' : 'warn') : 'pass';
    return { ...artifact, severity };
  });
  const failures = results.filter((r) => r.severity === 'fail');
  const warnings = results.filter((r) => r.severity === 'warn');
  return { results, failures, warnings, ok: failures.length === 0 };
}

/** Windows-only. Returns 'Missing' if the file does not exist, else the Authenticode Status enum name. */
export function getAuthenticodeStatus(filePath) {
  if (!fs.existsSync(filePath)) return 'Missing';
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', `(Get-AuthenticodeSignature -LiteralPath '${filePath.replace(/'/g, "''")}').Status`],
    { encoding: 'utf8' },
  );
  if (result.error || result.status !== 0) {
    return 'UnknownError';
  }
  const status = result.stdout.trim();
  return status || 'UnknownError';
}

export function getAuthenticodeStatuses(artifacts) {
  return artifacts.map(({ name, path }) => ({ name, path, status: getAuthenticodeStatus(path) }));
}
