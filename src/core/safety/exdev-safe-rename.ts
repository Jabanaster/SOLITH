import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Renames `src` to `dest`, falling back to copy when the filesystem reports
 * EXDEV — observed even for a same-directory rename on Windows profiles
 * where the directory sits under a cloud filter driver (OneDrive
 * Files-On-Demand), which can place sibling files on different underlying
 * extents. rename() cannot cross that boundary but copy can.
 *
 * Does NOT delete `src` on success or failure — every current call site
 * already has its own recovery contract for `src` (some must preserve it as
 * the last known-good copy until `dest` is independently verified; others
 * may discard it immediately because the true source of truth lives
 * elsewhere). Deciding that is the caller's responsibility, not this
 * helper's — see Finding 3, independent security review, ef254d1.
 *
 * FINDING-R3 (independent security review, d3397bb): the EXDEV fallback used
 * to `copyFileSync(src, dest)` directly onto the final destination path —
 * not atomic, so a crash mid-copy could leave `dest` (a live save/database
 * file) truncated. The fallback now copies to a temp file in `dest`'s own
 * directory (same volume as `dest`, so the final step is a true same-device
 * atomic rename) and only replaces `dest` once that copy has fully
 * succeeded. If the copy fails, the temp file is removed and `dest` is never
 * touched — matching the same "never destroy the only recoverable copy"
 * contract this helper already gave callers for `src`.
 */
export function renameOrCopyAcrossDevices(src: string, dest: string): void {
  try {
    fs.renameSync(src, dest);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'EXDEV') {
      throw error;
    }
  }

  const destDir = path.dirname(dest);
  // `path.basename(dest)` strips directory components; `destDir` is the
  // caller-authorized destination directory, so this sibling cannot escape it.
  const tempName = `.${path.basename(dest)}.exdev-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`;
  const tempDest = `${destDir}${path.sep}${tempName}`;

  try {
    fs.copyFileSync(src, tempDest);
  } catch (copyError) {
    cleanupTemp(tempDest);
    throw copyError;
  }

  try {
    fs.renameSync(tempDest, dest);
  } catch (renameError) {
    cleanupTemp(tempDest);
    throw renameError;
  }
}

function cleanupTemp(tempPath: string): void {
  try {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  } catch {
    // Best-effort cleanup only; the caller's error is what matters.
  }
}
