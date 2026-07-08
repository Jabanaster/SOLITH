/**
 * Session-local cache for trainer addresses (in-memory, cleared on app close).
 * Stores discovered addresses per game per session so rapid re-scans aren't needed.
 */

interface CachedAddress {
  address: string;
  gameExecutable: string;
  dataType: string;
  lastRead: number;
  lastValue: number;
  timestamp: number;
}

class TrainerSessionCache {
  private cache = new Map<string, CachedAddress>();

  private keyFor(executable: string, dataType: string): string {
    return `${executable}:${dataType}`.toLowerCase();
  }

  store(executable: string, dataType: string, address: string, value: number): void {
    const key = this.keyFor(executable, dataType);
    this.cache.set(key, {
      address,
      gameExecutable: executable,
      dataType,
      lastRead: Date.now(),
      lastValue: value,
      timestamp: Date.now(),
    });
  }

  retrieve(executable: string, dataType: string): CachedAddress | undefined {
    const key = this.keyFor(executable, dataType);
    return this.cache.get(key);
  }

  clear(executable: string, dataType: string): void {
    const key = this.keyFor(executable, dataType);
    this.cache.delete(key);
  }

  clearAll(): void {
    this.cache.clear();
  }

  list(): CachedAddress[] {
    return Array.from(this.cache.values());
  }
}

export const trainerSessionCache = new TrainerSessionCache();
