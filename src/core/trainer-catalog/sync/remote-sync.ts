import type { ModPack, TrainerCatalogEntry } from '../types.js';
import { slugifyGameId, steamCdnImages } from '../types.js';
import type { ParsedRemoteTrainer } from './parse-html.js';
import {
  parseTrainerListHtml,
  parseRemoteTrainerIndexHtml,
  parseRemoteGameCatalogHtml,
} from './parse-html.js';
import type { TrainerSyncSourceConfig } from '../types.js';
import { getFlingReference } from '../../cheat-system/trainer-reference.js';
import { evaluate, type AuthorityRequest } from '../../authority/index.js';

const FETCH_TIMEOUT_MS = 20_000;
const USER_AGENT = 'Solith-TrainerCatalog/1.0 (+local definitions sync; no binary download)';
const MAX_HTML_REDIRECTS = 5;
const MAX_HTML_RESPONSE_BYTES = 8 * 1024 * 1024;

export interface SyncImportResult {
  provider: string;
  imported: number;
  skipped: number;
  errors: string[];
  trainers: ParsedRemoteTrainer[];
}

// Finding R1 (independent security review, d3397bb): every redirect hop is a
// new outbound network target and must be revalidated, not just counted and
// size-capped. Strict same-host, HTTPS-only policy: a redirect is only
// followed if it stays on the exact hostname of the original request. Since
// the 3 configured sources are fixed, non-renderer-controlled hostnames, this
// makes a separate private-network/loopback denylist redundant here — a
// compromised source host cannot redirect off its own hostname to pivot
// anywhere else (localhost, RFC1918, link-local, or an unrelated public
// host), so there is no host it could redirect to that isn't itself.
export function validateRedirectTarget(location: string, currentUrl: string, allowedHost: string): URL {
  let target: URL;
  try {
    target = new URL(location, currentUrl);
  } catch {
    throw new Error(`Redirect from ${currentUrl} had a malformed Location header`);
  }
  if (target.protocol !== 'https:') {
    throw new Error(`Redirect from ${currentUrl} to disallowed scheme "${target.protocol}" rejected`);
  }
  if (target.username || target.password) {
    throw new Error(`Redirect from ${currentUrl} carrying embedded credentials rejected`);
  }
  if (target.hostname.toLowerCase() !== allowedHost.toLowerCase()) {
    throw new Error(`Redirect from ${currentUrl} to disallowed host "${target.hostname}" rejected`);
  }
  return target;
}

async function fetchHtml(url: string): Promise<string> {
  const authReq: AuthorityRequest = {
    identity: { kind: 'internal_subsystem', subsystem: 'trainer-catalog-sync' },
    capability: 'network.request',
    target: { kind: 'network_destination', identifier: url },
    risk: 'MODERATE',
    context: {
      isPackaged: false,
      isTestBuild: process.env.SOLITH_TEST_BUILD === '1',
      freezeActive: false,
      emergencyStopActive: false,
      operationOrigin: 'internal',
      readOnlyMode: false,
    },
  };
  const authRes = evaluate(authReq);
  if (authRes.decision.outcome === 'DENY') {
    throw new Error(`Authority DENIED network request for subsystem trainer-catalog-sync: ${authRes.decision.reason}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const initialUrl = new URL(url);
    if (initialUrl.protocol !== 'https:') {
      throw new Error(`Refusing non-HTTPS sync source: ${url}`);
    }
    const allowedHost = initialUrl.hostname;
    let currentUrl = url;
    let response: Response | undefined;
    for (let redirects = 0; ; redirects += 1) {
      response = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error(`Redirect from ${currentUrl} had no Location header`);
        if (redirects >= MAX_HTML_REDIRECTS) throw new Error('Exceeded maximum redirect count');
        currentUrl = validateRedirectTarget(location, currentUrl, allowedHost).toString();
        continue;
      }
      break;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${currentUrl}`);
    }
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > MAX_HTML_RESPONSE_BYTES) {
      throw new Error(`Response for ${currentUrl} exceeds ${MAX_HTML_RESPONSE_BYTES} byte cap`);
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_HTML_RESPONSE_BYTES) {
      throw new Error(`Response for ${currentUrl} exceeds ${MAX_HTML_RESPONSE_BYTES} byte cap`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function guessExecutable(gameName: string): string {
  const compact = gameName.replace(/[^a-zA-Z0-9]/g, '');
  return compact ? `${compact}.exe` : 'Game.exe';
}

function defaultCategories(gameName: string): string[] {
  const lower = gameName.toLowerCase();
  if (/rpg|souls|elden|witcher|avowed|baldur/i.test(lower)) return ['RPG', 'Action'];
  if (/sim|manager|tycoon|city/i.test(lower)) return ['Simulation', 'Strategy'];
  if (/fps|shooter|call of duty|battlefield/i.test(lower)) return ['Shooter', 'Action'];
  if (/racing|forza|need for speed/i.test(lower)) return ['Racing', 'Sports'];
  return ['Action', 'Single Player'];
}

export function remoteTrainerToCatalogEntry(
  trainer: ParsedRemoteTrainer,
  provider: TrainerSyncSourceConfig['id'],
): TrainerCatalogEntry {
  const catalogGameId = slugifyGameId(trainer.gameName);
  const entry: TrainerCatalogEntry = {
    catalogGameId,
    displayName: trainer.gameName,
    executables: [guessExecutable(trainer.gameName)],
    categories: defaultCategories(trainer.gameName),
    verificationStatus: 'community',
    sources: [{ provider, url: trainer.sourceUrl, lastSyncedAt: new Date().toISOString() }],
    hasModPack: true,
    modPackId: `${provider}-${catalogGameId}`,
    cheatCount: 0,
    searchableText: '',
  };
  entry.searchableText = [entry.displayName, ...entry.executables, ...entry.categories, provider]
    .join(' ')
    .toLowerCase();
  return entry;
}

export function remoteTrainerToModPack(
  trainer: ParsedRemoteTrainer,
  provider: TrainerSyncSourceConfig['id'],
): ModPack {
  const catalogGameId = slugifyGameId(trainer.gameName);
  const now = new Date().toISOString();
  const curated = provider === 'fling' ? getFlingReference(catalogGameId) : undefined;
  const commonCheats = [
    { id: 'health', name: 'Unlimited Health', description: 'Freeze health value', category: 'Player', valueType: 'float', requiresDiscovery: true, verified: false },
    { id: 'ammo', name: 'Unlimited Ammo', description: 'Freeze ammo count', category: 'Weapons', valueType: 'int32', requiresDiscovery: true, verified: false },
    { id: 'money', name: 'Set Money', description: 'Currency / resources', category: 'Currency', valueType: 'int32', requiresDiscovery: true, verified: false },
    { id: 'speed', name: 'Super Speed', description: 'Movement speed multiplier', category: 'Player', valueType: 'float', requiresDiscovery: true, verified: false },
  ];
  const cheats = curated
    ? curated.options.map((option, index) => ({
        id: `ref-${index + 1}-${option.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
        name: option.name,
        description: `Community trainer reference (${option.hotkey})`,
        category: 'Player',
        valueType: 'float' as const,
        requiresDiscovery: true,
        verified: false,
      }))
    : commonCheats;

  return {
    packId: `${provider}-${catalogGameId}`,
    catalogGameId,
    gameName: trainer.gameName,
    source: {
      provider,
      url: curated?.url ?? trainer.sourceUrl,
      trainerTitle: trainer.title,
      lastSyncedAt: now,
    },
    verificationStatus: 'community',
    versions: [{ versionLabel: curated?.versionLabel ?? '*', executables: [guessExecutable(trainer.gameName)] }],
    cheats,
    connectionBaseline: curated?.soloOnly ? 4 : 6,
    platform: 'unknown',
    syncedAt: now,
    notes: [
      `Imported trainer listing from ${provider}. Pointer paths are not verified — use Advanced Scan Mode or memory scan.`,
      'Definitions only; no third-party trainer executable was downloaded.',
      curated ? `${curated.optionCount} public options from curated FLiNG reference (${curated.lastChecked}).` : '',
    ].filter(Boolean),
  };
}

export async function syncTrainerSource(source: TrainerSyncSourceConfig): Promise<SyncImportResult> {
  const url = `${source.baseUrl.replace(/\/$/, '')}${source.listPath}`;
  const errors: string[] = [];
  let trainers: ParsedRemoteTrainer[] = [];

  try {
    const html = await fetchHtml(url);
    if (source.id === 'mrantifun') {
      trainers = parseTrainerListHtml(source.baseUrl, html);
    } else if (source.id === 'fling') {
      trainers = parseRemoteTrainerIndexHtml(html);
    } else if (source.id === 'plitch') {
      trainers = parseRemoteGameCatalogHtml(html);
    } else {
      trainers = parseTrainerListHtml(source.baseUrl, html);
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return { provider: source.id, imported: 0, skipped: 0, errors, trainers: [] };
  }

  return {
    provider: source.id,
    imported: trainers.length,
    skipped: 0,
    errors,
    trainers,
  };
}

export function applySteamAppId(entry: TrainerCatalogEntry, steamAppId: number): TrainerCatalogEntry {
  const images = steamCdnImages(steamAppId);
  return {
    ...entry,
    steamAppId,
    ...images,
  };
}
