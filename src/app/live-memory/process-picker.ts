import type { GameConfig } from '../../core/cheat-system/types.js';

export type ProcessPickerSort = 'az' | 'za' | 'confidence' | 'recent' | 'pid';
export type ProcessPickerGroup = 'current' | 'installed' | 'likely' | 'unknown';

export interface ProcessPickerProcess {
  pid: number;
  name: string;
  executablePath?: string;
  parentPid?: number;
  parentProcessName?: string;
  startTime?: string;
}

export interface ProcessPickerInstalledGame {
  id?: string;
  name?: string;
  path?: string;
  executablePath?: string | null;
}

export interface ProcessPickerOption {
  pid: number;
  processName: string;
  title: string;
  group: ProcessPickerGroup;
  confidence: number;
  matchedGameId: string | null;
  matchedBy: 'current-game' | 'installed-path' | 'installed-executable' | 'catalog-executable' | 'game-like-name' | 'unknown';
  executablePath?: string;
  parentPid?: number;
  parentProcessName?: string;
  startTime?: string;
  detectedOrdinal: number;
}

export interface BuildProcessPickerOptionsInput {
  processes: ProcessPickerProcess[];
  catalogGames: GameConfig[];
  installedGames?: ProcessPickerInstalledGame[];
  currentCatalogGameId?: string | null;
  showAllProcesses?: boolean;
  sort?: ProcessPickerSort;
  search?: string;
}

export const PROCESS_PICKER_GROUP_LABELS: Record<ProcessPickerGroup, string> = {
  current: 'Current game',
  installed: 'Installed games',
  likely: 'Likely games',
  unknown: 'Unknown processes',
};

const GROUP_ORDER: Record<ProcessPickerGroup, number> = {
  current: 0,
  installed: 1,
  likely: 2,
  unknown: 3,
};

const BLOCKED_PROCESS_PATTERNS = [
  /^solith/i,
  /^electron/i,
  /^explorer(?:\.exe)?$/i,
  /^runtimebroker(?:\.exe)?$/i,
  /^applicationframehost(?:\.exe)?$/i,
  /^textinputhost(?:\.exe)?$/i,
  /^startmenuexperiencehost(?:\.exe)?$/i,
  /^shellexperiencehost(?:\.exe)?$/i,
  /^systemsettings(?:\.exe)?$/i,
  /^taskmgr(?:\.exe)?$/i,
  /^dwm(?:\.exe)?$/i,
  /^winlogon(?:\.exe)?$/i,
  /^csrss(?:\.exe)?$/i,
  /^lsass(?:\.exe)?$/i,
  /^services(?:\.exe)?$/i,
  /^svchost(?:\.exe)?$/i,
];

const NON_GAME_PROCESS_PATTERNS = [
  /^node(?:\.exe)?$/i,
  /^npm(?:\.cmd|\.exe)?$/i,
  /^tsx(?:\.cmd|\.exe)?$/i,
  /^powershell(?:\.exe)?$/i,
  /^pwsh(?:\.exe)?$/i,
  /^cmd(?:\.exe)?$/i,
  /^conhost(?:\.exe)?$/i,
  /^search(host|indexer|protocolhost)(?:\.exe)?$/i,
  /^audiodg(?:\.exe)?$/i,
  /^steamwebhelper(?:\.exe)?$/i,
  /^epicgameslauncher(?:\.exe)?$/i,
  /^eadesktop(?:\.exe)?$/i,
  /^ubisoftconnect(?:\.exe)?$/i,
  /^rockstarservice(?:\.exe)?$/i,
  /^discord(?:\.exe)?$/i,
  /^chrome(?:\.exe)?$/i,
  /^msedge(?:\.exe)?$/i,
  /^firefox(?:\.exe)?$/i,
  /^code(?:\.exe)?$/i,
  /^cursor(?:\.exe)?$/i,
];

function normalizeExecutablePath(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\//g, '\\').toLowerCase();
}
function normalizeExecutableName(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/^.*[\\/]/, '')
    .toLowerCase();
}

function titleFromProcessName(name: string): string {
  return name
    .replace(/\.exe$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b(win64|shipping|x64|dx11|dx12)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || name;
}

function gameExecutables(game: GameConfig): string[] {
  return [game.executable, ...(game.aliases ?? [])].map(normalizeExecutableName).filter(Boolean);
}

function installedExecutableNames(installedGames: ProcessPickerInstalledGame[]): Map<string, ProcessPickerInstalledGame> {
  const map = new Map<string, ProcessPickerInstalledGame>();
  for (const game of installedGames) {
    const explicit = normalizeExecutableName(game.executablePath);
    if (explicit) map.set(explicit, game);

    const pathTail = normalizeExecutableName(game.path);
    if (pathTail.endsWith('.exe')) map.set(pathTail, game);
  }
  return map;
}

function isLikelyGameProcess(processName: string): boolean {
  const normalized = normalizeExecutableName(processName);
  if (
    !normalized ||
    BLOCKED_PROCESS_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    NON_GAME_PROCESS_PATTERNS.some((pattern) => pattern.test(normalized))
  ) {
    return false;
  }
  return /(win64|shipping|game|unity|ue4|ue5|client|launcher)/i.test(normalized);
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function compareWithinGroup(a: ProcessPickerOption, b: ProcessPickerOption, sort: ProcessPickerSort): number {
  if (sort === 'confidence') {
    return b.confidence - a.confidence || compareText(a.title, b.title) || compareText(a.processName, b.processName) || a.pid - b.pid;
  }
  if (sort === 'recent') {
    return b.detectedOrdinal - a.detectedOrdinal || compareText(a.title, b.title) || a.pid - b.pid;
  }
  if (sort === 'pid') {
    return a.pid - b.pid || compareText(a.title, b.title);
  }

  const titleCompare = compareText(a.title, b.title) || compareText(a.processName, b.processName) || a.pid - b.pid;
  return sort === 'za' ? -titleCompare : titleCompare;
}

export function buildProcessPickerOptions(input: BuildProcessPickerOptionsInput): ProcessPickerOption[] {
  const {
    processes,
    catalogGames,
    installedGames = [],
    currentCatalogGameId = null,
    showAllProcesses = false,
    sort = 'az',
    search = '',
  } = input;

  const currentGame = currentCatalogGameId
    ? catalogGames.find((game) => game.gameId === currentCatalogGameId) ?? null
    : null;
  const currentExecutables = new Set(currentGame ? gameExecutables(currentGame) : []);
  const installedByExecutable = installedExecutableNames(installedGames);
  const catalogByExecutable = new Map<string, GameConfig>();
  for (const game of catalogGames) {
    for (const executable of gameExecutables(game)) {
      catalogByExecutable.set(executable, game);
    }
  }

  const query = search.trim().toLowerCase();
  const options: ProcessPickerOption[] = [];

  processes.forEach((process, index) => {
    const processName = normalizeExecutableName(process.name);
    if (!processName || !Number.isInteger(process.pid) || process.pid <= 0) return;
    if (BLOCKED_PROCESS_PATTERNS.some((pattern) => pattern.test(processName))) return;

    const processPath = normalizeExecutablePath(process.executablePath);
    const exactInstalledGame = processPath
      ? installedGames.find((game) => normalizeExecutablePath(game.executablePath) === processPath) ?? null
      : null;
    const installedGame = exactInstalledGame ?? installedByExecutable.get(processName) ?? null;
    const catalogGame = catalogByExecutable.get(processName) ?? null;
    const currentMatch = currentExecutables.has(processName);

    let option: ProcessPickerOption;
    if (currentMatch && currentGame) {
      option = {
        pid: process.pid,
        processName: process.name,
        title: currentGame.name,
        group: 'current',
        confidence: 100,
        matchedGameId: currentGame.gameId,
        matchedBy: 'current-game',
        detectedOrdinal: index,
      };
    } else if (installedGame) {
      option = {
        pid: process.pid,
        processName: process.name,
        title: installedGame.name?.trim() || catalogGame?.name || titleFromProcessName(process.name),
        group: 'installed',
        confidence: exactInstalledGame ? 95 : 90,
        matchedGameId: installedGame.id ?? catalogGame?.gameId ?? null,
        matchedBy: exactInstalledGame ? 'installed-path' : 'installed-executable',
        detectedOrdinal: index,
      };
    } else if (catalogGame) {
      option = {
        pid: process.pid,
        processName: process.name,
        title: catalogGame.name,
        group: 'likely',
        confidence: 80,
        matchedGameId: catalogGame.gameId,
        matchedBy: 'catalog-executable',
        detectedOrdinal: index,
      };
    } else if (isLikelyGameProcess(process.name)) {
      option = {
        pid: process.pid,
        processName: process.name,
        title: titleFromProcessName(process.name),
        group: 'likely',
        confidence: 50,
        matchedGameId: null,
        matchedBy: 'game-like-name',
        detectedOrdinal: index,
      };
    } else {
      if (!showAllProcesses) return;
      option = {
        pid: process.pid,
        processName: process.name,
        title: titleFromProcessName(process.name),
        group: 'unknown',
        confidence: 10,
        matchedGameId: null,
        matchedBy: 'unknown',
        detectedOrdinal: index,
      };
    }

    if (
      query &&
      !option.title.toLowerCase().includes(query) &&
      !option.processName.toLowerCase().includes(query)
    ) {
      return;
    }
    options.push({ ...option, executablePath: process.executablePath, parentPid: process.parentPid, parentProcessName: process.parentProcessName, startTime: process.startTime });
  });

  return options.sort((a, b) => {
    const groupCompare = GROUP_ORDER[a.group] - GROUP_ORDER[b.group];
    if (groupCompare !== 0) return groupCompare;
    return compareWithinGroup(a, b, sort);
  });
}

export function groupProcessPickerOptions(options: ProcessPickerOption[]): Array<{
  group: ProcessPickerGroup;
  label: string;
  options: ProcessPickerOption[];
}> {
  const groups: Array<{ group: ProcessPickerGroup; label: string; options: ProcessPickerOption[] }> = [];
  for (const group of ['current', 'installed', 'likely', 'unknown'] as const) {
    const grouped = options.filter((option) => option.group === group);
    if (grouped.length > 0) {
      groups.push({ group, label: PROCESS_PICKER_GROUP_LABELS[group], options: grouped });
    }
  }
  return groups;
}

export function describeProcessMatch(option: ProcessPickerOption): string {
  const labels: Record<ProcessPickerOption['matchedBy'], string> = {
    'current-game': 'exact current target', 'installed-path': 'exact installed executable path',
    'installed-executable': 'installed executable name', 'catalog-executable': 'catalog executable name',
    'game-like-name': 'game-like process name', unknown: 'unclassified process',
  };
  return `${labels[option.matchedBy]} · ${option.confidence}% confidence`;
}

export function isSameProcessInstance(expected: ProcessPickerProcess, current: ProcessPickerProcess): boolean {
  if (expected.pid !== current.pid || expected.name.toLowerCase() !== current.name.toLowerCase()) return false;
  if (expected.startTime && current.startTime && expected.startTime !== current.startTime) return false;
  if (expected.executablePath && current.executablePath && normalizeExecutablePath(expected.executablePath) !== normalizeExecutablePath(current.executablePath)) return false;
  return true;
}