/**
 * Phase 2 remediation, Gap A — the SOLITH_TEST_BUILD-gated controlled E2E
 * activation seam (SOLITH.MD Section 7).
 *
 * Follows the SAME pattern already established and statically proven absent
 * by tests/live-memory/gate2-1-test-build-hooks.test.ts
 * (electron/live-memory-ipc.ts's __testHasSessionForOwner /
 * windows-process-identity.ts's __setTestProcessIdentityOverride): every
 * exported mutator throws unless `SOLITH_TEST_BUILD=1`, and nothing here is
 * registered on ipcMain, exposed via preload, or reachable from a renderer
 * except through electron/wisp-e2e-test-ipc.ts, which is itself only
 * registered when the same env var is set (see main.ts).
 *
 * What this seam does NOT do (Section 7's own required conditions):
 *   - it cannot attach to an arbitrary process — it only ever supplies an
 *     address for the ONE fixed E2E_CONTROLLED_ENTRY_ID, and only once a
 *     real LiveMemorySession is already attached to a real (controlled)
 *     process via the existing, unmodified liveMemory* IPC;
 *   - it cannot select a raw address on its own initiative — the address it
 *     resolves to is whatever a real Playwright test explicitly supplied via
 *     __setE2EControlledAddress, itself only reachable through the
 *     SOLITH_TEST_BUILD-gated test IPC below;
 *   - it cannot mint a token or approve a proposal — it only ever affects
 *     WHICH address a real proposeWrite/confirmWrite resolves to; the entire
 *     consent proposal/approval/token chain downstream of that is 100%
 *     unmodified production code (WispQuickSlotController, WispConsentService,
 *     write-consent.ts, LiveMemorySession.confirmWrite);
 *   - the resulting high-level proposal is created by the SAME
 *     WispQuickSlotController.activate() production code path a real Wisp
 *     hotkey press calls (electron/trainer-hotkeys.ts), just invoked via IPC
 *     instead of via globalShortcut — see wisp-e2e-test-ipc.ts.
 */
import type { CanonicalGameId, CanonicalTrainerEntryId, WispGameProfile } from '../src/core/adaptive-wisp/types.js';
import type { WispTrainerEntryLookup } from '../src/core/adaptive-wisp/entry-lookup.js';
import type { WispBoundEntryDescriptor } from '../src/core/adaptive-wisp/runtime-types.js';
import { WISP_PROFILE_SCHEMA_VERSION } from '../src/core/adaptive-wisp/schema.js';
import type { LiveMemoryAddress, LiveValueType } from '../src/core/live-memory/types.js';

const IS_TEST_BUILD = process.env.SOLITH_TEST_BUILD === '1';

/** catalogGameId a controlled canonical game must be linked to (via a real, test-seeded upsertCanonicalGame row) for buildControlledE2EWispProfileIfLinked to activate — same shape as certified-profiles.ts's 'atomfall' linkage. */
export const E2E_CONTROLLED_CATALOG_GAME_ID = 'wisp-e2e-controlled-fixture';
export const E2E_CONTROLLED_ACTION_ID = 'wisp-e2e-set-ammo' as CanonicalTrainerEntryId;
export const E2E_CONTROLLED_ENTRY_ID = 'wisp-e2e-ammo' as CanonicalTrainerEntryId;
const E2E_CONTROLLED_ENTRY_LABEL = 'E2E Controlled Ammo';
const E2E_CONTROLLED_ENTRY_DATA_TYPE: LiveValueType = 'int32';

interface ResolvedControl {
  address: LiveMemoryAddress;
  dataType: LiveValueType;
}

let controlledAddress: LiveMemoryAddress | null = null;

/** Test/headless override — only usable when SOLITH_TEST_BUILD=1. See top-of-file doc comment. */
export function __setE2EControlledAddress(address: LiveMemoryAddress | null): void {
  if (!IS_TEST_BUILD) {
    throw new Error('__setE2EControlledAddress is only available when SOLITH_TEST_BUILD=1.');
  }
  controlledAddress = address;
}

/**
 * Read-only resolver consumed by the live-memory adapter's normal catalog
 * address resolution path (adaptive-wisp-live-adapter.ts's resolveEntryAddress).
 * Always returns null in a production build (IS_TEST_BUILD false) or when no
 * test has set an address yet — zero behavior change for every real game.
 */
export function resolveE2EControlledAddress(gameId: CanonicalGameId, entryId: CanonicalTrainerEntryId): ResolvedControl | null {
  if (!IS_TEST_BUILD) return null;
  if (entryId !== E2E_CONTROLLED_ENTRY_ID) return null;
  if (!controlledAddress) return null;
  return { address: controlledAddress, dataType: E2E_CONTROLLED_ENTRY_DATA_TYPE };
}

/**
 * The controlled-fixture counterpart to certified-profiles.ts's
 * buildAtomfallWispProfileIfLinked — same shape, same "caller verifies
 * linkage first" contract, gated to test builds only.
 */
export function buildControlledE2EWispProfileIfLinked(canonicalGameId: CanonicalGameId | null): WispGameProfile | null {
  if (!IS_TEST_BUILD) return null;
  if (!canonicalGameId) return null;
  return {
    schemaVersion: WISP_PROFILE_SCHEMA_VERSION,
    profileId: 'e2e:controlled-fixture:set-ammo:v1',
    gameId: canonicalGameId,
    source: 'builtin',
    groups: [{ id: 'e2e', label: 'E2E Controlled Fixture', order: 0, actionIds: [E2E_CONTROLLED_ACTION_ID] }],
    actions: [
      {
        id: E2E_CONTROLLED_ACTION_ID,
        entryId: E2E_CONTROLLED_ENTRY_ID,
        label: E2E_CONTROLLED_ENTRY_LABEL,
        controlType: 'set',
        slot: 1,
        presets: [{ id: 'default', label: 'Default', value: 777 }],
      },
    ],
  };
}

/**
 * Augments a real WispTrainerEntryLookup with exactly one additional
 * resolvable entry (E2E_CONTROLLED_ENTRY_ID) — every other entryId still
 * goes through the real, unmodified base lookup unchanged. Gated: returns
 * `base` completely untouched outside a test build.
 */
export function createE2EAugmentedEntryLookup(base: WispTrainerEntryLookup): WispTrainerEntryLookup {
  if (!IS_TEST_BUILD) return base;
  return {
    resolveEntry(gameId: CanonicalGameId, entryId: CanonicalTrainerEntryId): WispBoundEntryDescriptor | null {
      if (entryId === E2E_CONTROLLED_ENTRY_ID) {
        return { id: entryId, label: E2E_CONTROLLED_ENTRY_LABEL, dataType: E2E_CONTROLLED_ENTRY_DATA_TYPE, enabled: true };
      }
      return base.resolveEntry(gameId, entryId);
    },
  };
}

if (IS_TEST_BUILD) {
  (globalThis as Record<string, unknown>).__solithSetE2EControlledAddress = __setE2EControlledAddress;
}
