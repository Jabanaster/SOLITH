export const TRAINER_CATEGORIES = [
  'ALL', 'PLAYER', 'INVENTORY', 'STATS', 'ENEMIES', 'GAME', 'UNLOCKS', 'VIDEO', 'VOICE', 'DISCOVERY'
] as const;

export const SOURCE_BADGES = [
  'SAVE', 'DATA', 'CONFIG', 'SCRIPT', 'DISCOVERED', 'RECIPE', 'LIVE-V2', 'BLOCKED'
] as const;

export const RISK_BADGES = ['Safe', 'Caution', 'Risky', 'Blocked'] as const;

export const STATUS_BADGES = [
  'Ready', 'Needs Discovery', 'Needs Rescan', 'Game Must Be Closed', 
  'V2 Live Mode', 'Blocked'
] as const;

export const SAFE_KEYWORDS = [
  'health', 'hp', 'stamina', 'mana', 'spirit', 'gold', 'money', 'coin', 'coins',
  'currency', 'credits', 'cash', 'quantity', 'amount', 'item_count', 'stack',
  'max_stack', 'ammo', 'damage', 'defense', 'armor', 'weight', 'price',
  'cooldown', 'xp', 'exp', 'experience', 'level', 'skill', 'skill_points',
  'attribute', 'stat', 'time', 'speed', 'day', 'hour', 'unlock', 'unlocked',
  'score', 'points', 'value', 'total', 'max', 'min'
] as const;

export const RISKY_KEYWORDS = [
  'id', 'guid', 'uuid', 'hash', 'checksum', 'signature', 'token', 'license',
  'entitlement', 'asset_path', 'prefab', 'class_name', 'script_ref',
  'internal_name', 'quest_id', 'dependency', 'version', 'build', 'crc',
  'encrypted', 'signed', 'flag', 'state', 'lock', 'session', 'auth'
] as const;

export const BLOCKED_KEYWORDS = [
  'anti', 'cheat', 'drm', 'license', 'key', 'token', 'auth', 'session',
  'multiplayer', 'online', 'network', 'server', 'cloud', 'steam', 'epic'
] as const;

export const SAVE_FOLDER_PATTERNS = [
  'saves', 'save', 'savegame', 'savegames', 'profiles', 'profile',
  'user', 'users', 'slots', 'autosave', 'checkpoints', 'persistent',
  'savedata', 'data', 'config', 'cfg'
] as const;

export const SAVE_FILE_EXTENSIONS = [
  '.sav', '.save', '.dat', '.json', '.xml', '.ini', '.cfg', '.txt',
  '.profile', '.slot', '.player', '.bin', '.slk'
] as const;

export const CONFIG_FILE_EXTENSIONS = [
  '.ini', '.cfg', '.conf', '.xml', '.json', '.txt'
] as const;

export const DATA_FILE_EXTENSIONS = [
  '.json', '.xml', '.csv', '.tsv', '.ini', '.cfg', '.conf', '.txt'
] as const;

export const ENGINE_INDICATORS = {
  unity: ['unity', '_data', 'globalgamemanagers', 'resources.assets', 'assembly-csharp'],
  unreal: ['unreal', '.pak', '.ucas', '.utoc', '.uasset', 'engine/binaries'],
  godot: ['godot', '.pck', 'project.binary', '.godot'],
  rpgmaker: ['rpgmaker', 'www/data', 'js/plugins', 'system.json', 'map'],
  renpy: ['renpy', 'game', '.rpa', '.rpy', '.rpyc']
} as const;

export const IGNORED_FOLDERS = [
  '.git', 'node_modules', 'cache', 'temp', 'logs', 'crashdumps',
  '.resourceforge', 'build', 'dist', 'obj', 'bin', 'out'
] as const;

export const SYSTEM_PATHS = [
  'c:\\', 'c:\\program files', 'c:\\program files (x86)', 'c:\\windows',
  'c:\\users\\', 'c:\\programdata', 'c:\\windows\\system32'
] as const;
