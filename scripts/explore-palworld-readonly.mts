/**
 * One-off manual exploration script — NOT part of `npm test`, NOT committed
 * as project history (throwaway, like the ad hoc real-game scans done
 * earlier for Stardew Valley / Atomfall — see PROJECT_SPEC.md Section 42.1).
 *
 * READ-ONLY. This script never calls writeMemory. It only:
 *   1. Measures real background network connections for the target process
 *      (informational — same evidence the online-session guard uses for
 *      writes, but no write is attempted here so the guard result does not
 *      gate anything in this script).
 *   2. Runs a first-scan for an exact int32 value across writable, committed
 *      memory regions.
 *
 * Run with: npx tsx scripts/explore-palworld-readonly.mts <exactValue>
 */
import { observeRemoteConnections } from '../src/core/live-memory/remote-connection-observer.js';
import { evaluateOnlineGuard } from '../src/core/live-memory/online-guard.js';
import { getConnectionBaseline } from '../src/core/live-memory/game-connection-baselines.js';
import { nativeMemoryDriver, listLiveMemoryProcesses } from '../src/core/live-memory/native-memory-driver.js';
import { scanFirst } from '../src/core/live-memory/memory-scanner.js';

const EXECUTABLE_NAME = 'Palworld-Win64-Shipping.exe';

async function main(): Promise<void> {
  const targetValueArg = process.argv[2];
  if (!targetValueArg) {
    console.error('Usage: npx tsx scripts/explore-palworld-readonly.mts <exactValue>');
    process.exitCode = 1;
    return;
  }
  const targetValue = Number(targetValueArg);
  if (!Number.isFinite(targetValue)) {
    console.error(`Not a number: ${targetValueArg}`);
    process.exitCode = 1;
    return;
  }

  const processes = listLiveMemoryProcesses();
  const match = processes.find((p) => p.name.toLowerCase() === EXECUTABLE_NAME.toLowerCase());
  if (!match) {
    console.error(`${EXECUTABLE_NAME} not found in running process list.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Found ${EXECUTABLE_NAME}, pid=${match.pid}`);

  console.log('\n--- Read-only network evidence (informational; no write attempted) ---');
  const evidence = await observeRemoteConnections(match.pid);
  console.log(evidence);
  const baseline = getConnectionBaseline(EXECUTABLE_NAME);
  const guard = evaluateOnlineGuard({
    userConfirmedOffline: true,
    remoteConnections: evidence,
    acceptedConnectionBaseline: baseline,
  });
  console.log(`Reviewed baseline for ${EXECUTABLE_NAME}: ${baseline}`);
  console.log(`If a write were attempted right now, the guard would say: ${JSON.stringify(guard)}`);

  console.log(`\n--- Read-only first scan for exact int32 value ${targetValue} ---`);
  const handle = nativeMemoryDriver.openProcess(match.pid);
  try {
    const result = scanFirst(nativeMemoryDriver, handle, 'int32', targetValue);
    console.log(`Regions scanned: ${result.regionsScanned}`);
    console.log(`Bytes scanned: ${result.bytesScanned}`);
    console.log(`Truncated: ${result.truncated}`);
    console.log(`Matches (${result.matches.length}):`);
    for (const m of result.matches.slice(0, 50)) {
      console.log(`  0x${m.address.toString(16)} = ${m.value}`);
    }
    if (result.matches.length > 50) {
      console.log(`  ... and ${result.matches.length - 50} more`);
    }
  } finally {
    nativeMemoryDriver.closeProcess(handle);
  }
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exitCode = 1;
});
