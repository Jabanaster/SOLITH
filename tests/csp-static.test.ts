import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const AI_LOCALHOST_ENDPOINTS = [
  'http://localhost:11434',
  'http://127.0.0.1:11434',
  'http://localhost:1234',
  'http://127.0.0.1:1234',
];

function readProductionCsp(): string {
  const html = fs.readFileSync(INDEX_HTML, 'utf-8');
  const match = html.match(/<meta\s+http-equiv=["']Content-Security-Policy["']\s+content=["']([\s\S]*?)["']\s*\/?>/i);
  assert.ok(match, 'index.html must define a Content-Security-Policy meta tag');
  return match[1].replace(/\s+/g, ' ').trim();
}

function directiveValues(csp: string, directiveName: string): string[] {
  const directive = csp
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${directiveName} `));
  assert.ok(directive, `CSP must include ${directiveName}`);
  return directive.split(/\s+/).slice(1);
}

describe('production Content Security Policy', () => {
  test('does not include Ollama or LM Studio localhost endpoints', () => {
    const csp = readProductionCsp();
    for (const endpoint of AI_LOCALHOST_ENDPOINTS) {
      assert.equal(csp.includes(endpoint), false, `production CSP must not include ${endpoint}`);
    }
  });

  test('blocks external network origins by default', () => {
    const csp = readProductionCsp();
    assert.deepStrictEqual(directiveValues(csp, 'default-src'), ["'self'"]);
    assert.deepStrictEqual(directiveValues(csp, 'connect-src'), ["'self'"]);
    assert.equal(/https?:\/\/(?!localhost(?::|\/)|127\.0\.0\.1(?::|\/))\S+/i.test(csp), false);
  });

  test('keeps required local packaged resources available', () => {
    const csp = readProductionCsp();
    assert.deepStrictEqual(directiveValues(csp, 'script-src'), ["'self'"]);
    assert.deepStrictEqual(directiveValues(csp, 'style-src'), ["'self'", "'unsafe-inline'"]);
    assert.deepStrictEqual(directiveValues(csp, 'font-src'), ["'self'", 'data:']);
    assert.deepStrictEqual(directiveValues(csp, 'img-src'), ["'self'", 'data:']);
    assert.deepStrictEqual(directiveValues(csp, 'frame-src'), ["'none'"]);
    assert.deepStrictEqual(directiveValues(csp, 'object-src'), ["'none'"]);
  });

  test('does not leak dev-only localhost endpoints into production HTML', () => {
    const csp = readProductionCsp();
    assert.equal(/\b(?:http|ws):\/\/(?:localhost|127\.0\.0\.1):\d+\b/i.test(csp), false);
  });
});
