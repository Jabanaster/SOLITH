# Prior Node 22 Environment — Extracted from Retained Evidence

## Source files read

- Docs\Security\Evidence\BatchB1_1_Closeout\Node22Gate\node-version.txt
- Docs\Security\Evidence\BatchB1_1_Closeout\Node22Gate\npm-version.txt
- Docs\Security\Evidence\BatchB1_1_Closeout\Node22Gate\node-paths.txt
- Docs\Security\Evidence\BatchB1_1_Closeout\Node22Gate\verification-final.txt
- Docs\Security\Evidence\BatchB1_1_Closeout\Node22GateStableRerun\node-environment.txt
- Docs\Security\Evidence\BatchB1_1_Closeout\Node22GateStableRerun\verification-final.txt

## Exact recovered facts

`node-paths.txt` recorded the raw output of `where.exe node; where.exe npm`
at the time of the prior successful Gate 1 run:

```
G:\ACTIVE_PROJECTS\SOLITH\.tools\node-v22.23.1-win-x64\node.exe
C:\Program Files\nodejs\node.exe
G:\ACTIVE_PROJECTS\SOLITH\.tools\node-v22.23.1-win-x64\npm
G:\ACTIVE_PROJECTS\SOLITH\.tools\node-v22.23.1-win-x64\npm.cmd
C:\Program Files\nodejs\npm
C:\Program Files\nodejs\npm.cmd
```

The project-local `.tools\node-v22.23.1-win-x64\node.exe` was listed
*first*, meaning the prior Gate 1 shell had this directory prepended to
`PATH` ahead of `C:\Program Files\nodejs`. `node-version.txt` confirms
`node --version` reported `v22.23.1` in that session — matching the
project-local distribution's version, not the system-wide install.
`npm-version.txt` confirms `npm --version` reported `10.9.8`, which is
the npm bundled with this specific Node 22.23.1 distribution (not the
`11.12.1` reported by the system-wide Node v24.15.0 in the immediately
prior Node22GateStableRerun attempt).

- node.exe path: `G:\ACTIVE_PROJECTS\SOLITH\.tools\node-v22.23.1-win-x64\node.exe`
- npm-cli.js path: `G:\ACTIVE_PROJECTS\SOLITH\.tools\node-v22.23.1-win-x64\node_modules\npm\bin\npm-cli.js`
- npm.cmd path (same distribution): `G:\ACTIVE_PROJECTS\SOLITH\.tools\node-v22.23.1-win-x64\npm.cmd`
- PATH value where recorded: not captured verbatim in retained evidence
  (only `where.exe` resolution order); ordering implies `.tools\node-v22.23.1-win-x64`
  was prepended ahead of `C:\Program Files\nodejs` in that session's PATH.
- Process command line: not recorded in retained evidence beyond the
  `where.exe`/`--version` calls shown above.
- Working directory: `G:\ACTIVE_PROJECTS\SOLITH` (RepositoryRoot in
  verification-final.txt).
- Node version: v22.23.1
- npm version: 10.9.8

## Conclusion

The v22.23.1 runtime used by the prior successful Gate 1 evidence is a
project-local, unzipped Node distribution checked into `.tools/` (and
excluded from Git via `.gitignore` line 127: `.tools/`). It was never on
the system PATH by default — the prior session simply had its PATH
temporarily arranged to prefer it. The current shell (used in the
immediately prior Node22GateStableRerun attempt) does not have that PATH
arrangement, which is why it fell through to the system-wide
`C:\Program Files\nodejs\node.exe` (v24.15.0) instead.
