/**
 * Extract all candidates from a wide scan and save to JSON for narrowing.
 */
import { nativeMemoryDriver, listLiveMemoryProcesses } from '../src/core/live-memory/native-memory-driver.js';
import { scanFirst } from '../src/core/live-memory/memory-scanner.js';

const EXECUTABLE_NAME = 'Palworld-Win64-Shipping.exe';

async function main(): Promise<void> {
  const targetValueArg = process.argv[2];
  if (!targetValueArg) {
    console.error('Usage: npx tsx scripts/explore-palworld-extract-all.mts <exactValue>');
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

  const handle = nativeMemoryDriver.openProcess(match.pid);
  try {
    console.log(`\nScanning for exact int32 value ${targetValue} (full 8 GiB)...`);
    const result = scanFirst(nativeMemoryDriver, handle, 'int32', targetValue, {
      maxBytesPerScan: 8 * 1024 * 1024 * 1024,
    });

    console.log(`Regions scanned: ${result.regionsScanned}`);
    console.log(`Bytes scanned: ${result.bytesScanned} (${(result.bytesScanned / (1024 * 1024 * 1024)).toFixed(2)} GiB)`);
    console.log(`Truncated: ${result.truncated}`);
    console.log(`Total matches: ${result.matches.length}`);

    const candidates = result.matches.map((m) => ({
      address: `0x${m.address.toString(16)}`,
      value: m.value,
    }));

    const output = {
      value: targetValue,
      timestamp: new Date().toISOString(),
      regionsScanned: result.regionsScanned,
      bytesScanned: result.bytesScanned,
      truncated: result.truncated,
      count: candidates.length,
      candidates,
    };

    console.log(JSON.stringify(output, null, 2));
  } finally {
    nativeMemoryDriver.closeProcess(handle);
  }
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exitCode = 1;
});
