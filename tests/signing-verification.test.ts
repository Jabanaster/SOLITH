import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSigningStatus } from '../scripts/signing-verification.mjs';

// Artifact-signing verification gap (independent security review, d3397bb):
// electron-builder's build log claimed "signing with signtool.exe" while the
// actual packaged Solith.exe and installer were NotSigned on disk — nothing
// in the release pipeline checked the artifact itself. This is deterministic
// coverage of the pure decision logic (evaluateSigningStatus), using
// injected Authenticode statuses so it never needs a real certificate.

describe('evaluateSigningStatus — artifact signing verification gate', () => {
  test('signed required artifacts pass in both dev and release mode', () => {
    const artifacts = [
      { name: 'main exe', status: 'Valid' },
      { name: 'installer', status: 'Valid' },
      { name: 'helper', status: 'Valid' },
    ];
    for (const releaseMode of [false, true]) {
      const { ok, failures } = evaluateSigningStatus(artifacts, { releaseMode });
      assert.equal(ok, true);
      assert.equal(failures.length, 0);
    }
  });

  test('main exe unsigned fails in release mode', () => {
    const { ok, failures } = evaluateSigningStatus(
      [{ name: 'main exe', status: 'NotSigned' }],
      { releaseMode: true },
    );
    assert.equal(ok, false);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].name, 'main exe');
  });

  test('installer unsigned fails in release mode', () => {
    const { ok, failures } = evaluateSigningStatus(
      [{ name: 'installer', status: 'NotSigned' }],
      { releaseMode: true },
    );
    assert.equal(ok, false);
    assert.equal(failures.length, 1);
  });

  test('required helper unsigned fails in release mode', () => {
    const { ok, failures } = evaluateSigningStatus(
      [{ name: 'solith-readonly-scanner.exe', status: 'NotSigned' }],
      { releaseMode: true },
    );
    assert.equal(ok, false);
    assert.equal(failures.length, 1);
  });

  test('missing required artifact fails in release mode', () => {
    const { ok, failures } = evaluateSigningStatus(
      [{ name: 'installer', status: 'Missing' }],
      { releaseMode: true },
    );
    assert.equal(ok, false);
    assert.equal(failures[0].status, 'Missing');
  });

  test('development mode unsigned is a warning, not a failure', () => {
    const { ok, failures, warnings } = evaluateSigningStatus(
      [{ name: 'main exe', status: 'NotSigned' }],
      { releaseMode: false },
    );
    assert.equal(ok, true);
    assert.equal(failures.length, 0);
    assert.equal(warnings.length, 1);
  });

  test('release mode unsigned is a hard fail regardless of which artifact', () => {
    const artifacts = [
      { name: 'main exe', status: 'Valid' },
      { name: 'installer', status: 'NotSigned' },
      { name: 'helper', status: 'Valid' },
    ];
    const { ok, failures } = evaluateSigningStatus(artifacts, { releaseMode: true });
    assert.equal(ok, false);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].name, 'installer');
  });

  test('mixed batch: only the unsigned/missing entries are reported as failures', () => {
    const artifacts = [
      { name: 'main exe', status: 'Valid' },
      { name: 'installer', status: 'NotSigned' },
      { name: 'helper', status: 'Missing' },
    ];
    const { failures } = evaluateSigningStatus(artifacts, { releaseMode: true });
    assert.deepEqual(failures.map((f) => f.name).sort(), ['helper', 'installer']);
  });
});
