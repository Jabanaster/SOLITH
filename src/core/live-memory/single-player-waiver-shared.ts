export interface WaiverRecord {
  acceptedAt: string;
  scopeKey: string;
}

export interface WaiverStoreFile {
  version: 1;
  byScope: Record<string, WaiverRecord>;
}

export interface SinglePlayerWaiverStoreLike {
  isAccepted(scopeKey: string): boolean;
  accept(scopeKey: string): WaiverRecord;
  acceptSessionOnly(scopeKey: string): void;
}

export class SessionSinglePlayerWaiverStore implements SinglePlayerWaiverStoreLike {
  private readonly sessionAccepted = new Set<string>();

  isAccepted(scopeKey: string): boolean {
    const key = scopeKey.trim().toLowerCase();
    return key ? this.sessionAccepted.has(key) : false;
  }

  accept(scopeKey: string): WaiverRecord {
    const key = scopeKey.trim().toLowerCase() || 'global';
    const record: WaiverRecord = { acceptedAt: new Date().toISOString(), scopeKey: key };
    this.sessionAccepted.add(key);
    return record;
  }

  acceptSessionOnly(scopeKey: string): void {
    this.sessionAccepted.add(scopeKey.trim().toLowerCase() || 'global');
  }
}

export const SINGLE_PLAYER_WAIVER_COPY =
  'Solith operates via direct memory manipulation. You are responsible for ensuring you are playing offline in single-player or private environments. Enable live modifications?';
