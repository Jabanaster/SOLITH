import type { NavSectionBehaviorMode } from '../../shared/types/index.js';

export type SectionCollapsedMap = Record<string, boolean>;

/** Parses the persisted remembered-section-state JSON, failing safe to an empty map on any malformed input. */
export function parseRememberedSectionState(raw: string | undefined | null): SectionCollapsedMap {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const result: SectionCollapsedMap = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'boolean') result[key] = value;
  }
  return result;
}

export function serializeRememberedSectionState(map: SectionCollapsedMap): string {
  return JSON.stringify(map);
}

export function toggleRememberedSection(map: SectionCollapsedMap, title: string): SectionCollapsedMap {
  return { ...map, [title]: !(map[title] ?? false) };
}

type CollapsedParams = {
  title: string;
  behaviorMode: NavSectionBehaviorMode;
  activeSectionTitle: string | null;
  remembered: SectionCollapsedMap;
};

/**
 * Deterministic collapse decision per section, given precedence:
 * 1. global behavior mode, 2. remembered per-section state, 3. safe default (expanded).
 */
export function isSectionCollapsed({ title, behaviorMode, activeSectionTitle, remembered }: CollapsedParams): boolean {
  if (behaviorMode === 'always-expand') return false;
  if (behaviorMode === 'always-collapse-inactive') {
    return activeSectionTitle !== null && title !== activeSectionTitle;
  }
  return remembered[title] ?? false;
}

export function canManuallyToggleSections(behaviorMode: NavSectionBehaviorMode): boolean {
  return behaviorMode === 'remember';
}
