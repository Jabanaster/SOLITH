import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { isGenericContainerName } from '../scripts/lib/generic-container-names.mjs';

describe('isGenericContainerName (future ingest hygiene guard)', () => {
  const junk = [
    'ZZ_Tools', 'zz_tools', 'zz tools',
    'ZZ_Others', 'zz_others', 'zz others',
    'tables', 'Tables', 'table', 'cheat-tables', 'cheat tables',
    'cheatengine-tables-master', 'CheatEngineTables-master',
    'cheatenginetables-master', 'CheatEngine-Tables-Master',
    'vault', 'scripts', 'users scripts', 'data', 'ct', 'files',
    'Cheat Engine Tutorial', 'tutorial',
  ];
  for (const name of junk) {
    test(`"${name}" is rejected as a generic container`, () => {
      assert.equal(isGenericContainerName(name), true);
    });
  }

  const realGames = [
    'Stardew Valley', 'Subnautica', 'Cyberpunk 2077', 'Dredge',
    'Grim Dawn', 'Far Cry 5', 'Table Top Racing', // "Table Top Racing" must not collide with "table"/"tables"
  ];
  for (const name of realGames) {
    test(`"${name}" is NOT rejected as a generic container`, () => {
      assert.equal(isGenericContainerName(name), false);
    });
  }
});
