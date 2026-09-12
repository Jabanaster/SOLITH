#!/usr/bin/env node
/**
 * Mission 12/13 — dry-run recompile of the re-fetched legacy source repo
 * (Hexorg/CheatEngineTables, staged locally, never executed) through the
 * CURRENT compiler. Writes NOTHING to production shards/summary — output
 * goes to a throwaway temp directory only, printed and then discarded.
 *
 * Usage: node scripts/dry-run-recompile-legacy-source.mjs <staged-repo-root>
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import yazl from 'yazl';
import { compileCtZipArchive } from '../src/core/registry/compile-ct-zip.ts';
import { isGenericContainerName } from './lib/generic-container-names.mjs';

async function walk(dir, out) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
    } else if (/\.ct$/i.test(entry.name)) {
      out.push(full);
    }
  }
}

async function main() {
  const rootDir = process.argv[2];
  if (!rootDir) {
    console.error('Usage: node scripts/dry-run-recompile-legacy-source.mjs <staged-repo-root>');
    process.exit(1);
  }

  const files = [];
  await walk(rootDir, files);
  console.log(`[dry-run-recompile] found ${files.length} .CT files under ${rootDir}`);

  const zipfile = new yazl.ZipFile();
  let index = 0;
  for (const f of files) {
    const base = path.basename(f);
    zipfile.addFile(f, `Games/legacy-source-dryrun/${index}_${base}`);
    index += 1;
  }
  zipfile.end();

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'solith-dryrun-'));
  const zipPath = path.join(tempDir, 'staging.zip');
  const out = await fs.open(zipPath, 'w');
  await new Promise((resolve, reject) => {
    const ws = out.createWriteStream();
    zipfile.outputStream.pipe(ws);
    ws.on('close', resolve);
    ws.on('error', reject);
  });
  await out.close();

  console.log('[dry-run-recompile] compiling (this can take a while)...');
  const compiled = await compileCtZipArchive(zipPath, { tempRoot: tempDir, maxArchiveBytes: 2 * 1024 * 1024 * 1024 });
  console.log('[dry-run-recompile] totals:', JSON.stringify(compiled.totals));

  // Classify every pointer/aob/script cheat the same way ct-native-readiness-audit.mjs does.
  const buckets = {
    DIRECT: 0, MODULE_OFFSET: 0, POINTER: 0, AOB: 0,
    SCRIPT_DEPENDENT: 0, LUA: 0, UNSUPPORTED: 0, AMBIGUOUS: 0,
  };
  let nativeReady = 0;
  let compiledTables = 0;
  let rejectedTablesCount = 0;

  for (const table of compiled.tables) {
    compiledTables += 1;
    for (const cheat of table.cheats) {
      if (cheat.kind === 'pointer') {
        const lr = cheat.metadata?.liveResolution;
        if (lr === 'resolvable') {
          const chainLen = Array.isArray(cheat.metadata?.pointerChain) ? cheat.metadata.pointerChain.length : 0;
          buckets[chainLen > 0 ? 'POINTER' : 'MODULE_OFFSET'] += 1;
          nativeReady += 1;
        } else if (lr === 'absolute_only') {
          buckets.DIRECT += 1;
        } else {
          buckets.UNSUPPORTED += 1;
        }
      } else if (cheat.kind === 'script') {
        buckets[cheat.metadata?.scriptType === 'lua' ? 'LUA' : 'SCRIPT_DEPENDENT'] += 1;
      } else if (cheat.kind === 'aob') {
        buckets.AOB += 1;
      } else {
        buckets.AMBIGUOUS += 1;
      }
    }
  }
  rejectedTablesCount = compiled.rejected?.length ?? 0;

  console.log('[dry-run-recompile] compiled tables:', compiledTables, 'rejected tables:', rejectedTablesCount);
  console.log('[dry-run-recompile] classification:', JSON.stringify(buckets));
  console.log('[dry-run-recompile] native-ready records:', nativeReady);

  if (process.env.DRYRUN_KEEP_OUTPUT) {
    const outPath = process.env.DRYRUN_KEEP_OUTPUT;
    await fs.writeFile(outPath, JSON.stringify(compiled), 'utf8');
    console.log('[dry-run-recompile] full compiled index written to', outPath);
  }

  // Clean up temp dir — this is dry-run scratch, not a deliverable.
  await fs.rm(tempDir, { recursive: true, force: true });
}

main().catch((error) => {
  console.error('[dry-run-recompile] Failed:', error);
  process.exitCode = 1;
});
