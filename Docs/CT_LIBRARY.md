# Solith CT Library

Solith treats Cheat Engine `.CT` files as a first-class, metadata-only research source.

The CT Library importer can ingest a single zip archive containing many `.CT` files and generate:

- a top-level CT Library summary index
- per-game shard files containing pointer, script, and AOB metadata
- L0 / metadata-only cheat entries for search and discovery workflows

Safety boundary:

- Auto Assembler and Lua scripts are parsed inertly and never executed.
- The importer never attaches to a process.
- The importer never writes memory.
- Generated CT Library entries are `L0` / `metadata-only` until separately verified.

Import command:

```powershell
npm run ct-library:import -- "G:\Downloads\Combined-CheatEngine-Tables.zip" --no-registry-index --library-out data/ct-library/personal-ct-library.summary.json --shards-dir data/ct-library/personal-ct-library-shards
```

The generated `data/ct-library/` files are local artifacts and are ignored by git. This keeps personal CT collections and large generated catalogs out of the repository while making them usable by Solith locally.

For the 2026-07-20 personal CT pack import, the local summary produced:

- `.CT` files discovered: 22,981
- compiled tables: 19,897
- rejected tables: 3,084
- pointer entries: 436,970
- inert scripts: 136,157
- AOB signatures: 111,535
- metadata-only cheat entries: 684,662
- game buckets: 299
