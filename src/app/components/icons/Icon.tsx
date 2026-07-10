import React from 'react';

import activitySvg from './activity.svg?raw';
import applySvg from './apply.svg?raw';
import backupsSvg from './backups.svg?raw';
import blockedSvg from './blocked.svg?raw';
import cancelSvg from './cancel.svg?raw';
import cautionSvg from './caution.svg?raw';
import databaseSvg from './database.svg?raw';
import discoverySvg from './discovery.svg?raw';
import gameSvg from './game.svg?raw';
import logSvg from './log.svg?raw';
import refreshSvg from './refresh.svg?raw';
import safeSvg from './safe.svg?raw';
import saveSvg from './save.svg?raw';
import searchSvg from './search.svg?raw';
import settingsSvg from './settings.svg?raw';
import trainerSvg from './trainer.svg?raw';

const ICONS = {
  activity: activitySvg,
  apply: applySvg,
  backups: backupsSvg,
  blocked: blockedSvg,
  cancel: cancelSvg,
  caution: cautionSvg,
  database: databaseSvg,
  discovery: discoverySvg,
  game: gameSvg,
  log: logSvg,
  refresh: refreshSvg,
  safe: safeSvg,
  save: saveSvg,
  search: searchSvg,
  settings: settingsSvg,
  trainer: trainerSvg,
} as const;

export type IconName = keyof typeof ICONS;

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

/**
 * Vendored Tabler icon wrapper. Source SVGs use stroke="currentColor", so
 * they theme via CSS `color` like text. Rendered via dangerouslySetInnerHTML
 * because the source is a static, build-time-bundled, developer-authored
 * asset — not user input — so there is no injection risk (see
 * rules/react/security.md's audit checklist: source is fixed at build time,
 * never influenced by runtime/user data).
 */
export const Icon: React.FC<IconProps> = ({ name, size = 18, className }) => {
  const svg = ICONS[name].replace(
    /^<svg[\s>]/,
    (matched) => `<svg width="${size}" height="${size}"${matched.slice(4)}`,
  );
  return <span className={className} style={{ display: 'inline-flex', lineHeight: 0 }} dangerouslySetInnerHTML={{ __html: svg }} aria-hidden="true" />;
};
