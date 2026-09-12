/**
 * Personal Library — composition layer (Mission 1).
 *
 * Gathers evidence from the real stores (canonical-games, trainer-catalog,
 * favorites, validation-receipts) and feeds the pure projector in model.ts.
 * This file owns NO persisted state itself — see model.ts's header comment
 * for the full list of who owns what.
 *
 * "running" is caller-supplied rather than queried here: core modules do not
 * reach into electron/ (electron/catalog-process-watch.ts lives in the main
 * process and only tracks the single most-recently-detected game today), so
 * the Electron layer is expected to pass in whatever running-game signal it
 * has. Passing no signal simply yields `running: false` for every game,
 * which is the honest default until a caller wires one in.
 */

import { listCanonicalGames, listInstallationsForGame } from '../canonical-games/store.js';
import { getCatalogEntry, hasUserAuthoredDefinition } from '../trainer-catalog/store.js';
import { isFavorite } from '../favorites/store.js';
import { getLatestReceipt } from '../validation-receipts/store.js';
import type { TrainerAccuracyEvidence } from '../trainer-catalog/trainer-accuracy.js';
import { needsReverify } from '../trainer-catalog/trainer-accuracy.js';
import {
  projectPersonalLibraryGame,
  type PersonalLibraryGame,
} from './model.js';

export interface BuildPersonalLibraryOptions {
  /** Canonical game ids currently detected as running (electron/catalog-process-watch.ts or equivalent). */
  runningCanonicalGameIds?: ReadonlySet<string>;
  nowIso?: string;
}

function receiptTrainerId(catalogGameId: string | undefined, modPackId: string | undefined): string {
  return modPackId ?? catalogGameId ?? 'unknown';
}

/**
 * This composer is intentionally conservative: it never asserts
 * EXACT_VERSION_MATCH or STRONG_MATCH from title text alone, and it only
 * trusts a locally-verified receipt as still-valid when no reverify trigger
 * fires against the installation evidence available here. Real-time
 * live-process hash/version comparison (the strongest possible evidence) is
 * out of scope for this composition layer — a later phase that has live
 * evidence at hand should feed a richer TrainerAccuracyEvidence directly to
 * computeTrainerAccuracy() rather than going through this composer.
 */
export function buildPersonalLibrary(options: BuildPersonalLibraryOptions = {}): PersonalLibraryGame[] {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const runningIds = options.runningCanonicalGameIds ?? new Set<string>();

  return listCanonicalGames().map((game) => {
    const installations = listInstallationsForGame(game.id);
    const catalogEntry = game.catalogGameId ? getCatalogEntry(game.catalogGameId) : null;
    const userAuthored = game.catalogGameId ? hasUserAuthoredDefinition(game.catalogGameId) : false;

    const trainerId = receiptTrainerId(game.catalogGameId, catalogEntry?.modPackId);
    const latestReceipt = game.catalogGameId ? getLatestReceipt(game.id, trainerId) : null;

    const firstInstallation = installations[0];
    const hasTrainer = Boolean(catalogEntry?.hasModPack) || userAuthored;

    const strongMatchEvidence = Boolean(
      firstInstallation?.executablePath &&
        catalogEntry?.executables.some((exe) =>
          firstInstallation.executablePath!.toLowerCase().endsWith(exe.toLowerCase()),
        ),
    );

    const hasValidationReceipt = latestReceipt?.result === 'PASS';
    const receiptFailed = latestReceipt?.result === 'FAIL';
    const receiptStillValid =
      hasValidationReceipt && latestReceipt
        ? !needsReverify({
            receipt: {
              executableName: latestReceipt.executableName,
              executableVersion: latestReceipt.executableVersion,
              executableHash: latestReceipt.executableHash,
              trainerSource: latestReceipt.trainerSource,
              trainerVersionHint: latestReceipt.trainerVersionHint,
            },
            current: {
              executableName: firstInstallation?.executablePath ?? latestReceipt.executableName,
              executableVersion: firstInstallation?.buildVersion,
              executableHash: undefined,
              trainerSource: latestReceipt.trainerSource,
              trainerVersionHint: latestReceipt.trainerVersionHint,
            },
          })
        : false;

    const evidence: TrainerAccuracyEvidence = {
      hasTrainer,
      hasValidationReceipt: Boolean(hasValidationReceipt),
      receiptStillValid,
      receiptFailed: Boolean(receiptFailed),
      exactVersionEvidence: false,
      exactVersionMismatch: false,
      strongMatchEvidence,
    };

    return projectPersonalLibraryGame({
      gameId: game.id,
      title: game.displayName,
      running: runningIds.has(game.id),
      installations,
      ownedConfirmed: catalogEntry?.ownedConfirmed,
      favorite: isFavorite(game.id),
      canonicalIdentityStatus: game.identityStatus,
      catalogEntry,
      hasUserAuthoredDefinition: userAuthored,
      latestValidationReceipt: latestReceipt,
      trainerAccuracyEvidence: evidence,
      nowIso,
    });
  });
}

export {
  projectPersonalLibraryGame,
  type PersonalLibraryGame,
  type PersonalLibraryProjectionInput,
  type OwnershipStatus,
  type CanonicalConfidence,
  type TrainerAvailability,
  type InstallEvidenceItem,
  type OwnershipEvidenceItem,
  type VersionEvidenceItem,
} from './model.js';
