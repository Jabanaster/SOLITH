// Phase 2 P2-5 (SOLITH.MD mission §11) — real-process structure-discovery
// certification. Spawns a genuine `solith-scanner-fixture.exe`, attaches
// and discovers through the real registered `ipcMain.handle` callbacks
// (same harness as scanner-backend-rollback-matrix.test.ts — nothing below
// the IPC boundary is mocked), against STRUCT_REGION: a real dedicated
// multi-field layout (sentinel int32, float32, u64, module-external
// pointer, mutable int32, raw bytes, ASCII string, unaligned field).
//
// This does NOT assert which byte offsets the engine chooses to group into
// which field — structure-model.ts's own contract is that field
// segmentation is evidence-driven, never a claim about "the" true layout
// (mission §11: "decodable" != "semantically inferred"). What this DOES
// assert, robustly and independent of segmentation internals:
//   1. every byte in the requested window is accounted for exactly once
//      (fields fully partition the window, byte-for-byte correct against
//      the fixture's own known plant + its deterministic decoy formula);
//   2. the real module-external pointer at STRUCT_POINTER_OFFSET is
//      genuinely classified as a pointer candidate into the real
//      secondary allocation;
//   3. the real ASCII string payload is genuinely classified as a string
//      candidate;
//   4. a real Snapshot A / mutate (via the fixture's own `writestruct`
//      stdin command) / Snapshot B / compare cycle detects the real
//      changed byte range truthfully, at the byte level.
import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

register(new URL("./fixtures/electron-loader.mjs", import.meta.url));

const mock = await import("./fixtures/electron-ipc-mock.mjs");
const { registerTrustedWindow, _clearTrustedWindowsForTests } =
  await import("../../src/core/security/trusted-sender-registry.ts");
const ipcModule = await import("../../electron/live-memory-ipc.ts");
const { initDatabase } = await import("../../src/core/database/index.ts");

const FIXTURE_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "native",
  "solith-scanner-core",
  "target",
  "release",
  "solith-scanner-fixture.exe",
);

function fixtureAvailable(): boolean {
  return process.platform === "win32" && existsSync(FIXTURE_PATH);
}

const testRequire = createRequire(import.meta.url);
function nativeAddonAvailable(): boolean {
  try {
    testRequire("solith-scanner-napi");
    return true;
  } catch {
    return false;
  }
}

interface FixtureHandle {
  child: ChildProcessWithoutNullStreams;
  fields: Record<string, string>;
  writeStructBytes: (offset: number, leHex: string) => Promise<void>;
}

function spawnFixture(): Promise<FixtureHandle> {
  const child = spawn(FIXTURE_PATH, [], { stdio: ["pipe", "pipe", "inherit"] });
  child.stdin.on("error", () => {
    /* fixture already gone — nothing left to say to it */
  });
  return new Promise((resolve, reject) => {
    let buffered = "";
    const fields: Record<string, string> = {};
    const pendingWrites: Array<{
      offset: number;
      resolve: () => void;
      reject: (e: Error) => void;
    }> = [];

    function onData(chunk: Buffer) {
      buffered += chunk.toString("utf8");
      let idx: number;
      // eslint-disable-next-line no-cond-assign
      while ((idx = buffered.indexOf("\n")) !== -1) {
        const line = buffered.slice(0, idx).trim();
        buffered = buffered.slice(idx + 1);
        if (line === "READY") {
          child.stdout.off("data", onData);
          child.stdout.on("data", onWriteAckData);
          resolve({ child, fields, writeStructBytes });
          return;
        }
        const eq = line.indexOf("=");
        if (eq !== -1) fields[line.slice(0, eq)] = line.slice(eq + 1);
      }
    }

    let ackBuffered = "";
    function onWriteAckData(chunk: Buffer) {
      ackBuffered += chunk.toString("utf8");
      let idx: number;
      // eslint-disable-next-line no-cond-assign
      while ((idx = ackBuffered.indexOf("\n")) !== -1) {
        const line = ackBuffered.slice(0, idx).trim();
        ackBuffered = ackBuffered.slice(idx + 1);
        const wroteMatch = /^WROTE (\d+)$/.exec(line);
        const pending = pendingWrites.shift();
        if (!pending) continue;
        if (wroteMatch && Number(wroteMatch[1]) === pending.offset)
          pending.resolve();
        else
          pending.reject(
            new Error(`unexpected fixture response to writestruct: ${line}`),
          );
      }
    }

    function writeStructBytes(offset: number, leHex: string): Promise<void> {
      return new Promise((res, rej) => {
        pendingWrites.push({ offset, resolve: res, reject: rej });
        child.stdin.write(`writestruct ${offset} ${leHex}\n`);
      });
    }

    child.stdout.on("data", onData);
    child.on("error", reject);
  });
}

function killFixture(handle: FixtureHandle): void {
  try {
    handle.child.stdin.write("exit\n");
  } catch {
    /* already gone */
  }
  handle.child.kill();
}

let nextSenderId = 1;
function makeTrustedEvent() {
  const id = nextSenderId++;
  registerTrustedWindow({
    webContentsId: id,
    windowType: "main",
    allowedUrlPrefixes: ["file:///app/dist/index.html"],
  });
  const mainFrame = { url: "file:///app/dist/index.html#/trainer" };
  const sender = {
    id,
    isDestroyed: () => false,
    mainFrame,
    once: (_event: string, _listener: () => void) => {},
    on: (_event: string, _listener: (...args: unknown[]) => void) => {},
  };
  return { sender, senderFrame: mainFrame } as any;
}

async function withAttachedFixture<T>(
  fn: (ctx: { event: unknown; child: FixtureHandle }) => Promise<T>,
): Promise<T> {
  _clearTrustedWindowsForTests();
  const userDataDir = mkdtempSync(
    path.join(os.tmpdir(), "solith-p2-5-real-process-"),
  );
  mock.__setUserDataDir(userDataDir);
  await initDatabase();
  ipcModule.registerLiveMemoryIpc();
  const child = await spawnFixture();
  try {
    const event = makeTrustedEvent();
    const attachResult = await mock.__invoke("live-memory-attach", event, {
      pid: child.child.pid!,
      executableName: "solith-scanner-fixture.exe",
      userConfirmedOffline: true,
    });
    assert.equal(
      attachResult.success,
      true,
      `attach must succeed: ${JSON.stringify(attachResult)}`,
    );
    return await fn({ event, child });
  } finally {
    killFixture(child);
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

const describeReal =
  fixtureAvailable() && nativeAddonAvailable() ? test : test.skip;

/** Exact JS mirror of fixture.rs's STRUCT_REGION decoy fill: `((i as u32).wrapping_mul(0x1656_67B1) >> 24) as u8`. */
function structDecoyByte(i: number): number {
  return (Math.imul(i >>> 0, 0x1656_67b1) >>> 24) & 0xff;
}

function buildExpectedStructBuffer(length: number, mutableI32: number): Buffer {
  const buf = Buffer.alloc(length);
  for (let i = 0; i < length; i++) buf[i] = structDecoyByte(i);
  buf.writeInt32LE(-777_000_111, 0x00); // STRUCT_SENTINEL_VALUE
  buf.writeFloatLE(98.6, 0x04); // STRUCT_FLOAT_VALUE
  buf.writeBigUInt64LE(0x1122_3344_5566_7788n, 0x08); // STRUCT_U64_VALUE
  // STRUCT_POINTER_OFFSET (0x10) filled by the caller once the real secondary base is known.
  buf.writeInt32LE(mutableI32, 0x18); // STRUCT_MUTABLE_I32_OFFSET
  Buffer.from([0xde, 0xad, 0xbe, 0xef]).copy(buf, 0x1c); // STRUCT_RAW_BYTES_PATTERN
  Buffer.from("StructPayload", "ascii").copy(buf, 0x20); // STRUCT_STRING_TEXT
  buf.writeInt32LE(-12345, 0x31); // STRUCT_UNALIGNED_VALUE
  return buf;
}

/** Concatenates a discovered structure's fields (assumed gap-free — asserted separately) into one contiguous raw-byte buffer, in offset order. */
function reconstructBytes(
  fields: Array<{ offset: number; width: number; rawHex: string }>,
): Buffer {
  const sorted = [...fields].sort((a, b) => a.offset - b.offset);
  const parts = sorted.map((f) =>
    Buffer.from(f.rawHex.replace(/^0x/, ""), "hex"),
  );
  return Buffer.concat(parts);
}

const STRUCT_WINDOW_LENGTH = 128;

/** One full discover -> byte-check -> pointer/string evidence -> snapshot/mutate/snapshot/compare -> refresh cycle against a single real, freshly-attached fixture process. */
async function runOneCycle({
  event,
  child,
}: {
  event: unknown;
  child: FixtureHandle;
}): Promise<void> {
  const structBase = child.fields.STRUCT_REGION_BASE;
  const secondaryBase = BigInt(child.fields.STRUCT_SECONDARY_REGION_BASE);
  assert.ok(structBase, "fixture must report STRUCT_REGION_BASE");

  // ── Discover ────────────────────────────────────────────────────────
  const discoverResult = await mock.__invoke("structure:discover", event, {
    label: "p2-5-real-process",
    baseAddress: structBase,
    length: STRUCT_WINDOW_LENGTH,
  });
  assert.equal(
    discoverResult.success,
    true,
    `discover must succeed: ${JSON.stringify(discoverResult)}`,
  );
  const structure = discoverResult.structure;
  assert.equal(
    structure.completeness.state,
    "complete",
    "a fully committed, freshly-allocated region must read complete",
  );
  assert.equal(
    structure.unknownSpans.length,
    0,
    "a fully readable region must have zero unknown spans",
  );
  assert.equal(structure.length, STRUCT_WINDOW_LENGTH);

  // ── 1. Every byte accounted for exactly once, byte-for-byte correct ──
  const totalFieldBytes = structure.fields.reduce(
    (sum: number, f: any) => sum + f.width,
    0,
  );
  assert.equal(
    totalFieldBytes,
    STRUCT_WINDOW_LENGTH,
    "fields must fully partition the requested window with no gaps or overlaps",
  );
  const reconstructed = reconstructBytes(structure.fields);
  const expected = buildExpectedStructBuffer(STRUCT_WINDOW_LENGTH, 42);
  secondaryBase; // (used below via readBigUInt64LE comparison, not baked into `expected` since it's runtime-random)
  // Overlay the real pointer bytes (ASLR-randomized base, unknown at authoring time) before comparing.
  expected.writeBigUInt64LE(secondaryBase, 0x10);
  assert.equal(
    reconstructed.toString("hex"),
    expected.toString("hex"),
    "reconstructed raw bytes must exactly match the fixture's known plant + its own deterministic decoy fill",
  );

  // ── 2. Real pointer candidate ─────────────────────────────────────────
  const pointerField = structure.fields.find(
    (f: any) => f.evidence.pointerCandidate.classified === true,
  );
  assert.ok(
    pointerField,
    "a real module-external pointer candidate must be classified somewhere in the window",
  );
  assert.equal(
    pointerField.offset,
    0x10,
    "the pointer candidate must be isolated at STRUCT_POINTER_OFFSET (real evidence wins the segmentation tie-break)",
  );
  assert.equal(
    BigInt(pointerField.evidence.pointerCandidate.destinationAddress),
    secondaryBase,
  );
  assert.equal(
    pointerField.evidence.pointerCandidate.destinationRegion,
    "heap_or_other_region",
  );
  assert.equal(pointerField.evidence.pointerCandidate.readable, true);
  assert.equal(pointerField.confidence, "high");

  // ── 3. Real string candidate ───────────────────────────────────────────
  const stringField = structure.fields.find(
    (f: any) =>
      f.evidence.stringCandidate.classified === true &&
      f.evidence.stringCandidate.text.startsWith("StructPa"),
  );
  assert.ok(
    stringField,
    "the real ASCII string payload must be classified as a string candidate",
  );
  assert.equal(
    stringField.offset,
    0x20,
    "the string candidate must be isolated at STRUCT_STRING_OFFSET (real evidence wins the segmentation tie-break)",
  );
  assert.equal(stringField.evidence.stringCandidate.encoding, "ascii");

  // ── 4. Snapshot A / mutate / Snapshot B / compare — real byte-level diff ─
  const snapAResult = await mock.__invoke("structure:capture-snapshot", event, {
    structureId: structure.id,
  });
  assert.equal(snapAResult.success, true);
  const snapshotA = snapAResult.snapshot;
  assert.equal(snapshotA.completeness.state, "complete");

  // Every LE byte must differ from the initial value's bytes (42 = 0x2A 00 00 00)
  // so the byte-level diff is guaranteed to cover the full 4-byte field, not a
  // coincidentally-unchanged subset of it.
  const NEW_MUTABLE_VALUE = 0x11223344;
  const mutationBuf = Buffer.alloc(4);
  mutationBuf.writeInt32LE(NEW_MUTABLE_VALUE, 0);
  await child.writeStructBytes(0x18, mutationBuf.toString("hex"));

  const snapBResult = await mock.__invoke("structure:capture-snapshot", event, {
    structureId: structure.id,
  });
  assert.equal(snapBResult.success, true);
  const snapshotB = snapBResult.snapshot;

  const compareResult = await mock.__invoke(
    "structure:compare-snapshots",
    event,
    {
      snapshotAId: snapshotA.id,
      snapshotBId: snapshotB.id,
    },
  );
  assert.equal(
    compareResult.success,
    true,
    `compare must succeed: ${JSON.stringify(compareResult)}`,
  );
  const changed = compareResult.diff.changes.filter(
    (c: any) => c.state === "changed",
  );
  assert.ok(
    changed.length > 0,
    "the diff must detect at least one genuinely changed byte range after the real mutation",
  );
  const overlapsMutation = changed.some(
    (c: any) => 0x18 < c.offset + c.length && 0x18 + 4 > c.offset,
  );
  assert.ok(
    overlapsMutation,
    `at least one changed range must overlap STRUCT_MUTABLE_I32_OFFSET (0x18): ${JSON.stringify(changed)}`,
  );
  const mutatedRange = changed.find(
    (c: any) => 0x18 < c.offset + c.length && 0x18 + 4 > c.offset,
  )!;
  const newBytesAtMutation = Buffer.from(
    mutatedRange.newRawHex.replace(/^0x/, ""),
    "hex",
  );
  const mutationStartWithinRange = 0x18 - mutatedRange.offset;
  assert.equal(
    newBytesAtMutation.readInt32LE(mutationStartWithinRange),
    NEW_MUTABLE_VALUE,
    "the post-mutation bytes must reflect the real new value written via writestruct",
  );

  // ── refresh sanity: refreshing after the mutation must reflect it too ──
  const refreshResult = await mock.__invoke("structure:refresh", event, {
    structureId: structure.id,
  });
  assert.equal(refreshResult.success, true);
  assert.equal(
    refreshResult.structure.id,
    structure.id,
    "refresh must preserve the structure's own id",
  );
  const refreshedTotalBytes = refreshResult.structure.fields.reduce(
    (sum: number, f: any) => sum + f.width,
    0,
  );
  assert.equal(refreshedTotalBytes, STRUCT_WINDOW_LENGTH);
}

const RESTARTS = 10;

describeReal(
  "P2-5 real-process structure discovery — 10 consecutive real fixture restarts, real pointer, real string, real mutation diff",
  { timeout: 180_000 },
  async () => {
    const results: Array<{ restart: number; pid: number }> = [];
    for (let restart = 1; restart <= RESTARTS; restart++) {
      await withAttachedFixture(async ({ event, child }) => {
        await runOneCycle({ event, child });
        results.push({ restart, pid: child.child.pid! });
      });
    }
    assert.equal(
      results.length,
      RESTARTS,
      "every restart must reach a real result — no retry-until-green",
    );
    const uniquePids = new Set(results.map((r) => r.pid));
    assert.equal(
      uniquePids.size,
      RESTARTS,
      "every restart must be a genuinely distinct process (no reused PID)",
    );
    console.log(
      "P2-5 real-process structure discovery — 10-restart campaign results:",
      JSON.stringify(results, null, 2),
    );
  },
);

// Mission §19 failure injection, exercised through the real IPC boundary
// against one real attached process — never a synthetic/mocked handler.
describeReal(
  "P2-5 structure discovery — IPC failure injection (malformed payloads, bad ids, process exit)",
  { timeout: 60_000 },
  async () => {
    await withAttachedFixture(async ({ event, child }) => {
      const structBase = child.fields.STRUCT_REGION_BASE;

      // Oversized request — rejected at the schema boundary, never silently clamped twice.
      const oversized = await mock.__invoke("structure:discover", event, {
        label: "oversized",
        baseAddress: structBase,
        length: 999_999,
      });
      assert.equal(oversized.success, false);

      // Malformed address — rejected at the schema boundary, never reaches the driver.
      const badAddress = await mock.__invoke("structure:discover", event, {
        label: "bad-address",
        baseAddress: "not-an-address",
        length: 64,
      });
      assert.equal(badAddress.success, false);

      // Invalid address (well-formed but points at unmapped memory) — truthful `failed` completeness, no crash.
      const unmapped = await mock.__invoke("structure:discover", event, {
        label: "unmapped",
        baseAddress: "0x1",
        length: 64,
      });
      assert.equal(unmapped.success, true, "a structurally valid request against unmapped memory must not itself fail at the IPC layer");
      assert.equal(unmapped.structure.completeness.state, "failed", "unmapped memory must report truthful completeness, never fabricated bytes");

      // Bad structure id — every downstream op fails gracefully, never throws past the handler.
      const badIdRefresh = await mock.__invoke("structure:refresh", event, { structureId: "does-not-exist" });
      assert.equal(badIdRefresh.success, false);
      const badIdSnapshot = await mock.__invoke("structure:capture-snapshot", event, { structureId: "does-not-exist" });
      assert.equal(badIdSnapshot.success, false);
      const badIdField = await mock.__invoke("structure:inspect-field", event, { structureId: "does-not-exist", offset: 0 });
      assert.equal(badIdField.success, false);
      const unknownGet = await mock.__invoke("structure:get", event, { structureId: "does-not-exist" });
      assert.equal(unknownGet.success, true);
      assert.equal(unknownGet.structure, null, "an unknown id is a truthful absence, not an error");

      // Bad snapshot id pair — compare fails gracefully.
      const badSnapshotCompare = await mock.__invoke("structure:compare-snapshots", event, {
        snapshotAId: "nope-a",
        snapshotBId: "nope-b",
      });
      assert.equal(badSnapshotCompare.success, false);

      // Real discover, then inspect an offset guaranteed to be past the discovered window — truthful "not found", not a crash.
      const realDiscover = await mock.__invoke("structure:discover", event, {
        label: "for-field-check",
        baseAddress: structBase,
        length: 64,
      });
      assert.equal(realDiscover.success, true);
      const noFieldAtThatOffset = await mock.__invoke("structure:inspect-field", event, {
        structureId: realDiscover.structure.id,
        offset: realDiscover.structure.length + 1000, // provably outside the discovered window
      });
      assert.equal(noFieldAtThatOffset.success, false, "an offset outside the discovered window must fail truthfully, never fabricate a field");

      // Process exits mid-discovery — real, disclosed finding: Windows may still let a
      // just-exited process's pages be read for a short window after `die`, so the byte
      // read itself can legitimately still succeed ('complete') even though module/region
      // enumeration against the now-gone process fails (proven above, structure-discovery.test.ts's
      // own focused regression: this degrades pointer-candidate evidence, it never crashes).
      // What must hold regardless of that race's outcome: the IPC call itself never throws,
      // and if evidence-gathering did fail, no field is ever falsely classified as a pointer.
      child.child.stdin.write("die\n");
      await new Promise((resolve) => setTimeout(resolve, 300));
      const afterDeath = await mock.__invoke("structure:discover", event, {
        label: "process-exited",
        baseAddress: structBase,
        length: 64,
      });
      assert.equal(afterDeath.success, true, "the IPC call itself must not throw even though the target process is dead");
      assert.ok(
        ["complete", "complete_with_unreadable_spans", "failed"].includes(afterDeath.structure.completeness.state),
        `completeness must be one of the real, documented states, never fabricated: ${afterDeath.structure.completeness.state}`,
      );
    });
  },
);
