import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import {
  MemoryViewer,
  HexInspector,
  PointerCandidateAnalyzer,
  SessionSnapshotManager,
  parseResearchAddress,
} from '../../src/core/live-memory/research/index.js';
import type { PointerPathCandidate } from '../../src/core/live-memory/pointer-scanner.js';

const HANDLE = { pid: 4242, opaque: { fake: true } };

test('parseResearchAddress accepts hex and decimal', () => {
  assert.equal(parseResearchAddress('0x1000'), 0x1000n);
  assert.equal(parseResearchAddress(4096), 0x1000n);
  assert.equal(parseResearchAddress(0x2000n), 0x2000n);
  assert.throws(() => parseResearchAddress('not-an-address'));
});

test('MemoryViewer reads typed values and lists bounded regions', () => {
  const driver = new FakeMemoryDriver();
  const buf = Buffer.alloc(64, 0);
  buf.writeInt32LE(12345, 0);
  buf.writeFloatLE(3.5, 4);
  buf.write('hello\0', 8, 'utf8');
  driver.addRegion(0x10000n, buf, true);
  driver.addRegion(0x20000n, Buffer.alloc(16, 1), false);

  const viewer = new MemoryViewer(driver);
  const asInt = viewer.readTypedValues(HANDLE, '0x10000', ['int32']);
  assert.equal(asInt[0]?.value, 12345);
  assert.equal(asInt[0]?.readable, true);

  const asFloat = viewer.readTypedValues(HANDLE, '0x10004', ['float']);
  assert.ok(typeof asFloat[0]?.value === 'number');
  assert.ok(Math.abs(Number(asFloat[0]?.value) - 3.5) < 0.01);

  const asString = viewer.readTypedValues(HANDLE, '0x10008', ['string']);
  assert.equal(asString[0]?.value, 'hello');
  assert.equal(asString[0]?.readable, true);

  const regions = viewer.listRegions(HANDLE, { maxRegions: 1 });
  assert.equal(regions.regions.length, 1);
  assert.equal(regions.truncated, true);
  assert.equal(regions.totalAvailable, 2);
});

test('HexInspector formats rows and clamps window size', () => {
  const driver = new FakeMemoryDriver();
  const buf = Buffer.alloc(64);
  for (let i = 0; i < 64; i++) buf[i] = i;
  buf.write('ABC', 0, 'utf8');
  driver.addRegion(0x30000n, buf, true);

  const inspector = new HexInspector(driver, 32);
  const window = inspector.inspect(HANDLE, 0x30000n, 4096);
  assert.equal(window.readable, true);
  assert.equal(window.truncated, true);
  assert.equal(window.size, 32);
  assert.ok(window.hexRows.length >= 1);
  assert.match(window.hexRows[0]!.ascii, /^ABC/);
});

test('HexInspector reports unreadable pages without throwing', () => {
  const driver = new FakeMemoryDriver();
  const inspector = new HexInspector(driver);
  const window = inspector.inspect(HANDLE, '0xdeadbeef', 64);
  assert.equal(window.readable, false);
  assert.equal(window.hexRows.length, 0);
  assert.ok(window.error);
});

test('PointerCandidateAnalyzer prefers module roots and reports moduleRootOk=0 honestly', () => {
  const analyzer = new PointerCandidateAnalyzer();
  const empty = analyzer.analyze('0x1000', []);
  assert.equal(empty.candidateCount, 0);
  assert.equal(empty.moduleRootOk, 0);
  assert.equal(empty.confidenceScore, 'low');
  assert.equal(empty.bestPath, null);

  const candidates: PointerPathCandidate[] = [
    { moduleName: 'kernel32.dll', moduleOffset: 0x100, offsets: [0x10, 0x20, 0x30, 0x40], depth: 4 },
    { moduleName: 'Game-Win64-Shipping.exe', moduleOffset: 0x2000, offsets: [0x18], depth: 1 },
  ];
  const report = analyzer.analyze(0xabcdefn, candidates);
  assert.equal(report.moduleRootOk, 1);
  assert.equal(report.bestPath?.moduleName, 'Game-Win64-Shipping.exe');
  assert.equal(report.confidenceScore, 'high');
  assert.ok((report.bestPath?.score ?? 0) > (report.ranked[1]?.score ?? 0));
});

test('SessionSnapshotManager diffs watches and persists under a root directory', () => {
  const mgr = new SessionSnapshotManager();
  const oldSnap = mgr.create({
    pid: 1,
    processName: 'game.exe',
    watchlist: [
      { address: '0x10', type: 'int32', lastValue: 1, label: 'a' },
      { address: '0x20', type: 'float', lastValue: 2.5 },
    ],
    matchSetIds: ['scan-a'],
    moduleBases: [{ name: 'game.exe', baseAddress: '0x400000', size: 0x1000 }],
  });
  const newSnap = mgr.create({
    pid: 1,
    processName: 'game.exe',
    watchlist: [
      { address: '0x10', type: 'int32', lastValue: 9, label: 'a' },
      { address: '0x30', type: 'int32', lastValue: 3 },
    ],
    matchSetIds: ['scan-a', 'scan-b'],
  });

  const diff = mgr.diff(oldSnap, newSnap);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.changed[0]?.old, 1);
  assert.equal(diff.changed[0]?.new, 9);
  assert.deepEqual(diff.matchSetIdsAdded, ['scan-b']);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-research-snap-'));
  try {
    const filePath = mgr.saveToDirectory(root, oldSnap, 'unit-test');
    assert.ok(filePath.endsWith('unit-test.json'));
    const loaded = mgr.loadFromFile(filePath);
    assert.equal(loaded.schemaVersion, 1);
    assert.equal(loaded.watchlist.length, 2);
    assert.equal(loaded.moduleBases?.[0]?.name, 'game.exe');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
