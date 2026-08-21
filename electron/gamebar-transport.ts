import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { systemBinaryPath } from '../src/core/safety/system-binary.js';

const LOOPBACK_HOST = '127.0.0.1';

const MAX_BODY_BYTES = 1024;
const REQUEST_WINDOW_MS = 30_000;
const RATE_WINDOW_MS = 10_000;
const RATE_LIMIT = 20;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export const GAMEBAR_PACKAGE_FAMILY = 'Solith.WispGameBarWidget.Poc_a9wj3655nef3j';
export const GAMEBAR_DISCOVERY_FILE = 'solith-transport.json';

export interface GameBarTransportDiscovery {
  version: 1;
  address: typeof LOOPBACK_HOST;
  port: number;
  sessionId: string;
  token: string;
  pid: number;
  createdAtUnixMs: number;
}

export interface GameBarTransportLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface GameBarTransportOptions {
  discoveryPath: string;
  logger?: GameBarTransportLogger;
  now?: () => number;
  token?: string;
  sessionId?: string;
  skipWindowsAclCheckForTests?: boolean;
}

export interface GameBarTransport {
  readonly address: typeof LOOPBACK_HOST;
  readonly port: number;
  readonly sessionId: string;
  readonly discoveryPath: string;
  stop(): Promise<void>;
}

type PingBody = {
  version: 1;
  sessionId: string;
  timestampUnixMs: number;
  nonce: string;
};

const defaultLogger: GameBarTransportLogger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
};

function writeJson(response: ServerResponse, status: number, payload: Record<string, unknown>): void {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

function reject(response: ServerResponse, status: number, code: string): void {
  writeJson(response, status, { ok: false, error: code });
}

function tokenMatches(header: string | undefined, expectedToken: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice('Bearer '.length), 'utf8');
  const expected = Buffer.from(expectedToken, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error('body_too_large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parsePingBody(buffer: Buffer, sessionId: string, now: number): PingBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new Error('malformed_json');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('invalid_body');
  }
  const record = parsed as Record<string, unknown>;
  const allowed = ['nonce', 'sessionId', 'timestampUnixMs', 'version'];
  const keys = Object.keys(record).sort();
  if (keys.length !== allowed.length || keys.some((key, index) => key !== allowed[index])) {
    throw new Error('unknown_or_missing_fields');
  }
  if (
    record.version !== 1 ||
    record.sessionId !== sessionId ||
    typeof record.timestampUnixMs !== 'number' ||
    !Number.isSafeInteger(record.timestampUnixMs) ||
    typeof record.nonce !== 'string' ||
    !NONCE_PATTERN.test(record.nonce)
  ) {
    throw new Error('invalid_body');
  }
  if (Math.abs(now - record.timestampUnixMs) > REQUEST_WINDOW_MS) {
    throw new Error('stale_request');
  }
  return record as PingBody;
}

function currentUserSid(): string {
  const output = execFileSync(systemBinaryPath('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const match = output.match(/"(S-1-5-[0-9-]+)"/i);
  if (!match) throw new Error('Unable to resolve the current Windows user SID');
  return match[1];
}

export function deriveAppContainerSid(packageFamily = GAMEBAR_PACKAGE_FAMILY): string {
  const digest = createHash('sha256')
    .update(Buffer.from(packageFamily.toLowerCase(), 'utf16le'))
    .digest();
  const authorities = Array.from(
    { length: 7 },
    (_, index) => digest.readUInt32LE(index * 4),
  );
  return `S-1-15-2-${authorities.join('-')}`;
}

function restrictAndAssertDiscoveryAcl(discoveryPath: string): void {
  if (process.platform !== 'win32') {
    throw new Error('Game Bar transport is supported only on Windows');
  }
  const userSid = currentUserSid();
  const appContainerSid = deriveAppContainerSid();
  execFileSync(systemBinaryPath('icacls.exe'), [
    discoveryPath,
    '/inheritance:r',
    '/grant:r',
    `*${userSid}:(F)`,
    `*${appContainerSid}:(R)`,
    '*S-1-5-18:(F)',
    '*S-1-5-32-544:(F)',
  ], { encoding: 'utf8', windowsHide: true });

  const output = execFileSync(systemBinaryPath('icacls.exe'), [discoveryPath], {
    encoding: 'utf8',
    windowsHide: true,
  }).toLowerCase();
  const forbidden = [
    'everyone',
    'builtin\\users',
    'authenticated users',
    'all application packages',
    'codexsandboxusers',
    '(i)',
  ];
  if (forbidden.some((identity) => output.includes(identity))
      || !output.includes(appContainerSid.toLowerCase())) {
    throw new Error('Discovery file ACL is broader than the approved principals');
  }
}

function writeDiscoveryFile(
  discoveryPath: string,
  discovery: GameBarTransportDiscovery,
  skipWindowsAclCheckForTests: boolean,
): void {
  fs.mkdirSync(path.dirname(discoveryPath), { recursive: true });
  fs.rmSync(discoveryPath, { force: true });
  const temporaryPath = `${discoveryPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, '', {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    if (!skipWindowsAclCheckForTests) restrictAndAssertDiscoveryAcl(temporaryPath);
    fs.writeFileSync(temporaryPath, JSON.stringify(discovery), {
      encoding: 'utf8',
      flag: 'r+',
    });
    fs.renameSync(temporaryPath, discoveryPath);
    if (!skipWindowsAclCheckForTests) restrictAndAssertDiscoveryAcl(discoveryPath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    fs.rmSync(discoveryPath, { force: true });
    throw error;
  }
}

function removeDiscoveryFile(discoveryPath: string): void {
  fs.rmSync(discoveryPath, { force: true });
}

export function resolveGameBarDiscoveryPath(localAppData = process.env.LOCALAPPDATA): string {
  if (!localAppData) throw new Error('LOCALAPPDATA is unavailable');
  return path.join(
    localAppData,
    'Packages',
    GAMEBAR_PACKAGE_FAMILY,
    'LocalState',
    GAMEBAR_DISCOVERY_FILE,
  );
}

export async function startGameBarTransport(
  options: GameBarTransportOptions,
): Promise<GameBarTransport> {
  const logger = options.logger ?? defaultLogger;
  const now = options.now ?? Date.now;
  const token = options.token ?? randomBytes(32).toString('base64url');
  const sessionId = options.sessionId ?? randomUUID();
  if (Buffer.from(token, 'utf8').length < 32) {
    throw new Error('Game Bar transport token must contain at least 256 bits');
  }

  let shuttingDown = false;
  let authFailureCount = 0;
  const acceptedNonces = new Map<string, number>();
  const requestTimes: number[] = [];

  const server = createServer(async (request, response) => {
    const requestNow = now();
    while (requestTimes.length > 0 && requestTimes[0] <= requestNow - RATE_WINDOW_MS) {
      requestTimes.shift();
    }
    if (requestTimes.length >= RATE_LIMIT) {
      reject(response, 429, 'rate_limited');
      return;
    }
    requestTimes.push(requestNow);

    if (shuttingDown) {
      reject(response, 503, 'shutting_down');
      return;
    }
    if (request.socket.localAddress !== LOOPBACK_HOST || request.socket.remoteAddress !== LOOPBACK_HOST) {
      reject(response, 403, 'loopback_required');
      return;
    }
    if (!tokenMatches(request.headers.authorization, token)) {
      authFailureCount += 1;
      logger.warn(`[GameBar Transport] Authentication rejected (${authFailureCount})`);
      reject(response, 401, 'unauthorized');
      return;
    }

    if (request.url === '/health') {
      if (request.method !== 'GET') {
        reject(response, 405, 'method_not_allowed');
        return;
      }
      writeJson(response, 200, { ok: true, service: 'solith-gamebar', sessionId });
      logger.info('[GameBar Transport] GET /health 200');
      return;
    }

    if (request.url !== '/v1/wisp/ping') {
      reject(response, 404, 'not_found');
      return;
    }
    if (request.method !== 'POST') {
      reject(response, 405, 'method_not_allowed');
      return;
    }
    if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      reject(response, 415, 'content_type_required');
      return;
    }

    let body: Buffer;
    try {
      body = await readBody(request);
    } catch {
      reject(response, 413, 'body_too_large');
      return;
    }

    let ping: PingBody;
    try {
      ping = parsePingBody(body, sessionId, requestNow);
    } catch (error) {
      reject(response, 400, error instanceof Error ? error.message : 'invalid_body');
      return;
    }

    for (const [nonce, timestamp] of acceptedNonces) {
      if (timestamp <= requestNow - REQUEST_WINDOW_MS) acceptedNonces.delete(nonce);
    }
    if (acceptedNonces.has(ping.nonce)) {
      reject(response, 409, 'duplicate_nonce');
      return;
    }
    acceptedNonces.set(ping.nonce, requestNow);

    writeJson(response, 200, {
      ok: true,
      service: 'solith',
      sessionId,
      message: 'Authenticated connection to SOLITH established.',
      serverTimeUnixMs: requestNow,
    });
    logger.info('[GameBar Transport] POST /v1/wisp/ping 200');
  });

  const port = await new Promise<number>((resolve, rejectStart) => {
    const onError = (error: Error) => rejectStart(error);
    server.once('error', onError);
    server.listen(0, LOOPBACK_HOST, () => {
      server.off('error', onError);
      const address = server.address();
      if (!address || typeof address === 'string' || address.address !== LOOPBACK_HOST) {
        rejectStart(new Error('Game Bar transport failed to bind exclusively to loopback'));
        return;
      }
      resolve(address.port);
    });
  });

  try {
    writeDiscoveryFile(
      options.discoveryPath,
      {
        version: 1,
        address: LOOPBACK_HOST,
        port,
        sessionId,
        token,
        pid: process.pid,
        createdAtUnixMs: now(),
      },
      options.skipWindowsAclCheckForTests === true,
    );
  } catch (error) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw error;
  }

  logger.info(
    `[GameBar Transport] Started ${LOOPBACK_HOST}:${port} session=${sessionId.slice(0, 8)}`,
  );

  return {
    address: LOOPBACK_HOST,
    port,
    sessionId,
    discoveryPath: options.discoveryPath,
    async stop(): Promise<void> {
      if (shuttingDown) return;
      shuttingDown = true;
      removeDiscoveryFile(options.discoveryPath);
      await new Promise<void>((resolve, rejectStop) => {
        server.close((error) => (error ? rejectStop(error) : resolve()));
        server.closeAllConnections();
      });
      acceptedNonces.clear();
      requestTimes.length = 0;
      logger.info('[GameBar Transport] Shutdown complete');
    },
  };
}
