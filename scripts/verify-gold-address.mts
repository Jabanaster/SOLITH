import { nativeMemoryDriver, listLiveMemoryProcesses } from '../src/core/live-memory/native-memory-driver.js';

const processes = listLiveMemoryProcesses();
const match = processes.find(p => p.name.toLowerCase() === 'Palworld-Win64-Shipping.exe'.toLowerCase());

if (!match) {
  console.error('Palworld not found');
  process.exitCode = 1;
} else {
  const handle = nativeMemoryDriver.openProcess(match.pid);
  try {
    const addr = BigInt('0x1bcd12ad354');
    const value = nativeMemoryDriver.readMemory(handle, addr, 'int32');
    console.log(`0x${addr.toString(16)} = ${value}`);
  } finally {
    nativeMemoryDriver.closeProcess(handle);
  }
}
