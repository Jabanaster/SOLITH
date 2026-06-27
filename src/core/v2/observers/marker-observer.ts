import fs from 'node:fs';
import type { SessionMarkerResult } from '../lifecycle/types.js';

/**
 * Read-only session marker file observer.
 *
 * Observes the presence of a configured session-marker file (e.g., a
 * third-party application's port-registry JSON). Does not write, delete,
 * or modify the file. Does not send data to any external service.
 *
 * The marker file path must be provided by the caller; it is never
 * hardcoded to a specific application path.
 */
export function observeMarkerFile(markerFilePath: string): SessionMarkerResult {
  const observedAt = new Date().toISOString();

  if (!markerFilePath) {
    return {
      availability: 'unavailable',
      markerPresent: false,
      markerPath: '',
      observedAt,
    };
  }

  try {
    if (!fs.existsSync(markerFilePath)) {
      return {
        availability: 'available',
        markerPresent: false,
        markerPath: markerFilePath,
        observedAt,
      };
    }

    const raw = fs.readFileSync(markerFilePath, 'utf-8').trim();

    // The marker is "present" when the file exists and is not empty / not a blank array
    const isEmpty = raw === '' || raw === '[]' || raw === 'null';
    const markerPresent = !isEmpty;

    let parsedContent: unknown;
    try {
      parsedContent = JSON.parse(raw);
    } catch {
      // Non-JSON marker files are still valid presence indicators
      parsedContent = undefined;
    }

    return {
      availability: 'available',
      markerPresent,
      markerPath: markerFilePath,
      parsedContent,
      observedAt,
    };
  } catch (err) {
    const msg = String(err);
    if (msg.includes('EACCES') || msg.includes('access') || msg.includes('permission')) {
      return {
        availability: 'permission_denied',
        markerPresent: false,
        markerPath: markerFilePath,
        error: msg.slice(0, 120),
        observedAt,
      };
    }
    return {
      availability: 'error',
      markerPresent: false,
      markerPath: markerFilePath,
      error: msg.slice(0, 120),
      observedAt,
    };
  }
}
