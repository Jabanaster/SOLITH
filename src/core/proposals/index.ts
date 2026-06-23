import crypto from 'crypto';
import db from '../database';
import { Proposal } from '../../shared/types';

export function createProposal(proposal: Omit<Proposal, 'id' | 'createdAt'>): Proposal {
  const proposalId = crypto.randomUUID();
  const stmt = db.prepare(`
    INSERT INTO proposals (
      id, gameId, recipeId, targetFile, operation, path, oldValue, newValue,
      risk, preview, validationRule, requiresBackup, dryRunPassed, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    proposalId,
    proposal.gameId,
    proposal.recipeId || null,
    proposal.targetFile,
    proposal.operation,
    proposal.path,
    String(proposal.oldValue),
    String(proposal.newValue),
    proposal.risk,
    proposal.preview,
    proposal.validationRule,
    proposal.requiresBackup ? 1 : 0,
    proposal.dryRunPassed ? 1 : 0,
    proposal.status
  );
  
  return {
    ...proposal,
    id: proposalId,
    createdAt: new Date().toISOString()
  };
}

export function getProposalById(proposalId: string): Proposal | null {
  const stmt = db.prepare('SELECT * FROM proposals WHERE id = ?');
  const row = stmt.get(proposalId);
  if (!row) return null;
  
  return {
    ...row,
    createdAt: row.createdAt.toISOString()
  };
}

export function getLatestProposal(gameId: string): Proposal | null {
  const stmt = db.prepare(`
    SELECT * FROM proposals 
    WHERE gameId = ? 
    ORDER BY createdAt DESC 
    LIMIT 1
  `);
  
  const row = stmt.get(gameId);
  if (!row) return null;
  
  return {
    ...row,
    createdAt: row.createdAt.toISOString()
  };
}

export function updateProposalStatus(proposalId: string, status: Proposal['status']): boolean {
  const stmt = db.prepare(`
    UPDATE proposals SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?
  `);
  
  return stmt.run(status, proposalId).changes !== 0;
}

export function deleteProposal(proposalId: string): boolean {
  const stmt = db.prepare('DELETE FROM proposals WHERE id = ?');
  return stmt.run(proposalId).changes !== 0;
}

export function getProposals(gameId: string): Proposal[] {
  const stmt = db.prepare(`
    SELECT * FROM proposals 
    WHERE gameId = ? 
    ORDER BY createdAt DESC
  `);
  
  return stmt.all(gameId).map((row: any) => ({
    ...row,
    createdAt: row.createdAt.toISOString()
  }));
}
