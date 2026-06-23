import { TrainerAdapter } from './contract';
import { JsonAdapter } from './json';
import { IniAdapter } from './ini';
import { XmlAdapter } from './xml';
import { CsvAdapter } from './csv';
import { TextAdapter } from './text';
import { LuaAdapter } from './lua';
import { BinaryAdapter } from './binary';

export * from './contract';

const adapters: TrainerAdapter[] = [
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
