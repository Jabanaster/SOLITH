import type { CanonicalGameId, WispGameProfile } from './types.js';
import { WISP_PROFILE_SCHEMA_VERSION } from './schema.js';

/**
 * Adaptive Wisp Increment 6 Tasks 1-4 + catalog-reconciliation closeout —
 * certified production Wisp profiles.
 *
 * Authoritative source: `trainer-catalog/bundled-definition-seed.ts`'s
 * `ATOMFALL_VERIFIED_AMMO_FEATURE`, a real, already-reviewed schema.v1
 * memory feature (`id: 'atomfall-current-weapon-ammo'`, `dataType: 'int32'`,
 * `defaultValue: 99`, `certificationLevel: 'L3'`,
 * `resolution.moduleName: 'atomfall_dx12.exe'`). This function does NOT
 * re-declare or duplicate that address data — Wisp profiles never carry
 * raw addresses/offsets (address resolution stays schema.v1's job via
 * `resolveLiveControlFromSchema`, unchanged Increment 4 architecture); only
 * the stable `entryId` is referenced.
 *
 * `controlType: 'set'` is the closest existing Wisp control semantic to
 * schema.v1's `write_once` (a specific one-shot value write, not a
 * toggle/freeze/cycle). The preset value is `99` — the REAL feature's own
 * `defaultValue`, not an invented convenience number (the catalog
 * -reconciliation closeout corrected an earlier, less careful choice of
 * `9999` here, which merely copied an unrelated "infinite resource"
 * convention rather than the actual authoritative value for this specific
 * feature).
 *
 * Catalog reconciliation (this closeout): `cheat-system/games.ts`'s
 * `atomfallCheats` now contains a cheat entry with this SAME id, copied
 * field-for-field from this same authoritative feature (dataType,
 * defaultValue, certificationLevel) — see that entry's own comment for the
 * full provenance note. This closes the previously-documented gap where
 * this action could never resolve past `availability: 'missing-entry'`.
 */
const ATOMFALL_AMMO_FEATURE_ENTRY_ID = 'atomfall-current-weapon-ammo';
const ATOMFALL_AMMO_DEFAULT_VALUE = 99;

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
        presets: [{ id: 'default', label: 'Default', value: ATOMFALL_AMMO_DEFAULT_VALUE }],
      },
    ],
  };
}
