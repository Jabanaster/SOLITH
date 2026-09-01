import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { validateXmlSafety } from '../src/core/adapters/xml.ts';

// Residual 1 (SOLITH non-frozen V1 cleanup pass): validateXmlSafety's depth
// counter used to be a single regex sweep (`/<(\/?[a-zA-Z_][\w\-.:]*)(?:\s+[^>]*)*>/g`)
// that could not distinguish real structural tags from '<'/'>' text that
// merely *looks* like a tag inside a comment, CDATA section, or a quoted
// attribute value. These prove the replacement tokenizer counts structural
// depth correctly across those cases while still rejecting real
// over-nesting and structural evasion attempts.

describe('validateXmlSafety — structural depth scanning', () => {
  test('accepts normal shallow XML', () => {
    const result = validateXmlSafety('<save><player><health>120</health></player></save>');
    assert.equal(result.safe, true);
  });

  test('accepts namespaced elements', () => {
    const result = validateXmlSafety(
      '<save xmlns:g="urn:game"><g:player><g:health>120</g:health></g:player></save>',
    );
    assert.equal(result.safe, true);
  });

  test('does not count fake tags inside a comment', () => {
    const fakeDepth = '<a>'.repeat(400).split('').join('');
    const content = `<save><!-- ${'<a>'.repeat(400)} --><player>1</player></save>`;
    const result = validateXmlSafety(content);
    assert.equal(result.safe, true, result.error);
    void fakeDepth;
  });

  test('does not count fake tags inside CDATA', () => {
    const content = `<save><notes><![CDATA[${'<a>'.repeat(400)}]]></notes></save>`;
    const result = validateXmlSafety(content);
    assert.equal(result.safe, true, result.error);
  });

  test('does not terminate a tag early on a quoted ">" in an attribute', () => {
    // If '>' inside the quoted attribute value were treated as the tag
    // terminator, the real closing '>' after `foo` would be seen as stray
    // text and the element count/nesting would be thrown off.
    const content = `<save><entry note="a > b"><value>1</value></entry></save>`;
    const result = validateXmlSafety(content);
    assert.equal(result.safe, true, result.error);
  });

  test('does not terminate a tag early on a quoted ">" using single quotes', () => {
    const content = `<save><entry note='a > b'><value>1</value></entry></save>`;
    const result = validateXmlSafety(content);
    assert.equal(result.safe, true, result.error);
  });

  test('accepts valid self-closing tags without counting them as nesting', () => {
    const content = `<save><flag enabled="true" /><flag2 enabled="false"/></save>`;
    const result = validateXmlSafety(content);
    assert.equal(result.safe, true, result.error);
  });

  test('accepts a processing instruction preamble', () => {
    const content = `<?xml version="1.0" encoding="UTF-8"?><save><player>1</player></save>`;
    const result = validateXmlSafety(content);
    assert.equal(result.safe, true, result.error);
  });

  test('rejects true nesting beyond the maximum depth', () => {
    const depth = 300;
    const content = '<save>' + '<a>'.repeat(depth) + '</a>'.repeat(depth) + '</save>';
    const result = validateXmlSafety(content);
    assert.equal(result.safe, false);
    assert.match(result.error ?? '', /nesting depth exceeds/i);
  });

  test('rejects malformed structural nesting (unbalanced closers) once real depth is exceeded', () => {
    const depth = 300;
    // No closing tags at all — depth climbs monotonically and must still trip.
    const content = '<save>' + '<a>'.repeat(depth);
    const result = validateXmlSafety(content);
    assert.equal(result.safe, false);
    assert.match(result.error ?? '', /nesting depth exceeds/i);
  });

  test('rejects a crafted structure that tries to hide real depth behind comments between real tags', () => {
    // The comments themselves must not count, but the real tags surrounding
    // them still must — an evasion attempt that assumes comment bodies are
    // never scanned would otherwise let real depth slip through uncounted.
    const depth = 300;
    let content = '<save>';
    for (let i = 0; i < depth; i++) {
      content += '<!-- decoy --><a>';
    }
    content += '<!-- decoy -->';
    const result = validateXmlSafety(content);
    assert.equal(result.safe, false);
    assert.match(result.error ?? '', /nesting depth exceeds/i);
  });

  test('old regex-fooling shape (fake nesting only inside comments/CDATA) no longer influences the count', () => {
    // Under the old regex, comment/CDATA bodies were scanned for tag-shaped
    // text just like real markup. This fixture has zero real structural
    // depth beyond 2, but would have registered as deeply nested under the
    // old implementation.
    const decoyDepth = 400;
    const content =
      `<save>` +
      `<!-- ${'<x>'.repeat(decoyDepth)} -->` +
      `<meta><![CDATA[${'<x>'.repeat(decoyDepth)}]]></meta>` +
      `</save>`;
    const result = validateXmlSafety(content);
    assert.equal(result.safe, true, result.error);
  });
});
