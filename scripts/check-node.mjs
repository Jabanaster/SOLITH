#!/usr/bin/env node
/**
 * Fail clearly when the active Node major is not the supported Solith line (22).
 * Prefer `.nvmrc` / `package.json#engines` as the source of policy; this is the
 * runtime guard for npm script entry points.
 */
const major = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
if (major !== 22) {
  console.error(
    `[solith] Unsupported Node.js ${process.version}. Required: Node.js 22.x (see .nvmrc and package.json engines).`,
  );
  process.exit(1);
}
