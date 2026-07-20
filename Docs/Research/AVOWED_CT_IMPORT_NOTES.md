# Avowed CT Import Notes

Date: 2026-07-20

Source file used for local research: `Avowed-Win64-Shipping.CT`

## Unified registry compiler result

The Avowed CT import produced:

- accepted pointer rows: 0
- raw script catalog entries: 2
- rejected pointer rows: 1
- pointer import errors: 0

The single rejected pointer row was:

```json
{
  "name": "Avowed 2.0 AOB script",
  "reason": "AssemblerScript not supported"
}
```

This is expected. The row is an Auto Assembler script container, not a pointer record. It must stay out of the pointer registry and remain inert script research metadata.

## AOB extraction result

The inert AOB parser extracted 28 signatures from `Avowed 2.0 AOB script`.

The nested `Get carried items (close and reopen to refresh!)` script contains no `aobscan`, `aobscanmodule`, or `aobscanregion` calls.

No duplicate signatures or validation warnings were found in the extracted Avowed AOB set.

Safety boundary:

- parse only
- never execute Auto Assembler
- never attach to a process
- never write memory
- preserve original script text for traceability
