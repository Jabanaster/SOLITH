import fs from 'fs';

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
 */
export function renameOrCopyAcrossDevices(src: string, dest: string): void {
  try {
    fs.renameSync(src, dest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'EXDEV') {
      throw error;
    }
    fs.copyFileSync(src, dest);
  }
}
