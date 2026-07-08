/**
 * One-off manual exploration script — NOT part of `npm test`, NOT committed
 * as project history. READ-ONLY (never calls writeMemory).
 *
 * Same as explore-palworld-readonly.mts but with an explicit, larger
 * maxTotalBytes bound so the scan reaches further into a large process
 * footprint than the driver's 2 GiB default — needed because the default
 * scan truncated before reaching Palworld's actual gold address (confirmed
 * by a next-scan against the previous run's candidates: none of them changed
 * when gold changed in-game, meaning they were all coincidental matches on
 * unrelated data, not the real value).
 *
 * Run with: npx tsx scripts/explore-palworld-wide-scan.mts <exactValue> [maxTotalGiB]
 */
import { nativeMemoryDriver, listLiveMemoryProcesses } from '../src/core/live-memory/native-memory-driver.js';
import { scanFirst } from '../src/core/live-memory/memory-scanner.js';

const EXECUTABLE_NAME = 'Palworld-Win64-Shipping.exe';

async function main(): Promise<void> {
  const targetValueArg = process.argv[2];
  const targetValue = Number(targetValueArg);
  if (!Number.isFinite(targetValue)) {
    console.error('Usage: npx tsx scripts/explore-palworld-wide-scan.mts <exactValue> [maxTotalGiB]');
    process.exitCode = 1;
    return;
  }
  const maxTotalGiB = Number(process.argv[3] ?? '8');
  const maxTotalBytes = maxTotalGiB * 1024 * 1024 * 1024;

  const processes = listLiveMemoryProcesses();
  const match = processes.find((p) => p.name.toLowerCase() === EXECUTABLE_NAME.toLowerCase());
  if (!match) {
    console.error(`${EXECUTABLE_NAME} not found in running process list.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Found ${EXECUTABLE_NAME}, pid=${match.pid}`);
  console.log(`Scanning for exact int32 value ${targetValue}, budget ${maxTotalGiB} GiB...`);

  const handle = nativeMemoryDriver.openProcess(match.pid);
  try {
    const start = performance.now();
    const result = scanFirst(nativeMemoryDriver, handle, 'int32', targetValue, { maxTotalBytes });
    const elapsedMs = performance.now() - start;
    console.log(`Regions scanned: ${result.regionsScanned}`);
    console.log(`Bytes scanned: ${result.bytesScanned} (${(result.bytesScanned / (1024 * 1024 * 1024)).toFixed(2)} GiB)`);
    console.log(`Truncated: ${result.truncated}`);
    console.log(`Elapsed: ${elapsedMs.toFixed(0)}ms`);
    console.log(`Matches (${result.matches.length}):`);
    for (const m of result.matches.slice(0, 100)) {
      console.log(`  0x${m.address.toString(16)} = ${m.value}`);
    }
    if (result.matches.length > 100) {
      console.log(`  ... and ${result.matches.length - 100} more`);
    }
  } finally {
    nativeMemoryDriver.closeProcess(handle);
  }
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exitCode = 1;
});
