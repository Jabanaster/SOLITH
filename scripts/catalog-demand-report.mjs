#!/usr/bin/env node
import { initDatabase } from '../src/core/database/index.ts';
import { listCatalogDemandSorted } from '../src/core/catalog-demand/store.ts';

await initDatabase();
const demand = listCatalogDemandSorted(100);
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), demand }, null, 2));
