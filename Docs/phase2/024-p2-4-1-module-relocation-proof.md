# Phase 2 P2-4.1 — Real Module-Base Relocation Proof (Closure)

`Docs/phase2/017`'s 10-restart fixture campaign observed the SAME module base across all 10 real launches of the identical `solith-scanner-fixture.exe` — real heap relocation was proven on 9/9 restarts, but module-base relocation itself was left PARTIAL, disclosed honestly rather than assumed to be "ASLR disabled." The user rejected leaving this PARTIAL, requiring either a real relocation proof or a deterministic equivalent, and explicitly forbidding disabling ASLR or faking a returned module base.

## Root cause: Windows caches a randomized image base per file identity, not per launch

Investigated directly rather than assumed. Windows' loader caches a randomized image base against the underlying **section object for a given file path** — relaunching the *identical file at the identical path* repeatedly reuses the same randomized base for the lifetime of that cached section, while a genuinely different file (even one with byte-identical content, at a different path) gets an independently, freshly randomized base from the real OS loader. Confirmed empirically via controlled probes before writing any test:

- Three consecutive launches of `solith-scanner-fixture.exe` from its normal build output path all loaded at the identical base.
- A single launch of a byte-for-byte copy of that same file at a different directory loaded at a completely different base — ruling out "same filename" and "same content" as the caching key; the full path is what's cached.

This is why the fixture campaign's 10 restarts (all launching the exact same file from the exact same path) never showed relocation — not a defect, not disabled ASLR, just the real, unmodified Windows loader behavior applied to a same-path repeated launch.

## The proof: two genuinely different process instances, two genuinely different real module bases

`tests/live-memory/pointer-stability-module-relocation.test.ts` — a byte-for-byte copy of the fixture binary is placed at a different directory (same filename, so `resolvePointerPath`'s by-name module lookup still matches in both processes) and launched alongside the original. Real module bases are read via the real `MemoryDriver.getModules()` in both live sessions — **never faked, never a unit-only substitute for the production resolver**.

Result (real, from a passing run — verified 3/3 consecutive):

- Original process module base and copy process module base are asserted `notEqual` — a real, live, OS-assigned difference, not a synthetic one.
- A real depth-3 pointer chain is discovered against the original process and validated, establishing a real `stable_exact` baseline recorded against the original's real module base.
- That baseline survives a real production save/load round trip (`pointerMapSave` → `pointerMapLoad`) into a session attached to the **copy** process.
- Re-validating the loaded node against the copy's session — whose real module base is genuinely different — correctly classifies **`stable_relocated`**, with the observation's `moduleBase` field matching the copy's real base and explicitly not matching the original's.

This exercises the real, unmodified production resolver (`resolvePointerPath`/`validateNodeAfterRestart`) against a genuine module-relative-address recalculation, proving `OLD MODULE BASE != CURRENT MODULE BASE` while the chain still resolves correctly — the mission's own required proof, achieved without disabling ASLR and without faking any returned address.

## Reinforced by real-game evidence

The real-game restart campaign (`Docs/phase2/023`) incidentally reinforces this: Bastion.exe's own real module base varied across 4 of its 5 real restarts on this machine — genuine ASLR relocation against a real, unmodified, third-party shipped binary, independent of the fixture-copy technique above.

## Disposition

**Module/ASLR relocation proof: COMPLETE.** Root cause of the fixture campaign's non-relocation identified and documented (file-path-keyed image-base caching, not disabled ASLR). A real, non-faked test proves the production resolver correctly handles a genuine module-base change between two live process instances, and real-game evidence independently reinforces it. Verified 3/3 consecutive clean runs of the dedicated test, registered in `scripts/run-node-tests.mjs` (`test`, `test:live-memory`).
