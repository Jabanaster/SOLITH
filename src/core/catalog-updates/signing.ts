import crypto from 'node:crypto';
import { canonicalizeForSigning } from './canonical.js';
import type { CatalogUpdateManifest, SignedCatalogUpdatePackage } from './types.js';

/**
 * ROADMAP §5.5 trust root — the only public key this build trusts for
 * catalog updates. Production SOLITH Ed25519 catalog signing key (public
 * half only). SHA-256 fingerprint of the DER-encoded SPKI:
 * 13b56bdbb492311cf016267e083f33f558410aea0e3660e4a789e264d66a17fb
 * The matching private key is generated and held entirely outside this
 * repository per ROADMAP §5.6's Electron boundary requirement and is
 * never referenced by production code or shipped in any build.
 */
export const TRUSTED_CATALOG_UPDATE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAdAYkM9RNOKJX61Up2AGNy4aHweLvlZhArX0MPPP/zFo=
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
