/**
 * XML write capability: propose, execute (atomic), and rollback field writes.
 *
 * These three functions run inside the child process. They have no access to
 * the main-process approval gate — that gate lives in host-supervisor.ts.
 * The child is stateless: each call receives full params.
 *
 * Workflow enforced by caller (supervisor):
 *   1. proposeWriteField  — validate XML safety, verify current value matches
 *   2. (supervisor creates proposal + awaits explicit main-process approval)
 *   3. executeWriteField  — backup → validate → atomic write → verify
 *   4. rollbackWriteField — atomic restore from backup → verify
 */

import fs from 'fs';
import path from 'path';
import { XmlAdapter, validateXmlSafety } from '../adapters/xml';
import { validateJsonSaveFieldProposal } from '../saves/json-save-field';
import { assertPathSaveFormatSupportsOperation, detectSaveFormatFromPath } from '../saves/save-format';

// ── Shared helpers ────────────────────────────────────────────────────────────

const adapter = new XmlAdapter();

function unwrap(val: unknown): string | null {
  if (val === undefined || val === null) return null;
  if (Array.isArray(val) && val.length === 1) return String(val[0]);
  return String(val);
}

function assertValidParams(p: unknown, required: string[]): asserts p is Record<string, unknown> {
  if (typeof p !== 'object' || p === null) throw new Error('invalid_params: expected object');
  for (const key of required) {
    if (typeof (p as Record<string, unknown>)[key] !== 'string' || !(p as Record<string, unknown>)[key]) {
      throw new Error(`invalid_params: missing or empty "${key}"`);
    }
  }
}

// ── proposeWriteField ─────────────────────────────────────────────────────────

export interface ProposeWriteResult {
  valid: true;
  currentValue?: string;
  proposedValue?: string;
  preview?: string;
}

/**
 * Validates the write operation without touching the file.
 * Returns { valid: true } if:
 *   - file exists and passes XML safety checks
 *   - field exists
 *   - currentValue matches the live value in the file
 *
 * Throws with a descriptive error string on any failure.
 */
export async function proposeWriteField(params: unknown): Promise<ProposeWriteResult> {
  assertValidParams(params, ['filePath', 'field', 'currentValue', 'newValue']);
  const { filePath, field, currentValue } = params as Record<string, string>;

  if (!fs.existsSync(filePath)) throw new Error('file_not_found');
  assertPathSaveFormatSupportsOperation(filePath, 'save_field_propose');

  const format = detectSaveFormatFromPath(filePath);
  if (format === 'json') {
    const proposal = validateJsonSaveFieldProposal(filePath, field, currentValue, String((params as Record<string, string>).newValue));
    return {
      valid: true,
      currentValue: proposal.currentValue,
      proposedValue: proposal.proposedValue,
      preview: proposal.preview,
    };
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const safety = validateXmlSafety(raw);
  if (!safety.safe) throw new Error(`xml_safety: ${safety.error}`);

  const readResult = await adapter.readCurrentValue(filePath, field);
  if (!readResult.success) throw new Error(`read_error: ${readResult.error}`);

  const live = unwrap(readResult.value);
  if (live === null) throw new Error('field_not_found');
  if (live !== String(currentValue)) throw new Error(`value_mismatch: current=${live} expected=${currentValue}`);

  return { valid: true };
}

// ── executeWriteField ─────────────────────────────────────────────────────────

export interface ExecuteWriteResult {
  written: true;
  verifiedValue: string;
  backupPath: string;
}

/**
 * Backs up the file, applies an atomic write, then verifies the written value.
 * The supervisor must have already validated path approval and consumed the
 * pending proposal before calling this via RPC.
 *
 * Steps:
 *   1. Re-validate XML safety (defense-in-depth)
 *   2. Re-verify live currentValue hasn't changed since proposal
 *   3. Copy original → .trainer-backup
 *   4. Build modified XML content
 *   5. Validate output content
 *   6. Write to .trainer-tmp then rename atomically
 *   7. Read back verifiedValue
 */
export async function executeWriteField(params: unknown): Promise<ExecuteWriteResult> {
  assertValidParams(params, ['filePath', 'field', 'currentValue', 'newValue']);
  const { filePath, field, currentValue, newValue } = params as Record<string, string>;

  if (!fs.existsSync(filePath)) throw new Error('file_not_found');
  assertPathSaveFormatSupportsOperation(filePath, 'save_field_write');

  const raw = fs.readFileSync(filePath, 'utf-8');
  const safety = validateXmlSafety(raw);
  if (!safety.safe) throw new Error(`xml_safety: ${safety.error}`);

  // Re-verify live value (file may have changed since proposal)
  const readResult = await adapter.readCurrentValue(filePath, field);
  if (!readResult.success) throw new Error(`read_error: ${readResult.error}`);
  const live = unwrap(readResult.value);
  if (live === null) throw new Error('field_not_found');
  if (live !== String(currentValue)) {
    throw new Error(`value_changed_since_proposal: current=${live} expected=${currentValue}`);
  }

  // Backup
  const backupPath = filePath + '.trainer-backup';
  fs.copyFileSync(filePath, backupPath);

  // Build modified XML
  const buildResult = await adapter.buildOutput(filePath, field, newValue);
  if (!buildResult.success) throw new Error(`build_error: ${buildResult.error}`);

  // Validate before write
  const validation = await adapter.validateContent(buildResult.content, filePath);
  if (!validation.valid) throw new Error(`validation_failed: ${validation.error}`);

  // Atomic write: write temp then rename (same-volume rename is atomic on Windows)
  const tmpPath = filePath + '.trainer-tmp';
  fs.writeFileSync(tmpPath, buildResult.content, 'utf-8');
  fs.renameSync(tmpPath, filePath);

  // Verify
  const verifyResult = await adapter.readCurrentValue(filePath, field);
  if (!verifyResult.success) throw new Error(`verify_error: ${verifyResult.error}`);
  const verified = unwrap(verifyResult.value);
  if (verified === null) throw new Error('verify_field_not_found');

  return { written: true, verifiedValue: verified, backupPath };
}

// ── rollbackWriteField ────────────────────────────────────────────────────────

export interface RollbackResult {
  restored: true;
  verifiedValue: string;
}

/**
 * Restores the backup created by executeWriteField and verifies the field value.
 * Atomic: copies to .trainer-restore-tmp then renames.
 */
export async function rollbackWriteField(params: unknown): Promise<RollbackResult> {
  assertValidParams(params, ['filePath', 'backupPath', 'field']);
  const { filePath, backupPath, field } = params as Record<string, string>;

  const expectedBackupPath = path.resolve(filePath + '.trainer-backup');
  const resolvedBackupPath = path.resolve(backupPath);
  if (resolvedBackupPath.toLowerCase() !== expectedBackupPath.toLowerCase()) {
    throw new Error('backup_path_invalid');
  }
  if (path.dirname(resolvedBackupPath).toLowerCase() !== path.dirname(path.resolve(filePath)).toLowerCase()) {
    throw new Error('backup_path_invalid');
  }

  if (!fs.existsSync(backupPath)) throw new Error('backup_not_found');
  assertPathSaveFormatSupportsOperation(filePath, 'save_field_rollback');

  const tmpPath = path.join(path.dirname(filePath), path.basename(filePath) + '.trainer-restore-tmp');
  fs.copyFileSync(backupPath, tmpPath);
  fs.renameSync(tmpPath, filePath);

  // Validate restored file
  const raw = fs.readFileSync(filePath, 'utf-8');
  const safety = validateXmlSafety(raw);
  if (!safety.safe) throw new Error(`restored_xml_safety: ${safety.error}`);

  // Verify field value
  const verifyResult = await adapter.readCurrentValue(filePath, field);
  if (!verifyResult.success) throw new Error(`verify_error: ${verifyResult.error}`);
  const verified = unwrap(verifyResult.value);
  if (verified === null) throw new Error('verify_field_not_found_after_rollback');

  return { restored: true, verifiedValue: verified };
}
