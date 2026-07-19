import crypto from 'crypto';

/**
 * Centrally managed unique ID generator for Solith.
 * Ensures consistent UUID generation across all database tables.
 */
export function generateId(): string {
  const id = crypto.randomUUID();
  if (!id) {
    throw new Error('UUID generation failed: returned empty string.');
  }
  return id;
}
