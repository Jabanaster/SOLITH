// Structured startup-timing instrumentation for diagnosing gray-screen /
// slow-launch behavior. performance.now() is relative to the Node process's
// performance.timeOrigin (process start), so each mark is a direct
// process-start-to-event delta with no manual epoch bookkeeping needed.
//
// Logs only a fixed event name and a millisecond offset — never paths, file
// contents, tokens, URLs, process payloads, or other sensitive/user state.
// No in-memory accumulation (nothing is stored — each mark is written and
// discarded immediately), so there is no unbounded growth to reset.
//
// Silent by default. Emits nothing unless explicitly enabled via
// SOLITH_STARTUP_TRACE=1, so packaged/production runs stay quiet.
import { performance } from 'node:perf_hooks';

const enabled = process.env.SOLITH_STARTUP_TRACE === '1';

export function mark(event: string): void {
  if (!enabled) return;
  const t = performance.now();
  console.log(`[startup-timing] event=${event} t_ms=${t.toFixed(1)}`);
}
