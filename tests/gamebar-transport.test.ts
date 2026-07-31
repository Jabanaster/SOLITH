import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  deriveAppContainerSid,
  startGameBarTransport,
} from '../electron/gamebar-transport.js';

const TOKEN = 'A'.repeat(43);
const SESSION = '11111111-2222-4333-8444-555555555555';

function tempDiscovery() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-gamebar-'));
  return { root, file: path.join(root, 'solith-transport.json') };
}

function pingBody(sessionId = SESSION, extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    sessionId,
    timestampUnixMs: Date.now(),
    nonce: 'nonce_1234567890abcdef',
    ...extra,
  };
}

async function request(
  port: number,
  route: string,
  options: { token?: string; method?: string; body?: string; contentType?: string } = {},
) {
  return fetch(`http://127.0.0.1:${port}${route}`, {
    method: options.method ?? 'POST',
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.contentType ? { 'Content-Type': options.contentType } : {}),
    },
    body: options.body,
  });
}

async function withTransport(
  run: (port: number, discoveryPath: string) => Promise<void>,
): Promise<void> {
  const temp = tempDiscovery();
  const transport = await startGameBarTransport({
    discoveryPath: temp.file,
    token: TOKEN,
    sessionId: SESSION,
    skipWindowsAclCheckForTests: true,
    logger: { info() {}, warn() {} },
  });
  try {
    await run(transport.port, temp.file);
  } finally {
    await transport.stop();
    fs.rmSync(temp.root, { recursive: true, force: true });
  }
}

test('binds only to IPv4 loopback and writes minimal discovery', async () => {
  await withTransport(async (port, file) => {
    const discovery = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(discovery.address, '127.0.0.1');
    assert.equal(discovery.port, port);
    assert.deepEqual(Object.keys(discovery).sort(), [
      'address', 'createdAtUnixMs', 'pid', 'port', 'sessionId', 'token', 'version',
    ]);
  });
});

test('derives the installed widget AppContainer SID from its package family', () => {
  assert.equal(
    deriveAppContainerSid(),
    'S-1-15-2-1450989936-3768333357-2179290931-1547239158-1553198993-1657222907-796510196',
  );
});

test('valid token succeeds while missing and incorrect tokens fail', async () => {
  await withTransport(async (port) => {
    const body = JSON.stringify(pingBody());
    const valid = await request(port, '/v1/wisp/ping', {
      token: TOKEN, contentType: 'application/json', body,
    });
    assert.equal(valid.status, 200);
    const payload = await valid.json() as Record<string, unknown>;
    assert.equal(payload.ok, true);
    assert.equal(payload.sessionId, SESSION);
    assert.equal(await request(port, '/v1/wisp/ping', {
      contentType: 'application/json', body,
    }).then((response) => response.status), 401);
    assert.equal(await request(port, '/v1/wisp/ping', {
      token: 'B'.repeat(43), contentType: 'application/json', body,
    }).then((response) => response.status), 401);
  });
});

test('token from a prior launch fails against the next session', async () => {
  const temp = tempDiscovery();
  const first = await startGameBarTransport({
    discoveryPath: temp.file, token: TOKEN, sessionId: SESSION,
    skipWindowsAclCheckForTests: true, logger: { info() {}, warn() {} },
  });
  await first.stop();
  const nextSession = '66666666-7777-4888-8999-000000000000';
  const second = await startGameBarTransport({
    discoveryPath: temp.file, token: 'C'.repeat(43), sessionId: nextSession,
    skipWindowsAclCheckForTests: true, logger: { info() {}, warn() {} },
  });
  try {
    const response = await request(second.port, '/v1/wisp/ping', {
      token: TOKEN,
      contentType: 'application/json',
      body: JSON.stringify(pingBody(nextSession)),
    });
    assert.equal(response.status, 401);
  } finally {
    await second.stop();
    fs.rmSync(temp.root, { recursive: true, force: true });
  }
});

test('route, method, content type, body size and JSON schema are allowlisted', async () => {
  await withTransport(async (port) => {
    assert.equal(await request(port, '/unknown', {
      token: TOKEN, contentType: 'application/json', body: '{}',
    }).then((response) => response.status), 404);
    assert.equal(await request(port, '/v1/wisp/ping', {
      token: TOKEN, method: 'GET',
    }).then((response) => response.status), 405);
    assert.equal(await request(port, '/v1/wisp/ping', {
      token: TOKEN, contentType: 'text/plain', body: '{}',
    }).then((response) => response.status), 415);
    assert.equal(await request(port, '/v1/wisp/ping', {
      token: TOKEN, contentType: 'application/json', body: 'x'.repeat(1025),
    }).then((response) => response.status), 413);
    assert.equal(await request(port, '/v1/wisp/ping', {
      token: TOKEN, contentType: 'application/json', body: '{',
    }).then((response) => response.status), 400);
    assert.equal(await request(port, '/v1/wisp/ping', {
      token: TOKEN,
      contentType: 'application/json',
      body: JSON.stringify(pingBody(SESSION, { unknown: true })),
    }).then((response) => response.status), 400);
  });
});

test('stale timestamps and replayed nonces are rejected', async () => {
  await withTransport(async (port) => {
    assert.equal(await request(port, '/v1/wisp/ping', {
      token: TOKEN,
      contentType: 'application/json',
      body: JSON.stringify(pingBody(SESSION, { timestampUnixMs: Date.now() - 31_000 })),
    }).then((response) => response.status), 400);
    const body = JSON.stringify(pingBody());
    assert.equal(await request(port, '/v1/wisp/ping', {
      token: TOKEN, contentType: 'application/json', body,
    }).then((response) => response.status), 200);
    assert.equal(await request(port, '/v1/wisp/ping', {
      token: TOKEN, contentType: 'application/json', body,
    }).then((response) => response.status), 409);
  });
});

test('rate limit is bounded and recovers after its short window', async () => {
  let now = Date.now();
  const temp = tempDiscovery();
  const transport = await startGameBarTransport({
    discoveryPath: temp.file, token: TOKEN, sessionId: SESSION, now: () => now,
    skipWindowsAclCheckForTests: true, logger: { info() {}, warn() {} },
  });
  try {
    for (let index = 0; index < 20; index += 1) {
      assert.equal(await request(transport.port, '/health', {
        token: TOKEN, method: 'GET',
      }).then((response) => response.status), 200);
    }
    assert.equal(await request(transport.port, '/health', {
      token: TOKEN, method: 'GET',
    }).then((response) => response.status), 429);
    now += 10_001;
    assert.equal(await request(transport.port, '/health', {
      token: TOKEN, method: 'GET',
    }).then((response) => response.status), 200);
  } finally {
    await transport.stop();
    fs.rmSync(temp.root, { recursive: true, force: true });
  }
});

test('shutdown deletes discovery and makes later requests fail', async () => {
  const temp = tempDiscovery();
  const transport = await startGameBarTransport({
    discoveryPath: temp.file, token: TOKEN, sessionId: SESSION,
    skipWindowsAclCheckForTests: true, logger: { info() {}, warn() {} },
  });
  const port = transport.port;
  await transport.stop();
  assert.equal(fs.existsSync(temp.file), false);
  await assert.rejects(() => request(port, '/health', { token: TOKEN, method: 'GET' }));
  fs.rmSync(temp.root, { recursive: true, force: true });
});

test('source has no generic command dispatch, shell, or IPC relay', () => {
  const source = fs.readFileSync(new URL('../electron/gamebar-transport.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bipcMain\b|\beval\s*\(|\bspawn\s*\(|\bshell\s*:/);
  assert.match(source, /request\.url === '\/health'/);
  assert.match(source, /request\.url !== '\/v1\/wisp\/ping'/);
});

test('widget keeps duplicate suppression active through a bounded cooldown', () => {
  const source = fs.readFileSync(
    new URL('../gamebar-widget-poc/WispGameBarWidget/MainPage.xaml.cs', import.meta.url),
    'utf8',
  );
  assert.match(source, /if \(_pingInFlight\) return;/);
  assert.match(source, /Task\.Delay\(TimeSpan\.FromSeconds\(1\)\)/);
  assert.ok(
    source.indexOf('Task.Delay(TimeSpan.FromSeconds(1))')
      < source.indexOf('_pingInFlight = false;'),
  );
});