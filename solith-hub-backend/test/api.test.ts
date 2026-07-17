import { describe, expect, it } from 'vitest';
import { app } from '../src/index';

type StoredRow = {
  id: string;
  game_id: string;
  executable_hash: string;
  cert_level: 'L0_Community' | 'L3_Certified';
  definition_payload: string;
  created_at: string;
  updated_at: string;
};

class FakeD1 {
  readonly rows: StoredRow[] = [];

  prepare(query: string): D1PreparedStatement {
    return new FakeStatement(this, query) as unknown as D1PreparedStatement;
  }
}

class FakeStatement {
  private values: unknown[] = [];

  constructor(
    private readonly db: FakeD1,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async all<T>(): Promise<D1Result<T>> {
    const [since, through] = this.values as [string, string];
    const results = this.db.rows
      .filter((row) => row.updated_at > since && row.updated_at <= through)
      .sort(
        (left, right) =>
          left.updated_at.localeCompare(right.updated_at) ||
          left.id.localeCompare(right.id),
      )
      .slice(0, 100) as T[];

    return {
      success: true,
      results,
      meta: {},
    } as unknown as D1Result<T>;
  }

  async run(): Promise<D1Result<unknown>> {
    if (this.query.includes('INSERT INTO definitions')) {
      const [id, gameId, executableHash, definitionPayload, now] = this.values as [
        string,
        string,
        string,
        string,
        string,
      ];
      this.db.rows.push({
        id,
        game_id: gameId,
        executable_hash: executableHash,
        cert_level: 'L0_Community',
        definition_payload: definitionPayload,
        created_at: now,
        updated_at: now,
      });
      return {
        success: true,
        results: [],
        meta: { changes: 1 },
      } as unknown as D1Result<unknown>;
    }

    if (this.query.includes('UPDATE definitions')) {
      const [updatedAt, id] = this.values as [string, string];
      const row = this.db.rows.find((candidate) => candidate.id === id);
      if (row) {
        row.cert_level = 'L3_Certified';
        row.updated_at = updatedAt;
      }
      return {
        success: true,
        results: [],
        meta: { changes: row ? 1 : 0 },
      } as unknown as D1Result<unknown>;
    }

    throw new Error(`Unexpected test query: ${this.query}`);
  }
}

function env(db = new FakeD1(), adminToken = 'test-admin-token') {
  return {
    bindings: {
      DB: db as unknown as D1Database,
      ADMIN_TOKEN: adminToken,
    },
    db,
  };
}

const validSubmission = {
  game_id: 'atomfall',
  executable_hash: 'a'.repeat(64),
  definition_payload: {
    schemaVersion: 1,
    id: 'atomfall',
    title: 'Atomfall',
    certificationLevel: 'L3',
    target: {
      executables: ['Atomfall_dx12.exe'],
      arch: 'x64',
    },
    safety: {
      requiresApproval: false,
      requiresOfflineConfirm: false,
      verificationStatus: 'verified',
    },
    memoryFeatures: [
      {
        id: 'ammo',
        certificationLevel: 'L3',
        resolution: { moduleName: 'atomfall_dx12.exe' },
      },
    ],
  },
};

describe('Solith Definition Hub API', () => {
  it('forces every submission to L0_Community and strips client certification', async () => {
    const testEnv = env();
    const response = await app.request(
      '/submit',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validSubmission),
      },
      testEnv.bindings,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ cert_level: 'L0_Community' });
    expect(testEnv.db.rows).toHaveLength(1);
    expect(testEnv.db.rows[0]!.cert_level).toBe('L0_Community');

    const stored = JSON.parse(testEnv.db.rows[0]!.definition_payload) as {
      certificationLevel?: string;
      safety: {
        verificationStatus: string;
        requiresApproval: boolean;
        requiresOfflineConfirm: boolean;
      };
      memoryFeatures: Array<{ certificationLevel?: string }>;
    };
    expect(stored.certificationLevel).toBeUndefined();
    expect(stored.memoryFeatures[0]!.certificationLevel).toBeUndefined();
    expect(stored.safety).toMatchObject({
      verificationStatus: 'community',
      requiresApproval: true,
      requiresOfflineConfirm: true,
    });
  });

  it('rejects malformed submissions without touching D1', async () => {
    const testEnv = env();
    const response = await app.request(
      '/submit',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...validSubmission,
          executable_hash: 'not-a-sha256',
        }),
      },
      testEnv.bindings,
    );

    expect(response.status).toBe(400);
    expect(testEnv.db.rows).toHaveLength(0);
  });

  it('returns definitions updated after the requested timestamp', async () => {
    const testEnv = env();
    testEnv.db.rows.push({
      id: crypto.randomUUID(),
      game_id: 'atomfall',
      executable_hash: 'a'.repeat(64),
      cert_level: 'L0_Community',
      definition_payload: JSON.stringify(validSubmission.definition_payload),
      created_at: '2026-07-17T01:00:00.000Z',
      updated_at: '2026-07-17T01:00:00.000Z',
    });

    const response = await app.request(
      '/catalog/sync?since=2026-07-17T00%3A00%3A00.000Z',
      undefined,
      testEnv.bindings,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      count: number;
      definitions: Array<{ definition_payload: unknown }>;
    };
    expect(body.count).toBe(1);
    expect(body.definitions[0]!.definition_payload).toMatchObject({
      schemaVersion: 1,
      id: 'atomfall',
    });
  });

  it('requires the admin bearer token and promotes an existing definition', async () => {
    const testEnv = env();
    const id = crypto.randomUUID();
    testEnv.db.rows.push({
      id,
      game_id: 'atomfall',
      executable_hash: 'a'.repeat(64),
      cert_level: 'L0_Community',
      definition_payload: JSON.stringify(validSubmission.definition_payload),
      created_at: '2026-07-17T01:00:00.000Z',
      updated_at: '2026-07-17T01:00:00.000Z',
    });

    const unauthorized = await app.request(
      '/admin/promote',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      },
      testEnv.bindings,
    );
    expect(unauthorized.status).toBe(401);

    const promoted = await app.request(
      '/admin/promote',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-admin-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ id }),
      },
      testEnv.bindings,
    );

    expect(promoted.status).toBe(200);
    expect(testEnv.db.rows[0]!.cert_level).toBe('L3_Certified');
  });
});
