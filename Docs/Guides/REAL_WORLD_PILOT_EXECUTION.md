# Real-World Pilot Execution Guide

How a writable real-world sandbox pilot is executed safely in Solith,
using the Drill Core `master_volume` pilot as the reference example.

## Principles

1. The live save/config file is **never** written during a sandbox pilot. It is
   only read to compute SHA-256 hashes that prove it stayed unchanged.
2. All work happens on fresh copies of a previously **verified intake**.
3. Every step is hash-verified; a failure at any gate aborts the write.
4. Edits use the narrowest possible adapter and target.

## Prerequisites

- A verified intake exists (see `Guides/REAL_WORLD_PILOT_INTAKE.md`) with:
  matching source/copy hashes, strict JSON parse OK, semantic round-trip MATCH,
  and the original confirmed unmodified.
- Explicit user approval for the specific file + target + value change.

## Pipeline

```
Renderer → preload → validated IPC → proposal → explicit approval
→ verified backup → atomic sandbox apply → post-write validation
→ journal → exact restore
```

### 1. Fresh copies
Create per-run `input/`, `working/`, `backups/`, `evidence/` directories inside
the ignored pilot workspace. Copy the verified intake into `input/`, then into
`working/`. Confirm both equal the verified intake hash.

### 2. Proposal gate
Display game, profile, target, current/proposed value, allowed range, risk,
pre-write SHA-256, backup destination, validation plan, restore plan, and
"Live original modified: No". Require explicit approval. Never auto-approve.

### 3. Verified backup
Hash the working file, copy it to a distinct backup, hash the backup, require
equality, and record a manifest.

### 4. Atomic byte-preserving apply
Confirm pre-write hash + current value, build the targeted token edit in a
same-directory temp file, validate it strictly, then atomically rename over the
working file. The adapter preserves GameMaker's numeric style (`100.0 → 75.0`).

### 5. Post-write validation
Strict parse, target equals the proposed value, top-level key count unchanged,
all unrelated values unchanged, encoding unchanged, only the selected token
changed, backup hash unchanged, **live original hash unchanged**.

### 6. Exact restore
Restore the working file from the verified backup and require exact SHA-256
equality with the pre-write working file.

## What is NOT claimed

A passing sandbox pilot proves the backup→apply→validate→restore mechanics on
real-format data. It does **not** prove the game loads the modified value
correctly. In-game validation is a separate, explicitly authorized step.
