/**
 * Phase 1.5 security closeout, Mission A2 — the REAL, deterministic
 * classification function that produces `ClassificationReceipt`s.
 *
 * ============================================================================
 * WHY THIS CLASSIFIER ONLY EVER RETURNS 'inconclusive' — READ BEFORE CHANGING
 * ============================================================================
 * The Mission A2 brief is explicit: "do not build a fake malware scanner
 * merely to satisfy the interface." SOLITH does not currently have a real
 * trainer-artifact-format parser, disassembler, or script analyzer anywhere
 * in this codebase capable of honestly determining — from raw bytes alone —
 * whether an artifact is a native-resolver, pointer, AOB, AutoAssembler
 * script, Lua script, etc.
 *
 * Given that, the only HONEST answer `classifyArtifactBytes` can give for
 * any input, today, is "I cannot determine this yet" — i.e. verdict
 * 'inconclusive'. Returning a fabricated 'eligible' would silently
 * reintroduce exactly the trust-boundary gap this mission exists to close
 * (a caller claiming safety with nothing behind it), and returning a
 * fabricated 'unsafe' would be equally dishonest in the other direction.
 *
 * This is the CORRECT and INTENTIONAL behavior for `classifierVersion:
 * 'v0-inconclusive-only'` — not a bug, not a placeholder to "finish later"
 * by making it more lenient. The point of this mission is the boundary and
 * receipt architecture (recomputed hash, immutable stored receipt, fail-
 * closed consumption by qualifyForUpload), which must stay unbypassable no
 * matter how sophisticated a future classifier becomes. A future real
 * classifier that can honestly reach 'eligible' (or 'unsafe') for genuine
 * content MUST ship under a NEW `classifierVersion` string so a receipt's
 * provenance is never ambiguous between "honest placeholder" and "real
 * detector".
 *
 * Properties this function guarantees:
 *   - REAL: not a stub that gets bypassed. qualifyForUploadWithVerifiedClassification
 *     genuinely refuses to progress an artifact with no recorded receipt.
 *   - DETERMINISTIC: identical bytes always produce the same verdict,
 *     contentTypes, reasons, and classifierVersion (only `classifiedAt`
 *     varies between calls).
 *   - TIED TO CONTENT IDENTITY: `artifactHash` is always
 *     `computeArtifactHash(buffer)`, recomputed here from the actual bytes —
 *     never accepted as a parameter — so a receipt can never be forged for
 *     the wrong artifact.
 */
import { computeArtifactHash } from '../trainer-artifact-store/store.js';
import type { ClassificationReceipt } from './types.js';

/** See file header. Bump this string (never mutate its meaning) when a real classifier ships. */
export const CLASSIFIER_VERSION = 'v0-inconclusive-only';

export function classifyArtifactBytes(buffer: Buffer): ClassificationReceipt {
  const artifactHash = computeArtifactHash(buffer);

  return {
    artifactHash,
    verdict: 'inconclusive',
    contentTypes: [],
    reasons: [
      "classifier 'v0-inconclusive-only' cannot yet determine trainer content types from raw bytes: no real trainer-format parser/disassembler exists in this codebase. This is the honest, non-fabricated result for every input in this pass, not a bug.",
    ],
    classifiedAt: new Date().toISOString(),
    classifierVersion: CLASSIFIER_VERSION,
  };
}
