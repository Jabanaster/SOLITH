/**
 * Local append-only audit log for live-memory reads/writes.
 * Never phones home — file stays under Solith userData when a path is set.
 */

import fs from 'node:fs';
import path from 'node:path';

export type MemoryAuditOp =
  | 'read'
  | 'write'
  | 'rollback'
  | 'resolve'
  | 'attach'
  | 'abort'
  | 'scan'
  | 'freeze_proposed'
  | 'freeze_approved'
  | 'freeze_started'
  | 'freeze_stopped'
  | 'freeze_expired'
  | 'freeze_cleanup_failed';

export interface MemoryAuditEntry {
  at: string;
  op: MemoryAuditOp;
  featureId?: string;
  address?: string;
  valueType?: string;
  valueBefore?: number;
  valueAfter?: number;
  reason?: string;
  pid?: number;
  executableName?: string;
  /**
   * Trust Shift: when true, the operator had accepted the single-player /
   * private-play waiver and assumed local responsibility for the modification.
   */
  waiverAssumed?: boolean;
}

export interface MemoryAuditLogOptions {
  /** Optional absolute path to append JSONL lines. */
  filePath?: string;
  /** Ring-buffer size for in-memory recent() queries. */
  maxEntries?: number;
}

const DEFAULT_MAX = 500;

export class MemoryAuditLog {
  private readonly entries: MemoryAuditEntry[] = [];
  private readonly maxEntries: number;
  private readonly filePath?: string;

  constructor(options: MemoryAuditLogOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX;
    this.filePath = options.filePath;
  }

  append(entry: Omit<MemoryAuditEntry, 'at'> & { at?: string }): MemoryAuditEntry {
    const full: MemoryAuditEntry = {
      ...entry,
      at: entry.at ?? new Date().toISOString(),
    };
    this.entries.push(full);
    while (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    if (this.filePath) {
      try {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        fs.appendFileSync(this.filePath, `${JSON.stringify(full)}\n`, 'utf8');
      } catch {
        // Audit must never break trainer writes.
      }
    }
    return full;
  }

  recent(limit = 50): MemoryAuditEntry[] {
    if (limit <= 0) return [];
    return this.entries.slice(-limit);
  }

  clear(): void {
    this.entries.length = 0;
  }

  get size(): number {
    return this.entries.length;
  }
}
