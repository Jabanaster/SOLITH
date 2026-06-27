import type {
  LifecycleState,
  ObservationTimeline,
  TimelineEntry,
  ProcessIdentity,
  EndpointObservationResult,
  SessionMarkerResult,
} from './types.js';

const DEFAULT_MAX_ENTRIES = 200;

export function createTimeline(maxEntries = DEFAULT_MAX_ENTRIES): ObservationTimeline {
  return {
    entries: [],
    startedAt: new Date().toISOString(),
    maxEntries,
  };
}

export function recordTransition(
  timeline: ObservationTimeline,
  previousState: LifecycleState,
  nextState: LifecycleState,
  reasonCode: string,
  identity: ProcessIdentity | null,
  endpoints: EndpointObservationResult,
  marker: SessionMarkerResult
): ObservationTimeline {
  const entry: TimelineEntry = {
    timestamp: new Date().toISOString(),
    previousState,
    nextState,
    reasonCode,
    gameProcessSummary: identity
      ? `PID ${identity.pid} (${identity.name}) started ${identity.startTime}`
      : 'not_running',
    endpointSummary: endpoints.availability === 'available'
      ? `listeners=${endpoints.listeners.length} connections=${endpoints.connections.length}`
      : `unavailable:${endpoints.availability}`,
    markerSummary: marker.availability === 'available'
      ? (marker.markerPresent ? `present:${marker.markerPath}` : `absent:${marker.markerPath}`)
      : `unavailable:${marker.availability}`,
  };

  const newEntries = [...timeline.entries, entry];
  // Drop oldest entries when over limit
  const bounded = newEntries.length > timeline.maxEntries
    ? newEntries.slice(newEntries.length - timeline.maxEntries)
    : newEntries;

  return { ...timeline, entries: bounded };
}

export function clearTimeline(timeline: ObservationTimeline): ObservationTimeline {
  return createTimeline(timeline.maxEntries);
}

/** Sanitize for export: no secrets, no full process lists, no payloads. */
export function exportTimeline(timeline: ObservationTimeline): object {
  return {
    startedAt: timeline.startedAt,
    entryCount: timeline.entries.length,
    entries: timeline.entries.map(e => ({
      timestamp: e.timestamp,
      previousState: e.previousState,
      nextState: e.nextState,
      reasonCode: e.reasonCode,
      gameProcessSummary: e.gameProcessSummary,
      endpointSummary: e.endpointSummary,
      markerSummary: e.markerSummary,
    })),
  };
}
