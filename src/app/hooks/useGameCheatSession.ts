import { useState, useCallback, useRef, useEffect } from 'react';
import { nativeMemoryDriver, listLiveMemoryProcesses } from '../../core/live-memory/native-memory-driver.js';
import { scanFirst } from '../../core/live-memory/memory-scanner.js';
import { observeRemoteConnections } from '../../core/live-memory/remote-connection-observer.js';
import { evaluateOnlineGuard } from '../../core/live-memory/online-guard.js';
import { getConnectionBaseline } from '../../core/live-memory/game-connection-baselines.js';
import { trainerSessionCache } from '../stores/trainerSessionCache.js';
import type { LiveProcessHandle, LiveValueType } from '../../core/live-memory/types.js';
import type { GameConfig, CheatDefinition } from '../../core/cheat-system/types.js';

export type CheatStatus = 'idle' | 'discovering' | 'confirmed' | 'frozen' | 'error';

export interface CheatSessionState {
  enabled: boolean;
  status: CheatStatus;
  candidates: { address: string; value: number }[];
  confirmedAddress: string | null;
  liveValue: number | null;
  isFrozen: boolean;
  error: string | null;
}

const FREEZE_INTERVAL_MS = 200;
const IDLE_STATE: CheatSessionState = {
  enabled: false,
  status: 'idle',
  candidates: [],
  confirmedAddress: null,
  liveValue: null,
  isFrozen: false,
  error: null,
};

/**
 * 'bool' cheats are represented as int32 flags in real game memory (0/1);
 * 'string' cheats (Stardew-style console commands) have no memory address
 * at all and are handled by a separate command executor, not this hook.
 */
function resolveMemoryDataType(cheat: CheatDefinition): LiveValueType | null {
  if (cheat.valueType === 'bool') return 'int32';
  if (cheat.valueType === 'string') return null;
  return cheat.valueType;
}

/**
 * Manages live memory discovery/write/freeze for every cheat of one game at
 * once. One process handle is shared across all of the game's cheats (opened
 * lazily on first discovery, closed on unmount) since scanning/writing 30+
 * addresses through 30+ separate handles would be wasteful and racy.
 */
export function useGameCheatSession(game: GameConfig, userConfirmedOffline: boolean) {
  const [states, setStates] = useState<Record<string, CheatSessionState>>({});
  const handleRef = useRef<LiveProcessHandle | null>(null);
  const freezeIntervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const getState = useCallback((cheatId: string): CheatSessionState => states[cheatId] ?? IDLE_STATE, [states]);

  const patchState = useCallback((cheatId: string, patch: Partial<CheatSessionState>) => {
    setStates((prev) => ({ ...prev, [cheatId]: { ...(prev[cheatId] ?? IDLE_STATE), ...patch } }));
  }, []);

  const ensureHandle = useCallback((): LiveProcessHandle => {
    if (handleRef.current) return handleRef.current;
    const processes = listLiveMemoryProcesses();
    const match = processes.find(
      (p) =>
        p.name.toLowerCase() === game.executable.toLowerCase() ||
        (game.aliases ?? []).some((a) => a.toLowerCase() === p.name.toLowerCase()),
    );
    if (!match) {
      throw new Error(`${game.name} is not running (looked for ${game.executable})`);
    }
    const handle = nativeMemoryDriver.openProcess(match.pid);
    handleRef.current = handle;
    return handle;
  }, [game]);

  const stopFreeze = useCallback((cheatId: string) => {
    const interval = freezeIntervalsRef.current[cheatId];
    if (interval) {
      clearInterval(interval);
      delete freezeIntervalsRef.current[cheatId];
    }
    setStates((prev) => {
      const existing = prev[cheatId];
      if (!existing) return prev;
      return {
        ...prev,
        [cheatId]: { ...existing, isFrozen: false, status: existing.confirmedAddress ? 'confirmed' : 'idle' },
      };
    });
  }, []);

  const writeValue = useCallback(
    async (cheat: CheatDefinition, value: number): Promise<{ allowed: boolean; reason: string }> => {
      const dataType = resolveMemoryDataType(cheat);
      const current = getState(cheat.id);
      const handle = handleRef.current;

      if (!dataType) return { allowed: false, reason: 'Console-command cheat — not memory-backed' };
      if (!handle || !current.confirmedAddress) return { allowed: false, reason: 'No confirmed address yet' };

      try {
        const processes = listLiveMemoryProcesses();
        const match = processes.find((p) => p.name.toLowerCase() === game.executable.toLowerCase());
        if (!match) return { allowed: false, reason: `${game.name} is not running` };

        const evidence = await observeRemoteConnections(match.pid);
        const baseline = getConnectionBaseline(game.executable) || game.connectionBaseline;
        const guard = evaluateOnlineGuard({
          userConfirmedOffline,
          remoteConnections: evidence,
          acceptedConnectionBaseline: baseline,
        });
        if (!guard.allowed) return { allowed: false, reason: guard.reason };

        const addr = BigInt(current.confirmedAddress);
        nativeMemoryDriver.writeMemory(handle, addr, dataType, value);
        patchState(cheat.id, { liveValue: value });
        return { allowed: true, reason: `Wrote ${value}` };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        patchState(cheat.id, { status: 'error', error: reason });
        return { allowed: false, reason };
      }
    },
    [getState, game, userConfirmedOffline, patchState],
  );

  const discover = useCallback(
    (cheat: CheatDefinition, currentValue: number) => {
      const dataType = resolveMemoryDataType(cheat);
      if (!dataType) {
        patchState(cheat.id, { status: 'error', error: 'This cheat requires console commands, not memory scanning' });
        return;
      }
      try {
        const handle = ensureHandle();
        const result = scanFirst(nativeMemoryDriver, handle, dataType, currentValue);
        const candidates = result.matches.map((m) => ({ address: `0x${m.address.toString(16)}`, value: m.value }));
        patchState(cheat.id, {
          status: 'discovering',
          candidates,
          error: result.truncated ? 'Scan truncated by memory budget — narrow to reduce it' : null,
        });
      } catch (err) {
        patchState(cheat.id, { status: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    },
    [ensureHandle, patchState],
  );

  const narrow = useCallback(
    (cheat: CheatDefinition, newValue: number) => {
      const dataType = resolveMemoryDataType(cheat);
      const handle = handleRef.current;
      const current = getState(cheat.id);
      if (!dataType || !handle || current.candidates.length === 0) return;

      const narrowed: { address: string; value: number }[] = [];
      for (const candidate of current.candidates) {
        try {
          const addr = BigInt(candidate.address);
          const value = nativeMemoryDriver.readMemory(handle, addr, dataType);
          if (value === newValue) narrowed.push({ address: candidate.address, value });
        } catch {
          // Address became unreadable (page freed/moved) — drop it silently.
        }
      }

      if (narrowed.length === 1) {
        const [confirmed] = narrowed;
        patchState(cheat.id, {
          status: 'confirmed',
          candidates: narrowed,
          confirmedAddress: confirmed.address,
          liveValue: confirmed.value,
        });
        trainerSessionCache.store(game.executable, dataType, confirmed.address, confirmed.value);
      } else if (narrowed.length > 1) {
        patchState(cheat.id, { status: 'discovering', candidates: narrowed });
      } else {
        patchState(cheat.id, { status: 'error', error: 'No candidates matched — try scanning again', candidates: [] });
      }
    },
    [getState, game.executable, patchState],
  );

  const toggleCheat = useCallback(
    (cheat: CheatDefinition, enabled: boolean) => {
      if (!enabled) {
        stopFreeze(cheat.id);
        patchState(cheat.id, { enabled: false, status: getState(cheat.id).confirmedAddress ? 'confirmed' : 'idle' });
        return;
      }

      patchState(cheat.id, { enabled: true });
      const current = getState(cheat.id);
      if (current.confirmedAddress) {
        void writeValue(cheat, Number(cheat.infiniteValue ?? 1));
        patchState(cheat.id, { status: 'confirmed' });
      } else {
        patchState(cheat.id, { status: 'discovering' });
      }
    },
    [getState, patchState, stopFreeze, writeValue],
  );

  const startFreeze = useCallback(
    (cheat: CheatDefinition) => {
      if (freezeIntervalsRef.current[cheat.id]) return;
      const value = Number(cheat.infiniteValue ?? 1);
      void writeValue(cheat, value);
      freezeIntervalsRef.current[cheat.id] = setInterval(() => void writeValue(cheat, value), FREEZE_INTERVAL_MS);
      patchState(cheat.id, { isFrozen: true, status: 'frozen' });
    },
    [writeValue, patchState],
  );

  const toggleFreeze = useCallback(
    (cheat: CheatDefinition, enabled: boolean) => {
      if (enabled) startFreeze(cheat);
      else stopFreeze(cheat.id);
    },
    [startFreeze, stopFreeze],
  );

  const applyValue = useCallback(
    (cheat: CheatDefinition, value: number) => {
      const current = getState(cheat.id);
      if (current.confirmedAddress) {
        void writeValue(cheat, value);
      } else {
        discover(cheat, value);
      }
    },
    [getState, writeValue, discover],
  );

  const resetError = useCallback((cheatId: string) => {
    patchState(cheatId, { status: 'idle', error: null, candidates: [] });
  }, [patchState]);

  useEffect(() => {
    return () => {
      Object.values(freezeIntervalsRef.current).forEach(clearInterval);
      freezeIntervalsRef.current = {};
      if (handleRef.current) {
        try {
          nativeMemoryDriver.closeProcess(handleRef.current);
        } catch {
          // Process may have already exited — nothing to clean up.
        }
        handleRef.current = null;
      }
    };
  }, []);

  return { getState, discover, narrow, toggleCheat, toggleFreeze, applyValue, resetError };
}
