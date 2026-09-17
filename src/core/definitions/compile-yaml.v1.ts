import { parse as parseYaml } from 'yaml';
import { parseSolithDefinitionV1, validateSolithDefinitionV1, type SolithDefinitionV1 } from './schema.v1.js';
import { YAML_EXPORT_BANNER_LINES } from './export-yaml.v1.js';

export interface CompileYamlResult {
  success: true;
  definition: SolithDefinitionV1;
  payloadJson: string;
}

export interface CompileYamlError {
  success: false;
  errors: string[];
}

export type CompileYamlOutcome = CompileYamlResult | CompileYamlError;

const BANNER_COMMENT_TEXTS = new Set<string>(YAML_EXPORT_BANNER_LINES);

/**
 * Full-line `#` comments carry real evidence in Solith-exported YAML (see
 * export-yaml.v1.ts: discovery evidence, session-address notes, header
 * lines). The `yaml` parser already ignores comments per spec — they never
 * need to be stripped from the text before parsing — so this only exists to
 * recover them before they are gone. PD-05: this used to be destructive
 * (comments were deleted, never read); now every non-banner comment line is
 * captured for provenanceNotes instead of being silently discarded.
 */
function extractYamlComments(yamlText: string): string[] {
  const comments: string[] = [];
  for (const line of yamlText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('#')) continue;
    const text = trimmed.replace(/^#+\s?/, '');
    if (text && !BANNER_COMMENT_TEXTS.has(text)) {
      comments.push(text);
    }
  }
  return comments;
}

function normalizeParsedDefinition(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion === '1' || record.schemaVersion === 1) {
    record.schemaVersion = 1;
  }
  const features = record.memoryFeatures;
  if (Array.isArray(features)) {
    for (const feature of features) {
      if (!feature || typeof feature !== 'object') continue;
      const resolution = (feature as Record<string, unknown>).resolution;
      if (!resolution || typeof resolution !== 'object') continue;
      const baseOffset = (resolution as Record<string, unknown>).baseOffset;
      if (typeof baseOffset === 'number' && Number.isFinite(baseOffset)) {
        (resolution as Record<string, unknown>).baseOffset = `0x${baseOffset.toString(16)}`;
      }
    }
  }
  return record;
}

/**
 * Parse and validate YAML text into a schema.v1 definition object.
 */
export function compileYamlToDefinition(yamlText: string): CompileYamlOutcome {
  if (!yamlText.trim()) {
    return { success: false, errors: ['YAML input is empty.'] };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (err) {
    return {
      success: false,
      errors: [`YAML parse error: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { success: false, errors: ['YAML root must be a mapping/object.'] };
  }

  const normalized = normalizeParsedDefinition(parsed) as Record<string, unknown>;
  const discardedComments = extractYamlComments(yamlText);
  if (discardedComments.length > 0) {
    const existing = Array.isArray(normalized.provenanceNotes)
      ? (normalized.provenanceNotes as unknown[]).filter((n): n is string => typeof n === 'string')
      : [];
    normalized.provenanceNotes = [...existing, ...discardedComments];
  }

  const validationErrors = validateSolithDefinitionV1(normalized);
  if (validationErrors.length > 0) {
    return { success: false, errors: validationErrors };
  }

  try {
    const definition = parseSolithDefinitionV1(normalized);
    return {
      success: true,
      definition,
      payloadJson: compileDefinitionToPayload(definition),
    };
  } catch (err) {
    return {
      success: false,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }
}

/** Minified JSON payload suitable for SQLite `payloadJson` or distribution. */
export function compileDefinitionToPayload(definition: SolithDefinitionV1): string {
  return JSON.stringify(definition);
}

/**
 * O.3 entry point: validate YAML and return minified schema.v1 JSON.
 */
export function compileYamlToPayload(yamlText: string): CompileYamlOutcome {
  return compileYamlToDefinition(yamlText);
}
