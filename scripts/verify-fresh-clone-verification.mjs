import fs from 'node:fs';
import path from 'node:path';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    fail(`Unable to read ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function parseExpectedCount(reportText) {
  const match = reportText.match(/\|\s*`npm test`\s*\|\s*\*\*PASS\*\*\s*\|\s*(\d+)\/(\d+)\s*\|/);
  if (!match) {
    fail('Could not find a documented npm test pass count in the report.');
  }
  return { pass: Number(match[1]), total: Number(match[2]) };
}

function parseActualCount(testText) {
  const passMatch = testText.match(/^\s*# pass\s+(\d+)\s*$/m);
  const testsMatch = testText.match(/^\s*# tests\s+(\d+)\s*$/m);
  if (!passMatch || !testsMatch) {
    fail('Could not find npm test summary lines in the captured output.');
  }

  const failMatch = testText.match(/^\s*# fail\s+(\d+)\s*$/m);
  const actualPass = Number(passMatch[1]);
  const actualTotal = Number(testsMatch[1]);
  const actualFail = failMatch ? Number(failMatch[1]) : 0;

  if (actualPass + actualFail > actualTotal) {
    fail(`Captured npm test summary is inconsistent: pass=${actualPass}, fail=${actualFail}, tests=${actualTotal}.`);
  }

  return { pass: actualPass, total: actualTotal };
}

const [reportArg, outputArg] = process.argv.slice(2);
if (!reportArg || !outputArg) {
  fail('Usage: node scripts/verify-fresh-clone-verification.mjs <report-md> <npm-test-log>');
}

const reportPath = path.resolve(reportArg);
const outputPath = path.resolve(outputArg);
const reportText = readText(reportPath);
const testText = readText(outputPath);

const expected = parseExpectedCount(reportText);
const actual = parseActualCount(testText);

if (expected.pass !== actual.pass || expected.total !== actual.total) {
  fail(
    `Fresh-clone report drift detected: report says ${expected.pass}/${expected.total}, ` +
      `captured npm test says ${actual.pass}/${actual.total}.`,
  );
}

console.log(`Fresh-clone report matches npm test output: ${actual.pass}/${actual.total}`);
