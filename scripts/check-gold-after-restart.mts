import { nativeMemoryDriver, listLiveMemoryProcesses } from '../src/core/live-memory/native-memory-driver.js';

async function main() {
  const processes = listLiveMemoryProcesses();
  console.log('Found', Array.isArray(processes) ? processes.length : 0, 'processes');

  let pid = null;
  for (const p of processes) {
    if (p && p.name && p.name.includes('Palworld-Win64-Shipping')) {
      pid = p.pid;
      console.log(`Found Palworld pid=${pid}`);
      break;
    }
  }

  if (!pid) {
    console.error('Palworld not found');
    process.exitCode = 1;
    return;
  }

  console.log('Opening process handle...');
  const handle = nativeMemoryDriver.openProcess(pid);
  console.log('Process handle opened:', handle);

  try {
    const addr1 = BigInt('0x218f743a954');
    const addr2 = BigInt('0x218ff263f30');

    console.log('Reading from addr1...');
    const v1 = nativeMemoryDriver.readMemory(handle, addr1, 'int32');
    console.log('Reading from addr2...');
    const v2 = nativeMemoryDriver.readMemory(handle, addr2, 'int32');

    console.log(`0x${addr1.toString(16)} = ${v1}`);
    console.log(`0x${addr2.toString(16)} = ${v2}`);
  } finally {
    nativeMemoryDriver.closeProcess(handle);
  }
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exitCode = 1;
});
