import { useCallback, useMemo } from 'react';
import type { NavSectionBehaviorMode } from '../../shared/types/index.js';
import {
  canManuallyToggleSections,
  isSectionCollapsed,
  parseRememberedSectionState,
  serializeRememberedSectionState,
  toggleRememberedSection,
} from '../lib/navSectionState.js';

type Params = {
  activeSectionTitle: string | null;
  behaviorMode: NavSectionBehaviorMode;
  rememberedStateRaw: string;
  onPersistRememberedState: (raw: string) => void;
};

/** Encapsulates sidebar navigation-group collapse/expand behavior across the three behavior modes. */
export function useNavSectionState({
  activeSectionTitle,
  behaviorMode,
  rememberedStateRaw,
  onPersistRememberedState,
}: Params) {
  const remembered = useMemo(() => parseRememberedSectionState(rememberedStateRaw), [rememberedStateRaw]);
  const canManuallyToggle = canManuallyToggleSections(behaviorMode);

  const isCollapsed = useCallback(
    (title: string) => isSectionCollapsed({ title, behaviorMode, activeSectionTitle, remembered }),
    [behaviorMode, activeSectionTitle, remembered],
  );

  const toggleSection = useCallback(
    (title: string) => {
      if (!canManuallyToggle) return;
      const next = toggleRememberedSection(remembered, title);
      onPersistRememberedState(serializeRememberedSectionState(next));
    },
    [canManuallyToggle, remembered, onPersistRememberedState],
  );

  return { isCollapsed, toggleSection, canManuallyToggle };
}
