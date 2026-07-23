import { Hono } from 'hono';
import { z } from 'zod';

type Bindings = {
  DB: D1Database;
  ADMIN_TOKEN: string;
};

type DefinitionRow = {
  id: string;
  game_id: string;
  executable_hash: string;
  cert_level: 'L0_Community' | 'L3_Certified';
  definition_payload: string;
  created_at: string;
  updated_at: string;
};

const MAX_SYNC_ROWS = 100;
const MAX_DEFINITION_BYTES = 256 * 1024;
const EPOCH = '1970-01-01T00:00:00.000Z';

const slugSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]*$/i, 'Must be a safe game identifier');

const definitionPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: slugSchema,
    title: z.string().trim().min(1).max(200),
    target: z
      .object({
        executables: z.array(z.string().trim().min(1).max(260)).min(1).max(32),
        arch: z.enum(['x64', 'x86']).optional(),
      })
      .passthrough(),
    safety: z
      .object({
        requiresApproval: z.boolean(),
        requiresOfflineConfirm: z.boolean(),
      })
      .passthrough(),
  })
  .passthrough();

const submissionSchema = z
  .object({
    game_id: slugSchema,
    executable_hash: z
      .string()
      .regex(/^[a-f0-9]{64}$/i, 'Must be a SHA-256 hash'),
    definition_payload: definitionPayloadSchema,
  })
  .strict();

const adminPromotionSchema = z
  .object({
    id: z.string().refine(
      (value) =>
        z.uuid().safeParse(value).success ||
        /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value),
      'Must be a UUID or ULID',
    ),
  })
  .strict();

const syncQuerySchema = z.object({
  since: z.string().datetime({ offset: true }).default(EPOCH),
});

/**
 * Client-supplied certification is never authoritative. Remove every nested
 * certification marker and force the definition's safety status to community.
 * The D1 cert_level column remains the canonical server-side trust decision.
 */
function normalizeCommunityPayload(
  input: z.infer<typeof definitionPayloadSchema>,
): Record<string, unknown> {
  const blockedKeys = new Set([
    'cert_level',
    'certLevel',
    'certificationLevel',
    'verificationStatus',
  ]);

  const stripCertification = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stripCertification);
    if (!value || typeof value !== 'object') return value;

    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (blockedKeys.has(key)) continue;
      output[key] = stripCertification(nested);
    }
    return output;
  };

  const normalized = stripCertification(input) as Record<string, unknown>;
  normalized.safety = {
    ...(normalized.safety as Record<string, unknown>),
    requiresApproval: true,
    requiresOfflineConfirm: true,
    verificationStatus: 'community',
  };
  return normalized;
}

async function secureTokenMatch(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const left = new Uint8Array(providedDigest);
  const right = new Uint8Array(expectedDigest);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

export const app = new Hono<{ Bindings: Bindings }>();

app.get('/health', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first();
    return c.json({
      service: 'solith-hub-backend',
      status: 'healthy',
      database: 'connected',
      time: new Date().toISOString(),
    });
  } catch {
    return c.json(
      {
        service: 'solith-hub-backend',
        status: 'unhealthy',
        database: 'disconnected',
        time: new Date().toISOString(),
      },
      503,
    );
  }
});

app.get('/catalog/sync', async (c) => {
  const parsed = syncQuerySchema.safeParse({ since: c.req.query('since') ?? EPOCH });
  if (!parsed.success) {
    return c.json(
      { error: 'invalid_query', details: parsed.error.flatten() },
      400,
    );
  }

  const syncStartedAt = new Date().toISOString();
  const result = await c.env.DB.prepare(
    `SELECT id, game_id, executable_hash, cert_level, definition_payload,
            created_at, updated_at
       FROM definitions
      WHERE updated_at > ?1 AND updated_at <= ?2
      ORDER BY updated_at ASC, id ASC
      LIMIT ${MAX_SYNC_ROWS}`,
  )
    .bind(parsed.data.since, syncStartedAt)
    .all<DefinitionRow>();

  const rows = result.results ?? [];
  const definitions = rows.map((row) => ({
    ...row,
    definition_payload: JSON.parse(row.definition_payload) as unknown,
  }));
  const nextSince =
    rows.length === MAX_SYNC_ROWS
      ? rows[rows.length - 1]!.updated_at
      : syncStartedAt;

  return c.json({
    definitions,
    count: definitions.length,
    next_since: nextSince,
    has_more: rows.length === MAX_SYNC_ROWS,
  });
});

app.post('/submit', async (c) => {
  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (contentLength > MAX_DEFINITION_BYTES) {
    return c.json({ error: 'payload_too_large' }, 413);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const parsed = submissionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: 'invalid_submission', details: parsed.error.flatten() },
      400,
    );
  }

  const definitionPayload = normalizeCommunityPayload(
    parsed.data.definition_payload,
  );
  const serializedPayload = JSON.stringify(definitionPayload);
  if (new TextEncoder().encode(serializedPayload).byteLength > MAX_DEFINITION_BYTES) {
    return c.json({ error: 'payload_too_large' }, 413);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO definitions
       (id, game_id, executable_hash, cert_level, definition_payload, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'L0_Community', ?4, ?5, ?5)`,
  )
    .bind(
      id,
      parsed.data.game_id,
      parsed.data.executable_hash.toLowerCase(),
      serializedPayload,
      now,
    )
    .run();

  return c.json(
    {
      id,
      game_id: parsed.data.game_id,
      cert_level: 'L0_Community' as const,
      created_at: now,
      updated_at: now,
    },
    201,
  );
});

app.post('/admin/promote', async (c) => {
  const expectedToken = c.env.ADMIN_TOKEN;
  if (!expectedToken) {
    return c.json({ error: 'admin_not_configured' }, 503);
  }

  const authorization = c.req.header('authorization') ?? '';
  const providedToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  if (!providedToken || !(await secureTokenMatch(providedToken, expectedToken))) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const parsed = adminPromotionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: 'invalid_promotion', details: parsed.error.flatten() },
      400,
    );
  }

  const updatedAt = new Date().toISOString();
  const result = await c.env.DB.prepare(
    `UPDATE definitions
        SET cert_level = 'L3_Certified', updated_at = ?1
      WHERE id = ?2`,
  )
    .bind(updatedAt, parsed.data.id)
    .run();

  if ((result.meta.changes ?? 0) === 0) {
    return c.json({ error: 'definition_not_found' }, 404);
  }

  return c.json({
    id: parsed.data.id,
    cert_level: 'L3_Certified' as const,
    updated_at: updatedAt,
  });
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));

app.onError((error, c) => {
  console.error('Unhandled Solith Hub error', error);
  return c.json({ error: 'internal_error' }, 500);
});

export default app;
