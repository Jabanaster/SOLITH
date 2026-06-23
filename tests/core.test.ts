import { test, describe } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

// Resolve module paths
import { scanDirectory, findSaveFiles } from '../src/core/scanner/index.ts';
import { parseSaveFile, extractSafeValues } from '../src/core/saves/index.ts';
import { assessRisk, classifyFile } from '../src/core/safety/index.ts';
import { compareSaves, calculateScore } from '../src/core/discovery/index.ts';
import { verifyRecipeSafety } from '../src/core/recipes/index.ts';

describe('ResourceForge Core Modules Tests', () => {
  
  test('1. Scanner & Save Detection Checks', () => {
    // Save detection extensions and folders list
    const sampleDir = path.resolve('./demo-game');
    
    // Scan local demo directory (ensure it doesn't crash)
    const scan = scanDirectory(sampleDir);
    assert.ok(Array.isArray(scan.saveFiles));
    assert.ok(Array.isArray(scan.configFiles));
    
    // Verify external save locations are NOT scanned when approval is disabled
    const savesWithoutApproval = findSaveFiles(sampleDir, false);
    // Should find at least save1.json and save2.json from local demo folder
    assert.ok(savesWithoutApproval.length >= 2);
    
    // Verify it blocks system files from scans
    const classification = classifyFile('cheat_engine.exe', '.exe');
    assert.strictEqual(classification.risk, 'BLOCKED');
  });

  test('2. Custom Parsers Tests', () => {
    // 2a. JSON with comments
    const jsonWithComments = `
      {
        // This is a comment
        "health": 100,
        /* Multi-line
           comment */
        "gold": 250
      }
    `;
    const tempJsonFile = './temp_test_save.json';
    fs.writeFileSync(tempJsonFile, jsonWithComments);
    try {
      const parsed = parseSaveFile(tempJsonFile);
      assert.ok(parsed);
      assert.strictEqual(parsed.format, 'json');
      assert.strictEqual(parsed.data.health, 100);
      assert.strictEqual(parsed.data.gold, 250);
    } finally {
      if (fs.existsSync(tempJsonFile)) fs.unlinkSync(tempJsonFile);
    }

    // 2b. INI / CFG
    const iniContent = `
      # Global config
      [player]
      hp = 80
      stamina = 50
      
      ; inventory
      [items]
      potions = 5
    `;
    const tempIniFile = './temp_test_save.ini';
    fs.writeFileSync(tempIniFile, iniContent);
    try {
      const parsed = parseSaveFile(tempIniFile);
      assert.ok(parsed);
      assert.strictEqual(parsed.format, 'ini');
      assert.strictEqual(parsed.data.player.hp, 80);
      assert.strictEqual(parsed.data.items.potions, 5);
    } finally {
      if (fs.existsSync(tempIniFile)) fs.unlinkSync(tempIniFile);
    }

    // 2c. XML (synchronous callback parsing)
    const xmlContent = `
      <save>
        <player>
          <health>120</health>
          <xp>4500</xp>
        </player>
      </save>
    `;
    const tempXmlFile = './temp_test_save.xml';
    fs.writeFileSync(tempXmlFile, xmlContent);
    try {
      const parsed = parseSaveFile(tempXmlFile);
      assert.ok(parsed);
      assert.strictEqual(parsed.format, 'xml');
      // xml2js structures element text inside arrays by default
      assert.strictEqual(parsed.data.save.player[0].health[0], '120');
    } finally {
      if (fs.existsSync(tempXmlFile)) fs.unlinkSync(tempXmlFile);
    }

    // 2d. CSV / TSV
    const csvContent = `id,name,damage,price\n1,Sword,15,100\n2,Shield,0,75`;
    const tempCsvFile = './temp_test_save.csv';
    fs.writeFileSync(tempCsvFile, csvContent);
    try {
      const parsed = parseSaveFile(tempCsvFile);
      assert.ok(parsed);
      assert.strictEqual(parsed.format, 'csv');
      assert.strictEqual(parsed.data[1][1], 'Sword');
      assert.strictEqual(parsed.data[1][2], 15);
    } finally {
      if (fs.existsSync(tempCsvFile)) fs.unlinkSync(tempCsvFile);
    }

    // 2e. Lua-like table (safe regex)
    const luaContent = `{
      health = 150,
      gold = 400,
      heroName = "Arthur",
      unlocked = true
    }`;
    const tempLuaFile = './temp_test_save.lua';
    fs.writeFileSync(tempLuaFile, luaContent);
    try {
      const parsed = parseSaveFile(tempLuaFile);
      assert.ok(parsed);
      assert.strictEqual(parsed.data.health, 150);
      assert.strictEqual(parsed.data.gold, 400);
      assert.strictEqual(parsed.data.heroName, 'Arthur');
      assert.strictEqual(parsed.data.unlocked, true);
    } finally {
      if (fs.existsSync(tempLuaFile)) fs.unlinkSync(tempLuaFile);
    }
  });

  test('3. Binary Save Safe Analysis Checks', () => {
    // Create a mock binary buffer with NULL bytes and printable strings
    const binaryBuffer = Buffer.concat([
      Buffer.from([0x00, 0x01, 0x02, 0x00]),
      Buffer.from('PlayerGold'),
      Buffer.from([0x00, 0x64, 0x00, 0x00]) // contains 100
    ]);
    
    const tempBinFile = './temp_test_save.sav';
    fs.writeFileSync(tempBinFile, binaryBuffer);
    try {
      const parsed = parseSaveFile(tempBinFile);
      assert.ok(parsed);
      assert.strictEqual(parsed.format, 'binary');
      assert.strictEqual(parsed.data.isBinary, true);
      // Verify string extraction
      assert.ok(parsed.data.strings.includes('PlayerGold'));
      
      // Verify safe values list (should contain meta size and hash)
      const values = extractSafeValues(parsed);
      assert.ok(values.some(v => v.path === 'meta.hash'));
    } finally {
      if (fs.existsSync(tempBinFile)) fs.unlinkSync(tempBinFile);
    }
  });

  test('4. Value Classification and Confidence Scoring', () => {
    // 4a. Risk Assessment Keywords
    const safeRisk = assessRisk('player.health', '100');
    assert.strictEqual(safeRisk.risk, 'Safe');
    
    const riskyRisk = assessRisk('game.uuid_quest_id', 'abc-def');
    assert.strictEqual(riskyRisk.risk, 'Risky');

    const blockedRisk = assessRisk('game.multiplayer_auth_token', 'session123');
    assert.strictEqual(blockedRisk.risk, 'Blocked');

    // 4b. Confidence Scoring Pass
    const highConf = calculateScore({
      path: 'player.gold',
      oldValue: 100,
      newValue: 250,
      confidence: 60,
      description: ''
    });
    // Boosted due to safe keyword (gold), numeric change, exact match
    assert.ok(highConf >= 80);

    const blockedConf = calculateScore({
      path: 'security.checksum',
      oldValue: 'a1',
      newValue: 'b2',
      confidence: 60,
      description: ''
    });
    // Should be blocked completely (confidence = 0)
    assert.strictEqual(blockedConf, 0);
  });

  test('5. Recipe Safety & Staleness Verification', () => {
    const tempTarget = './temp_recipe_target.json';
    fs.writeFileSync(tempTarget, JSON.stringify({ health: 100, name: 'Arthur' }));
    
    try {
      // Mock recipe
      const recipe = {
        id: 'recipe-1',
        gameId: 'game-1',
        name: 'Set Health',
        category: 'PLAYER',
        source: 'SAVE',
        target: tempTarget,
        path: 'health',
        valueType: 'number',
        risk: 'Safe',
        requiresBackup: false,
        confidence: 90,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        fileHash: crypto.createHash('sha256').update(fs.readFileSync(tempTarget)).digest('hex')
      };

      // 5a. Ready status
      const safetyReady = verifyRecipeSafety(recipe);
      assert.strictEqual(safetyReady, 'Ready');

      // 5b. Broken status (path no longer exists)
      const brokenRecipe = { ...recipe, path: 'stamina' };
      const safetyBroken = verifyRecipeSafety(brokenRecipe);
      assert.strictEqual(safetyBroken, 'Broken');

      // 5c. Needs Rescan status (file hash mismatch)
      fs.writeFileSync(tempTarget, JSON.stringify({ health: 150, name: 'Arthur' }));
      const safetyRescan = verifyRecipeSafety(recipe);
      assert.strictEqual(safetyRescan, 'Needs Rescan');

    } finally {
      if (fs.existsSync(tempTarget)) fs.unlinkSync(tempTarget);
    }
  });
});
