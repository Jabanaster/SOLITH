import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProcessPickerOptions,
  groupProcessPickerOptions,
  type ProcessPickerProcess,
  type ProcessPickerSort,
} from '../src/app/live-memory/process-picker.js';
import type { GameConfig } from '../src/core/cheat-system/types.js';

function game(gameId: string, name: string, executable: string, aliases: string[] = []): GameConfig {
  return {
    gameId,
    name,
    executable,
    aliases,
    platform: 'steam',
    cheatsSupported: true,
    cheatDiscoveryType: 'memory-scan',
    dataType: 'float',
    categories: [],
    cheats: [],
    connectionBaseline: 0,
    description: name,
    lastUpdated: new Date('2026-01-01T00:00:00.000Z'),
  };
}

const catalog = [
  game('bg3', 'Baldur’s Gate 3', 'bg3_dx11.exe'),
  game('cyberpunk', 'Cyberpunk 2077', 'Cyberpunk2077.exe'),
  game('dredge', 'DREDGE', 'DREDGE.exe'),
  game('palworld', 'Palworld', 'Palworld-Win64-Shipping.exe', ['Palworld.exe']),
  game('stardew', 'Stardew Valley', 'Stardew Valley.exe'),
];

const processes: ProcessPickerProcess[] = [
  { pid: 400, name: 'chrome.exe' },
  { pid: 303, name: 'Palworld-Win64-Shipping.exe' },
  { pid: 101, name: 'Cyberpunk2077.exe' },
  { pid: 202, name: 'DREDGE.exe' },
  { pid: 302, name: 'Palworld.exe' },
  { pid: 505, name: 'MonstersAreComingRockcampRoad.exe' },
  { pid: 201, name: 'bg3_dx11.exe' },
];

test('defaults to game-title A-Z ordering within display groups', () => {
  const options = buildProcessPickerOptions({ processes, catalogGames: catalog, showAllProcesses: false });

  assert.deepEqual(
    options.map((option) => option.title),
    [
      'Baldur’s Gate 3',
      'Cyberpunk 2077',
      'DREDGE',
      'Palworld',
      'Palworld',
    ],
  );
  assert.equal(options.some((option) => option.processName === 'chrome.exe'), false);
});

test('pins the exact current target above every other candidate', () => {
  const options = buildProcessPickerOptions({
    processes,
    catalogGames: catalog,
    currentCatalogGameId: 'palworld',
    showAllProcesses: false,
  });

  assert.deepEqual(options.slice(0, 2).map((option) => option.processName), [
    'Palworld-Win64-Shipping.exe',
    'Palworld.exe',
  ]);
  assert.equal(options[0].group, 'current');
  assert.equal(options[1].group, 'current');
});

test('uses process name as the secondary sort and PID as duplicate tie-breaker', () => {
  const options = buildProcessPickerOptions({
    processes: [
      { pid: 9, name: 'Palworld.exe' },
      { pid: 7, name: 'Palworld-Win64-Shipping.exe' },
      { pid: 5, name: 'Palworld.exe' },
    ],
    catalogGames: catalog,
    currentCatalogGameId: 'palworld',
  });

  assert.deepEqual(options.map((option) => `${option.processName}:${option.pid}`), [
    'Palworld-Win64-Shipping.exe:7',
    'Palworld.exe:5',
    'Palworld.exe:9',
  ]);
});

test('unknown processes are shown only when explicitly enabled and sort by process-derived title', () => {
  const hidden = buildProcessPickerOptions({
    processes: [{ pid: 1, name: 'unknown-tool.exe' }],
    catalogGames: catalog,
    showAllProcesses: false,
  });
  const shown = buildProcessPickerOptions({
    processes: [
      { pid: 2, name: 'zz-helper.exe' },
      { pid: 1, name: 'aa-helper.exe' },
    ],
    catalogGames: catalog,
    showAllProcesses: true,
  });

  assert.equal(hidden.length, 0);
  assert.deepEqual(shown.map((option) => option.processName), ['aa-helper.exe', 'zz-helper.exe']);
});

test('critical and Solith-owned processes remain blocked even when unknown override is enabled', () => {
  const options = buildProcessPickerOptions({
    processes: [
      { pid: 4, name: 'svchost.exe' },
      { pid: 8, name: 'lsass.exe' },
      { pid: 12, name: 'explorer.exe' },
      { pid: 16, name: 'Solith.exe' },
      { pid: 20, name: 'odd-local-tool.exe' },
    ],
    catalogGames: catalog,
    showAllProcesses: true,
  });

  assert.deepEqual(options.map((option) => option.processName), ['odd-local-tool.exe']);
  assert.equal(options[0].group, 'unknown');
});

test('non-game development and launcher helper processes do not get likely-game confidence', () => {
  const options = buildProcessPickerOptions({
    processes: [
      { pid: 31, name: 'node.exe' },
      { pid: 32, name: 'powershell.exe' },
      { pid: 33, name: 'steamwebhelper.exe' },
      { pid: 34, name: 'demo-win64-shipping.exe' },
    ],
    catalogGames: catalog,
    showAllProcesses: false,
  });

  assert.deepEqual(options.map((option) => option.processName), ['demo-win64-shipping.exe']);
  assert.equal(options[0].group, 'likely');
});

test('sort selection is deterministic across filter changes and refreshes', () => {
  const build = (sort: ProcessPickerSort, search = '', refreshed = processes) =>
    buildProcessPickerOptions({
      processes: refreshed,
      catalogGames: catalog,
      showAllProcesses: false,
      sort,
      search,
    }).map((option) => option.title);

  assert.deepEqual(build('za').slice(0, 2), ['Palworld', 'Palworld']);
  assert.deepEqual(build('za', 'cyber'), ['Cyberpunk 2077']);
  assert.deepEqual(build('za', '', [...processes].reverse()).slice(0, 2), ['Palworld', 'Palworld']);
});

test('installed games are grouped before likely catalog-only games', () => {
  const options = buildProcessPickerOptions({
    processes,
    catalogGames: catalog,
    installedGames: [{ id: 'local-dredge', name: 'DREDGE Local', executablePath: 'G:\\Games\\DREDGE.exe' }],
  });
  const groups = groupProcessPickerOptions(options);

  assert.deepEqual(groups.map((group) => group.label), ['Installed games', 'Likely games']);
  assert.equal(groups[0].options[0].title, 'DREDGE Local');
  assert.equal(groups[0].options[0].matchedBy, 'installed-executable');
});

test('PID sort orders duplicate process instances by PID within their group', () => {
  const options = buildProcessPickerOptions({
    processes: [
      { pid: 42, name: 'Cyberpunk2077.exe' },
      { pid: 12, name: 'Cyberpunk2077.exe' },
      { pid: 88, name: 'Cyberpunk2077.exe' },
    ],
    catalogGames: catalog,
    sort: 'pid',
  });

  assert.deepEqual(options.map((option) => option.pid), [12, 42, 88]);
});
