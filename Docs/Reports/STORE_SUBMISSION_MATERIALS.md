# SOLITH — Microsoft Store Submission Materials (Draft)

Status: draft content only. Nothing here has been submitted, certified, or reviewed by Microsoft. No Partner Center identity is embedded anywhere in this document.

## Short Description (≤100 chars)

Offline single-player save/memory trainer toolkit for your own installed PC games.

## Long Description

SOLITH is a desktop toolkit for exploring and modifying your own single-player, offline PC game installations — save files and, for supported titles, live process memory. It is built for accessibility, experimentation, and personal game modification, not for online or competitive play.

Key capabilities:
- Browse and edit structured save-file fields (JSON, INI, XML, and binary save formats) with format-aware, schema-validated safety gates.
- Attach to a user-selected, already-running game process to inspect and modify memory values in real time, with explicit per-write consent and protected-process/self-process guards.
- Import and review community-authored Cheat Table (.CT) definitions inside an inert-by-default sandbox — nothing executes automatically.
- Maintain an offline-first local game catalog and trainer library, with optional signed catalog updates.

SOLITH is designed for local, authorized use against games you own and have installed. It does not attach to, modify, or interfere with online multiplayer sessions, anti-cheat systems, or any other user's data.

## Feature Summary

- Save-file editor (JSON/INI/XML/binary) with field-level validation
- Live memory trainer with signature-based value resolution
- User-authorized process attachment with explicit write consent
- Offline-first game catalog with optional signed update channel
- Community Cheat Table (.CT) import with inert-by-default execution model
- Local-only operation — no account or network requirement for core use

## Privacy Statement Summary

SOLITH operates entirely locally. It does not transmit save data, memory contents, or gameplay telemetry to any server. Optional catalog-update checks contact a SOLITH-operated endpoint only to fetch signed catalog metadata (game names/executables/artwork references), never user data. No analytics or tracking SDKs are bundled.

## Authorized-Use / Product-Boundary Language

SOLITH is intended for:
- Modifying your own local, offline, single-player game saves and sessions
- Accessibility and quality-of-life adjustments (e.g., unlimited resources, invincibility) in single-player content
- Experimentation, learning, and game-modding research on titles you own

SOLITH is explicitly **not** designed or marketed for:
- Bypassing anti-cheat systems
- Cheating in competitive or online multiplayer
- DRM circumvention
- Stealth or anti-detection behavior
- Credential theft or any malware-like behavior
- Unrestricted or unauthorized process modification

## Support Contact

`<owner to supply — support email or URL>`

## Age Rating / Content Notes

- No user-generated content sharing, no online multiplayer, no in-app purchases in the base application.
- Age rating should be assessed by the owner against actual final Store submission per Microsoft's rating questionnaire (IARC); no rating is claimed here.

## Certification Reviewer Notes

SOLITH's normal, expected behavior can look unusual to an automated or first-pass reviewer. For context:

- **Process enumeration**: SOLITH lists running processes so the user can select a specific game to attach to. This list is read-only until the user explicitly picks a target.
- **User-authorized attachment only**: SOLITH never attaches automatically or silently. Attachment requires explicit user selection of a running process.
- **Protected/system processes are blocked**: SOLITH's safety layer refuses to attach to protected, system, or its own process (self-targeting is blocked outright).
- **Explicit write consent**: Any memory write requires a separate, explicit consent step per session; consent tokens are scoped, expire, and are invalidated if the target process exits.
- **`.CT` content is inert by default**: Imported community Cheat Table definitions are parsed and reviewed but never auto-executed; any script content requires explicit user action inside a sandboxed review flow.
- **No anti-cheat bypass code**: SOLITH does not detect, evade, or interact with any anti-cheat product. It operates only against processes the user explicitly selects.
- **Session cleanup**: All memory sessions, handles, and watchers are torn down on app exit, target-process exit, or feature disable — verified by dedicated cleanup test suites.
- **Full-trust desktop requirement**: SOLITH requires Win32 full-trust desktop capabilities (process access, file system access to arbitrary user-selected install paths) inherent to its save-editing and memory-trainer functionality; this is a `runFullTrust` desktop-bridge app, not sandboxed UWP.

## Result

`STORE SUBMISSION MATERIALS DRAFTED — NOT SUBMITTED`
