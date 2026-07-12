import type { TrainerSyncSourceConfig } from '../types.js';

/** Verified third-party listing pages — metadata/definitions only, never .exe binaries */
export const TRAINER_SYNC_SOURCES: TrainerSyncSourceConfig[] = [
  {
    id: 'mrantifun',
    displayName: 'Community forum listings',
    baseUrl: 'https://mrantifun.net',
    listPath: '/forums/game-trainers.20/',
    enabled: true,
    definitionsOnly: true,
  },
  {
    id: 'fling',
    displayName: 'Community trainer index',
    baseUrl: 'https://flingtrainer.com',
    listPath: '/',
    enabled: true,
    definitionsOnly: true,
  },
  {
    id: 'plitch',
    displayName: 'Community game catalog',
    baseUrl: 'https://www.plitch.com',
    listPath: '/en/games',
    enabled: true,
    definitionsOnly: true,
  },
];

export function getEnabledSyncSources(): TrainerSyncSourceConfig[] {
  return TRAINER_SYNC_SOURCES.filter((s) => s.enabled);
}
