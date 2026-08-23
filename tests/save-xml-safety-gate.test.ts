import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseSaveFile, parseSaveFileStrict } from '../src/core/saves/index.js';

// Finding R2 (independent security review, d3397bb): parseSaveFileStrict()
// parsed .xml-extension save files directly with xml2js.Parser, unlike every
// other XML entry point in the codebase (.CT import, metadata/script
// fallbacks), which all route through validateXmlSafety first. This suite
// proves the same gate now runs before the parser on this path too.

function withTempXmlFile(content: string, run: (filePath: string) => void): void {
  const filePath = path.join(os.tmpdir(), `solith-save-xml-safety-${Date.now()}-${Math.random().toString(36).slice(2)}.xml`);
  fs.writeFileSync(filePath, content);
  try {
    run(filePath);
  } finally {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

describe('parseSaveFileStrict — Finding R2 save-file XML safety gate', () => {
  test('accepts a legitimate nested save XML fixture', () => {
    withTempXmlFile(
      `<save><player><health>120</health><xp>4500</xp></player></save>`,
      (filePath) => {
        const parsed = parseSaveFileStrict(filePath);
        assert.equal(parsed.format, 'xml');
        assert.equal((parsed.data as any).save.player[0].health[0], '120');
      },
    );
  });

  test('rejects a bare DOCTYPE declaration before the parser ever runs', () => {
    withTempXmlFile(
      `<!DOCTYPE save><save><player><health>120</health></player></save>`,
      (filePath) => {
        assert.throws(() => parseSaveFileStrict(filePath), /DOCTYPE/i);
      },
    );
  });

  test('rejects a DOCTYPE with an ENTITY declaration', () => {
    withTempXmlFile(
      `<!DOCTYPE save [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><save>&xxe;</save>`,
      (filePath) => {
        assert.throws(() => parseSaveFileStrict(filePath), /DOCTYPE/i);
      },
    );
  });

  test('rejects an over-size XML save file', () => {
    const big = `<save>${'<x>a</x>'.repeat(700_000)}</save>`; // > 5MB
    withTempXmlFile(big, (filePath) => {
      assert.throws(() => parseSaveFileStrict(filePath), /size exceeds safe limit/i);
    });
  });

  test('rejects excessive nesting depth', () => {
    const depth = 300;
    const nested = '<save>' + '<a>'.repeat(depth) + '</a>'.repeat(depth) + '</save>';
    withTempXmlFile(nested, (filePath) => {
      assert.throws(() => parseSaveFileStrict(filePath), /nesting depth exceeds/i);
    });
  });

  test('malformed XML fails via the parser after passing the safety gate, not silently', () => {
    withTempXmlFile(`<save><player><health>120</health></save>`, (filePath) => {
      // Well-formed enough to pass the safety pre-scan but invalid XML —
      // must still fail (via the underlying xml2js parse error), not return
      // a false success.
      assert.throws(() => parseSaveFileStrict(filePath));
    });
  });

  test('the safety gate runs before the parser: a DOCTYPE-blocked file never reaches parseSaveFile as a success', () => {
    withTempXmlFile(`<!DOCTYPE save><save><player><health>1</health></player></save>`, (filePath) => {
      const parsed = parseSaveFile(filePath);
      assert.equal(parsed, null);
    });
  });
});
