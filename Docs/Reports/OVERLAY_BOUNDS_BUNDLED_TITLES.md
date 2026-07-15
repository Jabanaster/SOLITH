# Overlay layout bounds — bundled titles

**Purpose:** Document AG overlay preset fit at 1080p and ultrawide (3440×1440).  
**Source:** `src/core/cheat-system/overlay-layout-presets.ts`  
**Date:** 2026-07-15

Presets use **margin from the right edge** of the work area, so ultrawide does not center-drift into the game.

Work-area assumption: full monitor (taskbar ignored for this offline table).

| Game id | W×H | marginRight | marginTop | Anchor @ 1920×1080 (x,y) | Anchor @ 3440×1440 (x,y) | Fits work area |
|---------|-----|-------------|-----------|--------------------------|--------------------------|----------------|
| `palworld` | 400×620 | 16 | 40 | (1504, 40) | (3024, 40) | Yes / Yes |
| `stardew-valley` | 360×520 | 24 | 56 | (1536, 56) | (3056, 56) | Yes / Yes |
| `atomfall` | 400×600 | 20 | 48 | (1500, 48) | (3020, 48) | Yes / Yes |
| `avowed` | 420×640 | 12 | 36 | (1488, 36) | (3008, 36) | Yes / Yes |
| `undisputed` | 340×480 | 28 | 64 | (1552, 64) | (3072, 64) | Yes / Yes |
| `dredge` | 360×540 | 20 | 48 | (1540, 48) | (3060, 48) | Yes / Yes |
| `crimson-desert` | 400×600 | 16 | 44 | (1504, 44) | (3024, 44) | Yes / Yes |
| *(default)* | 380×560 | 20 | 48 | (1520, 48) | (3040, 48) | Yes / Yes |

`x = workWidth − marginRight − width`, `y = marginTop`.

## Validation rule

Offline AG check is geometric: `x ≥ 0`, `y ≥ 0`, `x + width ≤ workWidth`, `y + height ≤ workHeight` for both resolutions above.  
In-game visual QA remains LIVE / manual when the title is running under overlay.

## Follow-up (optional)

- Add unit test asserting all presets satisfy the 1080p + 3440×1440 inequalities.
- Ultrawide height 1440 leaves headroom for tallest preset (640px).
