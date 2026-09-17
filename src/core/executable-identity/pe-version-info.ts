/**
 * PE VS_VERSIONINFO extraction — closes the version/build-fingerprint gap
 * documented in Docs/phase3/002 (`node-lief`'s available binding has no
 * resource-directory API, so it cannot read a PE's version resource).
 * `resedit` (built on `pe-library`, both pure JS, no native binary) can:
 * verified end-to-end against a real Windows executable during this stage,
 * not assumed from its README. This is a second, narrower PE library
 * alongside node-lief — deliberately not a "major replacement" of it
 * (pe-metadata.ts's section/subsystem/entrypoint parsing stays on LIEF);
 * this only adds the one real capability LIEF's binding lacks.
 */
import fs from 'node:fs';
import { NtExecutable, NtExecutableResource, Resource } from 'resedit';

export interface PeVersionInfo {
  fileVersion?: string;
  productVersion?: string;
  companyName?: string;
  productName?: string;
  fileDescription?: string;
  originalFilename?: string;
}

const STRING_KEYS: Array<keyof PeVersionInfo> = [
  'fileVersion',
  'productVersion',
  'companyName',
  'productName',
  'fileDescription',
  'originalFilename',
];
const VERSION_STRING_TABLE_KEYS: Record<keyof PeVersionInfo, string> = {
  fileVersion: 'FileVersion',
  productVersion: 'ProductVersion',
  companyName: 'CompanyName',
  productName: 'ProductName',
  fileDescription: 'FileDescription',
  originalFilename: 'OriginalFilename',
};

/**
 * Reads the VS_VERSIONINFO resource (FileVersion/ProductVersion/etc.) from
 * a local PE file. Read-only, never executes the target. Returns `null`
 * for any non-PE, resource-less, or unparseable input (verified against
 * empty/garbage/truncated inputs during this stage: resedit always throws
 * a catchable error, never crashes) — same safety contract as
 * pe-metadata.ts, since this also runs on untrusted user-supplied trainer
 * executables in trainer-research.
 */
export function resolvePeVersionInfo(filePath: string): PeVersionInfo | null {
  try {
    const buf = fs.readFileSync(filePath);
    const exe = NtExecutable.from(buf);
    const resource = NtExecutableResource.from(exe);
    const [versionInfo] = Resource.VersionInfo.fromEntries(resource.entries);
    if (!versionInfo) return null;

    const [language] = versionInfo.getAllLanguagesForStringValues();
    if (!language) return null;
    const strings = versionInfo.getStringValues(language);

    const result: PeVersionInfo = {};
    for (const key of STRING_KEYS) {
      const raw = strings[VERSION_STRING_TABLE_KEYS[key]];
      if (raw) result[key] = raw;
    }
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}
