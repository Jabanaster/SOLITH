import crypto from 'crypto';
import db from '../database';
import { JournalEvent } from '../../shared/types';

export function logEvent(event: Omit<JournalEvent, 'id' | 'timestamp'>): JournalEvent {
  const eventId = crypto.randomUUID();
  const stmt = db.prepare(`
    INSERT INTO journal_events (id, gameId, recipeId, type, description, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    eventId,
    event.gameId || null,
    event.recipeId || null,
    event.type,
    event.description,
    event.details || null
  );
  
  return {
    ...event,
    id: eventId,
    timestamp: new Date().toISOString()
  };
}

export function getJournalEvents(gameId?: string, limit: number = 100): JournalEvent[] {
  const whereClause = gameId ? `WHERE je.gameId = ?` : '';
  const params: any[] = gameId ? [gameId, limit] : [limit];

  const stmt = db.prepare(`
    SELECT je.*, g.name as gameName, r.name as recipeName
    FROM journal_events je
    LEFT JOIN games g ON je.gameId = g.id
    LEFT JOIN recipes r ON je.recipeId = r.id
    ${whereClause}
    ORDER BY je.timestamp DESC
    LIMIT ?
  `);

  return stmt.all(...params).map((row: any) => ({
    ...row,
    timestamp: row.timestamp instanceof Date
      ? row.timestamp.toISOString()
      : String(row.timestamp)
  }));
}

export function getJournalEventsByType(gameId: string | undefined, type: string, limit: number = 100): JournalEvent[] {
  const whereClause = `WHERE je.gameId = ? AND je.type = ?`;
  const params: any[] = [gameId, type, limit];

  const stmt = db.prepare(`
    SELECT je.*, g.name as gameName, r.name as recipeName
    FROM journal_events je
    LEFT JOIN games g ON je.gameId = g.id
    LEFT JOIN recipes r ON je.recipeId = r.id
    ${whereClause}
    ORDER BY je.timestamp DESC
    LIMIT ?
  `);

  return stmt.all(...params).map((row: any) => ({
    ...row,
    timestamp: row.timestamp instanceof Date
      ? row.timestamp.toISOString()
      : String(row.timestamp)
  }));
}

export function clearJournal(gameId?: string): boolean {
  const whereClause = gameId ? `WHERE gameId = ?` : '';
  const params = gameId ? [gameId] : [];
  
  const stmt = db.prepare(`DELETE FROM journal_events ${whereClause}`);
  return stmt.run(...params).changes !== 0;
}

export function getJournalEventCount(gameId?: string): number {
  const whereClause = gameId ? `WHERE gameId = ?` : '';
  const params = gameId ? [gameId] : [];
  
  const stmt = db.prepare(`SELECT COUNT(*) as count FROM journal_events ${whereClause}`);
  const row = stmt.get(...params);
  return row.count;
}
