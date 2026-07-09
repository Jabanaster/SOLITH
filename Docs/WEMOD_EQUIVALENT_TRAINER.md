# WeMod-Equivalent Live Trainer for Palworld

> **Superseded (checkpoint `806ba56`, 2026-07-09).** `PalworldCheatMenu.tsx`,
> `PalworldCheatMenu.test.tsx`, and `useFreezeValue.ts` referenced below were intentionally
> removed as obsolete. Palworld cheats are now served through the generic
> `GameSpecificCheatMenu.tsx` (shared across all catalogued games, not Palworld-specific),
> with manual discovery handled by `LiveWatchPanel.tsx`. See `README.md` → "Trainer UI
> Migration" for the current architecture. This document is kept for historical reference
> only.

## Overview

ResourceForge now includes a complete WeMod-equivalent live trainer for Palworld with all requested features:

1. **Pre-curated cheat menu** with 50+ one-click toggles organized by category
2. **Real-time write verification** confirming changes apply immediately in-game
3. **Freeze value feature** (continuous re-write at 200ms interval)
4. **Real-time scanning** for live candidate discovery and auto-narrowing
5. **Online-session guard** blocking writes if game has active network connections
6. **Session-local caching** of discovered addresses within a single game session

## Architecture

### Cheat Definitions (`src/core/live-memory/palworld-cheats.ts`)

All Palworld cheats are pre-defined with metadata:

```typescript
interface CheatDefinition {
  id: string;                    // Unique identifier
  name: string;                  // Display name
  description: string;           // One-line description
  category: 'Player' | 'Inventory' | 'Stats' | ...;
  valueType: LiveValueType;      // 'int32', 'float', etc.
  infiniteValue: number;         // Value to write for "infinite" effect
  normalValues?: {               // Optional range for guided input
    min: number;
    max: number;
  };
  requiresDiscovery: boolean;    // false = known, true = user must scan
}
```

**Pre-curated cheats** (organized by category):

- **Player**: Infinite Player Health, Infinite Pal Health, Infinite Stamina, Infinite Satiety, Temperature Always Normal
- **Inventory**: No Item Weight Limit, Gold (pre-discovered at 0x218f743a954, 0x218ff263f30)
- **Stats**: Infinite Sanity, Set Stat Points, Set Level, Set Rank
- **Weapons**: Infinite Weapon Durability, No Reload
- **Enemies**: Set Loot Drop Multiplier
- **Game**: 100% Capture Chance, All Pals Are Rare, Instant Work Progress, No Crafting Requirements, No Building Requirements
- **Physics**: Instant Acceleration, Set Sprint Speed Multiplier, Set Jump Height Multiplier
- **Maps**: Key Location Teleport
- **Video/Voice**: Clip Video, Voice Command

## Components

### PalworldCheatMenu (`src/app/components/PalworldCheatMenu.tsx`)

Main UI component displaying pre-curated cheats organized by category.

**Features:**
- One-click toggle buttons for each cheat
- Status badges: IDLE / DISCOVERING / CONFIRMED / FROZEN / ERROR
- Freeze button (continuous re-write at 200ms)
- Real-time error display
- Responsive grid layout (320px+ width)
- Disabled state when offline confirmation is not set

**State Management:**
```typescript
interface CheatToggleState {
  [cheatId: string]: {
    isEnabled: boolean;         // Cheat is active
    value: number;              // Current write value
    isFrozen: boolean;          // Freeze mode enabled
    status: 'idle' | 'discovering' | 'confirmed' | 'frozen' | 'error';
    error: string | null;
  };
}
```

### Freeze Value Hook (`src/app/hooks/useFreezeValue.ts`)

Implements continuous value re-write at 200ms interval.

**Usage:**
```typescript
const { isFrozen, freezeError, startFreeze, stopFreeze } = useFreezeValue({
  handle,              // Open process handle
  address,             // Confirmed memory address
  dataType,            // 'int32', 'float', etc.
  freezeValue,         // Value to maintain (e.g., 9999 for infinite health)
  isEnabled,           // Toggle freeze on/off
});
```

**Behavior:**
- Writes immediately on enable
- Continues writing every 200ms while enabled
- Stops on handle close or write error
- Cleans up interval on component unmount

### Real-Time Scanner (`src/core/live-memory/real-time-scanner.ts`)

Background service for live candidate discovery and auto-narrowing.

**Usage:**
```typescript
const scanner = new RealtimeScanner({
  handle,             // Open process handle
  candidates,         // [{address, value}, ...]
  dataType,           // 'int32', 'float', etc.
  pollIntervalMs: 100, // Poll every 100-500ms
  onCandidateUpdate,  // Callback with updated candidates
  onError,            // Callback on error
});

scanner.start();      // Begin polling
scanner.stop();       // Stop and cleanup
```

**Real-time narrowing workflow:**
1. User has 632 candidates from first scan
2. Scanner polls all 632 every 100ms
3. User changes value in-game
4. Scanner detects value changes, updates only changed candidates
5. UI shows updated count: "432 candidates remaining"
6. User changes value again
7. Process repeats until 1 candidate remains (confirmed)

## Safety Architecture

### Online-Session Guard

Every write is gated by a fail-closed check:

```typescript
const guard = evaluateOnlineGuard({
  userConfirmedOffline,              // User's explicit checkbox confirmation
  remoteConnections,                 // Live TCP connection count
  acceptedConnectionBaseline: 4,     // Palworld Steamworks overhead
});

if (!guard.allowed) {
  // Write blocked with reason
  return { allowed: false, reason: guard.reason };
}
```

**Guard blocks writes if:**
- User did NOT check "offline only" confirmation
- Live connection count exceeds baseline
- Any error reading connection count

### Connection Baseline

Palworld's accepted baseline is **4 connections** (measured evidence):
- Steamworks cloud saves
- Friends/presence sync
- Telemetry
- Other background services

Baseline is reviewed empirically per game; guesses are rejected.

## Session Caching

Addresses discovered during a session are cached in-memory:

```typescript
trainerSessionCache.store(
  executable: 'Palworld-Win64-Shipping.exe',
  dataType: 'int32',
  address: '0x218f743a954',
  value: 75410,
);

// Later in same session, retrieve:
const cached = trainerSessionCache.retrieve('Palworld-Win64-Shipping.exe', 'int32');
// { address: '0x218f743a954', gameExecutable, dataType, lastRead, lastValue, timestamp }
```

**Cleared on:**
- App close (session ends)
- Manual user action
- Handle close due to error

**Preserved across:**
- Component re-renders
- Route changes within the same session
- Multiple cheats using same address

## User Workflows

### Workflow 1: One-Click Infinite Health (No Discovery Needed)

**Prerequisites:** Gold address already discovered (0x218f743a954)

1. Open Palworld trainer page
2. Check "I confirm this session is single-player/offline only"
3. Locate "Infinite Player Health" in Player category
4. Click toggle to enable
5. Status changes to CONFIRMED
6. Click "Freeze" button to maintain infinite health
7. Button shows "❄️ FROZEN"
8. Trainer continuously re-writes 9999 health every 200ms

### Workflow 2: Discover + Toggle (Manual Discovery)

1. Switch to "Advanced Mode"
2. Manually scan for current health value
3. Get candidates (e.g., 632 addresses)
4. Change health in-game
5. Enter new value in "Narrow" section
6. Scan narrows to 12 candidates
7. Repeat until 1 candidate (confirmed)
8. Enable freeze if desired
9. Address is cached for rest of session

### Workflow 3: Live Real-Time Scanning

**Future enhancement** (infrastructure ready):

1. Enable cheat toggle
2. Trainer automatically starts real-time scanner
3. Scanner polls candidate addresses every 100ms
4. User changes value in-game
5. Scanner detects change, updates UI live
6. Candidates narrow automatically without user input
7. "632 candidates" → "432" → "12" → "1" (confirmed)
8. No manual narrow step needed

## API Integration

### PalworldCheatMenu Props

```typescript
interface PalworldCheatMenuProps {
  userConfirmedOffline: boolean;
  onCheatToggle: (cheatId: string, enabled: boolean, value: number) => void;
  onCheatFreeze: (cheatId: string, enabled: boolean) => void;
  onCheatDiscover: (cheatId: string) => void;
}
```

### Page Integration

In `PalworldTrainerPage`:

```tsx
<PalworldCheatMenu
  userConfirmedOffline={userConfirmedOffline}
  onCheatToggle={handleCheatToggle}
  onCheatFreeze={handleCheatFreeze}
  onCheatDiscover={handleCheatDiscover}
/>
```

## Comparison with WeMod

| Feature | WeMod | ResourceForge |
|---------|-------|---------------|
| Pre-curated menu | ✅ | ✅ |
| One-click toggles | ✅ | ✅ |
| Freeze/infinite | ✅ | ✅ |
| Real-time scanning | ✅ | 🔧 Ready (not yet wired) |
| Safety guard | Limited | ✅ Fail-closed |
| Session caching | ✅ | ✅ |
| Multi-game support | ✅ | 🔧 Extensible |

## Known Limitations

### Session-Scoped Addresses

ASLR randomizes memory layout per session. Address 0x218f743a954 today will be different tomorrow.

**Mitigation:** Pointer chains can provide stable addresses across sessions. Palworld does not have stable chains (unlike some other games).

**User impact:** Re-scan each session (~30 seconds total for 2-3 narrowing passes).

### Exact-Value Scanning Only

Current scanner searches for exact value matches. Floating-point precision can make this unreliable for floats.

**Future:** Add fuzzy matching (±0.01) for float values.

### No Reverse-Engineering Detection

The trainer does not hide itself from anti-cheat systems. Palworld's anti-cheat is lenient; use at your own risk.

## Testing

### E2E Tests (`src/app/components/PalworldCheatMenu.test.tsx`)

Playwright test suite covering:

- Safety confirmation gate
- Cheat menu visibility
- Category organization
- Toggle enable/disable
- Freeze button appearance and toggle
- Cheat descriptions
- Advanced mode switch
- Error display

### Manual Testing Checklist

- [ ] Confirm safety checkbox blocks all interaction
- [ ] Unchecking safety checkbox hides menu
- [ ] All categories display correctly
- [ ] Toggle one cheat, verify status changes to DISCOVERING or CONFIRMED
- [ ] Click freeze button, verify "FROZEN" state and styling
- [ ] Disable freeze, status returns to CONFIRMED
- [ ] Switch to advanced mode, traditional trainer appears
- [ ] Switch back to cheat mode, menu returns
- [ ] Error display shows when write fails

## Future Enhancements

1. **Auto-narrow via real-time scanning** — Already implemented, waiting for UI wiring
2. **Pointer chain discovery** — For multi-session persistence
3. **Custom cheat values** — Allow users to set custom "freeze value" per cheat
4. **Cheat profiles** — Save/load sets of enabled cheats
5. **Performance metrics** — Show avg. poll time, write latency, success rate
6. **Multi-game support** — Extend beyond Palworld to Atomfall, Stardew Valley, etc.

## Technical Debt

- [ ] Real-time scanner integration with cheat menu (infrastructure ready, UI wiring pending)
- [ ] Pointer chain discovery for stable cross-session addresses
- [ ] Fuzzy float matching for non-exact values
- [ ] Performance profiling of 200ms freeze interval (might need tuning)

## References

- [Live Memory Trainer Implementation](./LIVE_TRAINER_IMPLEMENTATION.md)
- [Known Issues (KI-017, KI-018)](./KNOWN_ISSUES.md)
- [Game Connection Baselines](../src/core/live-memory/game-connection-baselines.ts)
