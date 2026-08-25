import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { renameOrCopyAcrossDevices } from '../safety/exdev-safe-rename.js';
import { WISP_PROFILE_LIMITS } from './limits.js';
import { persistenceError, type WispPersistenceError } from './persistence-errors.js';
import { validateWispUserState, type WispUserState } from './user-state-schema.js';
import type { CanonicalGameId } from './types.js';

/**
 * Adaptive Wisp local persistence (Increment 2, Sections 4, 10-14, 31-34).
 *
 * One JSON document per game under
 * `<userDataRoot>/adaptive-wisp/user-state/<sha256(gameId)>.json` — the
 * filename is derived from a hash of the canonical gameId (never the raw
 * string) so a hostile-looking gameId can never traverse outside the
 * directory (Section 32). Writes go through the same
 * write-temp-then-rename-or-copy pattern already used by
 * src/core/safety/exdev-safe-rename.ts elsewhere in the repo (Section 3/10)
 * — no second unsafe persistence framework.
 *
 * Reads are bounded (Section 33) and never crash on missing/malformed data
 * (Section 12) — every failure mode returns a structured
 * WispPersistenceError instead of throwing, and a corrupt file is left in
 * place (optionally shadowed by one bounded `.corrupt` copy, Section 56)
 * rather than silently overwritten.
 */

const USER_STATE_DIR_SEGMENTS = ['adaptive-wisp', 'user-state'];

function userStateDir(userDataRoot: string): string {
  return path.join(userDataRoot, ...USER_STATE_DIR_SEGMENTS);
}

/** Opaque, path-traversal-proof filename — the raw gameId never touches the filesystem path. */
function userStateFilePath(userDataRoot: string, gameId: CanonicalGameId): string {
  const hash = crypto.createHash('sha256').update(gameId, 'utf8').digest('hex');
  return path.join(userStateDir(userDataRoot), `${hash}.json`);
}

// A tiny per-path write queue — Section 34: prevent an older concurrent save
// from winning after a newer one, without building distributed locking.
const writeQueues = new Map<string, Promise<unknown>>();

function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const next = previous.then(task, task);
  writeQueues.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

export type WispLoadUserStateResult =
  | { ok: true; state: WispUserState | null; recoveredFromCorruption?: boolean }
  | { ok: false; error: WispPersistenceError };

export type WispSaveUserStateResult = { ok: true } | { ok: false; error: WispPersistenceError };

export async function loadUserState(userDataRoot: string, gameId: CanonicalGameId): Promise<WispLoadUserStateResult> {
  const filePath = userStateFilePath(userDataRoot, gameId);

  let stat: import('node:fs').Stats;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { ok: true, state: null };
    }
    return { ok: false, error: persistenceError('WISP_PERSISTENCE_READ_FAILED', 'failed to stat user-state file', error) };
  }

  if (stat.size > WISP_PROFILE_LIMITS.maxPersistedFileBytes) {
    return { ok: false, error: persistenceError('WISP_PERSISTENCE_TOO_LARGE', `user-state file exceeds ${WISP_PROFILE_LIMITS.maxPersistedFileBytes} bytes`) };
  }

  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    return { ok: false, error: persistenceError('WISP_PERSISTENCE_READ_FAILED', 'failed to read user-state file', error) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    await preserveCorruptEvidence(filePath, raw);
    return { ok: false, error: persistenceError('WISP_PERSISTENCE_CORRUPT', 'user-state file is not valid JSON', error) };
  }

  const validated = validateWispUserState(parsed);
  if (validated.ok === false) {
    await preserveCorruptEvidence(filePath, raw);
    const versionIssue = validated.issues.some((i) => i.code === 'WISP_PROFILE_VERSION_UNSUPPORTED');
    return {
      ok: false,
      error: persistenceError(
        versionIssue ? 'WISP_PERSISTENCE_VERSION_UNSUPPORTED' : 'WISP_PERSISTENCE_CORRUPT',
        validated.issues[0]?.message ?? 'user-state file failed schema validation',
      ),
    };
  }

  if (validated.state.gameId !== gameId) {
    // Defensive — a hash collision or a hand-edited file pointing at the
    // wrong game must never be trusted for this gameId's resolution.
    await preserveCorruptEvidence(filePath, raw);
    return { ok: false, error: persistenceError('WISP_PERSISTENCE_CORRUPT', 'user-state file gameId does not match the requested game') };
  }

  return { ok: true, state: validated.state };
}

export async function saveUserState(userDataRoot: string, state: WispUserState): Promise<WispSaveUserStateResult> {
  const filePath = userStateFilePath(userDataRoot, state.gameId);
  return enqueue(filePath, async () => {
    const dir = path.dirname(filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      return { ok: false, error: persistenceError('WISP_PERSISTENCE_WRITE_FAILED', 'failed to create user-state directory', error) };
    }

    // Deterministic key ordering — Section 14: readable diffs, reproducible
    // tests. A JSON.stringify array replacer would look tempting here, but
    // it filters by key name at EVERY nesting level, not just the top
    // level — it would silently strip fields from the nested `override`
    // object whose keys differ from the top-level state's. Sort recursively
    // instead so every level keeps all of its own keys.
    const serialized = JSON.stringify(sortKeysDeep(state), null, 2);

    const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`);
    try {
      await fs.writeFile(tmpPath, serialized, 'utf8');
      renameOrCopyAcrossDevices(tmpPath, filePath);
      return { ok: true };
    } catch (error) {
      try {
        await fs.unlink(tmpPath);
      } catch {
        // best-effort cleanup only
      }
      return { ok: false, error: persistenceError('WISP_PERSISTENCE_WRITE_FAILED', 'failed to atomically save user-state file', error) };
    }
  });
}

export async function deleteUserState(userDataRoot: string, gameId: CanonicalGameId): Promise<WispSaveUserStateResult> {
  const filePath = userStateFilePath(userDataRoot, gameId);
  return enqueue(filePath, async () => {
    try {
      await fs.unlink(filePath);
      return { ok: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { ok: true };
      return { ok: false, error: persistenceError('WISP_PERSISTENCE_WRITE_FAILED', 'failed to delete user-state file', error) };
    }
  });
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      result[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

/**
 * Preserves exactly one `.corrupt` copy of an invalid file as recovery
 * evidence (Section 56) — overwritten on each new corruption, never chained
 * (no `.corrupt.corrupt.corrupt`). Best-effort: a failure here must never
 * mask the real corruption error being returned to the caller.
 */
async function preserveCorruptEvidence(filePath: string, raw: string): Promise<void> {
  try {
    await fs.writeFile(`${filePath}.corrupt`, raw, 'utf8');
  } catch {
    // best-effort only
  }
}
