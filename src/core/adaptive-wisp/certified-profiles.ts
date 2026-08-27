import type { CanonicalGameId, WispGameProfile } from './types.js';
import { WISP_PROFILE_SCHEMA_VERSION } from './schema.js';

/**
 * Adaptive Wisp Increment 6 Tasks 1-4 remediation — certified production
 * Wisp profiles (Task 4: "Populate and certify the production Wisp profile
 * registry").
 *
 * Authoritative source decision, per Task 4's preferred-order list:
 * Option 1 ("transform an existing reviewed canonical trainer/cheat
 * definition into the strict Wisp schema"). Source:
 * `bundledDefinitionsForTests()` (src/core/trainer-catalog/
 * bundled-definition-seed.ts) ships an Atomfall schema.v1 definition whose
 * own test suite (tests/bundled-definition-seed.test.ts, unchanged) labels
 * one memory feature a "verified live-control pointer":
 *
 *   id: 'atomfall-current-weapon-ammo'
 *   type: 'write_once'
 *   resolution.moduleName: 'atomfall_dx12.exe'
 *   resolution.baseOffset: '0x1959a28'
 *   resolution.pointerChain: [24]
 *
 * This function does NOT re-declare, copy, or duplicate that address data —
 * Wisp profiles never carry raw addresses/offsets (see
 * src/core/adaptive-wisp/types.ts's WispActionDefinition; address
 * resolution is schema.v1's job via resolveLiveControlFromSchema, unchanged
 * — Increment 4's own architecture). This function only references the
 * memory feature by its stable `entryId`, exactly the same indirection
 * every other Wisp action already uses.
 *
 * `controlType: 'set'` was chosen for a `write_once` feature because Wisp's
 * domain model (types.ts's WispControlType) has no `write_once` variant;
 * `set` is the closest existing match — writing a specific value once, not
 * a toggle/freeze/cycle. The preset value `9999` is not an invented
 * game-balance guess: it reuses this EXACT repository's own established
 * convention for an "unlimited"-style int32 resource cheat, already used
 * for Atomfall itself (see cheat-system/games.ts's ATOMFALL_CONFIG
 * `infinite-health`/`infinite-stamina`, both `infiniteValue: 9999`).
 *
 * Documented, unresolved limitation (NOT closed here — see this file's
 * caller, electron/adaptive-wisp-hotkey-composition.ts, for the full
 * explanation): this action's `entryId` will resolve to
 * `availability: 'missing-entry'` today, not `'available'`, because
 * cheat-system's own CheatDefinition catalog for Atomfall
 * (games.ts's atomfallCheats) has no entry with this id — the two catalogs
 * use disjoint id namespaces. Registering this profile is still correct
 * and real: it is schema-valid, references only real reviewed data, and
 * will resolve to `'available'` the moment a separate, future task
 * reconciles the two catalogs' id namespaces for this feature — that
 * reconciliation is explicitly out of this directive's scope (it is not an
 * identity/registry concern, and closing it here would mean inventing an
 * unreviewed CheatDefinition, which the standing anti-fabrication
 * instruction forbids).
 */
const ATOMFALL_AMMO_FEATURE_ENTRY_ID = 'atomfall-current-weapon-ammo';
const ATOMFALL_UNLIMITED_RESOURCE_VALUE = 9999;

/**
 * Builds the real Atomfall Wisp profile bound to `canonicalGameId`, or
 * `null` if `canonicalGameId` is falsy. The caller is responsible for only
 * calling this once a real canonical game has genuinely been linked to
 * catalogGameId 'atomfall' (via findCanonicalGameByCatalogGameId,
 * unchanged existing install-discovery/migration-populated data) — this
 * function performs no lookup or validation of that linkage itself; it is
 * a pure profile builder, not a decision-maker.
 */
export function buildAtomfallWispProfileIfLinked(canonicalGameId: CanonicalGameId | null): WispGameProfile | null {
  if (!canonicalGameId) return null;
  return {
    schemaVersion: WISP_PROFILE_SCHEMA_VERSION,
    profileId: 'certified:atomfall:current-weapon-ammo:v1',
    gameId: canonicalGameId,
    source: 'builtin',
    groups: [
      { id: 'weapons', label: 'Weapons', order: 0, actionIds: ['atomfall-current-weapon-ammo'] },
    ],
    actions: [
      {
        id: 'atomfall-current-weapon-ammo',
        entryId: ATOMFALL_AMMO_FEATURE_ENTRY_ID,
        label: 'Current Weapon Ammo',
        controlType: 'set',
        slot: 1,
        presets: [{ id: 'unlimited', label: 'Unlimited', value: ATOMFALL_UNLIMITED_RESOURCE_VALUE }],
      },
    ],
  };
}
