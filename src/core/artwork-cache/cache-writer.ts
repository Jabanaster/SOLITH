import fs from 'node:fs';
import path from 'node:path';
import { isPersistableRightsClass } from './fetch-policy.js';
import type { ArtworkRightsClass } from './types.js';

export interface WriteArtworkFileParams {
  cacheDir: string;
  cacheKey: string;
  extension: string;
  data: Buffer;
  rightsClass: ArtworkRightsClass;
}

export interface WriteArtworkFileResult {
  localPath: string;
  sizeBytes: number;
}

/**
 * ROADMAP §4.2/§4.3 atomic write — and the actual, unbypassable persistent-
 * cache rights gate. `rightsClass` is required on every call; a class not on
 * the ROADMAP §4.2 persistable allowlist throws before anything touches
 * disk. This is deliberately enforced here (the one function every write
 * path funnels through), not only in the IPC layer or UI, so no future
 * caller can accidentally persist an unverified-rights asset.
 *
 * On a persistable write, the file goes to a temp path in the same
 * directory, then is renamed over the target (atomic on the same
 * filesystem). If either step fails, the temp file is cleaned up and the
 * previously-cached file at the target path — if any — is never touched,
 * satisfying "retain old image on failed refresh."
 */
export function writeArtworkFileAtomic(params: WriteArtworkFileParams): WriteArtworkFileResult {
  const { cacheDir, cacheKey, extension, data, rightsClass } = params;
  if (!isPersistableRightsClass(rightsClass)) {
    throw new Error(`Refusing to persist artwork with rights class '${rightsClass}' — not on the approved persistent-cache allowlist`);
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  const finalPath = path.join(cacheDir, `${cacheKey}.${extension}`);
  const tempPath = path.join(cacheDir, `.${cacheKey}.${extension}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tempPath, data);
    fs.renameSync(tempPath, finalPath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // best-effort cleanup — the write already failed, nothing more to report
    }
    throw error;
  }
  return { localPath: finalPath, sizeBytes: data.byteLength };
}
