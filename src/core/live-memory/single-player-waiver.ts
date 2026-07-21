/**
 * Local sticky single-player waiver store (no cloud).
 * Keyed by catalogGameId or executable name; session cache avoids re-prompts.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface WaiverRecord {
  acceptedAt: string;
  scopeKey: string;
}

export interface WaiverStoreFile {
  version: 1;
  byScope: Record<string, WaiverRecord>;
}

export class SinglePlayerWaiverStore {
  private sessionAccepted = new Set<string>();
  private file: WaiverStoreFile = { version: 1, byScope: {} };

  constructor(private readonly filePath?: string) {
    this.load();
  }

  private load(): void {
    if (!this.filePath) return;
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as WaiverStoreFile;
      if (raw?.version === 1 && raw.byScope && typeof raw.byScope === 'object') {
        this.file = raw;
      }
    } catch {
      // ignore corrupt store
    }
  }

  private save(): void {
    if (!this.filePath) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.file, null, 2), 'utf8');
    } catch {
      // never break trainer path
    }
  }

  isAccepted(scopeKey: string): boolean {
    const key = scopeKey.trim().toLowerCase();
    if (!key) return false;
    if (this.sessionAccepted.has(key)) return true;
    return Boolean(this.file.byScope[key]);
  }

  accept(scopeKey: string): WaiverRecord {
    const key = scopeKey.trim().toLowerCase() || 'global';
    const record: WaiverRecord = { acceptedAt: new Date().toISOString(), scopeKey: key };
    this.sessionAccepted.add(key);
    this.file.byScope[key] = record;
    this.save();
    return record;
  }

  /** Mark accepted for this process lifetime only (tests / one-shot). */
  acceptSessionOnly(scopeKey: string): void {
    this.sessionAccepted.add(scopeKey.trim().toLowerCase() || 'global');
  }
}

export const SINGLE_PLAYER_WAIVER_COPY =
  'Solith operates via direct memory manipulation. You are responsible for ensuring you are playing offline in single-player or private environments. Enable live modifications?';
