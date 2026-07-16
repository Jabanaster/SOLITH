#!/usr/bin/env node
/**
 * L3 live pointer certification harness — real memoryjs / ReadProcessMemory path.
 *
 * Bypasses FakeMemoryDriver. Attaches to a live Windows process, resolves a
 * schema.v1 memoryFeature pointer chain, reads, writes a safe test value, and
 * verifies the write.
 *
 * Usage (Atomfall bundled feature — default):
 *   npx tsx scripts/certify-live-pointer.mjs --process Atomfall_dx12.exe
 *
 * Custom definition JSON:
 *   npx tsx scripts/certify-live-pointer.mjs --process MyGame.exe --definition path.json --feature my-feature-id
 *
 * Restart verification ritual (human-in-the-loop):
 *   1. Run with game open (session A) — note PID + resolved address
 *   2. Fully quit game, relaunch (session B)
 *   3. Run again — pointer path must resolve; ammo read/write must still work
 *
 * Options:
 *   --process <exe>           Process executable name (required unless --pid)
 *   --pid <number>            Attach by PID (skips name lookup)
 *   --catalog-game-id <id>    Load bundled definition (default: atomfall)
 *   --feature <id>            Feature id (default: atomfall-current-weapon-ammo)
 *   --definition <path>       schema.v1 JSON file instead of bundled catalog id
 *   --write-value <n>         Safe test write value (default: 999)
 *   --no-write                Resolve + read only (no write probe)
 *   --restore                 Restore original value after write probe
 *   --session <label>         Log label for evidence capture (e.g. restart-A)
 *   --list-processes          Print matching processes and exit
 *
 * Exit 0 on PASS, 1 on FAIL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function ts() {
  return new Date().toISOString();
}

function log(step, message, extra = {}) {
  const line = { time: ts(), step, message, ...extra };
  console.log(JSON.stringify(line));
}

function parseArgs(argv) {
  const args = {
    process: null,
    pid: null,
    catalogGameId: 'atomfall',
    featureId: 'atomfall-current-weapon-ammo',
    definitionPath: null,
    writeValue: 999,
    noWrite: false,
    restore: true,
    session: 'live',
    listProcesses: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--process') args.process = argv[++i];
    else if (a === '--pid') args.pid = Number(argv[++i]);
    else if (a === '--catalog-game-id') args.catalogGameId = argv[++i];
    else if (a === '--feature') args.featureId = argv[++i];
    else if (a === '--definition') args.definitionPath = argv[++i];
    else if (a === '--write-value') args.writeValue = Number(argv[++i]);
    else if (a === '--no-write') args.noWrite = true;
    else if (a === '--no-restore') args.restore = false;
    else if (a === '--restore') args.restore = true;
    else if (a === '--session') args.session = argv[++i];
    else if (a === '--list-processes') args.listProcesses = true;
    else if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('Exit 0')[0]);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }

  return args;
}

function parseHexOffset(hex) {
  if (!hex) return 0;
  const normalized = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid hex offset: ${hex}`);
  }
  return value;
}

async function loadDefinition(args) {
  if (args.definitionPath) {
    const raw = JSON.parse(fs.readFileSync(path.resolve(args.definitionPath), 'utf-8'));
    return raw;
  }
  const seed = await import('../src/core/trainer-catalog/bundled-definition-seed.ts');
  const defs = seed.bundledDefinitionsForTests();
  const found = defs.find((d) => d.id === args.catalogGameId);
  if (!found) {
    throw new Error(`No bundled definition for catalog-game-id "${args.catalogGameId}"`);
  }
  return found;
}

function findProcessByName(processes, needle) {
  const n = needle.toLowerCase();
  return processes.filter((p) => p.name.toLowerCase() === n || p.name.toLowerCase().includes(n.replace(/\.exe$/i, '')));
}

/**
 * Verbose pointer resolution — logs each hop for L3 evidence capture.
 */
function resolvePointerPathVerbose(driver, handle, path) {
  const modules = driver.getModules(handle);
  const module = modules.find((m) => m.name.toLowerCase() === path.moduleName.toLowerCase());
  if (!module) {
    const loaded = modules.map((m) => m.name).sort();
    throw new Error(
      `Module "${path.moduleName}" not loaded. Loaded modules (${loaded.length}): ${loaded.slice(0, 20).join(', ')}${loaded.length > 20 ? '…' : ''}`,
    );
  }

  log('resolve.module', 'Located target module', {
    moduleName: module.name,
    moduleBase: `0x${module.baseAddress.toString(16)}`,
    moduleSize: module.size,
  });

  let address = module.baseAddress + BigInt(path.moduleOffset);
  log('resolve.static_slot', 'Module base + static offset', {
    moduleOffset: `0x${path.moduleOffset.toString(16)}`,
    staticAddress: `0x${address.toString(16)}`,
  });

  const chain = path.offsets ?? [];
  for (let i = 0; i < chain.length; i++) {
    const offset = chain[i];
    const pointerValue = driver.readPointer(handle, address);
    const next = pointerValue + BigInt(offset);
    log('resolve.deref', `Pointer chain step ${i + 1}/${chain.length}`, {
      readFrom: `0x${address.toString(16)}`,
      pointerValue: `0x${pointerValue.toString(16)}`,
      offset,
      resultAddress: `0x${next.toString(16)}`,
    });
    address = next;
  }

  log('resolve.final', 'Resolved value address', { address: `0x${address.toString(16)}` });
  return address;
}

function featureToPointerPath(feature) {
  const r = feature.resolution ?? {};
  if (!r.moduleName) throw new Error(`Feature "${feature.id}" missing resolution.moduleName`);
  if (!r.baseOffset) throw new Error(`Feature "${feature.id}" missing resolution.baseOffset`);
  return {
    moduleName: r.moduleName,
    moduleOffset: parseHexOffset(r.baseOffset),
    offsets: r.pointerChain ?? [],
  };
}

async function main() {
  const args = parseArgs(process.argv);

  const { nativeMemoryDriver, listLiveMemoryProcesses } = await import(
    '../src/core/live-memory/native-memory-driver.ts'
  );
  const { memoryDataTypeToLiveValue } = await import('../src/core/definitions/schema.v1.ts');

  log('session.start', 'L3 live pointer certification harness', {
    session: args.session,
    process: args.process,
    pid: args.pid,
    catalogGameId: args.catalogGameId,
    featureId: args.featureId,
    definitionPath: args.definitionPath,
    writeValue: args.writeValue,
    noWrite: args.noWrite,
    restore: args.restore,
  });

  const definition = await loadDefinition(args);
  const feature = (definition.memoryFeatures ?? []).find((f) => f.id === args.featureId);
  if (!feature) {
    throw new Error(`Feature "${args.featureId}" not found on definition "${definition.id}"`);
  }

  if (feature.type === 'scan_unknown' || feature.type === 'scan_first') {
    throw new Error(`Feature "${feature.id}" is ${feature.type} — cannot certify without prior discovery`);
  }

  log('feature.loaded', 'Using schema.v1 memory feature', {
    definitionId: definition.id,
    featureId: feature.id,
    featureName: feature.name,
    dataType: feature.dataType,
    certificationLevel: feature.certificationLevel ?? 'L0',
    resolution: feature.resolution,
  });

  const processes = listLiveMemoryProcesses();
  if (args.listProcesses) {
    const needle = args.process ?? 'atomfall';
    const matches = findProcessByName(processes, needle);
    log('process.list', `Processes matching "${needle}"`, { matches });
    process.exit(matches.length > 0 ? 0 : 1);
  }

  let pid = args.pid;
  if (!pid) {
    if (!args.process) {
      console.error('Provide --process <exe> or --pid <number>');
      process.exit(1);
    }
    const matches = findProcessByName(processes, args.process);
    if (matches.length === 0) {
      log('process.missing', `No running process matched "${args.process}"`, {
        hint: 'Launch the game into a live gameplay session, then rerun with --list-processes',
      });
      process.exit(1);
    }
    if (matches.length > 1) {
      log('process.ambiguous', 'Multiple processes matched — using first', { matches });
    }
    pid = matches[0].pid;
    log('process.selected', 'Attached target process', {
      pid,
      executable: matches[0].name,
    });
  }

  const handle = nativeMemoryDriver.openProcess(pid);
  const exeName = nativeMemoryDriver.getProcessExecutableName(handle);
  log('attach.ok', 'Opened process via memoryjs', { pid: handle.pid, executable: exeName });

  try {
    const pointerPath = featureToPointerPath(feature);
    const valueAddress = resolvePointerPathVerbose(nativeMemoryDriver, handle, pointerPath);
    const liveDataType = memoryDataTypeToLiveValue(feature.dataType);

    const originalValue = nativeMemoryDriver.readMemory(handle, valueAddress, liveDataType);
    log('read.before', 'Current live value at resolved address', {
      address: `0x${valueAddress.toString(16)}`,
      dataType: liveDataType,
      value: originalValue,
    });

    if (args.noWrite) {
      log('result.pass', 'Read-only certification PASS (no write probe)', {
        session: args.session,
        pid: handle.pid,
      });
      return;
    }

    nativeMemoryDriver.writeMemory(handle, valueAddress, liveDataType, args.writeValue);
    log('write.probe', 'Wrote safe test value', {
      address: `0x${valueAddress.toString(16)}`,
      dataType: liveDataType,
      wrote: args.writeValue,
    });

    const afterWrite = nativeMemoryDriver.readMemory(handle, valueAddress, liveDataType);
    log('read.after_write', 'Read-back after write probe', {
      address: `0x${valueAddress.toString(16)}`,
      value: afterWrite,
      expected: args.writeValue,
    });

    if (afterWrite !== args.writeValue) {
      log('result.fail', 'Write verification FAILED — read-back mismatch', {
        expected: args.writeValue,
        actual: afterWrite,
      });
      process.exit(1);
    }

    if (args.restore) {
      nativeMemoryDriver.writeMemory(handle, valueAddress, liveDataType, originalValue);
      const restored = nativeMemoryDriver.readMemory(handle, valueAddress, liveDataType);
      log('write.restore', 'Restored original value', {
        restoredValue: restored,
        originalValue,
      });
      if (restored !== originalValue) {
        log('result.warn', 'Restore read-back mismatch — verify in-game state manually', {
          expected: originalValue,
          actual: restored,
        });
      }
    }

    log('result.pass', 'L3 live pointer certification PASS', {
      session: args.session,
      pid: handle.pid,
      executable: exeName,
      definitionId: definition.id,
      featureId: feature.id,
      resolvedAddress: `0x${valueAddress.toString(16)}`,
      originalValue,
      probeValue: args.writeValue,
      restored: args.restore,
    });
  } finally {
    nativeMemoryDriver.closeProcess(handle);
    log('attach.close', 'Closed process handle', { pid: handle.pid });
  }
}

main().catch((err) => {
  log('result.fail', err instanceof Error ? err.message : String(err), { stack: err instanceof Error ? err.stack : undefined });
  process.exit(1);
});
