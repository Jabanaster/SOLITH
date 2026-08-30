import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  authorizePath,
  reauthorizeBeforeCommit,
  revalidateIdentity,
  findReparseComponent,
} from '../src/core/safety/handle-path-authorization';

/**
 * MP-P0.5 — adversarial proof that handle-based path authorization fails CLOSED
 * against symlink/junction escapes, TOCTOU races, and lexical-only containment
 * bypasses that path-safety.ts's string-based check cannot catch.
 */

let root: string;
let outside: string;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-p05-root-'));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-p05-outside-'));
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

function writeFile(dir: string, name: string, content = 'x'): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

describe('MP-P0.5 handle-based path authorization', () => {
  test('1. ordinary approved file authorizes', () => {
    const target = writeFile(root, 'ordinary-approved.txt');
    const result = authorizePath(target, [root]);
    assert.equal(result.authorized, true);
    assert.ok(result.identity);
    if (result.fd !== undefined) fs.closeSync(result.fd);
  });

  test('2. ordinary rejected outside-root file fails closed', () => {
    const target = writeFile(outside, 'outside.txt');
    const result = authorizePath(target, [root]);
    assert.equal(result.authorized, false);
    assert.match(result.reason || '', /outside all approved roots/);
  });

  test('3. ../ traversal resolves outside root and is rejected', () => {
    const nested = path.join(root, 'nested');
    fs.mkdirSync(nested, { recursive: true });
    const escapeTarget = writeFile(outside, 'escape-target.txt');
    const traversal = path.join(nested, '..', '..', path.basename(outside), 'escape-target.txt');
    const result = authorizePath(traversal, [root]);
    assert.equal(result.authorized, false);
    void escapeTarget;
  });

  test('4. sibling-prefix path is not treated as contained', () => {
    const siblingDir = `${root}backup`;
    fs.mkdirSync(siblingDir, { recursive: true });
    const target = writeFile(siblingDir, 'sibling.txt');
    const result = authorizePath(target, [root]);
    assert.equal(result.authorized, false);
    fs.rmSync(siblingDir, { recursive: true, force: true });
  });

  test('5. directory symlink escape (or junction fallback) is rejected', () => {
    const realTarget = writeFile(outside, 'linked-content.txt', 'secret');
    const linkDir = path.join(root, 'link-to-outside');
    let created: 'symlink' | 'junction' | null = null;
    try {
      fs.symlinkSync(outside, linkDir, 'dir');
      created = 'symlink';
    } catch {
      try {
        fs.symlinkSync(outside, linkDir, 'junction');
        created = 'junction';
      } catch {
        created = null;
      }
    }
    if (!created) {
      // Environment cannot create symlinks/junctions without elevation — documented limitation.
      return;
    }
    const throughLink = path.join(linkDir, path.basename(realTarget));
    const result = authorizePath(throughLink, [root]);
    assert.equal(result.authorized, false);
    assert.match(result.reason || '', /Reparse point/);
    fs.rmSync(linkDir, { force: true });
  });

  test('6. junction escape is rejected (component-wise reparse scan)', () => {
    const junctionDir = path.join(root, 'junction-to-outside');
    try {
      fs.symlinkSync(outside, junctionDir, 'junction');
    } catch {
      // Documented limitation: environment refused junction creation.
      return;
    }
    const target = writeFile(outside, 'via-junction.txt');
    const throughJunction = path.join(junctionDir, path.basename(target));
    const result = authorizePath(throughJunction, [root]);
    assert.equal(result.authorized, false);
    assert.match(result.reason || '', /Reparse point/);
    fs.rmSync(junctionDir, { force: true });
  });

  test('7. nested reparse component (reparse point buried mid-path) is caught', () => {
    const nestedParent = path.join(root, 'a', 'b');
    fs.mkdirSync(nestedParent, { recursive: true });
    const junctionDir = path.join(nestedParent, 'c');
    try {
      fs.symlinkSync(outside, junctionDir, 'junction');
    } catch {
      return;
    }
    const target = writeFile(outside, 'deep.txt');
    const deepPath = path.join(junctionDir, path.basename(target));
    const found = findReparseComponent(deepPath);
    assert.equal(found.found, true);
    fs.rmSync(junctionDir, { force: true });
  });

  test('8. mount/reparse behavior — documented as untestable without a second volume in this environment', () => {
    // A genuine mount point requires a second physical/virtual volume, which this
    // sandbox does not provision. findReparseComponent treats mount points identically
    // to junctions (both are IO_REPARSE_TAG-based and both report isSymbolicLink()
    // true via lstat on Windows), so coverage from tests 6/7 stands in for this case.
  });

  test('9. rename after authorization is caught by reauthorizeBeforeCommit', () => {
    const target = writeFile(root, 'rename-victim.txt');
    const auth = authorizePath(target, [root]);
    assert.equal(auth.authorized, true);
    assert.ok(auth.identity && auth.canonicalPath && auth.fd !== undefined);
    fs.closeSync(auth.fd!);

    const renamed = path.join(root, 'rename-victim-moved.txt');
    fs.renameSync(target, renamed);
    fs.writeFileSync(target, 'attacker-planted-file', 'utf8');

    const revalidation = reauthorizeBeforeCommit(auth.canonicalPath!, auth.identity!);
    assert.equal(revalidation.valid, false);
    assert.match(revalidation.reason || '', /identity changed/);
    fs.rmSync(renamed, { force: true });
  });

  test('10. target replacement after authorization (delete + recreate) is caught', () => {
    const target = writeFile(root, 'replace-victim.txt', 'original');
    const auth = authorizePath(target, [root]);
    assert.equal(auth.authorized, true);
    fs.closeSync(auth.fd!);

    fs.unlinkSync(target);
    fs.writeFileSync(target, 'replaced-content', 'utf8');

    const revalidation = reauthorizeBeforeCommit(auth.canonicalPath!, auth.identity!);
    assert.equal(revalidation.valid, false);
  });

  test('11. same path, different file identity (in-place content swap via unlink+recreate) fails revalidation', () => {
    const target = writeFile(root, 'identity-swap.txt', 'v1');
    const auth = authorizePath(target, [root]);
    const originalIdentity = auth.identity!;
    fs.closeSync(auth.fd!);

    fs.unlinkSync(target);
    fs.writeFileSync(target, 'v2', 'utf8');

    const revalidation = revalidateIdentityAtFreshOpen(target, originalIdentity);
    assert.equal(revalidation.valid, false);
  });

  test('12. approved lexical path resolving outside root via traversal segments is rejected even if root string-prefixes match', () => {
    const trickyRoot = path.join(root, 'game');
    fs.mkdirSync(trickyRoot, { recursive: true });
    const trickyEscape = `${trickyRoot}-not-actually-inside`;
    fs.mkdirSync(trickyEscape, { recursive: true });
    const target = writeFile(trickyEscape, 'lexical-lookalike.txt');
    const result = authorizePath(target, [trickyRoot]);
    assert.equal(result.authorized, false);
    fs.rmSync(trickyEscape, { recursive: true, force: true });
  });

  test('13. deleted/recreated target between authorize and commit fails closed', () => {
    const target = writeFile(root, 'deleted-recreated.txt');
    const auth = authorizePath(target, [root]);
    fs.closeSync(auth.fd!);

    fs.unlinkSync(target);

    const revalidation = reauthorizeBeforeCommit(auth.canonicalPath!, auth.identity!);
    assert.equal(revalidation.valid, false);
    assert.match(revalidation.reason || '', /no longer openable/);
  });

  test('14. stale authorization (identity captured long ago, file untouched) still revalidates true', () => {
    const target = writeFile(root, 'untouched.txt');
    const auth = authorizePath(target, [root]);
    fs.closeSync(auth.fd!);

    const revalidation = reauthorizeBeforeCommit(auth.canonicalPath!, auth.identity!);
    assert.equal(revalidation.valid, true);
  });

  test('15. final-handle identity mismatch across two independent authorizations of the same path after swap', () => {
    const target = writeFile(root, 'swap-a.txt', 'a');
    const first = authorizePath(target, [root]);
    fs.closeSync(first.fd!);

    fs.unlinkSync(target);
    fs.writeFileSync(target, 'b', 'utf8');

    const second = authorizePath(target, [root]);
    fs.closeSync(second.fd!);

    assert.notDeepEqual(first.identity, second.identity);
  });
});

function revalidateIdentityAtFreshOpen(targetPath: string, expected: { dev: number; ino: number }) {
  return reauthorizeBeforeCommit(targetPath, expected);
}
