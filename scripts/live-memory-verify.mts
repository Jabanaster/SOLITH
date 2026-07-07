/**
 * One-off manual verification script — NOT part of `npm test`.
 *
 * Spawns a real, separate Node child process holding a known value in a
 * dedicated (non-pooled) Buffer, then uses the actual product code
 * (nativeMemoryDriver, backed by the compiled `memoryjs` native addon) to
 * locate it via a byte-pattern scan and perform a genuine
 * ReadProcessMemory -> WriteProcessMemory -> ReadProcessMemory round trip
 * against that real OS process — not a fake/mock.
 *
 * Run with: npx tsx scripts/live-memory-verify.mts
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { nativeMemoryDriver } from '../src/core/live-memory/native-memory-driver.js';

const nodeRequire = createRequire(import.meta.url);
const memoryjs = nodeRequire('memoryjs');

const MAGIC = 'RESFORGELIVEMEM0'; // 16 ASCII bytes, unlikely to occur by chance
const INITIAL_VALUE = 123456;
const NEW_VALUE = 999999;

function toBytePattern(str: string): string {
  return Buffer.from(str, 'ascii')
    .toString('hex')
    .match(/../g)!
    .join(' ');
}

// Build the marker from numeric char codes rather than embedding the literal
// ASCII string in the child's source text: Node keeps the `-e` source string
// alive in process memory (e.g. for the module cache), so a literal copy of
// MAGIC in the source would give findPattern a second, wrong match to land
// on — the actual target Buffer isn't the only place those bytes appear.
const magicCodes = Array.from(Buffer.from(MAGIC, 'ascii'));

const childCode = `
  const buf = Buffer.allocUnsafeSlow(64);
  const codes = ${JSON.stringify(magicCodes)};
  for (let i = 0; i < codes.length; i++) buf.writeUInt8(codes[i], i);
  buf.writeInt32LE(${INITIAL_VALUE}, 16);
  console.log('READY ' + process.pid);
  // Keep the buffer referenced and the process alive until killed.
  setInterval(() => { if (buf.length < 0) console.log('unreachable'); }, 500);
`;

async function main(): Promise<void> {
  const child = spawn(process.execPath, ['-e', childCode], { stdio: ['ignore', 'pipe', 'inherit'] });

  const pid = await new Promise<number>((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error('child did not report READY in time')), 5000);
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
      const match = out.match(/READY (\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(parseInt(match[1], 10));
      }
    });
  });

  console.log(`Child test-target process started, pid=${pid}`);

  try {
    const pattern = toBytePattern(MAGIC);
    console.log(`Scanning for byte pattern: ${pattern}`);

    const rawHandle = memoryjs.openProcess(pid);
    const markerAddress: number = memoryjs.findPattern(rawHandle.handle, pattern, 0, 0);
    if (!markerAddress) throw new Error('Pattern not found in child process memory');
    memoryjs.closeProcess(rawHandle.handle);

    const valueAddress = BigInt(markerAddress) + 16n;
    console.log(`Marker found at 0x${markerAddress.toString(16)}, value address 0x${valueAddress.toString(16)}`);

    // Now exercise the ACTUAL product driver, not raw memoryjs.
    const handle = nativeMemoryDriver.openProcess(pid);

    const before = nativeMemoryDriver.readMemory(handle, valueAddress, 'int32');
    console.log(`Read before write: ${before} (expected ${INITIAL_VALUE})`);
    if (before !== INITIAL_VALUE) throw new Error(`Mismatch: expected ${INITIAL_VALUE}, got ${before}`);

    nativeMemoryDriver.writeMemory(handle, valueAddress, 'int32', NEW_VALUE);
    const after = nativeMemoryDriver.readMemory(handle, valueAddress, 'int32');
    console.log(`Read after write: ${after} (expected ${NEW_VALUE})`);
    if (after !== NEW_VALUE) throw new Error(`Mismatch: expected ${NEW_VALUE}, got ${after}`);

    nativeMemoryDriver.closeProcess(handle);

    console.log('PASS: real ReadProcessMemory/WriteProcessMemory round trip verified against a live process.');
  } finally {
    child.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exitCode = 1;
});
