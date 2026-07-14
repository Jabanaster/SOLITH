#!/usr/bin/env node
import { initDatabase } from '../src/core/database/index.ts';
import { listTrainerHealthRecords } from '../src/core/trainer-health/index.ts';

await initDatabase();
const records = listTrainerHealthRecords();
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2));
