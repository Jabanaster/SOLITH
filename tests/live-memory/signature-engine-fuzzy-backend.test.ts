/**
 * Phase 1 / Stage 7.5 §4 — fuzzy AOB fixture matrix.
 *
 * Independent ground truth, deliberately. Every buffer below is constructed
 * here, so the expected address / distance / drift kind / completeness of each
 * case is known from the fixture itself rather than by asking one backend what
 * the other backend said. Mission §4's explicit rule: "Do not compare legacy vs
 * native without independent truth."
 *
 * The source under test is `scanFuzzySignatureViaSource`, which is the whole
 * production fuzzy path above the backend seam. It is driven here through a
 * `ScannerMemorySource` whose read behavior is scripted, which is what lets a
 * single test file cover cases a real process cannot be made to produce on
 * demand — an unreadable region, a mid-scan process exit, a resource-limit
 * refusal — alongside the ordinary matching cases.
 *
 * `LEGACY_1MIB_CAP` is the case that matters most. It reproduces
 * `native-memory-driver.ts`'s real behavior (`readBuffer` throws outright for
 * any size over 1048576) and proves the two halves of the D01/D03 closure at
 * once: the legacy-shaped source genuinely cannot see a pattern that lives
 * past the cap, AND it now says so — `isAuthoritativeAbsence` is false and the
 * skipped range is named. Before this stage that same miss was reported as a
 * bare `null`, indistinguishable from a real absence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  scanFuzzySignatureViaSource,
  classifyFuzzySignatureDifference,
} from '../../src/core/live-memory/signature-engine.js';
import type {
  CanonicalMemoryRegion,
  CanonicalRegionReadOutcome,
  CanonicalScanBounds,
  CanonicalTargetModule,
  ScanControl,
  ScannerBackendKind,
} from '../../src/core/live-memory/scanner-backend.js';
import type { ScannerMemorySource } from '../../src/core/live-memory/scanner-backend-router.js';
import { NativeScannerBackend } from '../../src/core/live-memory/scanner-backend-native.js';
import { ScannerBackendError } from '../../src/core/live-memory/scanner-backend.js';

const LEGACY_READ_BUFFER_CAP = 1_048_576;

interface FixtureRegion {
  baseAddress: bigint;
  data: Buffer;
  /** When set, reading this region fails with this reason instead of returning bytes. */
  failReason?: string;
  /** When set, reading this region returns this terminal completeness state. */
  terminal?: CanonicalRegionReadOutcome['completeness'];
  /** When set, only these byte ranges are readable; the rest are reported skipped. */
  readableRuns?: Array<{ offset: number; length: number }>;
}

interface FixtureSourceOptions {
  kind?: ScannerBackendKind;
  modules?: CanonicalTargetModule[];
  /** Emulate `native-memory-driver.ts`'s hard 1 MiB `readBuffer` ceiling. */
  legacyOneMiBCap?: boolean;
}

/**
 * A scripted `ScannerMemorySource`. Returns exactly the bytes and exactly the
 * completeness the case under test declares — no inference, no hidden repair.
 */
function makeSource(regions: FixtureRegion[], options: FixtureSourceOptions = {}): ScannerMemorySource {
  const kind = options.kind ?? 'native';
  return {
    kind,
    // eslint-disable-next-line @typescript-eslint/require-await
    async enumerateRegions(): Promise<CanonicalMemoryRegion[]> {
      return regions.map((r) => ({
        baseAddress: r.baseAddress,
        size: BigInt(r.data.length),
        isReadable: true,
        isWritable: true,
        isExecutable: false,
      }));
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async enumerateModules(): Promise<CanonicalTargetModule[]> {
      return options.modules ?? [];
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async readRegion(
      region: CanonicalMemoryRegion,
      bounds: CanonicalScanBounds,
      control?: ScanControl,
    ): Promise<CanonicalRegionReadOutcome> {
      const skipped = (reason: string): CanonicalRegionReadOutcome => ({
        backend: kind,
        slices: [],
        completeness: {
          state: 'complete_with_skipped_regions',
          skipped: [{ baseAddress: region.baseAddress, size: region.size, reason }],
        },
        metrics: {
          regionsConsidered: 1,
          regionsRead: 0,
          regionsSkipped: 1,
          bytesRequested: region.size,
          bytesRead: 0n,
          elapsedMillis: 0n,
        },
      });

      if (control?.signal?.aborted) {
        return {
          backend: kind,
          slices: [],
          completeness: { state: 'cancelled', atByte: 0n },
          metrics: {
            regionsConsidered: 1,
            regionsRead: 0,
            regionsSkipped: 1,
            bytesRequested: region.size,
            bytesRead: 0n,
            elapsedMillis: 0n,
          },
        };
      }

      if (bounds.maxRegionBytes !== undefined && region.size > BigInt(bounds.maxRegionBytes)) {
        return skipped('max_region_bytes');
      }

      // The fixture regions are whole; a span request is resolved against the
      // region that contains it so module-scoped spans still read correctly.
      const owner = regions.find(
        (r) =>
          region.baseAddress >= r.baseAddress &&
          region.baseAddress + region.size <= r.baseAddress + BigInt(r.data.length),
      );
      if (!owner) return skipped('no_such_region');

      if (owner.terminal) {
        return {
          backend: kind,
          slices: [],
          completeness: owner.terminal,
          metrics: {
            regionsConsidered: 1,
            regionsRead: 0,
            regionsSkipped: 1,
            bytesRequested: region.size,
            bytesRead: 0n,
            elapsedMillis: 0n,
          },
        };
      }
      if (owner.failReason) return skipped(owner.failReason);
      if (options.legacyOneMiBCap && region.size > BigInt(LEGACY_READ_BUFFER_CAP)) {
        return skipped(`legacy_read_failed: readBuffer size ${region.size} exceeds 1 MiB`);
      }

      const spanStart = Number(region.baseAddress - owner.baseAddress);
      const spanEnd = spanStart + Number(region.size);

      if (owner.readableRuns) {
        const slices = [];
        const holes = [];
        let cursor = spanStart;
        for (const run of owner.readableRuns) {
          const runStart = Math.max(run.offset, spanStart);
          const runEnd = Math.min(run.offset + run.length, spanEnd);
          if (runStart >= runEnd) continue;
          if (runStart > cursor) {
            holes.push({
              baseAddress: owner.baseAddress + BigInt(cursor),
              size: BigInt(runStart - cursor),
              reason: 'unreadable_page',
            });
          }
          slices.push({
            baseAddress: owner.baseAddress + BigInt(runStart),
            data: owner.data.subarray(runStart, runEnd),
          });
          cursor = runEnd;
        }
        if (cursor < spanEnd) {
          holes.push({
            baseAddress: owner.baseAddress + BigInt(cursor),
            size: BigInt(spanEnd - cursor),
            reason: 'unreadable_page',
          });
        }
        return {
          backend: kind,
          slices,
          completeness:
            holes.length > 0 ? { state: 'complete_with_skipped_regions', skipped: holes } : { state: 'complete' },
          metrics: {
            regionsConsidered: 1,
            regionsRead: 1,
            regionsSkipped: 0,
            bytesRequested: region.size,
            bytesRead: BigInt(slices.reduce((n, s) => n + s.data.length, 0)),
            elapsedMillis: 0n,
          },
        };
      }

      const data = owner.data.subarray(spanStart, spanEnd);
      return {
        backend: kind,
        slices: [{ baseAddress: region.baseAddress, data }],
        completeness: { state: 'complete' },
        metrics: {
          regionsConsidered: 1,
          regionsRead: 1,
          regionsSkipped: 0,
          bytesRequested: region.size,
          bytesRead: BigInt(data.length),
          elapsedMillis: 0n,
        },
      };
    },
  };
}

const BASE = 0x10000000n;
const SIGNATURE = 'DE AD BE EF';

/** Deterministic filler that never coincidentally contains the signature. */
function filler(size: number): Buffer {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) buf[i] = (i * 7) % 0x7f;
  return buf;
}

function plant(size: number, offset: number, bytes: number[]): Buffer {
  const buf = filler(size);
  buf.set(bytes, offset);
  return buf;
}

// ── 1. Exact match ──────────────────────────────────────────────────────────
test('fuzzy matrix 01 — exact match resolves to the planted address at distance 0', async () => {
  const data = plant(0x400, 0x100, [0xde, 0xad, 0xbe, 0xef]);
  const outcome = await scanFuzzySignatureViaSource(makeSource([{ baseAddress: BASE, data }]), SIGNATURE);
  assert.equal(outcome.match?.address, BASE + 0x100n);
  assert.equal(outcome.match?.distance, 0);
  assert.equal(outcome.match?.mode, 'exact');
  assert.equal(outcome.match?.driftKind, 'hamming');
  assert.equal(outcome.completeness.state, 'complete');
  assert.equal(outcome.isAuthoritativeAbsence, false);
});

// ── 2. One tolerated mismatch ───────────────────────────────────────────────
test('fuzzy matrix 02 — a single substituted byte resolves as a distance-1 Hamming match', async () => {
  const data = plant(0x400, 0x120, [0xde, 0xad, 0xbe, 0x00]);
  const outcome = await scanFuzzySignatureViaSource(makeSource([{ baseAddress: BASE, data }]), SIGNATURE, {
    maxDistance: 2,
    maxEdits: 0,
  });
  assert.equal(outcome.match?.address, BASE + 0x120n);
  assert.equal(outcome.match?.distance, 1);
  assert.equal(outcome.match?.mode, 'fuzzy');
  assert.equal(outcome.match?.driftKind, 'hamming');
});

// ── 3. Multiple tolerated mismatches ────────────────────────────────────────
test('fuzzy matrix 03 — two substituted bytes resolve as a distance-2 Hamming match', async () => {
  const data = plant(0x400, 0x140, [0xde, 0xad, 0x00, 0x11]);
  const outcome = await scanFuzzySignatureViaSource(makeSource([{ baseAddress: BASE, data }]), SIGNATURE, {
    maxDistance: 2,
    maxEdits: 0,
  });
  assert.equal(outcome.match?.address, BASE + 0x140n);
  assert.equal(outcome.match?.distance, 2);
});

// ── 4. Tolerance boundary ───────────────────────────────────────────────────
test('fuzzy matrix 04 — exactly maxDistance mismatches is inside tolerance', async () => {
  const data = plant(0x400, 0x160, [0xde, 0xad, 0x00, 0x11]);
  const outcome = await scanFuzzySignatureViaSource(makeSource([{ baseAddress: BASE, data }]), SIGNATURE, {
    maxDistance: 2,
    maxEdits: 0,
  });
  assert.equal(outcome.match?.distance, 2, 'distance == maxDistance must still match');
});

// ── 5. Beyond tolerance ─────────────────────────────────────────────────────
test('fuzzy matrix 05 — one mismatch past tolerance is an authoritative absence', async () => {
  const data = plant(0x400, 0x180, [0xde, 0x00, 0x11, 0x22]);
  const outcome = await scanFuzzySignatureViaSource(makeSource([{ baseAddress: BASE, data }]), SIGNATURE, {
    maxDistance: 2,
    maxEdits: 0,
  });
  assert.equal(outcome.match, null);
  assert.equal(outcome.completeness.state, 'complete');
  assert.equal(outcome.isAuthoritativeAbsence, true, 'full coverage + no match == authoritative absence');
});

// ── 6. Shifted / drifted (byte insertion) ───────────────────────────────────
test('fuzzy matrix 06 — an inserted byte resolves through bounded edit distance', async () => {
  // DE AD <FF inserted> BE EF — Hamming cannot absorb this; edit distance can.
  const data = plant(0x400, 0x1a0, [0xde, 0xad, 0xff, 0xbe, 0xef]);
  const outcome = await scanFuzzySignatureViaSource(makeSource([{ baseAddress: BASE, data }]), SIGNATURE, {
    maxDistance: 0,
    maxEdits: 1,
  });
  assert.equal(outcome.match?.address, BASE + 0x1a0n);
  assert.equal(outcome.match?.driftKind, 'edit');
  assert.equal(outcome.match?.distance, 1);
});

// ── 7. Wildcard-containing pattern ──────────────────────────────────────────
test('fuzzy matrix 07 — a wildcard token costs nothing and still yields an exact match', async () => {
  const data = plant(0x400, 0x1c0, [0xde, 0xad, 0x5a, 0xef]);
  const outcome = await scanFuzzySignatureViaSource(
    makeSource([{ baseAddress: BASE, data }]),
    'DE AD ? EF',
    { maxDistance: 2, maxEdits: 0 },
  );
  assert.equal(outcome.match?.address, BASE + 0x1c0n);
  assert.equal(outcome.match?.distance, 0);
  assert.equal(outcome.match?.mode, 'exact');
});

// ── 8. Multiple candidates ──────────────────────────────────────────────────
test('fuzzy matrix 08 — the lowest-distance candidate wins over an earlier worse one', async () => {
  const data = filler(0x400);
  data.set([0xde, 0xad, 0x00, 0x11], 0x80); // distance 2, earlier
  data.set([0xde, 0xad, 0xbe, 0xef], 0x200); // distance 0, later
  const outcome = await scanFuzzySignatureViaSource(makeSource([{ baseAddress: BASE, data }]), SIGNATURE, {
    maxDistance: 2,
    maxEdits: 0,
  });
  assert.equal(outcome.match?.address, BASE + 0x200n, 'better match must win regardless of address order');
  assert.equal(outcome.match?.distance, 0);
});

// ── 9. Tie / scoring behavior ───────────────────────────────────────────────
test('fuzzy matrix 09 — on an equal-cost tie, Hamming is preferred over edit', async () => {
  // Offset 0x80: DE AD FF BE EF  -> edit distance 1 (insertion)
  // Offset 0x200: DE AD BE 00    -> Hamming distance 1 (substitution)
  const data = filler(0x400);
  data.set([0xde, 0xad, 0xff, 0xbe, 0xef], 0x80);
  data.set([0xde, 0xad, 0xbe, 0x00], 0x200);
  const outcome = await scanFuzzySignatureViaSource(makeSource([{ baseAddress: BASE, data }]), SIGNATURE, {
    maxDistance: 1,
    maxEdits: 1,
  });
  assert.equal(outcome.match?.distance, 1);
  assert.equal(outcome.match?.driftKind, 'hamming', 'equal cost must resolve to the Hamming candidate');
  assert.equal(outcome.match?.address, BASE + 0x200n);
});

// ── 10. No match ────────────────────────────────────────────────────────────
test('fuzzy matrix 10 — a pattern that is genuinely absent is an authoritative absence', async () => {
  const outcome = await scanFuzzySignatureViaSource(
    makeSource([{ baseAddress: BASE, data: filler(0x400) }]),
    SIGNATURE,
    { maxDistance: 0, maxEdits: 0 },
  );
  assert.equal(outcome.match, null);
  assert.equal(outcome.isAuthoritativeAbsence, true);
});

// ── 11. >1 MiB location — the D01/D03 closure proof ─────────────────────────
test('fuzzy matrix 11 — a match past 1 MiB is found natively and is NOT a false absence under legacy', async () => {
  const size = 2 * 1024 * 1024;
  const offset = 1_500_000; // comfortably past the legacy readBuffer ceiling
  const data = plant(size, offset, [0xde, 0xad, 0xbe, 0xef]);

  const native = await scanFuzzySignatureViaSource(
    makeSource([{ baseAddress: BASE, data }], { kind: 'native' }),
    SIGNATURE,
  );
  assert.equal(native.match?.address, BASE + BigInt(offset), 'native must read past 1 MiB and find the pattern');
  assert.equal(native.completeness.state, 'complete');

  const legacy = await scanFuzzySignatureViaSource(
    makeSource([{ baseAddress: BASE, data }], { kind: 'legacy', legacyOneMiBCap: true }),
    SIGNATURE,
  );
  assert.equal(legacy.match, null, 'legacy genuinely cannot reach it — the defect is preserved, not repaired here');
  assert.equal(
    legacy.completeness.state,
    'complete_with_skipped_regions',
    'but the miss must be reported as uncovered, not as a clean scan',
  );
  assert.equal(
    legacy.isAuthoritativeAbsence,
    false,
    'D03 closure: a capped legacy read must never yield an authoritative not-found',
  );

  // And the shadow-compare classifier must attribute the difference to the
  // known cause rather than blaming native.
  const differences = classifyFuzzySignatureDifference(legacy, native);
  assert.equal(differences.length, 1);
  assert.equal(differences[0].classification, 'EXPECTED_NATIVE_CORRECTION');
});

// ── 12. Unaligned location ──────────────────────────────────────────────────
test('fuzzy matrix 12 — a match at an odd, unaligned offset resolves exactly', async () => {
  const data = plant(0x400, 0x101, [0xde, 0xad, 0xbe, 0xef]);
  const outcome = await scanFuzzySignatureViaSource(makeSource([{ baseAddress: BASE, data }]), SIGNATURE);
  assert.equal(outcome.match?.address, BASE + 0x101n);
  assert.equal(outcome.match?.distance, 0);
});

// ── 13. Inaccessible region ─────────────────────────────────────────────────
test('fuzzy matrix 13 — an unreadable region is reported skipped, never as a clean absence', async () => {
  const outcome = await scanFuzzySignatureViaSource(
    makeSource([{ baseAddress: BASE, data: filler(0x400), failReason: 'access_denied' }]),
    SIGNATURE,
  );
  assert.equal(outcome.match, null);
  assert.equal(outcome.completeness.state, 'complete_with_skipped_regions');
  assert.equal(outcome.isAuthoritativeAbsence, false);
  assert.match(
    outcome.completeness.state === 'complete_with_skipped_regions' ? outcome.completeness.skipped[0].reason : '',
    /access_denied/,
  );
});

// ── 13b. Partially readable region — a hole must not be stitched over ───────
test('fuzzy matrix 13b — a pattern straddling an unreadable hole is uncovered, not absent', async () => {
  const data = plant(0x400, 0x1fe, [0xde, 0xad, 0xbe, 0xef]); // straddles the 0x200 boundary
  const outcome = await scanFuzzySignatureViaSource(
    makeSource([
      {
        baseAddress: BASE,
        data,
        readableRuns: [
          { offset: 0, length: 0x200 },
          { offset: 0x280, length: 0x180 },
        ],
      },
    ]),
    SIGNATURE,
    { maxDistance: 0, maxEdits: 0 },
  );
  assert.equal(outcome.match, null, 'the straddling pattern is genuinely unreachable');
  assert.equal(outcome.isAuthoritativeAbsence, false, 'and must not be promoted to a confident not-found');
});

// ── 14. Cancellation ────────────────────────────────────────────────────────
test('fuzzy matrix 14 — cancellation is terminal and is never an authoritative absence', async () => {
  const controller = new AbortController();
  controller.abort();
  const data = plant(0x400, 0x100, [0xde, 0xad, 0xbe, 0xef]);
  const outcome = await scanFuzzySignatureViaSource(
    makeSource([{ baseAddress: BASE, data }]),
    SIGNATURE,
    {},
    {},
    { signal: controller.signal },
  );
  assert.equal(outcome.match, null);
  assert.equal(outcome.completeness.state, 'cancelled');
  assert.equal(outcome.isAuthoritativeAbsence, false);
});

// ── 15. Process exit ────────────────────────────────────────────────────────
test('fuzzy matrix 15 — a mid-scan process exit is terminal and is never an authoritative absence', async () => {
  const outcome = await scanFuzzySignatureViaSource(
    makeSource([
      { baseAddress: BASE, data: filler(0x400), terminal: { state: 'process_exited', atByte: 128n } },
    ]),
    SIGNATURE,
  );
  assert.equal(outcome.match, null);
  assert.equal(outcome.completeness.state, 'process_exited');
  assert.equal(outcome.isAuthoritativeAbsence, false);
});

// ── 16. Resource limit ──────────────────────────────────────────────────────
test('fuzzy matrix 16 — an over-budget region is refused out loud, not silently dropped', async () => {
  const data = plant(0x4000, 0x100, [0xde, 0xad, 0xbe, 0xef]);
  const outcome = await scanFuzzySignatureViaSource(
    makeSource([{ baseAddress: BASE, data }]),
    SIGNATURE,
    {},
    { maxRegionBytes: 0x100 },
  );
  assert.equal(outcome.match, null);
  assert.equal(outcome.completeness.state, 'complete_with_skipped_regions');
  assert.equal(outcome.isAuthoritativeAbsence, false);
});

// ── 17. Module scoping — fail closed when the module is absent ──────────────
test('fuzzy matrix 17 — a module-scoped request fails closed when the module is not loaded', async () => {
  const data = plant(0x400, 0x100, [0xde, 0xad, 0xbe, 0xef]);
  const outcome = await scanFuzzySignatureViaSource(
    makeSource([{ baseAddress: BASE, data }], { modules: [{ name: 'Other.dll', baseAddress: BASE, size: 0x400n }] }),
    SIGNATURE,
    { moduleName: 'Missing.exe' },
  );
  assert.equal(outcome.match, null, 'must not widen the search to the whole address space');
  assert.equal(outcome.isAuthoritativeAbsence, true, 'an unloaded module is a complete answer, not an uncovered one');
});

// ── 18. Module scoping — restricts the searched range ───────────────────────
test('fuzzy matrix 18 — a module-scoped request searches only that module span', async () => {
  const data = filler(0x400);
  data.set([0xde, 0xad, 0xbe, 0xef], 0x300); // outside the module span below
  const outcome = await scanFuzzySignatureViaSource(
    makeSource([{ baseAddress: BASE, data }], {
      modules: [{ name: 'Demo.exe', baseAddress: BASE, size: 0x200n }],
    }),
    SIGNATURE,
    { moduleName: 'Demo.exe', maxDistance: 0, maxEdits: 0 },
  );
  assert.equal(outcome.match, null, 'a match outside the named module must not be returned');
});

// ── 19. Hint window ─────────────────────────────────────────────────────────
test('fuzzy matrix 19 — a hint window excludes matches outside it and includes matches inside it', async () => {
  const data = plant(0x1000, 0x800, [0xde, 0xad, 0xbe, 0xef]);
  const source = makeSource([{ baseAddress: BASE, data }]);

  const miss = await scanFuzzySignatureViaSource(source, SIGNATURE, {
    hintAddress: BASE + 0x100n,
    maxShiftBytes: 16,
  });
  assert.equal(miss.match, null, 'a match far outside the shift window must not be returned');

  const hit = await scanFuzzySignatureViaSource(source, SIGNATURE, {
    hintAddress: BASE + 0x7f8n,
    maxShiftBytes: 64,
  });
  assert.equal(hit.match?.address, BASE + 0x800n);
  assert.equal(hit.match?.shiftBytes, 8, 'shiftBytes must report the real signed drift from the hint');
});

// ── 20. No silent widening: module enumeration fails closed ─────────────────
test('fuzzy matrix 20 — the native backend refuses a module query it cannot answer, rather than returning []', async () => {
  // An unbound module provider must NOT degrade to "no modules", because a
  // module-scoped fuzzy request would then either fail-closed for the wrong
  // reason or, worse, be widened to the whole address space. Refusing out loud
  // is the only honest option while the native core has no module enumeration.
  const backend = new NativeScannerBackend();
  await assert.rejects(
    () => backend.enumerateModules(),
    (err: unknown) => {
      assert.ok(err instanceof ScannerBackendError);
      assert.equal(err.kind, 'unsupported_operation');
      return true;
    },
  );
});

// ── 21. No hidden fallback: unattached native reads fail loudly ─────────────
test('fuzzy matrix 21 — an unattached native backend throws a typed error instead of degrading', async () => {
  const backend = new NativeScannerBackend();
  await assert.rejects(
    () => backend.enumerateRegions(),
    (err: unknown) => {
      assert.ok(err instanceof ScannerBackendError);
      assert.equal(err.kind, 'attach_failed');
      return true;
    },
  );
  await assert.rejects(
    () =>
      backend.readRegion(
        { baseAddress: BASE, size: 0x100n, isReadable: true, isWritable: true, isExecutable: false },
        {},
      ),
    (err: unknown) => {
      assert.ok(err instanceof ScannerBackendError);
      assert.equal(err.kind, 'attach_failed');
      return true;
    },
  );
});

// ── 22. A bound module provider is used verbatim ────────────────────────────
test('fuzzy matrix 22 — a bound module provider supplies module identity to the native backend', async () => {
  const backend = new NativeScannerBackend(() => [{ name: 'Demo.exe', baseAddress: BASE, size: 0x400n }]);
  const modules = await backend.enumerateModules();
  assert.equal(modules.length, 1);
  assert.equal(modules[0].name, 'Demo.exe');
  assert.equal(modules[0].baseAddress, BASE);
});
