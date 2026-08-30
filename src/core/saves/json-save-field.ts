import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMutationTransaction } from '../safety/mutation-transaction-service';

const MAX_JSON_SAVE_FILE_BYTES = 8 * 1024 * 1024;

/**
 * MP-P0.4 — durable root for this provider's backups/journal/receipts.
 *
 * host-supervisor.ts sets SOLITH_DURABLE_ROOT on the child process env before
 * spawning (see host-supervisor.ts's start()), sourced from getAppPaths()'s
 * real userData/durable directory. When unset (direct unit-test calls, or any
 * other caller that hasn't wired the env through yet) this falls back to a
 * process-wide temp location — durability isn't guaranteed in that case, but
 * the transaction is still safe (backup + journal + atomic replace still all
 * happen, just under a location that may not survive a full uninstall).
 */
function resolveDurableRoot(): string {
  return process.env.SOLITH_DURABLE_ROOT || path.join(os.tmpdir(), 'solith-durable-fallback');
}

export interface JsonSaveFieldReadResult {
  value: unknown;
  found: boolean;
}

export interface JsonSaveFieldProposal {
  currentValue: string;
  currentType: 'string' | 'number' | 'boolean';
  proposedValue: string;
  proposedTypedValue: string | number | boolean;
  preview: string;
}

function stripJsonComments(jsonString: string): string {
  return jsonString.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => g ? '' : m);
}

export function assertSimpleJsonFieldPath(field: string): string[] {
  const parts = field.split('.');
  if (
    parts.length === 0 ||
    parts.some(part => !/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(part))
  ) {
    throw new Error('json_field_path_unsupported: expected simple dot notation without arrays');
  }
  return parts;
}

export function readJsonDocument(filePath: string): unknown {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error('save_path_not_file');
  }
  if (stat.size > MAX_JSON_SAVE_FILE_BYTES) {
    throw new Error(`Save file is too large to parse safely (${stat.size} bytes > ${MAX_JSON_SAVE_FILE_BYTES} bytes; limit 8.0 MiB).`);
  }

  let raw = fs.readFileSync(filePath, 'utf-8');
  if (raw.charCodeAt(0) === 0xFEFF) {
    raw = raw.slice(1);
  }

  try {
    return JSON.parse(stripJsonComments(raw));
  } catch {
    throw new Error('json_parse_error: malformed JSON save data');
  }
}

export function readJsonSaveField(filePath: string, field: string): JsonSaveFieldReadResult {
  const parts = assertSimpleJsonFieldPath(field);
  let current = readJsonDocument(filePath);

  for (const part of parts) {
    if (
      current === null ||
      typeof current !== 'object' ||
      Array.isArray(current) ||
      !Object.prototype.hasOwnProperty.call(current, part)
    ) {
      return { value: null, found: false };
    }
    current = (current as Record<string, unknown>)[part];
  }

  if (current === undefined || typeof current === 'object') {
    return { value: null, found: false };
  }

  return { value: current, found: true };
}

function scalarType(value: unknown): 'string' | 'number' | 'boolean' | null {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return null;
}

function parseProposedScalar(rawValue: string, targetType: 'string' | 'number' | 'boolean'): string | number | boolean {
  if (targetType === 'string') return rawValue;
  if (targetType === 'number') {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      throw new Error('json_proposal_type_mismatch: proposed value must be a finite number');
    }
    return parsed;
  }
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error('json_proposal_type_mismatch: proposed value must be true or false');
}

export function validateJsonSaveFieldProposal(
  filePath: string,
  field: string,
  expectedCurrentValue: string,
  proposedValue: string,
): JsonSaveFieldProposal {
  const readResult = readJsonSaveField(filePath, field);
  if (!readResult.found) throw new Error('field_not_found');

  const currentType = scalarType(readResult.value);
  if (!currentType) {
    throw new Error('json_proposal_type_unsupported: only string, number, and boolean fields can be previewed');
  }

  const currentValue = String(readResult.value);
  if (currentValue !== String(expectedCurrentValue)) {
    throw new Error(`value_mismatch: current=${currentValue} expected=${expectedCurrentValue}`);
  }

  const proposedTypedValue = parseProposedScalar(String(proposedValue), currentType);
  return {
    currentValue,
    currentType,
    proposedValue: String(proposedValue),
    proposedTypedValue,
    preview: `Preview ${field}: ${currentValue} -> ${String(proposedValue)} (${currentType}; backup + atomic write on approval)`,
  };
}

export interface JsonSaveFieldWriteResult {
  verifiedValue: string;
  backupPath: string;
}

/**
 * MP-P0.4 — backs up the JSON file, applies a scalar field change, and verifies
 * the write, routed through MutationTransactionService for handle-based
 * authorization, durable backup/journal/receipt, and pre-commit revalidation.
 * Caller must have already validated the proposal (supervisor approval gate).
 *
 * External contract (parameters, return shape, and thrown error messages) is
 * unchanged from the pre-P0.4 implementation — existing callers and tests do
 * not need to change. What changed internally: the file's own directory now
 * acts as the sole authorized root (no wider game-root containment is enforced
 * here, since this function has never had that context — same as before), the
 * ad hoc `.trainer-backup`/`.trainer-tmp` siblings are replaced by durable,
 * hash-verified backup/journal/receipt records, and the target is
 * re-authorized (reparse-point + identity check) immediately before replace.
 */
export function writeJsonSaveField(
  filePath: string,
  field: string,
  expectedCurrentValue: string,
  proposedValue: string,
): JsonSaveFieldWriteResult {
  const proposal = validateJsonSaveFieldProposal(filePath, field, expectedCurrentValue, proposedValue);
  const parts = assertSimpleJsonFieldPath(field);

  const applyField = (original: Buffer): Buffer => {
    let raw = original.toString('utf-8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(stripJsonComments(raw)) as Record<string, unknown>;
    } catch {
      throw new Error('json_parse_error: malformed JSON save data');
    }

    let current: unknown = doc;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (
        current === null ||
        typeof current !== 'object' ||
        Array.isArray(current) ||
        !Object.prototype.hasOwnProperty.call(current, part)
      ) {
        throw new Error('field_not_found');
      }
      current = (current as Record<string, unknown>)[part];
    }

    const leaf = parts[parts.length - 1]!;
    if (
      current === null ||
      typeof current !== 'object' ||
      Array.isArray(current) ||
      !Object.prototype.hasOwnProperty.call(current, leaf)
    ) {
      throw new Error('field_not_found');
    }

    const live = String((current as Record<string, unknown>)[leaf]);
    if (live !== proposal.currentValue) {
      throw new Error(`value_changed_since_proposal: current=${live} expected=${proposal.currentValue}`);
    }

    (current as Record<string, unknown>)[leaf] = proposal.proposedTypedValue;
    return Buffer.from(`${JSON.stringify(doc, null, 2)}\n`, 'utf-8');
  };

  const receipt = runMutationTransaction({
    targetPath: filePath,
    approvedRoots: [path.dirname(filePath)],
    provider: 'json-save-field',
    durableRoot: resolveDurableRoot(),
    produceContent: applyField,
    validateContent: (produced) => {
      // Roundtrip parse requirement (plan §5.14): the produced bytes must
      // themselves be valid JSON before they are ever committed to the target.
      JSON.parse(produced.toString('utf-8'));
    },
  });

  const verify = readJsonSaveField(filePath, field);
  if (!verify.found) throw new Error('verify_field_not_found');
  const verifiedValue = String(verify.value);
  if (verifiedValue !== String(proposal.proposedTypedValue)) {
    throw new Error(`verify_mismatch: current=${verifiedValue} expected=${proposal.proposedTypedValue}`);
  }

  // write-save-field.ts's rollbackWriteField() (a separate, pre-existing code
  // path outside MutationTransactionService) validates backupPath by exact
  // sibling-suffix pattern: `${filePath}.trainer-backup`, same directory as
  // the target. Preserve that external contract by also depositing a copy of
  // the just-verified durable backup at the legacy sibling location — the
  // durable backup under receipt.backupPath remains the P0.4 audit trail.
  const legacyBackupPath = `${filePath}.trainer-backup`;
  fs.copyFileSync(receipt.backupPath, legacyBackupPath);

  return { verifiedValue, backupPath: legacyBackupPath };
}
