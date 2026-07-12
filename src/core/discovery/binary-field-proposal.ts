/**
 * Proposes binary save field candidates from before/after byte diffs.
 * Used by Discovery Lab when comparing two save snapshots.
 */

export interface BinaryFieldProposal {
  offset: number;
  before: number;
  after: number;
  width: 1 | 2 | 4 | 8;
  confidence: 'low' | 'medium' | 'high';
  suggestedFieldId?: string;
}

const CORE_FIELD_OFFSETS: Record<number, string> = {
  16: 'gold',
  20: 'hp',
  24: 'stamina',
};

function readLeInt(bytes: Uint8Array, offset: number, width: 1 | 2 | 4 | 8): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (width === 1) return view.getUint8(offset);
  if (width === 2) return view.getUint16(offset, true);
  if (width === 4) return view.getInt32(offset, true);
  return Number(view.getBigInt64(offset, true));
}

export function proposeFieldsFromByteDiff(
  before: Uint8Array,
  after: Uint8Array,
  options: { maxProposals?: number } = {},
): BinaryFieldProposal[] {
  const max = options.maxProposals ?? 32;
  const len = Math.min(before.length, after.length);
  const proposals: BinaryFieldProposal[] = [];

  for (const width of [4, 2, 1] as const) {
    for (let offset = 0; offset <= len - width; offset += width) {
      const b = readLeInt(before, offset, width);
      const a = readLeInt(after, offset, width);
      if (b === a) continue;

      const suggested = CORE_FIELD_OFFSETS[offset];
      let confidence: BinaryFieldProposal['confidence'] = 'low';
      if (suggested) confidence = 'high';
      else if (width === 4 && offset >= 8 && offset < 64) confidence = 'medium';

      proposals.push({
        offset,
        before: b,
        after: a,
        width,
        confidence,
        suggestedFieldId: suggested,
      });
    }
  }

  proposals.sort((x, y) => {
    const rank = { high: 0, medium: 1, low: 2 };
    return rank[x.confidence] - rank[y.confidence] || x.offset - y.offset;
  });

  return proposals.slice(0, max);
}
