import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listLiveMemoryProcesses } from '../src/core/live-memory/native-memory-driver.ts';
import { analyzeAobRepairCandidatesReadOnly } from '../src/core/runtime/aob-repair-analyzer.ts';
import { openWindowsReadOnlyProcessSession } from '../src/core/runtime/windows-readonly-process-module-reader.ts';
import { loadRegistry } from '../src/core/registry/load-registry.ts';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function csvArg(name) {
  const raw = arg(name);
  if (!raw) return undefined;
  return raw.split(',').map((value) => value.trim()).filter(Boolean);
}

const registryPath = arg('registry');
const artifactPath = arg('artifact');
const pidArg = arg('pid');
const nameArg = arg('name');
const outputPath = arg('out') ?? path.join(process.cwd(), 'artifacts', 'signature-resolution', `aob-repair-candidates-${Date.now()}.json`);
const maxCandidatesArg = arg('max-candidates');
const maxObservedRefinementsArg = arg('max-observed-refinements');
const symbols = csvArg('symbols');

if (process.platform !== 'win32') {
  console.error('AOB repair candidate analysis is supported only on Windows.');
  process.exit(1);
}

if (!registryPath || !artifactPath || !pidArg || !nameArg) {
  console.error('Usage: npx tsx scripts/analyze-aob-repair-candidates.mjs --registry <registry.json> --artifact <signature-artifact.json> --pid <pid> --name <process.exe> [--symbols a,b] [--max-candidates 8] [--out report.json]');
  console.error('This command is read-only. It generates inert repair candidates only and never mutates registry data.');
  process.exit(1);
}

const pid = Number(pidArg);
if (!Number.isSafeInteger(pid) || pid <= 0) {
  console.error(`Invalid --pid value: ${pidArg}`);
  process.exit(1);
}

const maxCandidatesPerSignature = maxCandidatesArg == null ? undefined : Number(maxCandidatesArg);
if (maxCandidatesPerSignature != null && (!Number.isSafeInteger(maxCandidatesPerSignature) || maxCandidatesPerSignature < 0)) {
  console.error(`Invalid --max-candidates value: ${maxCandidatesArg}`);
  process.exit(1);
}

const maxObservedRefinementsPerCandidate = maxObservedRefinementsArg == null ? undefined : Number(maxObservedRefinementsArg);
if (
  maxObservedRefinementsPerCandidate != null &&
  (!Number.isSafeInteger(maxObservedRefinementsPerCandidate) || maxObservedRefinementsPerCandidate < 0)
) {
  console.error(`Invalid --max-observed-refinements value: ${maxObservedRefinementsArg}`);
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

const registry = await loadRegistry(registryPath);
const sourceArtifact = JSON.parse(await fs.readFile(artifactPath, 'utf8'));

const session = openWindowsReadOnlyProcessSession({
  pid,
  executableName: selected.name,
  executablePath: selected.path,
  selectedByUser: true,
});

try {
  const report = await analyzeAobRepairCandidatesReadOnly({
    registry,
    sourceArtifact,
    modules: session.getModules(),
    reader: session,
    maxCandidatesPerSignature,
    maxObservedRefinementsPerCandidate,
    symbols,
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    ok: true,
    readOnly: report.readOnly,
    executable: report.executable,
    reportPath: outputPath,
    totals: report.totals,
    uniqueCandidateSymbols: report.signatures
      .filter((signature) => signature.candidates.some((candidate) => candidate.status === 'candidate_unique_match'))
      .map((signature) => signature.symbol),
  }, null, 2));
} finally {
  session.close();
}
