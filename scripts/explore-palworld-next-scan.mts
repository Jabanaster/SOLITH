/**
 * One-off manual exploration script — NOT part of `npm test`, NOT committed
 * as project history. READ-ONLY: re-reads a fixed candidate address list and
 * reports which ones now equal the given exact value. No writeMemory call.
 *
 * Run with: npx tsx scripts/explore-palworld-next-scan.mts <exactValue>
 */
import { nativeMemoryDriver, listLiveMemoryProcesses } from '../src/core/live-memory/native-memory-driver.js';
import { scanNext } from '../src/core/live-memory/memory-scanner.js';
import type { ScanMatch } from '../src/core/live-memory/types.js';

const EXECUTABLE_NAME = 'Palworld-Win64-Shipping.exe';

// Candidates from the post-restart first-scan (fresh PID 26316, exact value 75410).
const PRIOR_MATCHES: ScanMatch[] = [
  { address: 0x21840574850n, value: 75410 },
  { address: 0x218405f2a14n, value: 75410 },
  { address: 0x2184a65ed4cn, value: 75410 },
  { address: 0x2187f949d50n, value: 75410 },
  { address: 0x2188947ca6cn, value: 75410 },
  { address: 0x2189fd430bcn, value: 75410 },
  { address: 0x218d3eb1b30n, value: 75410 },
];

async function main(): Promise<void> {
  const targetValueArg = process.argv[2];
  const targetValue = Number(targetValueArg);
  if (!Number.isFinite(targetValue)) {
    console.error('Usage: npx tsx scripts/explore-palworld-next-scan.mts <exactValue>');
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
    console.log('Raw current reads at each prior candidate (diagnostic):');
    for (const prior of PRIOR_MATCHES) {
      try {
        const current = nativeMemoryDriver.readMemory(handle, prior.address, 'int32');
        console.log(`  0x${prior.address.toString(16)}: was ${prior.value}, now ${current}`);
      } catch (err) {
        console.log(`  0x${prior.address.toString(16)}: READ FAILED (${String(err).slice(0, 80)})`);
      }
    }

    const kept = scanNext(nativeMemoryDriver, handle, 'int32', { kind: 'exact', value: targetValue }, PRIOR_MATCHES);
    console.log(`\nNarrowed to ${kept.length} candidate(s) matching exact value ${targetValue}:`);
    for (const m of kept) {
      console.log(`  0x${m.address.toString(16)} = ${m.value}`);
    }
  } finally {
    nativeMemoryDriver.closeProcess(handle);
  }
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exitCode = 1;
});
