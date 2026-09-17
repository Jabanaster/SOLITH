/**
 * PE structural metadata via LIEF (ROADMAP.md Phase 3: "LIEF — FULL — PE
 * header/section/import/export/signing parsing, replaces pe-analyzer.ts").
 *
 * KNOWN GAP (verified, not guessed): the `node-lief` binding actually
 * available (v1.3.2) exposes sections/header/optionalHeader/symbols/
 * relocations/entrypoint for PE, but its shipped TypeScript surface has no
 * import table, export table, resource directory (so no VS_VERSIONINFO /
 * FileVersion), or Authenticode signature API — confirmed by reading
 * node_modules/node-lief/lib/index.d.ts in full, not assumed. Only the
 * structural subset below is therefore a real LIEF adoption; import/export/
 * signing parsing remains NOT_STARTED, blocked on binding capability (not
 * Phase 2), and must not be claimed as done.
 *
 * The generic `AbstractHeader.architecture` numeric field is also
 * undocumented in this binding (no exported enum to decode it against), so
 * this module deliberately does NOT map it to a machine-type name — that
 * would be a guessed identity, prohibited by the roadmap's certification
 * standard. Bitness comes from the well-documented `is_32`/`is_64` fields
 * and `optionalHeader.magic` instead. Because real Windows PC games are
 * overwhelmingly x86/x64 (native ARM64 Windows games are not a realistic
 * case for this product), PE32_PLUS is reported as "x64" — a documented
 * simplification, not a silent guess.
 */
import lief from 'node-lief';

let loggingSilenced = false;
function silenceLiefLogging(): void {
  if (loggingSilenced) return;
  lief.logging.disable();
  loggingSilenced = true;
}

// Standard Microsoft PE/COFF subsystem constants (winnt.h IMAGE_SUBSYSTEM_*) —
// not LIEF-specific, safe to hardcode; identical to what pe-analyzer.ts's own
// hand-rolled table used before this module replaced it.
const SUBSYSTEM_NAMES: Record<number, string> = {
  1: 'native',
  2: 'windows-gui',
  3: 'windows-cui',
};

export interface PeSectionMetadata {
  name: string;
  virtualSize: number;
  rawSize: number;
}

export interface PeStructuralMetadata {
  isPe: true;
  bitness: 'x86' | 'x64';
  subsystem: string;
  entryPoint: string;
  imageBase: string;
  majorImageVersion: number;
  minorImageVersion: number;
  sections: PeSectionMetadata[];
}

export interface NotPeMetadata {
  isPe: false;
}

/**
 * Parses a local file's PE structure via LIEF. Read-only — never executes
 * the target. Returns `{isPe: false}` for any non-PE or unparseable input
 * (empty, truncated, corrupt, or a different executable format entirely)
 * rather than throwing, since callers (trainer research, on untrusted
 * user-supplied binaries) must treat "not a valid PE" as an ordinary,
 * expected outcome. Verified against empty/garbage/truncated inputs during
 * this stage's implementation: LIEF always either throws a catchable JS
 * error or returns a best-effort partial parse — never crashes the process.
 */
export function resolvePeStructuralMetadata(filePath: string): PeStructuralMetadata | NotPeMetadata {
  silenceLiefLogging();
  try {
    const bin = lief.parse(filePath);
    if (bin.format !== 'PE') return { isPe: false };

    const sections: PeSectionMetadata[] = bin.sections().map((section) => ({
      name: section.name,
      virtualSize: Number(section.virtualSize),
      rawSize: Number(section.size),
    }));

    return {
      isPe: true,
      bitness: bin.optionalHeader.magic === 'PE32_PLUS' ? 'x64' : 'x86',
      subsystem: SUBSYSTEM_NAMES[bin.optionalHeader.subsystem] ?? `unknown(${bin.optionalHeader.subsystem})`,
      entryPoint: `0x${bin.entrypoint.toString(16).toUpperCase()}`,
      imageBase: `0x${bin.optionalHeader.imagebase.toString(16).toUpperCase()}`,
      majorImageVersion: bin.optionalHeader.majorImageVersion,
      minorImageVersion: bin.optionalHeader.minorImageVersion,
      sections,
    };
  } catch {
    return { isPe: false };
  }
}
