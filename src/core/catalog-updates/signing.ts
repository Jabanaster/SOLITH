import crypto from 'node:crypto';
import { canonicalizeForSigning } from './canonical.js';
import type { CatalogUpdateManifest, SignedCatalogUpdatePackage } from './types.js';

/**
 * ROADMAP §5.5 trust root — the only public key this build trusts for
 * catalog updates. This is a placeholder Ed25519 keypair generated solely
 * for this implementation pass; its private half was used only to sign
 * test fixtures in tests/catalog-updates-signing.test.ts and is never
 * referenced by production code (the private key is never shipped, per
 * ROADMAP §5.6's Electron boundary requirement). Before this pipeline
 * signs a real catalog update, the owner must generate SOLITH's own
 * Ed25519 keypair entirely outside this repository, keep the private key
 * offline, and replace this constant with the real public key.
 */
export const TRUSTED_CATALOG_UPDATE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAnLCX7HvCLQNhwVLBPl90PtEbZ+D648Bkj0yuTRt9geU=
-----END PUBLIC KEY-----
`;

export function canonicalManifestBytes(manifest: CatalogUpdateManifest): Buffer {
  return Buffer.from(canonicalizeForSigning(manifest), 'utf8');
}

/**
 * Fails closed on anything malformed — an unparseable key, a non-Ed25519
 * key, a malformed base64 signature, or any other error during verification
 * all resolve to `false`, never to an exception that a caller could
 * mishandle as "unknown, proceed anyway."
 */
export function verifySignedCatalogUpdate(
  pkg: SignedCatalogUpdatePackage,
  publicKeyPem: string = TRUSTED_CATALOG_UPDATE_PUBLIC_KEY_PEM,
): boolean {
  try {
    const publicKey = crypto.createPublicKey(publicKeyPem);
    if (publicKey.asymmetricKeyType !== 'ed25519') return false;
    const payload = canonicalManifestBytes(pkg.manifest);
    const signature = Buffer.from(pkg.signature, 'base64');
    if (signature.length === 0) return false;
    return crypto.verify(null, payload, publicKey, signature);
  } catch {
    return false;
  }
}
