/**
 * Injector helper trust manifest — hash-pinned allowlist under injector-helpers.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { systemPowerShellPath } from '../safety/system-binary.js';

export const HELPER_MANIFEST_FILE = 'manifest.json';
export const HELPER_MANIFEST_SEAL_FILE = 'manifest.seal';

export interface InjectorHelperManifestEntry {
  relativePath: string;
  sha256: string;
  publisher?: string | null;
  registeredAt: string;
}

export interface InjectorHelperManifest {
  version: 1;
  entries: InjectorHelperManifestEntry[];
}

export interface HelperTrustDecision {
  allowed: boolean;
  reason: string;
  entry?: InjectorHelperManifestEntry;
}

function normalizeRelative(rel: string): string {
  return rel.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

export function helperManifestPath(helpersRoot: string): string {
  return path.join(helpersRoot, HELPER_MANIFEST_FILE);
}

export function helperManifestSealPath(helpersRoot: string): string {
  return path.join(helpersRoot, HELPER_MANIFEST_SEAL_FILE);
}

export function emptyHelperManifest(): InjectorHelperManifest {
  return { version: 1, entries: [] };
}

export function hashHelperManifest(manifest: InjectorHelperManifest): string {
  const canonical = JSON.stringify({
    version: manifest.version,
    entries: [...manifest.entries]
      .map((e) => ({
        relativePath: normalizeRelative(e.relativePath),
        sha256: e.sha256.toLowerCase(),
        publisher: e.publisher ?? null,
        registeredAt: e.registeredAt,
      }))
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function deriveHelperManifestSealKey(helpersRoot: string): Buffer {
  return createHmac('sha256', 'solith-injector-helper-manifest-v1')
    .update(path.resolve(helpersRoot).toLowerCase())
    .digest();
}

export function sealHelperManifest(helpersRoot: string, manifest: InjectorHelperManifest): string {
  const bodyHash = hashHelperManifest(manifest);
  return createHmac('sha256', deriveHelperManifestSealKey(helpersRoot)).update(bodyHash).digest('hex');
}

export function verifyHelperManifestSeal(
  helpersRoot: string,
  manifest: InjectorHelperManifest,
  sealHex: string,
): boolean {
  const expected = Buffer.from(sealHelperManifest(helpersRoot, manifest), 'hex');
  let actual: Buffer;
  try {
    actual = Buffer.from(sealHex.trim(), 'hex');
  } catch {
    return false;
  }
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function readHelperManifest(helpersRoot: string): {
  manifest: InjectorHelperManifest;
  sealOk: boolean;
  reason?: string;
} {
  const manifestFile = helperManifestPath(helpersRoot);
  const sealFile = helperManifestSealPath(helpersRoot);
  if (!fs.existsSync(manifestFile)) {
    return { manifest: emptyHelperManifest(), sealOk: true, reason: 'empty_manifest' };
  }
  let parsed: InjectorHelperManifest;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as InjectorHelperManifest;
  } catch {
    return { manifest: emptyHelperManifest(), sealOk: false, reason: 'manifest_parse_failed' };
  }
  if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) {
    return { manifest: emptyHelperManifest(), sealOk: false, reason: 'manifest_invalid' };
  }
  if (!fs.existsSync(sealFile)) {
    return { manifest: parsed, sealOk: false, reason: 'manifest_seal_missing' };
  }
  const seal = fs.readFileSync(sealFile, 'utf8');
  const sealOk = verifyHelperManifestSeal(helpersRoot, parsed, seal);
  return {
    manifest: parsed,
    sealOk,
    reason: sealOk ? undefined : 'manifest_seal_mismatch',
  };
}

export function writeSealedHelperManifest(
  helpersRoot: string,
  manifest: InjectorHelperManifest,
): void {
  fs.mkdirSync(helpersRoot, { recursive: true });
  const normalized: InjectorHelperManifest = {
    version: 1,
    entries: manifest.entries.map((e) => ({
      relativePath: normalizeRelative(e.relativePath),
      sha256: e.sha256.toLowerCase(),
      publisher: e.publisher ?? null,
      registeredAt: e.registeredAt,
    })),
  };
  const seal = sealHelperManifest(helpersRoot, normalized);
  fs.writeFileSync(helperManifestPath(helpersRoot), `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  fs.writeFileSync(helperManifestSealPath(helpersRoot), `${seal}\n`, 'utf8');
}

export function relativeHelperPath(helpersRoot: string, absoluteExe: string): string {
  const root = path.resolve(helpersRoot);
  const resolved = path.resolve(absoluteExe);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Helper path escapes injector-helpers root.');
  }
  return normalizeRelative(rel);
}

export function evaluateHelperTrust(input: {
  helpersRoot: string;
  exePath: string;
  sha256: string;
  publisher?: string | null;
}): HelperTrustDecision {
  const { manifest, sealOk, reason } = readHelperManifest(input.helpersRoot);
  if (!sealOk && reason !== 'empty_manifest') {
    return { allowed: false, reason: `Helper manifest untrusted (${reason}).` };
  }
  let rel: string;
  try {
    rel = relativeHelperPath(input.helpersRoot, input.exePath);
  } catch (err) {
    return { allowed: false, reason: err instanceof Error ? err.message : String(err) };
  }
  const entry = manifest.entries.find((e) => normalizeRelative(e.relativePath) === rel);
  if (!entry) {
    return {
      allowed: false,
      reason: 'Helper is not registered in the sealed injector-helpers manifest.',
    };
  }
  if (entry.sha256.toLowerCase() !== input.sha256.toLowerCase()) {
    return { allowed: false, reason: 'Helper SHA-256 does not match the sealed manifest entry.' };
  }
  if (entry.publisher) {
    const pub = (input.publisher ?? '').trim().toLowerCase();
    if (!pub || pub !== entry.publisher.trim().toLowerCase()) {
      return { allowed: false, reason: 'Helper Authenticode publisher does not match the manifest.' };
    }
  }
  return { allowed: true, reason: 'Helper matches sealed manifest entry.', entry };
}

export function upsertHelperManifestEntry(
  helpersRoot: string,
  entry: InjectorHelperManifestEntry,
): InjectorHelperManifest {
  const { manifest, sealOk, reason } = readHelperManifest(helpersRoot);
  if (!sealOk && reason && reason !== 'empty_manifest') {
    throw new Error(`Cannot update untrusted helper manifest (${reason}).`);
  }
  const rel = normalizeRelative(entry.relativePath);
  const nextEntries = manifest.entries.filter((e) => normalizeRelative(e.relativePath) !== rel);
  nextEntries.push({
    relativePath: rel,
    sha256: entry.sha256.toLowerCase(),
    publisher: entry.publisher ?? null,
    registeredAt: entry.registeredAt,
  });
  const next = { version: 1 as const, entries: nextEntries };
  writeSealedHelperManifest(helpersRoot, next);
  return next;
}

export function queryAuthenticodePublisher(exePath: string): string | null {
  if (process.platform !== 'win32') return null;
  try {
    const script = [
      `$ErrorActionPreference = 'Stop'`,
      `$s = Get-AuthenticodeSignature -FilePath '${exePath.replace(/'/g, "''")}'`,
      `if ($s.Status -ne 'Valid') { '' ; exit 0 }`,
      `$s.SignerCertificate.Subject`,
    ].join('; ');
    const raw = execFileSync(systemPowerShellPath(), ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 8_000,
      windowsHide: true,
    }).trim();
    return raw || null;
  } catch {
    return null;
  }
}