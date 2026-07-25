# Solith Wisp Companion Foundation

Solith Wisp is the living companion layer for Solith. It is a small techno-spirit built from the Solith "S" silhouette that helps the user understand scans, OCR, watcher events, backups, recovery states, and safety blocks without needing to Alt-Tab away from a game.

The Wisp is a creature first and a UI element second. It should feel observant, loyal, curious, cautious, and protective while remaining professional and non-intrusive.

This document describes the current foundation slice. It provides the safe control surface, artwork, in-app companion, detached message bubbles, and separate overlay window. It is not yet the complete living-companion system; deeper behaviors such as full cursor tracking, long-term local relationship memory, richer emotional transitions, and animation-rig transformations remain future work.

## Core contract

Solith Wisp may:

- display status messages;
- trigger approved read-only scans;
- trigger OCR capture flows;
- record user-declared read-only telemetry events such as damage, stamina use, XP gain, gold spend, or loot pickup;
- open Solith panels through approved UI routing;
- pause or resume read-only watchers;
- explain certification status and blocked actions.

Solith Wisp must never:

- execute CT scripts;
- write game memory;
- promote a target to L4;
- bypass approvals;
- attach to an unspecified process;
- override offline, multiplayer, anti-cheat, or protected-target guards;
- run arbitrary shell commands;
- execute actions outside the approved companion action allowlist.

This keeps the companion expressive without making it a hidden execution path.

## Creature forms

| Form | Purpose | Behavior |
|---|---|---|
| Base Wisp | Default communication and idle presence | Curious hover, soft breathing pulse, eye movement |
| Crystal Form | Collapsed, sleeping, quiet monitoring | Curls into a compact Solith shape; halo protects it |
| Shield Form | Guard enforcement and safety blocks | Defensive posture; protects the user from unsafe actions |
| Controller Form | Game/library interaction and quick commands | Excited, playful, taps holographic controls |
| Phoenix Form | Recovery, backups, restoration | Reassembles from fragmented state; relieved/triumphant |
| Dragon Form | Advanced analysis and correlation | Focused, predatory, tracks candidate data |
| Scan Mode | OCR/read-only scan attention | Watches the target, narrow eyes, stable halo |
| Success Mode | Completed work | Proud posture, brighter cyan, open hands |
| Warning Mode | Caution or approval needed | Orange accents, protective stance |
| Error Mode | Failed operation | Fragmented/glitched posture, purple distortion |

The current implementation uses static concept artwork for these forms and CSS motion. The Wisp itself is rendered as a free-floating creature: no permanent square shell, no always-attached text card, and no default command input. Later phases may replace static imagery with transparent sprites, Lottie, vector animation, or a real-time rig.

## Personality guide

Default personality:

- intelligent;
- curious;
- loyal;
- slightly mischievous;
- protective around unsafe actions;
- excited by games and discoveries;
- calm while monitoring;
- persistent without being intrusive.

The Wisp should communicate mostly through motion and short messages. It should not produce long chatbot monologues during gameplay.

## Detached bubble requirements

The Wisp can exist alone with no bubble visible. When it needs to speak, messages appear as detached floating bubbles near the creature. Bubbles are temporary UI, not the Wisp's body.

Detached bubbles support:

- title;
- short body;
- severity indicator;
- source label;
- timestamp through the message model;
- action buttons;
- independent close controls;
- progress value when supplied;

Message text should be short enough to read while playing.

The intentional interaction bubble is separate from notifications. It opens only when the user clicks the Wisp or uses an approved overlay affordance. It contains compact safe quick actions and the short command input; it must be dismissible without hiding the Wisp.

## Safe quick commands

Initial approved commands:

- `begin_scan`
- `scan_now`
- `event_took_damage`
- `event_used_stamina`
- `event_gained_xp`
- `event_spent_gold`
- `event_picked_up_loot`
- `open_ocr_capture`
- `pause_watcher`
- `resume_watcher`
- `open_details`
- `dismiss`
- `hide`

Explicitly blocked classes:

- `execute_ct_script`
- `write_memory`
- `promote_l4`
- `attach_unspecified_process`
- `bypass_guard`
- `run_shell_command`

## Local relationship model

Future relationship behavior should remain local and privacy-conscious. Acceptable local preferences include:

- preferred screen corner;
- quiet mode;
- dismissed message count;
- favorite games by local usage;
- reduced-motion preference;
- preferred Wisp form/cosmetic.

Do not add manipulative mechanics such as streaks, guilt, hunger, paid survival, or punishment for absence.

## Overlay implementation plan

Phase 1, now:

- companion message/action model;
- safe allowlist and blocked-action tests;
- free-floating in-app Wisp companion;
- detached closable notification bubbles;
- intentional compact interaction bubble;
- concept art assets;
- subtle living motion and reduced-motion support.

Phase 2:

- dedicated `#wisp-overlay` route;
- Electron companion overlay window;
- safe show/hide IPC exposed through the preload bridge;
- no write-capable IPC.

Phase 3:

- central message bus so CT import, OCR, watcher, verification, backups, and hub sync can publish Wisp messages.

Phase 4:

- connect quick commands to read-only watcher/OCR IPC routes;
- companion should only dispatch typed, approved events.

Phase 5:

- global hotkeys for show/hide/focus if they can be added without colliding with existing trainer hotkeys;
- user-controlled overlay repositioning and monitor selection;
- animation rig or optimized transparent sprite/Lottie set;
- sound effects with independent mute/volume;
- accessibility tuning.

## Performance and accessibility budget

- Default Wisp should idle at low CPU cost.
- Respect `prefers-reduced-motion`.
- Sound is optional and independently adjustable.
- Message text must remain readable at small overlay sizes.
- Collapsed state should be usable at 32–48 px.
- Active state should be usable at 48–96 px.
- Full diagnostic state should appear only when operationally relevant.

## Current implementation

The current foundation slice is intentionally non-live and zero-trust:

- `src/core/companion/wisp.ts` defines forms, moods, messages, safe actions, blocked actions, and reducer behavior.
- `src/app/components/SolithWispCompanion.tsx` renders the free-floating in-app companion, detached bubbles, and intentionally opened quick command input.
- `electron/wisp-overlay.ts` creates the separate transparent Wisp overlay window.
- `src/app/pages/WispOverlayPage.tsx` renders the overlay route.
- `src/app/assets/wisp/` contains the current concept-form artwork.
- `tests/companion-wisp.test.ts` proves unsafe action classes are blocked, injected actions are sanitized, default state has no forced bubble/input, and detached bubbles can close without hiding the Wisp.

The Wisp is not yet connected to the live watcher, OCR IPC, or a central message bus. It also has not yet passed manual real-game overlay certification.

## Manual certification checklist

Before this feature is called complete rather than foundation:

- Wisp renders correctly in the installed Electron app.
- Wisp floats with no bubble visible by default.
- Bubble opens, closes independently, hides, restores, and respects quiet mode.
- Safe quick commands produce safe local companion messages.
- Unsupported commands are rejected with a safe explanation.
- Overlay button opens the separate Wisp window.
- Overlay can be hidden and reopened.
- App shutdown closes the overlay and leaves no orphan Electron process.
- Overlay works over a fullscreen-borderless game without stealing input unexpectedly.
- Default placement does not cover critical game UI.
- DPI scaling and multi-monitor behavior are acceptable.
- Existing offline, protected-target, and write-policy guards remain unchanged.
