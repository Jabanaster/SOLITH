import { listLiveMemoryProcesses } from '../src/core/live-memory/native-memory-driver.ts';
import {
  openWindowsReadOnlyProcessSession,
  WindowsReadOnlyAdapterError,
} from '../src/core/runtime/windows-readonly-process-module-reader.ts';

const TARGET_PROCESS_NAME = 'notepad.exe';
const PE_DOS_HEADER = [0x4d, 0x5a] as const;

function fail(message: string, details?: unknown): never {
  console.error(`[Solith harmless smoke] FAIL: ${message}`);
  if (details !== undefined) console.error(details);
  process.exit(1);
}

function formatError(error: unknown): string {
  if (error instanceof WindowsReadOnlyAdapterError) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

if (process.platform !== 'win32') {
  fail('This read-only process smoke test is supported only on Windows.');
}

const matches = listLiveMemoryProcesses().filter(
  (candidate) => candidate.name.toLowerCase() === TARGET_PROCESS_NAME,
);

if (matches.length !== 1) {
  fail(
    `Expected exactly one live ${TARGET_PROCESS_NAME} process for explicit PID selection; found ${matches.length}. Open one blank Notepad window and retry.`,
    JSON.stringify(matches.slice(0, 10), null, 2),
  );
}

const selected = matches[0];
if (!selected) fail(`No ${TARGET_PROCESS_NAME} process selected.`);

let session: ReturnType<typeof openWindowsReadOnlyProcessSession> | null = null;
let handleClosedCleanly = false;

try {
  session = openWindowsReadOnlyProcessSession({
    pid: selected.pid,
    executableName: TARGET_PROCESS_NAME,
    selectedByUser: true,
    platform: 'win32',
  });

  const modules = session.getModules();
  const baseModule = modules.find((module) => module.name.toLowerCase() === TARGET_PROCESS_NAME);
  if (!baseModule) {
    fail(`Could not find selected base module ${TARGET_PROCESS_NAME}.`, JSON.stringify(modules, null, 2));
  }
  if (baseModule.baseAddress <= 0n || baseModule.size < PE_DOS_HEADER.length) {
    fail(`Base module has invalid address or size: ${baseModule.name}.`);
  }

  const header = await session.readModuleBytes(baseModule, 0, PE_DOS_HEADER.length);
  const mzFound = header[0] === PE_DOS_HEADER[0] && header[1] === PE_DOS_HEADER[1];
  if (!mzFound) {
    fail(`Expected PE DOS header 4D 5A, read ${Array.from(header).map((byte) => byte.toString(16).padStart(2, '0')).join(' ').toUpperCase()}.`);
  }

  let outOfRangeRejected = false;
  try {
    await session.readModuleBytes(baseModule, baseModule.size, 1);
  } catch (error) {
    outOfRangeRejected = true;
    if (
      error instanceof WindowsReadOnlyAdapterError &&
      error.code !== 'invalid_address_range' &&
      error.code !== 'partial_read'
    ) {
      throw error;
    }
  }
  if (!outOfRangeRejected) fail('Out-of-range module read was not rejected.');

  session.close();
  handleClosedCleanly = true;

  console.log(JSON.stringify({
    ok: true,
    target: TARGET_PROCESS_NAME,
    pid: selected.pid,
    explicitlySelectedByPid: true,
    readOnly: true,
    writeApiInvoked: false,
    permissions: 'PROCESS_QUERY_INFORMATION | PROCESS_VM_READ via Solith read-only adapter',
    executableName: session.process.executableName,
    executablePath: session.process.executablePath ?? null,
    moduleCount: modules.length,
    baseModule: {
      name: baseModule.name,
      baseAddress: `0x${baseModule.baseAddress.toString(16)}`,
      size: baseModule.size,
    },
    mzHeaderFound: true,
    boundedToSelectedModule: true,
    outOfRangeRejected,
    handleClosedCleanly,
  }, null, 2));
} catch (error) {
  fail(formatError(error));
} finally {
  if (session && !handleClosedCleanly) {
    try {
      session.close();
      console.error('[Solith harmless smoke] Cleanup: process handle closed after failure.');
    } catch (error) {
      console.error(`[Solith harmless smoke] Cleanup failed: ${formatError(error)}`);
    }
  }
}
