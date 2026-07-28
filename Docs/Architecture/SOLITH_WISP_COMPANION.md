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

WISP BACKEND EXPANSION — ADAPTIVE POSITIONING, ADVANCED GAME-AWARE CONTROLS, CUSTOMIZATION, AND CHARACTER STATE SYSTEM

PROJECT
- Repository: G:\ACTIVE_PROJECTS\SOLITH
- Product: Solith — local-first Electron game trainer and save editor
- Component: Wisp assistant / overlay system
- Status: Deferred to post-v1 unless separately authorized
- Existing Wisp/Game Bar worktree:
  G:\ACTIVE_PROJECTS\SOLITH-GAMEBAR
- Branch:
  prototype/xbox-gamebar-wisp

PURPOSE

Expand Wisp from a static assistant overlay into a responsive, game-aware command surface with:

1. Adaptive opposite-side placement
2. Basic and Advanced control modes
3. Per-game customizable controls
4. Capability-driven rendering
5. Multiple restrained character poses and states
6. Compact idle behavior
7. Responsive layouts that avoid clipping and overlap
8. Backend schemas and persistence supporting all of the above

Do not implement this as a collection of hardcoded buttons or visual-only React state. The backend, profile system, capability registry, persistence layer, and UI must share a coherent model.

======================================================================
1. ADAPTIVE OPPOSITE-SIDE POSITIONING
======================================================================

GOAL

Wisp must automatically position its text, controls, and expanded panels on the side opposite the main Solith or active game window.

REQUIRED BEHAVIOR

1. Detect the bounds of:
   - the main Solith window,
   - the active game window when available,
   - the active display work area.

2. Calculate usable free space:
   - left of the reference window,
   - right of the reference window,
   - above and below when horizontal placement is impossible.

3. Default behavior:
   - reference window on left → Wisp opens right,
   - reference window on right → Wisp opens left,
   - reference window centered → choose the side with more usable space.

4. Automatically flip sides if:
   - the panel would clip,
   - the panel would exceed the display work area,
   - the window crosses the screen midpoint,
   - Wisp expands from Basic to Advanced mode,
   - the display scale or resolution changes.

5. Recalculate when:
   - Solith moves,
   - the game moves,
   - either window resizes,
   - the active monitor changes,
   - display topology changes,
   - Wisp content grows or collapses.

6. Keep a configurable safe gap between Wisp and the reference window.

7. Keep all Wisp text, buttons, menus, input fields, and character art inside the visible work area.

8. Avoid covering:
   - primary game HUD elements when known,
   - Solith navigation,
   - confirmation dialogs,
   - safety warnings,
   - active approval controls.

9. Support a user placement preference:
   - Auto
   - Left
   - Right

10. Auto must remain the default.

MULTI-MONITOR RULES

- Use the display containing the largest portion of the reference window.
- Do not assume the primary monitor.
- Respect per-monitor scaling.
- Reposition safely when the reference window moves between monitors.
- Never preserve stale coordinates that place Wisp off-screen.

BACKEND MODEL

Add a placement policy model similar to:

```ts
type WispPlacementMode = "auto" | "left" | "right";

interface WispPlacementPreferences {
  mode: WispPlacementMode;
  gapPx: number;
  allowVerticalFallback: boolean;
}

interface WispPlacementContext {
  referenceWindowBounds: Rectangle;
  displayWorkArea: Rectangle;
  panelPreferredSize: Size;
  panelMinimumSize: Size;
  displayScaleFactor: number;
}

interface WispPlacementResult {
  side: "left" | "right" | "top" | "bottom";
  bounds: Rectangle;
  flipped: boolean;
  reason:
    | "preferred"
    | "more-space"
    | "collision"
    | "off-screen"
    | "manual-override"
    | "vertical-fallback";
}
````

Keep the placement calculation in a testable backend/core module rather than embedding all logic in a React component.

ACCEPTANCE CRITERIA

* Solith on left → Wisp opens right.
* Solith on right → Wisp opens left.
* Centered window → larger available side selected.
* Wisp flips when crossing the midpoint.
* Advanced expansion cannot clip off-screen.
* Multi-monitor transitions work.
* Manual Left/Right override persists.
* Auto remains the default.

======================================================================
2. BASIC AND ADVANCED WISP MODES
================================

BASIC MODE

Basic mode remains compact and is the default.

It should show only:

* common high-frequency actions,
* actions supported by the active game profile,
* high-confidence verified actions,
* essential Wisp controls.

Possible actions include:

* Open overlay
* Hide Wisp
* Quiet mode
* Scan now
* Health
* Stamina
* Money or primary currency
* XP
* Common inventory action

Do not show generic actions merely because another game supports them.

ADVANCED BUTTON

Add a visible:

```text
Advanced
```

button.

Behavior:

1. Opens an expanded game-aware control surface.
2. Preserves the existing Basic mode configuration.
3. Allows return to Basic mode.
4. Does not reload the entire Electron page.
5. Does not replay the Solith intro.
6. Does not destroy current Wisp conversation or scan state.
7. May remember the preferred mode per game.
8. Expands toward the side with available screen space.
9. Triggers placement recalculation before rendering.

ADVANCED CATEGORIES

Advanced mode may expose categories such as:

* Player stats
* Health and survival
* Resources
* Currencies
* Inventory
* Equipment
* Skills
* Progression
* Crafting
* Quest state
* World state
* Time
* Weather
* Reputation
* Factions
* Companions
* Teleport/location
* Save-backed fields
* Live-memory fields
* Read-only diagnostics
* Experimental tools

Only categories supported by the active game profile may appear.

======================================================================
3. GAME-AWARE CONTROL REGISTRY
==============================

Do not hardcode one universal Wisp action list.

Each action must come from the active game profile and capability registry.

CONTROL MODEL

Use a schema similar to:

```ts
type WispControlType =
  | "action"
  | "number"
  | "toggle"
  | "slider"
  | "select"
  | "multi-select"
  | "increment"
  | "read-only"
  | "search"
  | "preset";

type WispCapabilityStatus =
  | "verified"
  | "experimental"
  | "read-only"
  | "unsupported"
  | "blocked";

type WispDataBackend =
  | "save"
  | "live-memory"
  | "trainer-host"
  | "derived"
  | "none";

interface WispControlDefinition {
  id: string;
  profileId: string;
  categoryId: string;

  label: string;
  description?: string;

  type: WispControlType;
  backend: WispDataBackend;
  capabilityStatus: WispCapabilityStatus;

  valuePath?: string;
  actionId?: string;

  minimum?: number;
  maximum?: number;
  step?: number;
  options?: Array<{
    value: string;
    label: string;
  }>;

  approvalRequired: boolean;
  backupRequired: boolean;
  rollbackSupported: boolean;

  supportedGameVersions?: string[];
  requiredCapabilities?: string[];
  incompatibleStates?: string[];

  riskLevel: "low" | "medium" | "high" | "blocked";
  defaultVisible: boolean;
  basicEligible: boolean;
}
```

CAPABILITY RULES

* Verified controls may be enabled.
* Experimental controls must be visibly labeled.
* Read-only controls must not expose write actions.
* Unsupported controls should normally be hidden.
* Blocked controls must never execute.
* Version mismatch must disable or hide affected controls.
* Online or anti-cheat-protected contexts must fail closed.
* Missing profile data must not fall back to fake generic actions.

======================================================================
4. PER-GAME CUSTOMIZATION
=========================

Allow users to configure Wisp independently for each game.

SUPPORTED CUSTOMIZATION

1. Pin favorite actions.
2. Hide unwanted actions.
3. Reorder controls.
4. Reorder categories.
5. Choose Basic-mode shortcuts.
6. Choose which Advanced sections start expanded.
7. Rename display labels locally.
8. Save control presets.
9. Select compact or expanded density.
10. Reset to profile defaults.
11. Restore a previously saved layout.
12. Export/import configuration only if consistent with existing Solith policy.

PERSISTENCE MODEL

Store preferences locally and key them by:

* stable game ID,
* profile ID,
* optional profile version.

Example:

```ts
interface WispGamePreferences {
  gameId: string;
  profileId: string;
  profileVersion?: string;

  preferredMode: "basic" | "advanced";
  placementMode: "auto" | "left" | "right";

  pinnedControlIds: string[];
  hiddenControlIds: string[];
  controlOrder: string[];
  categoryOrder: string[];
  expandedCategoryIds: string[];

  customLabels: Record<string, string>;
  selectedPresetId?: string;

  updatedAt: string;
}
```

MIGRATION REQUIREMENTS

* Preferences must survive application restarts.
* Unknown or removed control IDs must be ignored safely.
* Profile updates must not corrupt user customization.
* New controls should use profile defaults unless configured.
* Provide a reset path.
* Do not silently delete user preferences.

======================================================================
5. WISP CHARACTER POSE AND STATE SYSTEM
=======================================

CURRENT PROBLEM

The current raised-hands pose is unsuitable as the permanent neutral pose.

It visually reads as:

* shrugging,
* surrendering,
* presenting,
* surprise,
* or asking a question.

It may be used for a greeting or prompt state, but it should not be the default idle state.

DEFAULT NEUTRAL POSE

Use:

* arms relaxed near the body,
* slightly asymmetrical floating stance,
* head facing the user,
* subtle hover,
* restrained glow pulse,
* no exaggerated hand gestures.

The default pose should remain visually quiet and avoid competing with the interface.

REQUIRED POSE STATES

At minimum support:

| State                | Recommended pose                                       |
| -------------------- | ------------------------------------------------------ |
| Neutral              | Arms relaxed; subtle hover                             |
| Listening            | Slight head tilt; one hand raised gently               |
| Thinking             | Hand near chin or restrained orbiting energy           |
| Success              | Small upward gesture; brighter glow                    |
| Warning              | One hand raised; amber/red accent                      |
| Error                | Slight recoil or lowered posture                       |
| Scanning             | Hands forward; scanning ring or sweep                  |
| Quiet mode           | Compact posture; dim glow                              |
| Hidden/minimized     | Orb, hood icon, or compact avatar                      |
| Advanced mode        | Focused pose controlling restrained holographic panels |
| Greeting             | Raised/open hands may be used here                     |
| Waiting for approval | Still posture with approval indicator                  |

STATE MODEL

```ts
type WispVisualState =
  | "neutral"
  | "listening"
  | "thinking"
  | "success"
  | "warning"
  | "error"
  | "scanning"
  | "quiet"
  | "minimized"
  | "advanced"
  | "greeting"
  | "awaiting-approval";

interface WispVisualStateContext {
  state: WispVisualState;
  intensity: "subtle" | "normal" | "urgent";
  reducedMotion: boolean;
  messageId?: string;
  actionId?: string;
}
```

STATE TRANSITIONS

Examples:

* User opens Wisp → greeting, then neutral.
* User types → listening.
* Backend request active → thinking.
* Scan active → scanning.
* Action succeeds → success briefly, then neutral.
* Validation warning → warning.
* Action fails → error briefly.
* Quiet mode enabled → quiet.
* Wisp minimized → compact orb/avatar.
* Advanced panel open → advanced.
* Approval prompt active → awaiting approval.

Do not leave Wisp permanently in a high-energy state.

ANIMATION RULES

* Use subtle animation by default.
* Respect reduced-motion accessibility settings.
* Avoid constant hand movement.
* Avoid rapid glow pulses.
* Avoid large looping animations that distract during gameplay.
* Success/error reactions should return to neutral after a short duration.
* Urgent warning motion should be reserved for real safety issues.

======================================================================
6. COMPACT IDLE AND DOCKING BEHAVIOR
====================================

The full character should not occupy a large empty strip when no interaction is active.

DEFAULT IDLE OPTIONS

* compact orb,
* hood/avatar icon,
* small docked Wisp,
* collapsed edge tab.

Expand to the full character only when:

* speaking,
* scanning,
* warning,
* requesting approval,
* showing Advanced controls,
* responding to direct interaction.

DOCKING

Support:

* left edge,
* right edge,
* automatic opposite-side dock,
* compact/minimized form,
* expanded panel.

Do not place the character decoratively in dead space without a functional relationship to nearby controls.

======================================================================
7. RESPONSIVE PANEL LAYOUT
==========================

The Basic and Advanced panels must respond to available screen space.

SUPPORTED LAYOUTS

* Compact single column
* Expanded single column
* Two-column category layout when enough width exists
* Scrollable long category lists
* Search/filter in Advanced mode
* Collapsible categories
* Docked compact layout
* Opposite-side expanded layout

RULES

* No button overlap.
* No text overlap.
* No controls stacked over status cards.
* No panel extending beyond the work area.
* No character art blocking input fields.
* No hidden Close button.
* No input field narrower than its usable minimum.
* No action buttons placed on top of game-status labels.
* Recalculate layout when content changes.

======================================================================
8. BACKEND ORCHESTRATION
========================

Introduce a clear backend separation:

1. Game/profile detection
2. Capability resolution
3. User preference resolution
4. Safety/policy filtering
5. Control model generation
6. Placement calculation
7. Visual-state calculation
8. Renderer delivery
9. Action execution
10. Audit/event recording

Suggested flow:

```text
Active game
→ Resolve profile
→ Resolve verified capabilities
→ Apply safety restrictions
→ Load user Wisp preferences
→ Build Basic/Advanced control model
→ Calculate panel placement
→ Resolve Wisp visual state
→ Render
→ User action
→ Validate approval and capability
→ Execute through existing safe backend
→ Record result
→ Update Wisp visual state
```

Do not allow the renderer to invent capabilities or bypass backend policy.

======================================================================
9. SAFETY REQUIREMENTS
======================

* Local single-player use only.
* Preserve anti-cheat and online protections.
* Never expose unsupported controls as functioning.
* Writes must use existing approval policy.
* Preserve backup and rollback requirements.
* Save-backed and live-memory controls must be labeled distinctly.
* Experimental controls must be visibly marked.
* Unsafe or unsupported states must fail closed.
* The customization layer may change presentation, not authority.
* Renaming or pinning a control must not alter its safety classification.
* User presets must not bypass approval.

======================================================================
10. TESTING REQUIREMENTS
========================

PLACEMENT TESTS

* Left window produces right-side placement.
* Right window produces left-side placement.
* Centered window selects larger side.
* Off-screen result flips automatically.
* Advanced expansion recalculates bounds.
* Multi-monitor placement uses correct display.
* Scale-factor changes preserve visible bounds.
* Manual override persists.

CONTROL REGISTRY TESTS

* Active profile returns only supported controls.
* Unsupported controls remain hidden or disabled.
* Experimental controls are labeled.
* Read-only controls cannot write.
* Version mismatch blocks affected controls.
* Online/anti-cheat state removes write authority.

CUSTOMIZATION TESTS

* Pinning persists per game.
* Hiding persists per game.
* Reordering persists.
* Reset restores defaults.
* Removed control IDs do not break loading.
* Profile updates preserve valid preferences.

POSE-STATE TESTS

* Neutral is default after initialization.
* Scanning state activates during scans.
* Success/error states return to neutral.
* Quiet mode uses compact state.
* Advanced mode selects advanced pose.
* Reduced-motion setting disables excessive animation.
* Approval state cannot be confused with success.

RESPONSIVE TESTS

* No overlap at supported minimum window size.
* No clipping at standard desktop sizes.
* Advanced mode supports scrolling.
* Buttons remain clickable.
* Character art does not cover controls.

======================================================================
11. MANUAL ACCEPTANCE MATRIX
============================

Manually verify with at least two different profiles:

PROFILE A

* Farming or life-simulation game
* Resources
* Stamina
* Skills
* Inventory
* Time/world state if supported

PROFILE B

* Action or RPG game
* Health
* XP
* Equipment
* Reputation or quest state if supported

For each profile verify:

1. Basic controls differ appropriately.
2. Advanced categories are game-specific.
3. Unsupported actions do not appear enabled.
4. User can pin/hide/reorder actions.
5. Preferences survive restart.
6. Placement responds to window movement.
7. Wisp flips when needed.
8. Neutral pose uses relaxed arms.
9. Scanning/success/warning states visibly differ.
10. Compact idle mode is unobtrusive.
11. No clipping or control overlap occurs.

======================================================================
12. ROADMAP PLACEMENT
=====================

Add this work under the deferred Wisp/post-v1 track.

Recommended milestone order:

W1 — Wisp backend schemas and control registry
W2 — Adaptive placement engine
W3 — Basic/Advanced mode framework
W4 — Per-game preference persistence
W5 — Character pose/state controller
W6 — Responsive panel implementation
W7 — Two-profile integration
W8 — Manual multi-monitor and gameplay certification
W9 — Optional Game Bar host integration

Do not allow Wisp work to block Solith S1–S5 unless Chase explicitly changes the portfolio scope decision.

======================================================================
FINAL DELIVERABLE FORMAT
========================

Return:

1. Existing Wisp architecture
2. New backend architecture
3. Data models added
4. Placement algorithm
5. Control registry behavior
6. Customization persistence
7. Pose/state system
8. Responsive layout behavior
9. Safety integration
10. Tests added
11. Manual verification results
12. Remaining defects
13. Commit hash
14. Current Wisp milestone status

FINAL STATUS

```text
WISP BACKEND EXPANSION
Status: COMPLETE / IN PROGRESS / BLOCKED
Adaptive opposite-side placement: PASS / FAIL
Advanced mode: PASS / FAIL
Game-aware controls: PASS / FAIL
Per-game customization: PASS / FAIL
Preference persistence: PASS / FAIL
Neutral pose updated: PASS / FAIL
State-driven poses: PASS / FAIL
Compact idle mode: PASS / FAIL
Responsive layout: PASS / FAIL
Multi-monitor handling: PASS / FAIL
Safety gates preserved: PASS / FAIL
Two-profile manual verification: PASS / FAIL
Implementation commit: <hash or PENDING>
Observed issues: <exact issues or none>
```

WISP WORKSTREAM AMENDMENT — MANDATORY GAME BAR HOST, MULTI-FORM CHARACTER SYSTEM, CUSTOMIZATION, AND 3D LIFE-LIKE BEHAVIOR

STATUS CHANGE

Replace:

W9 — Optional Game Bar host integration

With:

W9 — Mandatory Xbox Game Bar host integration and certification

Xbox Game Bar is a required Wisp host for the target product vision. The Wisp roadmap is not complete until the Game Bar host passes certification over a real supported game.

This does not mean Game Bar must block the first Solith alpha unless Chase explicitly changes the current portfolio scope. It means the Wisp workstream itself cannot be called complete without it.

======================================================================
1. MANDATORY GAME BAR HOST
======================================================================

REQUIRED OUTCOME

Wisp must run as a functional Xbox Game Bar widget/host with:

- visible overlay over a real game,
- game-aware controls,
- compact and expanded forms,
- adaptive positioning,
- input and click-through behavior,
- multi-monitor support,
- persistence,
- safety gating,
- state-driven animations,
- no dependency on the main Solith window remaining visible.

MANDATORY CERTIFICATION

Game Bar integration must pass:

1. Widget installs and registers correctly.
2. Widget opens from Xbox Game Bar.
3. Wisp renders over a real supported game.
4. Wisp can switch between compact and expanded modes.
5. Wisp controls remain clickable.
6. Non-interactive transparent regions do not block the game.
7. Click-through behavior is correct.
8. Focus returns safely to the game.
9. Game movement/resolution changes do not lose Wisp.
10. Wisp survives widget close/reopen.
11. Wisp preferences survive restart.
12. Multi-monitor placement works.
13. High-DPI scaling works.
14. Safety and approval gates remain enforced.
15. No unsupported write capability is exposed.
16. The widget does not disappear unexpectedly during normal use.
17. Performance remains acceptable during gameplay.

W9 is complete only after manual evidence is recorded over at least one real supported game.

======================================================================
2. MULTI-FORM WISP SYSTEM
======================================================================

GOAL

Wisp should not have only one body or one static mascot presentation.

Wisp must support multiple forms that differ in silhouette, presence, animation, and interaction density.

Forms should feel like expressions of the same character, not unrelated skins.

REQUIRED FORM CATEGORIES

At minimum:

1. Orb form
   - smallest footprint,
   - quiet idle mode,
   - low distraction,
   - ideal during active gameplay.

2. Hood/avatar form
   - compact recognizable identity,
   - suitable for docked mode,
   - moderate personality without large screen usage.

3. Full character form
   - used for conversation,
   - approvals,
   - warnings,
   - advanced controls,
   - onboarding,
   - celebration.

4. Holographic assistant form
   - panels and controls arranged around Wisp,
   - used for Advanced mode,
   - visually communicates active tool operation.

5. Spirit/flame form
   - more abstract,
   - minimal limbs,
   - animated energy and motion,
   - useful for users who want a less humanoid presence.

6. Creature/companion form
   - optional cute companion-style silhouette,
   - expressive but restrained,
   - must preserve Wisp identity.

7. Minimal glyph form
   - nearly icon-only,
   - accessibility and performance-friendly,
   - useful for low-resource mode.

8. 3D full form
   - optional high-fidelity mode,
   - supports richer animation,
   - spins, turns, hover motion, reactions, and spatial gestures.

FORM MODEL

```ts
type WispFormId =
  | "orb"
  | "hood"
  | "full-character"
  | "holographic"
  | "spirit"
  | "companion"
  | "glyph"
  | "full-3d";

interface WispFormDefinition {
  id: WispFormId;
  label: string;
  description: string;

  renderer: "sprite-2d" | "skeletal-2d" | "model-3d" | "glyph";
  assetId: string;

  supportedStates: WispVisualState[];
  supportsAdvancedMode: boolean;
  supportsDockedMode: boolean;
  supportsGameBar: boolean;

  minimumWidth: number;
  minimumHeight: number;

  performanceTier: "low" | "medium" | "high";
  reducedMotionFallbackForm?: WispFormId;
}
````

FORM RULES

* Every form must preserve the same personality identity.
* State transitions must remain understandable across forms.
* Forms that cannot support a visual state must fall back safely.
* Game Bar must support at least:

  * orb,
  * hood,
  * full character,
  * glyph.
* 3D is not required on unsupported hardware.
* The renderer must degrade gracefully.

======================================================================
3. USER CUSTOMIZATION
=====================

Allow Wisp customization without turning the system into an uncontrolled character editor.

CUSTOMIZATION OPTIONS

1. Color theme

   * primary glow,
   * secondary glow,
   * accent,
   * warning color,
   * success color.

2. Form

   * choose among supported Wisp forms.

3. Temperament

   * Active
   * Balanced
   * Docile

4. Animation intensity

   * Minimal
   * Subtle
   * Expressive

5. Voice/personality presentation

   * quiet,
   * standard,
   * energetic,
   * concise,
   * explanatory.

6. Idle behavior

   * still,
   * subtle hover,
   * occasional look-around,
   * gentle orbit,
   * playful.

7. Interaction frequency

   * only when summoned,
   * important events only,
   * normal,
   * proactive.

8. Dock behavior

   * automatic,
   * left,
   * right,
   * compact,
   * hidden until summoned.

9. Form by context

   * orb during gameplay,
   * full character during conversation,
   * holographic during Advanced mode,
   * glyph under reduced-motion or low-performance mode.

10. Optional accessories

* restrained and profile-safe,
* no visual clutter that blocks controls.

TEMPERAMENT MODEL

```ts
type WispTemperament = "active" | "balanced" | "docile";

interface WispBehaviorPreferences {
  temperament: WispTemperament;
  animationIntensity: "minimal" | "subtle" | "expressive";
  interactionFrequency:
    | "summoned-only"
    | "important-only"
    | "normal"
    | "proactive";

  idleBehavior:
    | "still"
    | "hover"
    | "look-around"
    | "orbit"
    | "playful";

  preferredForm: WispFormId;
  gameplayForm?: WispFormId;
  conversationForm?: WispFormId;
  advancedModeForm?: WispFormId;
}
```

TEMPERAMENT BEHAVIOR

Active:

* more movement,
* faster reactions,
* more proactive prompts,
* expressive success animations,
* occasional playful motion.

Balanced:

* restrained animation,
* normal prompts,
* moderate reactions,
* default setting.

Docile:

* minimal movement,
* low-interruption behavior,
* subdued glow,
* prompts only when important or summoned.

Customization must change presentation and interaction frequency, not safety authority.

======================================================================
4. 3D WISP MODE
===============

3D is a strong direction, but it must be optional and performance-aware.

3D CAPABILITIES

Possible animations:

* slow idle rotation,
* hover drift,
* spin on success,
* small flip or twirl,
* head tilt,
* hand gestures,
* holographic panel manipulation,
* playful orbit,
* recoil on error,
* glow expansion,
* compact transformation into orb form,
* re-expansion into full form.

Do not make Wisp constantly spin. That would become annoying.

3D should support:

* skeletal animation,
* blend states,
* state transitions,
* reduced-motion mode,
* LOD or lower-complexity model,
* transparent background,
* Game Bar rendering,
* high-DPI scaling,
* hardware capability detection.

3D RENDERING STRATEGY

Evaluate:

* Three.js
* Babylon.js
* WebGPU/WebGL path inside Electron
* pre-rendered sprite fallback
* lightweight model formats such as glTF/GLB

Recommended asset format:

```text
GLB / glTF
```

Required:

* small model size,
* optimized textures,
* reduced draw calls,
* animation clips named by state,
* fallback 2D representation,
* no external asset loading required at runtime.

PERFORMANCE MODES

Low:

* glyph or orb,
* no continuous 3D,
* minimal animation.

Medium:

* 2D skeletal or lightweight 3D,
* subtle idle animation.

High:

* full 3D,
* richer state animation,
* holographic panels,
* expressive transitions.

Auto-detect performance tier, but allow manual override.

======================================================================
5. MAKE WISP FEEL ALIVE
=======================

Wisp should feel responsive, not randomly animated.

LIFE-LIKE BEHAVIOR SHOULD COME FROM CONTEXT

Examples:

* User opens Wisp:
  greeting animation once, then neutral.

* User is idle:
  subtle hover or glance, no constant chatter.

* Game starts:
  compact gameplay form.

* Scan begins:
  scanning pose and visual sweep.

* User succeeds:
  brief spin, glow pulse, or small celebratory motion.

* Warning appears:
  focused posture and warning color.

* User ignores Wisp:
  return to docile idle rather than escalating.

* Advanced mode opens:
  transform into holographic or full form.

* Wisp is moved:
  react briefly, then settle.

* Quiet mode activates:
  shrink into orb/glyph and dim.

* User repeatedly uses one control:
  optionally pin or suggest it, subject to preference.

Do not simulate neediness, annoyance, guilt, or emotional manipulation.

Wisp may feel alive through:

* state awareness,
* subtle anticipation,
* contextual animation,
* memory of preferences,
* responsive form changes.

It should not behave like a pet demanding attention.

======================================================================
6. CUSTOMIZATION PERSISTENCE
============================

Store customization locally.

```ts
interface WispAppearancePreferences {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;

  defaultForm: WispFormId;
  gameplayForm: WispFormId;
  conversationForm: WispFormId;
  advancedModeForm: WispFormId;

  temperament: WispTemperament;
  animationIntensity: "minimal" | "subtle" | "expressive";
  reducedMotion: boolean;

  performanceMode: "auto" | "low" | "medium" | "high";
  updatedAt: string;
}
```

Requirements:

* survives restart,
* safe migration,
* reset to defaults,
* invalid colors/forms fall back safely,
* missing assets do not crash Wisp,
* Game Bar and Electron hosts use the same preferences.

======================================================================
7. UPDATED WISP ROADMAP
=======================

W1 — Wisp backend schemas and control registry
W2 — Adaptive placement engine
W3 — Basic/Advanced mode framework
W4 — Per-game control customization
W5 — Appearance, form, and temperament preferences
W6 — Multi-form renderer
W7 — Character pose/state controller
W8 — Optional 3D renderer with 2D fallback
W9 — Mandatory Xbox Game Bar host integration
W10 — Two-profile game-aware integration
W11 — Multi-monitor, scaling, and performance certification
W12 — Real-game Game Bar certification and release gate

Wisp work is not complete until W9–W12 pass.

======================================================================
8. MANUAL ACCEPTANCE
====================

Verify:

1. User can choose form.
2. User can customize colors.
3. User can choose Active, Balanced, or Docile.
4. Preferences survive restart.
5. Gameplay can use orb form.
6. Conversation can expand to full form.
7. Advanced mode can use holographic form.
8. State changes produce appropriate animation.
9. 3D mode works on supported hardware.
10. 2D fallback works when 3D is disabled.
11. Reduced-motion mode works.
12. Game Bar supports required forms.
13. Game Bar survives close/reopen.
14. Wisp feels responsive without becoming distracting.
15. No animation blocks controls or gameplay.

FINAL STATUS

```text
WISP CHARACTER AND GAME BAR EXPANSION
Status: COMPLETE / IN PROGRESS / BLOCKED
Mandatory Game Bar host: PASS / FAIL
Game Bar real-game certification: PASS / FAIL
Multi-form system: PASS / FAIL
Color customization: PASS / FAIL
Temperament customization: PASS / FAIL
Active/Balanced/Docile behavior: PASS / FAIL
3D renderer: PASS / FAIL / DEFERRED
2D fallback: PASS / FAIL
State-driven animation: PASS / FAIL
Reduced-motion support: PASS / FAIL
Preference persistence: PASS / FAIL
Performance fallback: PASS / FAIL
Observed issues: <exact issues or none>
```
