# Certification checklist — offline pack audit

Use for bundled or imported definitions before any live attach.

- [ ] Definition loads (`--file` or `--catalog-game-id`)
- [ ] `schemaErrors` empty
- [ ] Memory features: resolution OK, or intentionally `scan_unknown` / `scan_first`
- [ ] Save editor (if present): `defaultDirectory` set and no path traversal
- [ ] `certificationLevel` on features / pack recorded (do not inflate beyond offline evidence)
- [ ] Report JSON retained under `Docs/Reports/` only after user approves filename

Blocked without live game:

- [ ] L2 attach + read
- [ ] L3 restart-verify
- [ ] L4 in-game evidence
