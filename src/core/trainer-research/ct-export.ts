import type { MemoryDiffCandidate } from './types.js';

function mapVariableType(dataType: string): string {
  switch (dataType) {
    case 'float':
      return 'Float';
    case 'double':
      return 'Double';
    case 'int64':
      return '8 Bytes';
    case 'byte':
      return 'Byte';
    case 'uint32':
    case 'int32':
    default:
      return '4 Bytes';
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function exportCandidatesToCheatTableXml(
  title: string,
  candidates: MemoryDiffCandidate[],
  options: { gameExecutable?: string } = {},
): string {
  const entries = candidates
    .map((candidate) => {
      const name = candidate.label.trim() || `Research ${candidate.address}`;
      const address = candidate.address.startsWith('0x')
        ? candidate.address
        : `0x${BigInt(candidate.address).toString(16).toUpperCase()}`;
      const moduleHint = options.gameExecutable
        ? `\n      <Comments>Solith research export — verify against ${options.gameExecutable}</Comments>`
        : '\n      <Comments>Solith External Trainer Research Lab export — verify address after game patch</Comments>';

      return `    <CheatEntry>
      <ID>${escapeXml(candidate.id)}</ID>
      <Description>"${escapeXml(name)}"</Description>
      <VariableType>${mapVariableType(candidate.dataType)}</VariableType>
      <Address>${address}</Address>${moduleHint}
    </CheatEntry>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<CheatTable CheatTableVersion="42">
  <CheatEntries>
${entries || '    <!-- No candidates selected -->'}
  </CheatEntries>
  <UserdefinedSymbols/>
  <Comments>Solith research export for "${escapeXml(title)}" — memory entries only, no scripts.</Comments>
</CheatTable>
`;
}
