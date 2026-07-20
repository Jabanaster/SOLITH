import { parseStringPromise } from 'xml2js';
import { slugifyGameId } from '../trainer-catalog/types.js';
import { analyzeAaScript } from './aa-script-analyzer.js';
import type {
  AaScriptAnalysis,
  CtRawScriptCatalog,
  CtRawScriptCatalogEntry,
  CtRawScriptType,
  CtScriptResearchReport,
} from './types.js';

function textValue(field: unknown): string {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  if (Array.isArray(field)) return String(field[0] ?? '');
  if (typeof field === 'object' && field !== null && '_' in (field as object)) {
    return String((field as { _: string })._);
  }
  return String(field);
}

function scriptFromEntry(record: Record<string, unknown>): string {
  return (
    textValue(record.AssemblerScript) ||
    textValue(record.AutoAssemblerScript) ||
    textValue(record.LuaScript)
  ).trim();
}

function rawScriptFromEntry(record: Record<string, unknown>): { content: string; type: CtRawScriptType } | null {
  const cheatScript = textValue(record.CheatScript).trim();
  if (cheatScript) return { content: cheatScript, type: 'CheatScript_Metadata' };

  const assemblerScript = (
    textValue(record.AssemblerScript) ||
    textValue(record.AutoAssemblerScript)
  ).trim();
  if (assemblerScript) return { content: assemblerScript, type: 'AutoAssembler_Script' };

  const luaScript = textValue(record.LuaScript).trim();
  if (luaScript) return { content: luaScript, type: 'Lua_Script' };

  return null;
}

function walkScripts(
  node: unknown,
  defaultExecutable: string,
  pathLabel = '',
  out: AaScriptAnalysis[] = [],
): void {
  if (!node || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  const desc = textValue(record.Description).replace(/^"|"$/g, '').trim();
  const script = scriptFromEntry(record);

  if (script && desc && script.length > 40) {
    const analysis = analyzeAaScript(pathLabel ? `${pathLabel} > ${desc}` : desc, script, defaultExecutable);
    if (analysis) out.push(analysis);
  }

  const children = record.CheatEntry;
  if (!children) return;
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    walkScripts(child, defaultExecutable, pathLabel ? `${pathLabel} > ${desc}` : desc, out);
  }
}

function walkRawScriptCatalog(
  node: unknown,
  pathLabel = '',
  out: CtRawScriptCatalogEntry[] = [],
): CtRawScriptCatalogEntry[] {
  if (!node || typeof node !== 'object') return out;
  const record = node as Record<string, unknown>;
  const desc = textValue(record.Description).replace(/^"|"$/g, '').trim();
  const currentPath = desc ? (pathLabel ? `${pathLabel} > ${desc}` : desc) : pathLabel;
  const raw = rawScriptFromEntry(record);

  if (raw && desc) {
    const scriptEntry: CtRawScriptCatalogEntry = {
      name: desc,
      path: currentPath,
      type: raw.type,
      script_excerpt: raw.content.slice(0, 500),
      raw_script_content: raw.content,
      executable: false,
    };
    const ctId = textValue(record.ID).trim();
    if (ctId) {
      scriptEntry.ctId = ctId;
    }
    out.push(scriptEntry);
  }

  const children = record.CheatEntry;
  if (children) {
    const list = Array.isArray(children) ? children : [children];
    for (const child of list) walkRawScriptCatalog(child, currentPath, out);
  }

  if (record.CheatEntries) walkRawScriptCatalog(record.CheatEntries, currentPath, out);

  return out;
}

function guessExecutable(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes('crimson desert')) return 'CrimsonDesert.exe';
  if (lower.includes('palworld')) return 'Palworld-Win64-Shipping.exe';
  return 'Game.exe';
}

export async function analyzeCheatTableScripts(
  xmlText: string,
  options: { title?: string; executable?: string } = {},
): Promise<CtScriptResearchReport> {
  const parsed = (await parseStringPromise(xmlText, { explicitArray: false, trim: true })) as Record<
    string,
    unknown
  >;
  const table = (parsed.CheatTable ?? parsed.cheatTable) as Record<string, unknown> | undefined;
  const title =
    options.title ??
    (textValue(table?.CheatTableTitle) ||
      textValue(table?.Title) ||
      'Cheat Table Script Research');
  const executable = options.executable ?? guessExecutable(title);
  const catalogGameId = slugifyGameId(title);

  const scripts: AaScriptAnalysis[] = [];
  if (table?.CheatEntries) walkScripts(table.CheatEntries, executable, '', scripts);

  const allSymbols = [...new Set(scripts.flatMap((s) => s.registeredSymbols))];

  const notes = [
    `Script Research Analyzer: ${scripts.length} AssemblerScript entries parsed.`,
    'Solith extracts AOB patterns and symbols only — scripts are never executed.',
    `${scripts.filter((s) => s.usesCodeInjection).length} scripts use code injection (reference-only).`,
  ];

  return {
    title,
    catalogGameId,
    executable,
    analyzedScripts: scripts.length,
    scripts,
    allSymbols,
    notes,
  };
}

export async function extractCheatTableRawScriptCatalog(
  xmlText: string,
  options: { title?: string; sourceNote?: string } = {},
): Promise<CtRawScriptCatalog> {
  const parsed = (await parseStringPromise(xmlText, { explicitArray: false, trim: true })) as Record<
    string,
    unknown
  >;
  const table = (parsed.CheatTable ?? parsed.cheatTable) as Record<string, unknown> | undefined;
  const title =
    options.title ??
    (textValue(table?.CheatTableTitle) ||
      textValue(table?.Title) ||
      'Cheat Table Script Catalog');
  const catalogGameId = slugifyGameId(title);
  const scripts: CtRawScriptCatalogEntry[] = [];
  if (table?.CheatEntries) walkRawScriptCatalog(table.CheatEntries, '', scripts);

  return {
    title,
    catalogGameId,
    sourceNote:
      options.sourceNote ??
      'Raw Cheat Engine script text extracted as inert Solith metadata. Scripts are never executed.',
    scripts,
  };
}

export function buildScriptResearchNotes(report: CtScriptResearchReport): string[] {
  const lines = [...report.notes];
  for (const script of report.scripts.slice(0, 8)) {
    if (script.aobScans[0]) {
      lines.push(`${script.cheatName}: AOB ${script.aobScans[0].symbol} → ${script.aobScans[0].patternSolith}`);
    }
    lines.push(`${script.cheatName}: strategy=${script.replicationStrategy}`);
  }
  if (report.scripts.length > 8) {
    lines.push(`…and ${report.scripts.length - 8} more analyzed scripts`);
  }
  return lines;
}
