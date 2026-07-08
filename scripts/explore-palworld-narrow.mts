/**
 * One-off manual exploration script — NOT part of `npm test`, NOT committed
 * as project history. READ-ONLY (never calls writeMemory).
 *
 * Reads a JSON candidate-address list (hex strings), re-reads each one, and
 * writes back only the addresses whose current value matches the given exact
 * value — narrowing the same file in place so repeated rounds don't require
 * re-editing source.
 *
 * Run with: npx tsx scripts/explore-palworld-narrow.mts <candidatesJsonPath> <exactValue>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { nativeMemoryDriver, listLiveMemoryProcesses } from '../src/core/live-memory/native-memory-driver.js';

const EXECUTABLE_NAME = 'Palworld-Win64-Shipping.exe';

async function main(): Promise<void> {
  const candidatesPath = process.argv[2];
  const targetValueArg = process.argv[3];
  const targetValue = Number(targetValueArg);
  if (!candidatesPath || !Number.isFinite(targetValue)) {
    console.error('Usage: npx tsx scripts/explore-palworld-narrow.mts <candidatesJsonPath> <exactValue>');
    process.exitCode = 1;
    return;
  }

  const rawAddresses: string[] = JSON.parse(readFileSync(candidatesPath, 'utf8'));
  const addresses = rawAddresses.map((a) => BigInt(a));

  const processes = listLiveMemoryProcesses();
  const match = processes.find((p) => p.name.toLowerCase() === EXECUTABLE_NAME.toLowerCase());
  if (!match) {
    console.error(`${EXECUTABLE_NAME} not found in running process list.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Found ${EXECUTABLE_NAME}, pid=${match.pid}`);
  console.log(`Re-checking ${addresses.length} candidate(s) against exact value ${targetValue}...`);

  const handle = nativeMemoryDriver.openProcess(match.pid);
  const kept: bigint[] = [];
  try {
    for (const address of addresses) {
      try {
        const current = nativeMemoryDriver.readMemory(handle, address, 'int32');
        if (current === targetValue) kept.push(address);
      } catch {
        // Address unmapped since last scan — drop it.
      }
    }
  } finally {
    nativeMemoryDriver.closeProcess(handle);
  }

  console.log(`Narrowed from ${addresses.length} to ${kept.length}:`);
  for (const a of kept) console.log(`  0x${a.toString(16)}`);

  writeFileSync(candidatesPath, JSON.stringify(kept.map((a) => `0x${a.toString(16)}`), null, 2) + '\n', 'utf8');
  console.log(`Wrote narrowed list back to ${candidatesPath}`);
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exitCode = 1;
});
