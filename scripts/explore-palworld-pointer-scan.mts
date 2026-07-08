/**
 * One-off manual exploration script — NOT part of `npm test`, NOT committed
 * as project history. READ-ONLY (never calls writeMemory).
 *
 * Runs the reverse pointer scanner against each given target address to find
 * candidate module+offset chains, mirroring the Atomfall discovery process
 * in PROJECT_SPEC.md Section 42.1. Candidates found here still need a real
 * game restart to prove which (if any) are restart-stable — a raw scan
 * result alone does not confirm stability.
 *
 * Run with: npx tsx scripts/explore-palworld-pointer-scan.mts <addr1> [addr2] ...
 * (addresses as 0x-prefixed hex)
 */
import { nativeMemoryDriver, listLiveMemoryProcesses } from '../src/core/live-memory/native-memory-driver.js';
import { scanForPointerPath } from '../src/core/live-memory/pointer-scanner.js';

const EXECUTABLE_NAME = 'Palworld-Win64-Shipping.exe';

async function main(): Promise<void> {
  const addressArgs = process.argv.slice(2);
  if (addressArgs.length === 0) {
    console.error('Usage: npx tsx scripts/explore-palworld-pointer-scan.mts <addr1> [addr2] ...');
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

  const handle = nativeMemoryDriver.openProcess(match.pid);
  try {
    for (const addrStr of addressArgs) {
      const target = BigInt(addrStr);
      console.log(`\n--- Pointer scan for target 0x${target.toString(16)} ---`);
      const start = performance.now();
      const result = scanForPointerPath(nativeMemoryDriver, handle, target, {
        maxBytesPerScan: 6 * 1024 * 1024 * 1024,
        maxRegionBytes: 512 * 1024 * 1024,
      });
      const elapsedMs = performance.now() - start;
      console.log(`Levels searched: ${result.levelsSearched}, scans performed: ${result.scansPerformed}, truncated: ${result.truncated}, elapsed: ${elapsedMs.toFixed(0)}ms`);
      console.log(`Candidates (${result.candidates.length}):`);
      for (const c of result.candidates) {
        console.log(`  ${c.moduleName}+0x${c.moduleOffset.toString(16)} offsets=[${c.offsets.map((o) => '0x' + o.toString(16)).join(', ')}] depth=${c.depth}`);
      }
    }
  } finally {
    nativeMemoryDriver.closeProcess(handle);
  }
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exitCode = 1;
});
