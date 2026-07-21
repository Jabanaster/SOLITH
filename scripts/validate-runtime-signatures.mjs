import path from 'node:path';
import { listLiveMemoryProcesses } from '../src/core/live-memory/native-memory-driver.ts';
import { resolveRegistrySignaturesFromFileReadOnly } from '../src/core/runtime/signature-resolution.ts';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const registryPath = arg('registry');
const pidArg = arg('pid');
const nameArg = arg('name');
const outputPath = arg('out') ?? path.join(process.cwd(), 'artifacts', 'signature-resolution', `signature-resolution-${Date.now()}.json`);

if (process.platform !== 'win32') {
  console.error('Runtime signature validation is supported only on Windows.');
  process.exit(1);
}

if (!registryPath || !pidArg || !nameArg) {
  console.error('Usage: npm run runtime:validate-signatures -- --registry <registry.json> --pid <pid> --name <process.exe> [--out artifact.json]');
  console.error('This command is read-only and requires explicit PID + executable-name selection.');
  process.exit(1);
}

const pid = Number(pidArg);
if (!Number.isSafeInteger(pid) || pid <= 0) {
  console.error(`Invalid --pid value: ${pidArg}`);
  process.exit(1);
}

const matches = listLiveMemoryProcesses().filter((candidate) => candidate.pid === pid);
if (matches.length !== 1) {
  console.error(`Expected exactly one selected process for PID ${pid}, found ${matches.length}.`);
  process.exit(1);
}

const selected = matches[0];
if (selected.name.toLowerCase() !== String(nameArg).toLowerCase()) {
  console.error(`Selected PID ${pid} is ${selected.name}, expected ${nameArg}.`);
  process.exit(1);
}

const artifact = await resolveRegistrySignaturesFromFileReadOnly({
  registryPath,
  outputPath,
  process: {
    pid,
    executableName: selected.name,
    executablePath: selected.path,
    selectedByUser: true,
  },
});

console.log(JSON.stringify({
  ok: true,
  readOnly: artifact.readOnly,
  executable: artifact.executable,
  artifactPath: outputPath,
  process: artifact.process,
  registryId: artifact.registryId,
  summary: artifact.summary,
}, null, 2));
