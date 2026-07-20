import { listLiveMemoryProcesses } from '../src/core/live-memory/native-memory-driver.ts';
import { openWindowsReadOnlyProcessSession } from '../src/core/runtime/windows-readonly-process-module-reader.ts';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const pidArg = arg('pid');
const nameArg = arg('name');

if (process.platform !== 'win32') {
  console.error('Windows read-only runtime smoke test is supported only on Windows.');
  process.exit(1);
}

if (!pidArg && !nameArg) {
  console.error('Usage: npx tsx scripts/smoke-windows-readonly-runtime.mjs --pid <pid> [--name node.exe]');
  console.error('       npx tsx scripts/smoke-windows-readonly-runtime.mjs --name <process.exe>');
  process.exit(1);
}

const processes = listLiveMemoryProcesses();
const matches = pidArg
  ? processes.filter((process) => process.pid === Number(pidArg))
  : processes.filter((process) => process.name.toLowerCase() === String(nameArg).toLowerCase());

if (matches.length !== 1) {
  console.error(`Expected exactly one selected process, found ${matches.length}.`);
  console.error(JSON.stringify(matches.slice(0, 10), null, 2));
  process.exit(1);
}

const selected = matches[0];
const expectedName = nameArg ?? selected.name;
const session = openWindowsReadOnlyProcessSession({
  pid: selected.pid,
  executableName: expectedName,
  selectedByUser: true,
});

let closedCleanly = false;
try {
  const modules = session.getModules();
  if (modules.length === 0) throw new Error('No modules enumerated.');
  const main = modules.find((module) => module.name.toLowerCase() === expectedName.toLowerCase()) ?? modules[0];
  if (main.baseAddress <= 0n || main.size <= 0) throw new Error('Selected module has invalid base address or size.');
  const boundedReadLength = Math.min(64, main.size);
  const bytes = await session.readModuleBytes(main, 0, boundedReadLength);
  let outOfRangeRejected = false;
  try {
    await session.readModuleBytes(main, main.size, 1);
  } catch {
    outOfRangeRejected = true;
  }
  if (!outOfRangeRejected) throw new Error('Out-of-range module read was not rejected.');

  session.close();
  closedCleanly = true;
  console.log(JSON.stringify({
    ok: true,
    pid: selected.pid,
    explicitlySelectedByPid: Boolean(pidArg),
    executableName: session.process.executableName,
    expectedExecutableName: expectedName,
    executablePath: session.process.executablePath ?? null,
    moduleCount: modules.length,
    firstModule: {
      name: main.name,
      baseAddress: `0x${main.baseAddress.toString(16)}`,
      size: main.size,
    },
    boundedToSelectedModule: true,
    bytesRead: bytes.length,
    knownByteRangeRead: bytes.length > 0,
    outOfRangeRejected,
    handleClosedCleanly: closedCleanly,
    writeApiInvoked: false,
    permissions: 'PROCESS_QUERY_INFORMATION | PROCESS_VM_READ via patched memoryjs source',
    readOnly: true,
  }, null, 2));
} finally {
  if (!closedCleanly) session.close();
}
