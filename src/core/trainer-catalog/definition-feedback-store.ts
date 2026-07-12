import db from '../database/index.js';

export interface DefinitionFeedbackRow {
  catalogGameId: string;
  featureId: string;
  executableHashPrefix: string | null;
  rating: number;
  note: string | null;
  recordedAt: string;
}

export function recordDefinitionFeedback(input: {
  catalogGameId: string;
  featureId: string;
  executableHashPrefix?: string | null;
  rating: -1 | 0 | 1;
  note?: string | null;
}): void {
  db.prepare(
    `INSERT INTO definition_feedback (catalogGameId, featureId, executableHashPrefix, rating, note, recordedAt)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  ).run(
    input.catalogGameId,
    input.featureId,
    input.executableHashPrefix ?? null,
    input.rating,
    input.note ?? null,
  );
}

export function getDefinitionFeedbackSummary(
  catalogGameId: string,
  featureId?: string,
): { positive: number; negative: number; total: number } {
  const params: string[] = [catalogGameId];
  let sql = `SELECT rating, COUNT(*) as c FROM definition_feedback WHERE catalogGameId = ?`;
  if (featureId) {
    sql += ' AND featureId = ?';
    params.push(featureId);
  }
  sql += ' GROUP BY rating';

  const rows = db.prepare(sql).all(...params) as Array<{ rating: number; c: number }>;
  let positive = 0;
  let negative = 0;
  for (const row of rows) {
    if (row.rating > 0) positive += row.c;
    if (row.rating < 0) negative += row.c;
  }
  return { positive, negative, total: positive + negative };
}

export function listDefinitionFeedback(
  catalogGameId: string,
  limit = 50,
): DefinitionFeedbackRow[] {
  return db
    .prepare(
      `SELECT catalogGameId, featureId, executableHashPrefix, rating, note, recordedAt
       FROM definition_feedback WHERE catalogGameId = ? ORDER BY recordedAt DESC LIMIT ?`,
    )
    .all(catalogGameId, limit) as DefinitionFeedbackRow[];
}
