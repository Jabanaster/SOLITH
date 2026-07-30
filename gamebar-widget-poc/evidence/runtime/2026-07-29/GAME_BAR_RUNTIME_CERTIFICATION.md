# SOLITH Game Bar Wisp Runtime Certification

Date: 2026-07-29
Status: **GAME BAR RUNTIME — VERIFIED**

## Certified artifact

- Package: `Solith.WispGameBarWidget.Poc_0.1.0.0_x64__a9wj3655nef3j`
- Architecture: x64
- Signature kind: Developer
- Package status after testing: `Ok`
- Test game: Palworld
- SOLITH desktop process during unavailable-path testing: closed
- Loopback mock during unavailable-path testing: stopped; port 8787 closed

## Results

### 1. Explicit unpin behavior

- Preconditions: Wisp installed, opened, and pinned.
- Steps: Open Game Bar; click the Wisp pin; close Game Bar.
- Expected: Wisp disappears when Game Bar closes.
- Actual: Wisp disappeared after unpinning and closing Game Bar.
- Result: **PASS**
- Evidence: operator observation; [pinned persistence screenshot](pinned-widget-persists-with-gamebar-closed.png) records the contrasting pinned state.

### 2. Repeated widget open/close cycles

- Preconditions: Wisp unpinned and Game Bar available.
- Steps: Open Game Bar; open Wisp; close it with its `X`; repeat three times; leave the fourth instance open.
- Expected: Every cycle succeeds without a crash or stale widget.
- Actual: All cycles completed successfully.
- Result: **PASS**

### 3. Duplicate-instance prevention

- Preconditions: Repeated open/close cycle complete with the final widget open.
- Steps: Inspect running `WispGameBarWidget` processes and recent Windows Application errors.
- Expected: One responsive widget process and no matching crash events.
- Actual: One responsive process; zero matching error or critical events.
- Result: **PASS**

### 4. Windowed game mode

- Preconditions: Palworld running in Windowed mode; Wisp pinned.
- Steps: Close Game Bar; use Palworld with Wisp visible.
- Expected: Wisp remains visible and Palworld remains usable.
- Actual: Operator confirmed visibility and normal game operation.
- Result: **PASS**

### 5. Borderless-windowed game mode

- Preconditions: Palworld changed to Borderless Windowed; Wisp pinned.
- Steps: Close Game Bar; use Palworld; enable click-through; Alt+Tab away and back; minimize/restore; close/reopen Game Bar.
- Expected: Wisp remains visible and responsive without duplicate instances; game input remains functional.
- Actual: Operator confirmed every step passed.
- Result: **PASS**

### 6. Fullscreen game mode

- Preconditions: Palworld running fullscreen; Wisp pinned.
- Steps: Close Game Bar and observe the widget over Palworld.
- Expected: Wisp remains visible above the fullscreen game.
- Actual: Wisp rendered correctly above responsive Palworld.
- Result: **PASS**
- Evidence: [Palworld fullscreen screenshot](palworld-fullscreen-pinned-widget.png)

### 7. Input focus

- Preconditions: Palworld fullscreen with pinned Wisp.
- Steps: Close the Palworld news panel and control the game with Wisp visible.
- Expected: Palworld continues accepting input.
- Actual: Operator confirmed normal game input.
- Result: **PASS**

### 8. Click-through

- Preconditions: Wisp pinned over Palworld.
- Steps: Open Game Bar; enable Wisp click-through; close Game Bar; interact with Palworld underneath Wisp.
- Expected: Wisp control panel hides and input passes to Palworld.
- Actual: Control panel hid and Palworld accepted input.
- Result: **PASS**

### 9. Alt+Tab

- Preconditions: Palworld in Windowed and later Borderless Windowed modes with Wisp active.
- Steps: Alt+Tab to another application and return to Palworld.
- Expected: Wisp and Palworld remain responsive after returning.
- Actual: Operator confirmed both mode checks passed.
- Result: **PASS**

### 10. Minimize/restore

- Preconditions: Palworld in Windowed and later Borderless Windowed modes with Wisp active.
- Steps: Minimize Palworld and restore it.
- Expected: Wisp remains operational and no duplicate appears.
- Actual: Operator confirmed both mode checks passed.
- Result: **PASS**

### 11. SOLITH closed

- Preconditions: No SOLITH process running; Wisp process active.
- Steps: Inspect processes and operate Wisp without SOLITH.
- Expected: Wisp remains responsive without depending on the desktop application.
- Actual: SOLITH process count was zero; Wisp remained responsive.
- Result: **PASS**

### 12. Loopback mock unavailable

- Preconditions: Mock process stopped; port `127.0.0.1:8787` closed; SOLITH closed.
- Steps: Open Wisp and click **Ping Solith**.
- Expected: Controlled unavailable-service message without a crash.
- Actual: Wisp displayed `Mock Solith service unreachable: An error occurred while sending the request.` and remained responsive.
- Result: **PASS**
- Evidence: [mock unavailable screenshot](mock-unavailable-controlled-error.png)

### 13. Widget close/reopen

- Preconditions: Wisp available in the Game Bar Widget Menu.
- Steps: Close Wisp with its `X`; reopen it from the Widget Menu; repeat.
- Expected: Clean close and reopen without duplicates or crashes.
- Actual: Repeated cycles completed; final process inspection found one responsive instance.
- Result: **PASS**

### 14. Game Bar close/reopen

- Preconditions: Wisp opened and tested in pinned and unpinned states.
- Steps: Close and reopen Game Bar with `Win+G`.
- Expected: Pinned Wisp persists; unpinned Wisp hides; reopening Game Bar remains functional.
- Actual: Both pinned and unpinned lifecycle behaviors matched expectations.
- Result: **PASS**

### 15. Widget repositioning

- Preconditions: Game Bar open and click-through disabled.
- Steps: Drag Wisp by its `Solith Wisp` title bar; close Game Bar.
- Expected: Wisp can be repositioned inside Game Bar but is not draggable while the overlay is closed.
- Actual: Operator confirmed the widget moved inside Game Bar and remained fixed while pinned outside it.
- Result: **PASS**

## Final verification

- Installed package status: `Ok`
- Wisp processes: 1
- Responsive Wisp processes: 1
- SOLITH processes: 0
- Loopback port 8787 listening: no
- Matching Windows Application error/critical events during final inspection: 0

## Final status

**GAME BAR RUNTIME — VERIFIED**
