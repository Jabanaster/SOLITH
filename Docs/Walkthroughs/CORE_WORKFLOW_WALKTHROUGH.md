# Core Workflow Walkthrough

This document describes the complete flow from scanning to rollback in Solith.

## Core Flow Steps
1. **Game Registration**: A game is added to the library. The path is canonicalized and validated.
2. **Library Scan**: The game folder is scanned. Resource and configuration files are identified, cataloged, and fingerprinted.
3. **Save Detection**: Save files are located within approved boundaries.
4. **Discovery Lab**: Two save states (before and after) are compared to find candidates (e.g., gold changes).
5. **Recipe Creation**: A recipe is generated and verified for compatibility.
6. **Proposal Creation**: Editing a value produces a Proposal showing risk and preview.
7. **Dry Run**: Verifies the target path and value structure before applying.
8. **Backup**: A hash-verified backup is stored in the database and Roaming folder.
9. **Atomic Write**: A sibling temporary file is written, parsed for validity, and renamed atomically over the original.
10. **Journal**: The success or failure of the operation is logged.
11. **Rollback**: Restores the target from the backup using atomic replacement.
