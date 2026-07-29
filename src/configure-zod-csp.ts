import { z } from 'zod';

// Zod otherwise probes dynamic-code support with `new Function("")`.
// Strict renderer CSPs correctly block that probe and report a violation.
// Jitless mode uses Zod's CSP-safe validation path in development and builds.
z.config({ jitless: true });
