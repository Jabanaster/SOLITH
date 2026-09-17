import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyExecutableRoles } from '../src/core/install-discovery/executable-role.ts';

describe('classifyExecutableRoles', () => {
  test('launcher + actual game: the launcher is not mistaken for the game', () => {
    const roles = classifyExecutableRoles(['GameLauncher.exe', 'Game-Win64-Shipping.exe']);
    assert.equal(roles.get('GameLauncher.exe'), 'LAUNCHER');
    assert.equal(roles.get('Game-Win64-Shipping.exe'), 'PRIMARY_GAME');
  });

  test('client + dedicated server: both classified distinctly, neither treated as equivalent', () => {
    const roles = classifyExecutableRoles(['GameClient.exe', 'Game_DedicatedServer.exe']);
    assert.equal(roles.get('GameClient.exe'), 'PRIMARY_GAME');
    assert.equal(roles.get('Game_DedicatedServer.exe'), 'SERVER');
  });

  test('benchmark + primary game are distinguished', () => {
    const roles = classifyExecutableRoles(['Game.exe', 'GameBenchmark.exe']);
    assert.equal(roles.get('Game.exe'), 'PRIMARY_GAME');
    assert.equal(roles.get('GameBenchmark.exe'), 'BENCHMARK');
  });

  test('alternate game binary (DX11/DX12 sibling) resolved via catalog-known executable', () => {
    const roles = classifyExecutableRoles(['Game.exe', 'Game_DX12.exe'], {
      knownCatalogExecutables: ['Game.exe'],
    });
    assert.equal(roles.get('Game.exe'), 'PRIMARY_GAME');
    assert.equal(roles.get('Game_DX12.exe'), 'ALTERNATE_GAME');
  });

  test('unknown executable role: two game-like candidates with no catalog evidence fail closed, not guessed', () => {
    const roles = classifyExecutableRoles(['Foo.exe', 'Bar.exe']);
    assert.equal(roles.get('Foo.exe'), 'UNKNOWN');
    assert.equal(roles.get('Bar.exe'), 'UNKNOWN');
  });

  test('updater, tool, and anti-cheat bootstrap are each classified correctly, not lumped into one bucket', () => {
    const roles = classifyExecutableRoles([
      'Game.exe',
      'GameUpdater.exe',
      'GameConfigTool.exe',
      'EasyAntiCheat.exe',
    ]);
    assert.equal(roles.get('Game.exe'), 'PRIMARY_GAME');
    assert.equal(roles.get('GameUpdater.exe'), 'UPDATER');
    assert.equal(roles.get('GameConfigTool.exe'), 'TOOL');
    assert.equal(roles.get('EasyAntiCheat.exe'), 'ANTI_CHEAT_BOOTSTRAP');
  });

  test('crash reporter is classified as TOOL, not confused with the game itself', () => {
    const roles = classifyExecutableRoles(['Game.exe', 'Game_CrashReporter.exe']);
    assert.equal(roles.get('Game_CrashReporter.exe'), 'TOOL');
  });

  test('a single executable with no special pattern is the primary game by elimination', () => {
    const roles = classifyExecutableRoles(['MyStrangelyNamedBinary.exe']);
    assert.equal(roles.get('MyStrangelyNamedBinary.exe'), 'PRIMARY_GAME');
  });

  test('every input executable appears exactly once in the result — none silently dropped', () => {
    const inputs = ['A.exe', 'ALauncher.exe', 'AUpdater.exe', 'ABenchmark.exe', 'AServer.exe', 'Unrelated.exe'];
    const roles = classifyExecutableRoles(inputs);
    assert.equal(roles.size, inputs.length);
    for (const name of inputs) assert.ok(roles.has(name), `missing classification for ${name}`);
  });

  test('bundled third-party SDK helper binaries (Epic Online Services web helper) are never treated as game candidates', () => {
    // Real-game evidence: Palworld (Steam appid 1623730, ROADMAP.md Phase 3
    // curated title) ships Engine/Binaries/Win64/EpicWebHelper.exe alongside
    // the actual game binary — confirmed against a real install.
    const roles = classifyExecutableRoles(['Palworld-Win64-Shipping.exe', 'EpicWebHelper.exe'], {
      knownCatalogExecutables: ['Palworld-Win64-Shipping.exe', 'Palworld.exe'],
    });
    assert.equal(roles.get('Palworld-Win64-Shipping.exe'), 'PRIMARY_GAME');
    assert.equal(roles.get('EpicWebHelper.exe'), 'TOOL');
  });

  test('.NET/CoreCLR createdump.exe crash-dump helper is never treated as a game candidate', () => {
    // Real-game evidence: Stardew Valley (Steam appid 413150, ROADMAP.md
    // Phase 3 Exit Gate title) ships createdump.exe at install root
    // alongside "Stardew Valley.exe" — confirmed against a real install.
    // Without this, both were classified UNKNOWN (2 unrelated game-like
    // candidates), and the title could never resolve a primary executable.
    const roles = classifyExecutableRoles(['Stardew Valley.exe', 'createdump.exe']);
    assert.equal(roles.get('Stardew Valley.exe'), 'PRIMARY_GAME');
    assert.equal(roles.get('createdump.exe'), 'TOOL');
  });

  test('Google Crashpad handler (crashpad_handler.exe) is classified as a tool, not a game candidate', () => {
    // Real-game evidence: Crimson Desert Enhanced (Steam appid 3321460,
    // ROADMAP.md Phase 3 curated title) ships bin64/crashpad_handler.exe
    // alongside the real game binary — confirmed against a real install.
    const roles = classifyExecutableRoles(['CrimsonDesert.exe', 'crashpad_handler.exe'], {
      knownCatalogExecutables: ['CrimsonDesert.exe'],
    });
    assert.equal(roles.get('CrimsonDesert.exe'), 'PRIMARY_GAME');
    assert.equal(roles.get('crashpad_handler.exe'), 'TOOL');
  });

  test('Microsoft GDK launch-bootstrap helper (gamelaunchhelper.exe) is classified as a tool, not a game candidate', () => {
    // Real-game evidence: a PC Game Pass / Xbox app packaged title (Docs/phase3/008
    // §3, Atomfall, Steam appid 801800 also exists but this is the GDK
    // install) ships Content/gamelaunchhelper.exe alongside the real
    // executables — a fixed Microsoft toolchain binary name, not
    // game-specific — confirmed against a real install.
    const roles = classifyExecutableRoles(['Atomfall.exe', 'gamelaunchhelper.exe'], {
      knownCatalogExecutables: ['Atomfall.exe'],
    });
    assert.equal(roles.get('Atomfall.exe'), 'PRIMARY_GAME');
    assert.equal(roles.get('gamelaunchhelper.exe'), 'TOOL');
  });

  test('gamelaunchhelper matcher is anchored to the exact basename, not a substring — case variants of the real name are caught', () => {
    const roles = classifyExecutableRoles(['GameLaunchHelper.exe', 'GAMELAUNCHHELPER.EXE']);
    assert.equal(roles.get('GameLaunchHelper.exe'), 'TOOL');
    assert.equal(roles.get('GAMELAUNCHHELPER.EXE'), 'TOOL');
  });

  test('names that merely contain "gamelaunchhelper" as a substring are NOT rejected by this rule (no overbroad ban)', () => {
    // Required negative cases: the fix closes the specific evidenced
    // reproduction (the exact real GDK binary name) — it must not reject
    // an unrelated executable just because its name contains that
    // sequence. Each is tested as the sole candidate (no other rule of any
    // kind matches any of these three names either, so each resolves
    // PRIMARY_GAME by elimination — the ordinary, correct outcome for a
    // real single-executable game).
    for (const name of ['mygamelaunchhelpertool.exe', 'gamelaunchhelper_backup.exe', 'notgamelaunchhelper.exe']) {
      const roles = classifyExecutableRoles([name]);
      assert.equal(roles.get(name), 'PRIMARY_GAME', `${name} must not be rejected by the gamelaunchhelper rule`);
    }
  });

  test('multiple catalog-known executables are all PRIMARY_GAME (e.g. 32-bit and 64-bit both shipped)', () => {
    const roles = classifyExecutableRoles(['Game32.exe', 'Game64.exe', 'GameOther.exe'], {
      knownCatalogExecutables: ['Game32.exe', 'Game64.exe'],
    });
    assert.equal(roles.get('Game32.exe'), 'PRIMARY_GAME');
    assert.equal(roles.get('Game64.exe'), 'PRIMARY_GAME');
    assert.equal(roles.get('GameOther.exe'), 'ALTERNATE_GAME');
  });
});
