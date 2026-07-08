import { useState, useCallback, useRef, useEffect } from 'react';
import { nativeMemoryDriver, listLiveMemoryProcesses } from '../../core/live-memory/native-memory-driver.js';
import { scanFirst, scanNext } from '../../core/live-memory/memory-scanner.js';
import { observeRemoteConnections } from '../../core/live-memory/remote-connection-observer.js';
import { evaluateOnlineGuard } from '../../core/live-memory/online-guard.js';
import { getConnectionBaseline } from '../../core/live-memory/game-connection-baselines.js';
import { trainerSessionCache } from '../stores/trainerSessionCache.js';
import type { LiveValueType, LiveProcessHandle } from '../../core/live-memory/types.js';

export interface TrainerAddress {
  address: string;
  value: number;
  confirmed: boolean;
}

export interface TrainerWorkflowState {
  status: 'idle' | 'scanning' | 'narrowing' | 'confirmed' | 'error';
  processName: string;
  searchValue: number | null;
  candidates: TrainerAddress[];
  candidateCount: number;
  confirmedAddress: string | null;
  liveValue: number | null;
  error: string | null;
}

export interface useLiveTrainerWorkflowOptions {
  processName: string;
  dataType: LiveValueType;
  userConfirmedOffline: boolean;
}

export function useLiveTrainerWorkflow({
  processName,
  dataType,
  userConfirmedOffline,
}: useLiveTrainerWorkflowOptions) {
  const cached = trainerSessionCache.retrieve(processName, dataType);

  const [state, setState] = useState<TrainerWorkflowState>(() => ({
    status: cached ? 'confirmed' : 'idle',
    processName,
    searchValue: null,
    candidates: cached ? [{ address: cached.address, value: cached.lastValue, confirmed: true }] : [],
    candidateCount: cached ? 1 : 0,
    confirmedAddress: cached?.address ?? null,
    liveValue: cached?.lastValue ?? null,
    error: null,
  }));

  const handleRef = useRef<LiveProcessHandle | null>(null);

  const findProcess = useCallback(() => {
    const processes = listLiveMemoryProcesses();
    return processes.find((p) => p.name.toLowerCase() === processName.toLowerCase());
  }, [processName]);

  const startScan = useCallback(
    async (searchValue: number) => {
      setState((s) => ({ ...s, status: 'scanning', searchValue, error: null, candidates: [] }));

      try {
        // Close any existing handle before opening a new one
        if (handleRef.current) {
          nativeMemoryDriver.closeProcess(handleRef.current);
          handleRef.current = null;
        }

        const match = findProcess();
        if (!match) {
          setState((s) => ({ ...s, status: 'error', error: `${processName} not found` }));
          return;
        }

        const handle = nativeMemoryDriver.openProcess(match.pid);
        handleRef.current = handle;

        const result = scanFirst(nativeMemoryDriver, handle, dataType, searchValue);

        const candidates: TrainerAddress[] = result.matches.map((m) => ({
          address: `0x${m.address.toString(16)}`,
          value: m.value,
          confirmed: false,
        }));

        setState((s) => ({
          ...s,
          status: 'scanning',
          candidates,
          candidateCount: result.matches.length,
          error: result.truncated ? 'Scan was truncated due to memory budget' : null,
        }));
      } catch (err) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        }));
        if (handleRef.current) {
          nativeMemoryDriver.closeProcess(handleRef.current);
          handleRef.current = null;
        }
      }
    },
    [findProcess, processName, dataType],
  );

  const narrowCandidates = useCallback(
    async (newSearchValue: number) => {
      if (!handleRef.current || state.candidates.length === 0) {
        setState((s) => ({ ...s, error: 'No candidates to narrow' }));
        return;
      }

      setState((s) => ({ ...s, status: 'narrowing' }));

      try {
        const narrowed: TrainerAddress[] = [];

        for (const candidate of state.candidates) {
          try {
            const addr = BigInt(candidate.address);
            const value = nativeMemoryDriver.readMemory(handleRef.current, addr, dataType);

            if (value === newSearchValue) {
              narrowed.push({ ...candidate, value, confirmed: narrowed.length === 0 });
            }
          } catch {
            // Address became unreadable, skip it
          }
        }

        if (narrowed.length === 1) {
          setState((s) => ({
            ...s,
            status: 'confirmed',
            candidates: narrowed,
            candidateCount: narrowed.length,
            confirmedAddress: narrowed[0].address,
            liveValue: narrowed[0].value,
          }));
        } else if (narrowed.length > 1) {
          setState((s) => ({
            ...s,
            status: 'narrowing',
            candidates: narrowed,
            candidateCount: narrowed.length,
          }));
        } else {
          setState((s) => ({
            ...s,
            status: 'error',
            error: 'No candidates matched the new value',
            candidates: [],
            candidateCount: 0,
          }));
        }
      } catch (err) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [state.candidates, dataType],
  );

  const confirmAddress = useCallback(async (address: string) => {
    if (!handleRef.current) return;

    try {
      const addr = BigInt(address);
      const value = nativeMemoryDriver.readMemory(handleRef.current, addr, dataType);

      setState((s) => ({
        ...s,
        status: 'confirmed',
        confirmedAddress: address,
        liveValue: value,
        candidates: [{ address, value, confirmed: true }],
        candidateCount: 1,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [dataType]);

  const readLiveValue = useCallback(async () => {
    if (!state.confirmedAddress || !handleRef.current) return;

    try {
      const addr = BigInt(state.confirmedAddress);
      const value = nativeMemoryDriver.readMemory(handleRef.current, addr, dataType);
      setState((s) => ({ ...s, liveValue: value }));
      return value;
    } catch (err) {
      setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [state.confirmedAddress, dataType]);

  const writeValue = useCallback(
    async (newValue: number): Promise<{ allowed: boolean; reason: string }> => {
      if (!state.confirmedAddress || !handleRef.current) {
        return { allowed: false, reason: 'No confirmed address' };
      }

      try {
        const match = findProcess();
        if (!match) {
          return { allowed: false, reason: `${processName} not found` };
        }

        const evidence = await observeRemoteConnections(match.pid);
        const baseline = getConnectionBaseline(processName);

        const guard = evaluateOnlineGuard({
          userConfirmedOffline,
          remoteConnections: evidence,
          acceptedConnectionBaseline: baseline,
        });

        if (!guard.allowed) {
          return { allowed: false, reason: guard.reason };
        }

        const addr = BigInt(state.confirmedAddress);
        nativeMemoryDriver.writeMemory(handleRef.current, addr, dataType, newValue);

        const readBack = nativeMemoryDriver.readMemory(handleRef.current, addr, dataType);
        setState((s) => ({ ...s, liveValue: readBack }));

        return { allowed: true, reason: `Successfully wrote ${newValue}` };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        setState((s) => ({ ...s, error: reason }));
        return { allowed: false, reason };
      }
    },
    [state.confirmedAddress, processName, dataType, findProcess, userConfirmedOffline],
  );

  const cacheAddress = useCallback((address: string, value: number) => {
    trainerSessionCache.store(processName, dataType, address, value);
  }, [processName, dataType]);

  const cleanup = useCallback(() => {
    if (handleRef.current) {
      nativeMemoryDriver.closeProcess(handleRef.current);
      handleRef.current = null;
    }
  }, []);

  const actions = useRef({
    startScan,
    narrowCandidates,
    confirmAddress,
    readLiveValue,
    writeValue,
    cacheAddress,
    cleanup,
  });

  useEffect(() => {
    actions.current = {
      startScan,
      narrowCandidates,
      confirmAddress,
      readLiveValue,
      writeValue,
      cacheAddress,
      cleanup,
    };
  }, [startScan, narrowCandidates, confirmAddress, readLiveValue, writeValue, cacheAddress, cleanup]);

  return {
    state,
    actions: actions.current,
  };
}
