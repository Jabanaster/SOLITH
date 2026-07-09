# Vendored `memoryjs@3.5.1` (patched)

Why this exists: a true fresh `npm ci` on Windows/Node 24 fails while installing
the real `memoryjs@3.5.1` from the npm registry, because its *own* install-time
build script (`scripts/install.js`) spawns `npm.cmd run build64` without
`shell: true`. Modern Node throws `spawn EINVAL` for that on Windows. The
project's `patches/memoryjs+3.5.1.patch` fixed this via `patch-package`, but
`patch-package` only runs in this project's root `postinstall` — which happens
*after* `memoryjs`'s own install script has already run (and crashed). The fix
was always applied one step too late to help a genuinely clean install.

This directory is a vendored copy of `memoryjs@3.5.1`'s source with both
upstream fixes already applied directly, so the very first install attempt
uses the corrected files — no post-hoc patching required for this package.

Fixes baked in (previously `patches/memoryjs+3.5.1.patch`, now retired — see
`Docs/KNOWN_ISSUES.md` KI-015):

1. `scripts/install.js` — `spawn(...)` now passes `{ shell: true }` so it can
   launch `npm.cmd` on Windows, and propagates a non-zero exit code instead of
   silently swallowing build failures.
2. `binding.gyp` — adds `/Zc:strictStrings-` to `AdditionalOptions` so current
   MSVC accepts `lib/memoryjs.cc`'s C string literal assignments.

Also trimmed from the upstream `package.json`: the `eslint` /
`eslint-config-airbnb-base` entries, which upstream lists under `dependencies`
(not `devDependencies`) despite being lint-only tooling unrelated to building
or running the native addon. Removing them avoids pulling in ~240 unrelated
transitive packages for a project that doesn't lint this vendored copy.
`node-addon-api` is kept — `binding.gyp` requires it at build time
(`include_dirs` resolves via `require('node-addon-api').include`).

Referenced from the root `package.json` as:

```
"memoryjs": "file:vendor/memoryjs-3.5.1-patched"
```

No build artifacts (`build/`, `.node` binaries) or nested `node_modules` are
committed here — only the source files needed for `npm` to extract and then
`node-gyp` to compile.

To pick up a newer upstream `memoryjs` release, re-vendor from scratch (copy
the new release's source into this directory) and re-apply the two fixes
above if upstream hasn't merged them yet — check
https://github.com/Rob--/memoryjs for their current status first.
