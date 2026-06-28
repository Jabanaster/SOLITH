import { TrainerAdapter } from './contract';
import { DrillCoreSettingsAdapter } from './drill-core-settings';
import { JsonAdapter } from './json';
import { IniAdapter } from './ini';
import { XmlAdapter } from './xml';
import { CsvAdapter } from './csv';
import { TextAdapter } from './text';
import { LuaAdapter } from './lua';
import { BinaryAdapter } from './binary';

export * from './contract';

// Narrow, byte-preserving adapters are listed first so they take precedence
// over the generic family adapters for the specific files they support.
const adapters: TrainerAdapter[] = [
  new DrillCoreSettingsAdapter(),
  new JsonAdapter(),
  new IniAdapter(),
  new XmlAdapter(),
  new CsvAdapter(),
  new TextAdapter(),
  new LuaAdapter(),
  new BinaryAdapter()
];

export function getAdapterForFile(filePath: string): TrainerAdapter | null {
  for (const adapter of adapters) {
    if (adapter.supports(filePath)) {
      return adapter;
    }
  }
  return null;
}

export function getAllAdapters(): TrainerAdapter[] {
  return adapters;
}
