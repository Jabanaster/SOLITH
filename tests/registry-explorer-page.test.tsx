import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RegistryExplorerPage from '../src/app/pages/RegistryExplorerPage.tsx';
import type { CompiledCtRegistry } from '../src/core/registry/load-registry.ts';

const registry = {
  schemaVersion: '1.0.0',
  artifact: {
    schemaVersion: 1,
    generatedAt: '2026-07-20T00:00:00.000Z',
    source: { path: 'Avowed.CT', filename: 'Avowed.CT', sha256: 'a'.repeat(64) },
    counts: { pointers: 0, scripts: 1, aobSignatures: 1, rejections: 0, warnings: 0, duplicates: 0 },
  },
  game: 'Avowed',
  sourceFile: 'Avowed.CT',
  compiledAt: '2026-07-20T00:00:00.000Z',
  metadata: {
    totalPointers: 0,
    totalScripts: 1,
    rejectedPointers: 0,
    pointerImportErrors: 0,
    totalAobSignatures: 1,
    aobWarnings: 0,
    duplicateAobSignatures: 0,
  },
  pointers: { title: 'Avowed', catalogGameId: 'avowed', accepted: [], rejected: [], definition: {} as never, errors: [] },
  scripts: {
    title: 'Avowed',
    catalogGameId: 'avowed',
    sourceNote: 'metadata only',
    scripts: [{
      name: 'Health Script',
      path: 'Health Script',
      type: 'AutoAssembler_Script',
      script_excerpt: '[ENABLE]',
      raw_script_content: '[ENABLE]\naobscanmodule(playerHealth,Avowed-Win64-Shipping.exe,48 8B ??)\n[DISABLE]',
      executable: false,
    }],
  },
  aobSignatures: [{
    id: 'aob-playerhealth',
    symbol: 'playerHealth',
    scanType: 'aobscanmodule',
    module: 'Avowed-Win64-Shipping.exe',
    pattern: '48 8B ??',
    normalizedPattern: '48 8B ??',
    sourceEntryId: 'ct-script-0-health-script',
    sourceEntryDescription: 'Health Script',
    sourceScriptIndex: 0,
    lineNumber: 2,
    executable: false,
    warnings: [],
    completeness: 'complete',
    sourcePath: 'Health Script',
  }],
  rejections: [],
  pipeline: {
    $schema: 'https://solith.dev/schemas/ct-compiler-v1.2.0.json',
    schema_version: '1.2.0',
    compiled_at: '2026-07-20T00:00:00.000Z',
    source: {
      file: 'Avowed.CT',
      sha256: 'a'.repeat(64),
      kind: 'ct-file',
    },
    global_status: {
      certification_level: 'L0',
      verification_cycles_completed: 0,
      last_monitored_pid: null,
    },
    entries: [],
    aob_signatures: [{
      aob_id: 'aob-playerhealth',
      origin: 'ct-script-0-health-script',
      signature_type: 'script-extracted',
      pattern: '48 8B ??',
      module_target: 'Avowed-Win64-Shipping.exe',
      symbol: 'playerHealth',
      scan_type: 'aobscanmodule',
      line_number: 2,
      warnings: [],
    }],
    script_catalog_refs: [{
      script_id: 'ct-script-0-health-script',
      type: 'AutoAssembler_Script',
      catalog_storage_key: 'quarantine::ct-script-0-health-script::inert',
      excerpt: '[ENABLE]',
      rejection_flags: ['L0_UNVERIFIED', 'CONTAINS_AA'],
    }],
    rejections: [],
    warnings: [],
  },
} satisfies CompiledCtRegistry;

describe('RegistryExplorerPage', () => {
  test('renders a read-only overview and AOB detail', () => {
    const html = renderToStaticMarkup(<RegistryExplorerPage registry={registry} />);

    assert.match(html, /CT Registry Explorer/);
    assert.match(html, /Avowed\.CT/);
    assert.match(html, /playerHealth/);
    assert.match(html, /executable=false/);
    assert.match(html, /Zero-trust governance/);
    assert.match(html, /Quarantined script catalog/);
    assert.match(html, /Run Read-Only Verification/);
    assert.match(html, /Restart comparison/);
    assert.match(html, /Pointer L3 verified/);
    assert.match(html, /cannot promote rows into Live Watch/);
    assert.match(html, /Solith does not execute Auto Assembler text here/);
  });

  test('renders no-registry empty state with load affordance', () => {
    const html = renderToStaticMarkup(<RegistryExplorerPage />);

    assert.match(html, /No registry loaded/);
    assert.match(html, /Load compiled registry JSON/);
    assert.match(html, /display-only|does not execute/i);
  });
});
