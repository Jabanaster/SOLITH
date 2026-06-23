# IPC Channel Inventory

This inventory catalogs all exposed IPC channels, their request/response schemas, privileged capabilities, path inputs, safety checks, and test coverage.

| Channel | Request Schema | Response Schema | Privileged Capability | Path Input | Safety Checks | Tests |
| ------- | -------------- | --------------- | --------------------- | ---------- | ------------- | ----- |
| `get-games` | None | `Game[]` or error | Read DB list | None | DB initialization check | UI loads games list |
| `add-game` | `AddGameSchema` | `{ success: boolean, game: Game }` | Insert DB record | `path` | `validatePathSafety` | `core.test.ts` / E2E |
| `scan-game` | `ScanGameSchema` | `Scan` or error | Read filesystem & DB | None (reads game path from DB) | DB lookup validation | `core.test.ts` / E2E |
| `get-recipes` | `GetRecipesSchema` | `Recipe[]` or error | Read DB list | None | DB lookup validation | `core.test.ts` / E2E |
| `create-recipe` | `CreateRecipeSchema` | `{ success: true, recipe: Recipe }` | Insert DB record | `target` | `validateIpcPathSafety` | `core.test.ts` / E2E |
| `get-journal` | `GetJournalSchema` | `JournalEvent[]` or error | Read DB list | None | DB lookup validation | UI Journal check |
| `log-event` | `LogEventSchema` | `{ success: true, event: JournalEvent }` | Insert DB record | None | Schema check | UI logs event |
| `get-settings` | None | `Settings` or error | Read DB list | None | DB check | UI settings check |
| `set-setting` | `SetSettingSchema` | `{ success: true }` | Update DB record | None | Schema check | UI setting update |
| `delete-recipe` | `DeleteRecipeSchema` | `{ success: boolean }` | Delete DB record | None | Schema check | UI recipe delete |
| `get-backups` | `GetBackupsSchema` | `Backup[]` | Read DB list | None | DB lookup validation | `safety-integration.test.ts` |
| `restore-backup`| `RestoreBackupSchema` | `{ success: boolean }` | Write filesystem | None (reads backup from DB) | Target lock, backup validation, containment validation, atomic swap, post-restore hash check | `safety-integration.test.ts` |
| `detect-save-files` | `DetectSaveFilesSchema` | `string[]` | Read directory | None (reads game path from DB) | DB lookup validation | `core.test.ts` |
| `parse-save` | `ParseSaveSchema` | `ParsedSave` or null | Read file | `filePath` | `validatePathSafety` | `core.test.ts` |
| `compare-saves` | `CompareSavesSchema` | `ComparisonResult[]` | Read files | `savePathA`, `savePathB` | `validatePathSafety` (both) | `core.test.ts` |
| `create-proposal-for-edit` | `CreateProposalSchema` | `Proposal` or null | Insert DB record | `filePath` | `validateIpcPathSafety` | `safety-integration.test.ts` |
| `apply-proposal` | `ApplyProposalSchema` | `{ success: boolean, backup?: Backup, error?: string }` | Write filesystem | `targetFile` | `validateIpcPathSafety`, target lock, dry run, atomic sibling temp write, validation checks, atomic swap, post-write hash verification | `safety-integration.test.ts` |
| `suggest-data-edits` | `SuggestDataEditsSchema` | `Suggestion[]` | Read file | `filePath` | `validatePathSafety` | Save editor suggestions |

## Validation & Safety Checks
1. **No generic file system channels**: `read-file`, `write-file`, `scan-directory` are deleted.
2. **Schema Enforcement**: Zod validations run in the Electron main process for every incoming request.
3. **Path Safety**: Any path input is validated to ensure it does not touch blocked system folders and resolves canonical real paths.
4. **Game Containment**: Path targets are verified to reside strictly inside the game's approved directory.
