# Solith Known Limitations

This file is the release-facing limitations list. Do not remove an item until the claim has direct verification evidence.

## Live memory

- Most bundled live-memory controls are L0 discovery workflows, not verified pointer packs.
- Session-local addresses are not restart-stable unless promoted with L3+ evidence.
- Write-capable behavior exists in the native driver and must remain behind policy gates.
- Read-only AOB validation against Avowed must run before any write-capable Avowed workflow.

## CT Library

- Personal CT library artifacts under `data/ct-library/` are ignored and local-only.
- Imported CT scripts are research metadata only and are never executed by Solith.
- CT Library UI import/search/display still needs full E2E coverage before beta.
- Very large CT archives can take minutes to parse.

## Build and release

- Native `memoryjs` requires a Windows C++ build toolchain.
- Installers are development artifacts until signing and installer lifecycle testing are verified.
- Clean-clone verification must be rerun after dependency, build, or native-addon changes.

## Documentation

- Older milestone reports are historical evidence, not current release proof.
- Current release claims must be backed by commands run against the current commit.
