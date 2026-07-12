/**
 * Advanced Scan Mode watch-list bookmarks (renderer localStorage).
 */

export interface WatchListBookmark {
  id: string;
  label: string;
  address: string;
  dataType: string;
  createdAt: string;
}

const STORAGE_KEY = 'solith.advanced-scan.watch-list';

function loadRaw(): WatchListBookmark[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WatchListBookmark[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRaw(bookmarks: WatchListBookmark[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
}

export function listWatchListBookmarks(): WatchListBookmark[] {
  return loadRaw().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addWatchListBookmark(
  bookmark: Omit<WatchListBookmark, 'id' | 'createdAt'>,
): WatchListBookmark {
  const entry: WatchListBookmark = {
    ...bookmark,
    id: `wl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  const next = [entry, ...loadRaw()].slice(0, 50);
  saveRaw(next);
  return entry;
}

export function removeWatchListBookmark(id: string): void {
  saveRaw(loadRaw().filter((b) => b.id !== id));
}

export function clearWatchListBookmarks(): void {
  saveRaw([]);
}
