import type { RuntimeModuleInfo } from './module-inspection.js';
import type { ReadOnlyMemoryReader } from './memory-reader.js';
import { DEFAULT_RUNTIME_POLICY, assertReadOnlyPolicy, type RuntimePolicy } from './runtime-policy.js';

export interface ParsedAobToken { value: number | null }
export interface SignatureScanResult {
  module: string;
  pattern: string;
  matches: Array<{ offset: number; address: string }>;
  truncated: boolean;
  timedOut: boolean;
}

export function parseAobPattern(pattern: string): ParsedAobToken[] {
  return pattern.trim().split(/\s+/).filter(Boolean).map((token) => {
    if (/^[0-9A-Fa-f]{2}$/.test(token)) return { value: Number.parseInt(token, 16) };
    if (/^\?+$/.test(token) || /^\*+$/.test(token)) return { value: null };
    throw new Error(`Invalid AOB token "${token}".`);
  });
}

export async function scanModuleForSignature(input: {
  module: RuntimeModuleInfo;
  pattern: string;
  reader: ReadOnlyMemoryReader;
  policy?: RuntimePolicy;
  signal?: AbortSignal;
}): Promise<SignatureScanResult> {
  const policy = input.policy ?? DEFAULT_RUNTIME_POLICY;
  assertReadOnlyPolicy(policy);
  const tokens = parseAobPattern(input.pattern);
  const scanBytes = Math.min(input.module.size, policy.maxScanBytes);
  const haystack = await input.reader.readModuleBytes(input.module, 0, scanBytes);
  const started = Date.now();
  const matches: SignatureScanResult['matches'] = [];

  for (let offset = 0; offset <= haystack.length - tokens.length; offset += 1) {
    if (input.signal?.aborted) throw new Error('Signature scan cancelled.');
    if (Date.now() - started > policy.timeoutMs) {
      return { module: input.module.name, pattern: input.pattern, matches, truncated: scanBytes < input.module.size, timedOut: true };
    }
    let ok = true;
    for (let i = 0; i < tokens.length; i += 1) {
      const expected = tokens[i].value;
      if (expected != null && haystack[offset + i] !== expected) {
        ok = false;
        break;
      }
    }
    if (ok) matches.push({ offset, address: `0x${(input.module.baseAddress + BigInt(offset)).toString(16)}` });
  }

  return { module: input.module.name, pattern: input.pattern, matches, truncated: scanBytes < input.module.size, timedOut: false };
}
