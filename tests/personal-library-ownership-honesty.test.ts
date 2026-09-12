import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  projectPersonalLibraryGame,
  type PersonalLibraryProjectionInput,
} from '../src/core/personal-library/model.ts';
import type { GameInstallation } from '../src/core/canonical-games/types.ts';
import type { InstallPlatform } from '../src/core/install-discovery/types.ts';
import type { TrainerAccuracyEvidence } from '../src/core/trainer-catalog/trainer-accuracy.ts';

/**
 * Personal Library Completion pass, Phase 2, Mission 17 — ownership honesty
 * tests. Hostile/adversarial suite proving that NO local install-discovery
 * signal, on its own, is ever allowed to flip `owned` away from
 * `'unknown'`. This is a dedicated, explicit, per-provider enumeration of
 * the guarantee tests/personal-library-model.test.ts already exercises
 * generically — the point here is that a reviewer can see, launcher by
 * launcher, that installed-only evidence never implies ownership, rather
 * than trusting a single generic assertion.
 *
 * Nothing here launches a game, touches a process, or reads/writes memory —
 * these are pure calls into projectPersonalLibraryGame with fabricated
 * (never real) evidence bags.
 */

const NO_ACCURACY_EVIDENCE: TrainerAccuracyEvidence = {
  hasTrainer: false,
  hasValidationReceipt: false,
  receiptStillValid: false,
  receiptFailed: false,
  exactVersionEvidence: false,
  exactVersionMismatch: false,
  strongMatchEvidence: false,
};

function installation(launcher: InstallPlatform, overrides: Partial<GameInstallation> = {}): GameInstallation {
  return {
    id: `install-${launcher}`,
    canonicalGameId: 'game-1',
    launcher,
    installPath: `C:/Games/${launcher}/Foo`,
    executablePath: `C:/Games/${launcher}/Foo/Foo.exe`,
    detectedAt: '2026-09-01T00:00:00.000Z',
    lastSeenAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  } as GameInstallation;
}

function baseInput(overrides: Partial<PersonalLibraryProjectionInput> = {}): PersonalLibraryProjectionInput {
  return {
    gameId: 'game-1',
    title: 'Foo',
    running: false,
    installations: [],
    ownedConfirmed: undefined,
    favorite: false,
    canonicalIdentityStatus: undefined,
    catalogEntry: null,
    hasUserAuthoredDefinition: false,
    latestValidationReceipt: null,
    trainerAccuracyEvidence: NO_ACCURACY_EVIDENCE,
    nowIso: '2026-09-10T00:00:00.000Z',
    ...overrides,
  };
}

const PROVIDERS_WITH_REAL_INSTALL_SIGNAL: InstallPlatform[] = ['steam', 'gog', 'epic', 'ubisoft', 'ea', 'xbox'];

describe('Mission 17 — installed-only evidence never implies ownership, per provider', () => {
  for (const launcher of PROVIDERS_WITH_REAL_INSTALL_SIGNAL) {
    test(`${launcher}: installed:true but owned stays 'unknown' with no ownedConfirmed evidence`, () => {
      const result = projectPersonalLibraryGame(
        baseInput({ installations: [installation(launcher)] }),
      );
      assert.equal(result.installed, true);
      assert.equal(result.owned, 'unknown');
      assert.notEqual(result.owned, true);
      assert.notEqual(result.owned, false);
      assert.deepEqual(result.ownershipEvidence, []);
    });

    test(`${launcher}: installed:true AND ownedConfirmed explicitly false -> owned stays false, not flipped true by install evidence`, () => {
      const result = projectPersonalLibraryGame(
        baseInput({ installations: [installation(launcher)], ownedConfirmed: false }),
      );
      assert.equal(result.installed, true);
      assert.equal(result.owned, false);
    });
  }
});

describe('Mission 17 — Battle.net (partial provider) never crashes and never fabricates', () => {
  test('no Battle.net installations at all -> installed:false, owned stays unknown, no crash', () => {
    // Battle.net has a PARTIAL scanner (battle-net.ts — a real, documented
    // Windows Uninstall-registry signal, but not exhaustive/reliable enough
    // for 'supported'; see provider-capabilities.ts). The honest behavior
    // for "no evidence exists" is simply the default empty-installations
    // path, proven here explicitly for this provider.
    const result = projectPersonalLibraryGame(baseInput({ installations: [] }));
    assert.equal(result.installed, false);
    assert.equal(result.owned, 'unknown');
    assert.deepEqual(result.launchers, []);
  });

  test('a battlenet-launcher installation never implies ownership, even though a real (partial) scanner can now produce one', () => {
    // Exercises the honesty guarantee even now that battle-net.ts is real:
    // an installed-only signal (Uninstall registry evidence) must never be
    // upgraded to "owned" — install and ownership stay strictly separate
    // for every provider, Battle.net included.
    const result = projectPersonalLibraryGame(
      baseInput({ installations: [installation('battlenet')] }),
    );
    assert.equal(result.installed, true);
    assert.equal(result.owned, 'unknown');
  });
});

describe('Mission 17 — a running process alone never implies ownership', () => {
  test('running:true, no installations, no ownedConfirmed -> owned stays unknown', () => {
    const result = projectPersonalLibraryGame(baseInput({ running: true }));
    assert.equal(result.running, true);
    assert.equal(result.installed, false);
    assert.equal(result.owned, 'unknown');
  });

  test('running:true AND installed:true (still no ownedConfirmed) -> owned stays unknown', () => {
    const result = projectPersonalLibraryGame(
      baseInput({ running: true, installations: [installation('steam')] }),
    );
    assert.equal(result.owned, 'unknown');
  });
});

describe('Mission 17 — favorite:true alone never implies ownership', () => {
  test('favorite:true, no other evidence -> owned stays unknown', () => {
    const result = projectPersonalLibraryGame(baseInput({ favorite: true }));
    assert.equal(result.favorite, true);
    assert.equal(result.owned, 'unknown');
  });

  test('favorite:true AND installed:true AND running:true (still no ownedConfirmed) -> owned stays unknown', () => {
    const result = projectPersonalLibraryGame(
      baseInput({ favorite: true, running: true, installations: [installation('epic')] }),
    );
    assert.equal(result.owned, 'unknown');
  });
});

describe('Mission 17 — missing evidence anywhere resolves to unknown, never a guessed boolean', () => {
  test('ownedConfirmed === null (never touched, explicit null) -> unknown', () => {
    const result = projectPersonalLibraryGame(baseInput({ ownedConfirmed: null }));
    assert.equal(result.owned, 'unknown');
  });

  test('ownedConfirmed === undefined (never touched) -> unknown', () => {
    const result = projectPersonalLibraryGame(baseInput({ ownedConfirmed: undefined }));
    assert.equal(result.owned, 'unknown');
  });

  test('every combination of maximal non-ownership evidence still resolves to unknown, never true or false', () => {
    const result = projectPersonalLibraryGame(
      baseInput({
        running: true,
        favorite: true,
        installations: [
          installation('steam'),
          installation('gog', { id: 'install-gog-2' }),
          installation('epic', { id: 'install-epic-2' }),
        ],
        ownedConfirmed: undefined,
      }),
    );
    assert.equal(result.owned, 'unknown');
    assert.notEqual(result.owned, true);
    assert.notEqual(result.owned, false);
  });

  test('the tri-state is a real, distinct string value — never safely reducible to a plain truthy/falsy check', () => {
    const result = projectPersonalLibraryGame(baseInput());
    assert.equal(typeof result.owned, 'string');
    assert.equal(result.owned, 'unknown');
    // Documents the hazard explicitly: the non-empty string 'unknown' is
    // TRUTHY in JS (`Boolean('unknown') === true`), so a caller doing
    // `if (game.owned)` to mean "is owned" would silently treat UNKNOWN
    // ownership as if it were confirmed owned. Any consumer of this field
    // must compare `=== true` / `=== false` / `=== 'unknown'` explicitly —
    // never rely on truthiness in either direction.
    assert.equal(Boolean(result.owned), true);
    assert.notEqual(result.owned, true);
  });
});

describe('Mission 17 — explicit ownedConfirmed:true is the ONLY path that ever produces owned:true', () => {
  test('owned:true requires ownedConfirmed:true regardless of install/running/favorite evidence', () => {
    const withoutConfirmation = projectPersonalLibraryGame(
      baseInput({ running: true, favorite: true, installations: [installation('xbox')] }),
    );
    assert.notEqual(withoutConfirmation.owned, true);

    const withConfirmation = projectPersonalLibraryGame(
      baseInput({ running: false, favorite: false, installations: [], ownedConfirmed: true }),
    );
    assert.equal(withConfirmation.owned, true);
    assert.equal(withConfirmation.ownershipEvidence[0].source, 'user-confirmed');
  });
});
