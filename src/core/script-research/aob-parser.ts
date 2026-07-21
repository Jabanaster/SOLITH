import type {
  AobCompleteness,
  AobScanType,
  AobSignatureExtractionReport,
  CtRawScriptCatalog,
  CtRawScriptCatalogEntry,
  ExtractedAobSignature,
} from './types.js';

const AOB_CALL_RE = /\b(aobscanmodule|aobscanregion|aobscan)\s*\(([^)]*)\)/gi;
const REGISTER_SYMBOL_RE = /\bregistersymbol\s*\(([^)]*)\)/gi;
const LABEL_DECL_RE = /^\s*([A-Za-z_][A-Za-z0-9_.$@]*):\s*(?:\/\/.*)?$/;
const LABEL_CALL_RE = /\blabel\s*\(([^)]*)\)/gi;

function splitCeArgs(rawArgs: string): string[] {
  return rawArgs
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeModule(moduleRaw: string | undefined): string | undefined {
  const moduleName = moduleRaw?.trim().replace(/^"+|"+$/g, '');
  if (!moduleName) return undefined;
  return moduleName;
}

function normalizeAobPattern(rawPattern: string): { pattern: string; warnings: string[]; completeness: AobCompleteness } {
  const warnings: string[] = [];
  const tokens = rawPattern.trim().split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    return { pattern: '', warnings: ['AOB pattern is empty.'], completeness: 'invalid' };
  }

  const normalized = tokens.map((token) => {
    if (/^[0-9a-fA-F]{2}$/.test(token)) return token.toUpperCase();
    if (/^\?+$/.test(token)) return '??';
    if (/^\*+$/.test(token)) return '*';

    warnings.push(`Invalid AOB token "${token}".`);
    return token;
  });

  const hasInvalidToken = warnings.length > 0;
  const hasConcreteByte = normalized.some((token) => /^[0-9A-F]{2}$/.test(token));
  const completeness: AobCompleteness = hasInvalidToken ? 'invalid' : hasConcreteByte ? 'complete' : 'partial';

  if (!hasConcreteByte) warnings.push('AOB pattern has no concrete byte tokens.');

  return {
    pattern: normalized.join(' '),
    warnings,
    completeness,
  };
}

function lineNumberForOffset(script: string, offset: number): number {
  return script.slice(0, offset).split(/\r?\n/).length;
}

function extractRegisteredSymbols(script: string): string[] {
  const symbols = new Set<string>();
  for (const match of script.matchAll(REGISTER_SYMBOL_RE)) {
    for (const part of match[1].split(/\s+/)) {
      const symbol = part.trim();
      if (symbol) symbols.add(symbol);
    }
  }
  return [...symbols];
}

function contextLines(lines: string[], lineNumber: number, radius = 12): string[] {
  const index = lineNumber - 1;
  return lines.slice(Math.max(0, index - radius), Math.min(lines.length, index + radius + 1));
}

function extractNearbyLabels(lines: string[]): string[] {
  const labels = new Set<string>();

  for (const line of lines) {
    const labelMatch = line.match(LABEL_DECL_RE);
    if (labelMatch) labels.add(labelMatch[1]);

    for (const callMatch of line.matchAll(LABEL_CALL_RE)) {
      for (const part of callMatch[1].split(/\s+/)) {
        const label = part.trim();
        if (label) labels.add(label);
      }
    }
  }

  return [...labels].slice(0, 24);
}

function extractNearbyOffsets(lines: string[], symbol: string): string[] {
  const offsets = new Set<string>();
  const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const symbolOffsetRe = new RegExp(`${escapedSymbol}\\s*\\+\\s*([0-9A-Fa-f]+)`, 'g');
  const memoryOffsetRe = /\[[^\]\r\n]+\+\s*(0x[0-9A-Fa-f]+|[0-9A-Fa-f]{2,})\]/g;
  const defineOffsetRe = /\bdefine\s*\(\s*[^,]+,\s*[^)+]+\+\s*([0-9A-Fa-f]+)\s*\)/gi;

  for (const line of lines) {
    for (const match of line.matchAll(symbolOffsetRe)) offsets.add(`+${match[1].toUpperCase()}`);
    for (const match of line.matchAll(memoryOffsetRe)) offsets.add(`+${match[1].toUpperCase().replace(/^0X/, '0x')}`);
    for (const match of line.matchAll(defineOffsetRe)) offsets.add(`+${match[1].toUpperCase()}`);
  }

  return [...offsets].slice(0, 24);
}

function parseAobCall(
  scanType: AobScanType,
  rawArgs: string,
): { symbol?: string; module?: string; rawPattern?: string; warnings: string[] } {
  const args = splitCeArgs(rawArgs);
  const warnings: string[] = [];

  if (scanType === 'aobscanmodule') {
    if (args.length < 3) warnings.push('aobscanmodule requires symbol, module, and pattern arguments.');
    return {
      symbol: args[0],
      module: normalizeModule(args[1]),
      rawPattern: args.slice(2).join(',').trim(),
      warnings,
    };
  }

  if (scanType === 'aobscanregion') {
    if (args.length < 4) warnings.push('aobscanregion requires symbol, start, end, and pattern arguments.');
    return {
      symbol: args[0],
      rawPattern: args.slice(3).join(',').trim(),
      warnings,
    };
  }

  if (args.length < 2) warnings.push('aobscan requires symbol and pattern arguments.');
  return {
    symbol: args[0],
    rawPattern: args.slice(1).join(',').trim(),
    warnings,
  };
}

export function extractAOBsFromScriptEntry(entry: CtRawScriptCatalogEntry): ExtractedAobSignature[] {
  const script = entry.raw_script_content;
  const lines = script.split(/\r?\n/);
  const registeredSymbols = extractRegisteredSymbols(script);
  const signatures: ExtractedAobSignature[] = [];

  for (const match of script.matchAll(AOB_CALL_RE)) {
    const scanType = match[1].toLowerCase() as AobScanType;
    const rawArgs = match[2];
    const lineNumber = lineNumberForOffset(script, match.index ?? 0);
    const parsed = parseAobCall(scanType, rawArgs);
    const pattern = normalizeAobPattern(parsed.rawPattern ?? '');
    const warnings = [...parsed.warnings, ...pattern.warnings];

    if (!parsed.symbol) warnings.push('AOB signature is missing a symbol name.');
    if (scanType === 'aobscanmodule' && !parsed.module) warnings.push('aobscanmodule signature is missing a module name.');
    if (scanType !== 'aobscanmodule' && !parsed.module) warnings.push(`${scanType} does not declare a module; resolution is process-wide or region-bound.`);

    const nearby = contextLines(lines, lineNumber);
    const completeness: AobCompleteness =
      warnings.some((warning) => /^Invalid|AOB pattern is empty|AOB signature is missing|aobscan.*requires/i.test(warning))
        ? 'invalid'
        : pattern.completeness === 'complete' && (scanType !== 'aobscanmodule' || parsed.module)
          ? 'complete'
          : 'partial';

    signatures.push({
      symbol: parsed.symbol ?? '',
      module: parsed.module,
      pattern: pattern.pattern,
      rawPattern: parsed.rawPattern ?? '',
      scanType,
      sourceEntry: entry.name,
      sourcePath: entry.path,
      sourceScriptType: entry.type,
      lineNumber,
      executable: false,
      nearbyLabels: extractNearbyLabels(nearby),
      nearbyOffsets: extractNearbyOffsets(nearby, parsed.symbol ?? ''),
      registeredSymbols: registeredSymbols.filter((symbol) => symbol === parsed.symbol),
      warnings,
      completeness,
    });
  }

  return signatures;
}

export function extractAOBsFromCatalog(
  catalog: CtRawScriptCatalog,
  options: { extractedAt?: string } = {},
): AobSignatureExtractionReport {
  const signatures = catalog.scripts.flatMap(extractAOBsFromScriptEntry);
  const seen = new Map<string, string>();
  let duplicateSignatures = 0;

  for (const signature of signatures) {
    const key = `${signature.scanType}|${signature.module ?? ''}|${signature.pattern}`;
    const firstSymbol = seen.get(key);
    if (firstSymbol && firstSymbol !== signature.symbol) {
      signature.duplicateOf = firstSymbol;
      signature.warnings.push(`Duplicate signature pattern already used by "${firstSymbol}".`);
      duplicateSignatures += 1;
    } else {
      seen.set(key, signature.symbol);
    }
  }

  const warnings = signatures.flatMap((signature) =>
    signature.warnings.map((warning) => `${signature.sourceEntry}:${signature.lineNumber} ${warning}`),
  );

  return {
    sourceTitle: catalog.title,
    extractedAt: options.extractedAt ?? new Date().toISOString(),
    totalScripts: catalog.scripts.length,
    totalSignatures: signatures.length,
    duplicateSignatures,
    signatures,
    warnings,
  };
}
