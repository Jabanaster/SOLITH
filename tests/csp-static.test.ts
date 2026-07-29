import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const SOURCE_ROOTS = [path.join(ROOT, 'src'), path.join(ROOT, 'electron')];
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

function sourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(entry.name) ? [target] : [];
  });
}

function dynamicCodeViolations(filePath: string): string[] {
  const source = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, 'utf-8'),
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'eval'
    ) {
      violations.push('eval');
    }
    if (
      ts.isNewExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'Function'
    ) {
      violations.push('new Function');
    }
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && (node.expression.text === 'setTimeout' || node.expression.text === 'setInterval')
      && node.arguments[0]
      && (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))
    ) {
      violations.push(`${node.expression.text} string callback`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

describe('production Content Security Policy', () => {
  test('does not include Ollama or LM Studio localhost endpoints', () => {
    const csp = readProductionCsp();
    for (const endpoint of AI_LOCALHOST_ENDPOINTS) {
      assert.equal(csp.includes(endpoint), false, `production CSP must not include ${endpoint}`);
    }
  });

  test('blocks external execution and connection origins by default', () => {
    const csp = readProductionCsp();
    assert.deepStrictEqual(directiveValues(csp, 'default-src'), ["'self'"]);
    assert.deepStrictEqual(directiveValues(csp, 'connect-src'), ["'self'"]);
    assert.deepStrictEqual(directiveValues(csp, 'script-src'), ["'self'"]);
    assert.deepStrictEqual(directiveValues(csp, 'font-src'), ["'self'", 'data:']);
  });

  test('keeps required local packaged resources available', () => {
    const csp = readProductionCsp();
    assert.deepStrictEqual(directiveValues(csp, 'script-src'), ["'self'"]);
    assert.deepStrictEqual(directiveValues(csp, 'style-src'), ["'self'", "'unsafe-inline'"]);
    assert.deepStrictEqual(directiveValues(csp, 'font-src'), ["'self'", 'data:']);
    assert.deepStrictEqual(directiveValues(csp, 'img-src'), [
      "'self'",
      'data:',
      'solith-asset:',
      'https://cdn.cloudflare.steamstatic.com',
      'https://cdn.akamai.steamstatic.com',
    ]);
    assert.deepStrictEqual(directiveValues(csp, 'frame-src'), ["'none'"]);
    assert.deepStrictEqual(directiveValues(csp, 'object-src'), ["'none'"]);
  });

  test('does not leak dev-only localhost endpoints into production HTML', () => {
    const csp = readProductionCsp();
    assert.equal(/\b(?:http|ws):\/\/(?:localhost|127\.0\.0\.1):\d+\b/i.test(csp), false);
  });

  test('never permits unsafe-eval in the production policy', () => {
    assert.equal(readProductionCsp().includes("'unsafe-eval'"), false);
  });

  test('renderer configures Zod jitless mode before importing the application', () => {
    const entry = fs.readFileSync(path.join(ROOT, 'src', 'index.tsx'), 'utf-8');
    const firstImport = entry.match(/^\s*import\s+[^;]+;/m)?.[0] ?? '';
    assert.match(firstImport, /configure-zod-csp/);
    assert.match(
      fs.readFileSync(path.join(ROOT, 'src', 'configure-zod-csp.ts'), 'utf-8'),
      /z\.config\(\{\s*jitless:\s*true\s*\}\)/,
    );
  });

  test('application source contains no direct dynamic-code execution', () => {
    const violations = SOURCE_ROOTS.flatMap((root) =>
      sourceFiles(root).flatMap((filePath) =>
        dynamicCodeViolations(filePath).map((kind) => `${path.relative(ROOT, filePath)}: ${kind}`),
      ),
    );
    assert.deepStrictEqual(violations, []);
  });
});
