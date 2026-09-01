import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateRedirectTarget } from '../src/core/trainer-catalog/sync/remote-sync.js';

// Finding R1 (independent security review, d3397bb): fetchHtml() in
// remote-sync.ts followed redirects with a count cap and a response-size cap
// but never revalidated the redirect *target* itself. This is the deny-path
// unit coverage for the strict same-host, HTTPS-only redirect policy added to
// close that gap: validateRedirectTarget() must reject anything that isn't
// exactly the original request's hostname over https, before the caller ever
// issues the next fetch.

describe('validateRedirectTarget — Finding R1 remote-sync redirect revalidation', () => {
  test('allows a same-host HTTPS redirect', () => {
    const target = validateRedirectTarget(
      'https://flingtrainer.com/other-page',
      'https://flingtrainer.com/',
      'flingtrainer.com',
    );
    assert.equal(target.toString(), 'https://flingtrainer.com/other-page');
  });

  test('allows a same-host HTTPS redirect expressed as a relative Location header', () => {
    const target = validateRedirectTarget('/moved', 'https://flingtrainer.com/original', 'flingtrainer.com');
    assert.equal(target.toString(), 'https://flingtrainer.com/moved');
  });

  test('allows a redirect chain that stays within the allowed host', () => {
    const first = validateRedirectTarget('https://flingtrainer.com/step2', 'https://flingtrainer.com/step1', 'flingtrainer.com');
    const second = validateRedirectTarget('https://flingtrainer.com/step3', first.toString(), 'flingtrainer.com');
    assert.equal(second.toString(), 'https://flingtrainer.com/step3');
  });

  test('rejects a redirect downgrading to http', () => {
    assert.throws(
      () => validateRedirectTarget('http://flingtrainer.com/page', 'https://flingtrainer.com/', 'flingtrainer.com'),
      /disallowed scheme/i,
    );
  });

  test('rejects a redirect to localhost', () => {
    assert.throws(
      () => validateRedirectTarget('https://localhost/admin', 'https://flingtrainer.com/', 'flingtrainer.com'),
      /disallowed host/i,
    );
  });

  test('rejects a redirect to 127.0.0.1', () => {
    assert.throws(
      () => validateRedirectTarget('https://127.0.0.1:8080/', 'https://flingtrainer.com/', 'flingtrainer.com'),
      /disallowed host/i,
    );
  });

  test('rejects a redirect to a private RFC1918 address', () => {
    assert.throws(
      () => validateRedirectTarget('https://192.168.1.5/', 'https://flingtrainer.com/', 'flingtrainer.com'),
      /disallowed host/i,
    );
  });

  test('rejects a redirect to an unrelated public host', () => {
    assert.throws(
      () => validateRedirectTarget('https://evil.example.com/steal', 'https://flingtrainer.com/', 'flingtrainer.com'),
      /disallowed host/i,
    );
  });

  test('rejects a redirect carrying embedded credentials', () => {
    assert.throws(
      () => validateRedirectTarget('https://user:pass@flingtrainer.com/', 'https://flingtrainer.com/', 'flingtrainer.com'),
      /embedded credentials/i,
    );
  });

  test('rejects a malformed Location header', () => {
    assert.throws(
      () => validateRedirectTarget('https://[not-a-valid-ipv6-literal', 'https://flingtrainer.com/', 'flingtrainer.com'),
      /malformed/i,
    );
  });

  test('rejects an unsupported protocol redirect target', () => {
    assert.throws(
      () => validateRedirectTarget('file:///etc/passwd', 'https://flingtrainer.com/', 'flingtrainer.com'),
      /disallowed scheme/i,
    );
  });
});
