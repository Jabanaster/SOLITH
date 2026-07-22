# Solith Read-Only Scanner Helper

Solith ships a bundled Windows helper executable, `solith-readonly-scanner.exe`, for production pointer-chain L2 validation.

The helper is a Solith runtime component, not a standalone trainer. It is launched only by the headless verification worker after the user explicitly selects a process in the app.

## Boundary

- Windows only.
- Opens the target process with read/query permissions only.
- Enumerates modules.
- Uses `VirtualQueryEx` to confirm committed readable regions.
- Uses `ReadProcessMemory` only for pointer-sized reads needed to walk pointer chains.
- Returns JSON over stdin/stdout.
- Exits after the verification request.

## Explicit non-goals

- No memory writes.
- No code patching.
- No injection.
- No debugger bypass.
- No anti-cheat bypass.
- No automatic process attachment.
- No CT/Lua/Auto Assembler execution.
- No L4 write-capable promotion.

## L2 behavior

For pointer records imported from CT metadata, the helper verifies:

1. the selected PID still matches the expected executable name;
2. the pointer root module is loaded;
3. the root offset is inside the module image;
4. every pointer hop read is inside a committed readable memory region;
5. the final address resolves to a committed readable memory region.

It does not read or modify the target gameplay value. A successful result means the pointer chain is L2-resolvable for this session only; restart-stable evidence is still required before L3.
