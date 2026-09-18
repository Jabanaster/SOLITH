import { useState, useCallback, useRef, useEffect } from 'react';
import type { GameConfig, CheatDefinition } from '../../core/cheat-system/types.js';
import { cheatsForHotkeySlots, parseCheatHotkeySlot } from '../../core/cheat-system/cheat-hotkey-slots.js';
import { requiresCommunityExecutionApproval } from '../../core/trainer-catalog/community-trust.js';

export type CheatStatus = 'idle' | 'discovering' | 'confirmed' | 'frozen' | 'error';

export interface DriftPromptState {
  warning: string;
}

export interface ScanCandidate {
  address: string;
  value: number;
  /** Present on candidates from multi-type scans; used to keep narrowing under the same interpretation. */
  dataType?: string;
  /** First-pass scan mode that found this candidate; research metadata only. */
  scanMode?: string;
}

export interface CheatSessionState {
  enabled: boolean;
  status: CheatStatus;
  candidates: ScanCandidate[];
  confirmedAddress: string | null;
  /** The data type the confirmed address was actually found under — may differ from the cheat definition's presumed type (see the multi-type unknown scan). Falls back to resolveMemoryDataType(cheat) when null. */
  confirmedDataType: string | null;
  liveValue: number | null;
  isFrozen: boolean;
  error: string | null;
  /** True once scanFirstUnknown has captured a baseline snapshot, waiting on narrowUnknown(). */
  unknownScanActive: boolean;
}

const IDLE_STATE: CheatSessionState = {
  enabled: false,
  status: 'idle',
  candidates: [],
  confirmedAddress: null,
  confirmedDataType: null,
  liveValue: null,
  isFrozen: false,
  error: null,
  unknownScanActive: false,
};

/** Types tried at once for an unknown-value scan — multi-type "All" scan equivalent, scoped to the types that actually show up as game stats (byte/int64 are rare for a bar/meter and would mostly add noise). */
const UNKNOWN_SCAN_DATA_TYPES = ['float', 'int32', 'double'];

/**
 * 'bool' cheats are represented as int32 flags in real game memory (0/1);
 * 'string' cheats (Stardew-style console commands) have no memory address
 * at all and are handled by a separate command executor, not this hook.
 */
function resolveMemoryDataType(cheat: CheatDefinition): string | null {
  if (cheat.valueType === 'bool') return 'int32';
  if (cheat.valueType === 'string') return null;
  return cheat.valueType;
}

/**
 * Manages live memory discovery/write/freeze for every cheat of one game,
 * entirely through the electronAPI IPC bridge exposed by electron/preload.ts.
 *
 * P4-13: attach and address discovery/scanning (Phase 2, untouched) still go
 * through the legacy `window.electronAPI.liveMemory*` channels — this hook is
 * not the place to relitigate scanning/AOB/pointer resolution. Real
 * mutation — write, freeze, and rollback — is canonical-only, through
 * `window.electronAPI.trainer*` (trainer-execution-ipc.ts ->
 * TrainerApplicationService -> TrainerRuntime), reusing the same attached
 * session via `trainerBindRuntime`. For `scan_first`/`scan_unknown`
 * features (every discovery-required cheat — see games.ts), the address
 * this hook's own discovery flow confirms is handed to the runtime via
 * `trainerSeedDiscoveredFeature` before every write/freeze — never a second,
 * independent execution path (mission §18: no silent legacy fallback).
 *
 * This MUST NOT import anything from src/core/live-memory directly — those
 * modules use Node built-ins (createRequire, native addons) that only exist
 * in the Electron main process. This hook runs in the sandboxed renderer
 * (contextIsolation: true, nodeIntegration: false, sandbox: true — see
 * electron/main.ts), where those imports crash at module-load time with
 * "createRequire is not a function". All actual memory access happens in
 * main via electron/live-memory-ipc.ts; this hook only ever calls
 * ipcRenderer.invoke through the preload bridge.
 *
 * One LiveMemorySession (main-process side) is shared per attached game and
 * supports exactly one active freeze at a time — see startFreeze in
 * live-memory-session.ts ("A freeze is already active on this session. Stop
 * it first."). This hook enforces that by tracking which cheat currently
 * owns the freeze and stopping it before starting a new one.
 */
export function useGameCheatSession(game: GameConfig, userConfirmedOffline: boolean) {
  const [states, setStates] = useState<Record<string, CheatSessionState>>({});
  const [driftPrompt, setDriftPrompt] = useState<DriftPromptState | null>(null);
  const [ratingPrompt, setRatingPrompt] = useState<{ cheatId: string } | null>(null);
  const [communityPrompt, setCommunityPrompt] = useState<{ cheatName: string } | null>(null);
  const driftResolverRef = useRef<((proceed: boolean) => void) | null>(null);
  const communityResolverRef = useRef<((proceed: boolean) => void) | null>(null);
  const communityApprovalChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const communityApprovedCheatsRef = useRef(new Set<string>());
  const attachedRef = useRef(false);
  const frozenCheatIdRef = useRef<string | null>(null);
  const reappliedRef = useRef(false);
  const featureHintsRef = useRef<Record<string, string>>({});
  /**
   * P4-13: whether `trainerBindRuntime` succeeded for the currently attached
   * session, and why not when it failed. Real mutation (write/freeze) is
   * canonical-only from here on (mission §18 "no silent fallback") — a bind
   * failure surfaces as an explicit error on the next write/freeze attempt
   * rather than silently reverting to a raw-address legacy write.
   */
  const runtimeBoundRef = useRef(false);
  const runtimeBindErrorRef = useRef<string | null>(null);
  /** Tracks each cheat's last confirmed write proposalId, so toggling off can roll it back for real instead of just forgetting local state. */
  const writeProposalIdRef = useRef<Record<string, string>>({});
  const getStateRef = useRef<(cheatId: string) => CheatSessionState>(() => IDLE_STATE);
  const toggleCheatRef = useRef<(cheat: CheatDefinition, enable: boolean) => void | Promise<void>>(
    () => undefined,
  );
  const [zeroInputStatus, setZeroInputStatus] = useState<{
    phase: 'idle' | 'preparing' | 'ready' | 'error';
    message?: string;
    counts?: { resolved: number; failed: number; scanRequired: number };
  }>({ phase: 'idle' });

  const getState = useCallback((cheatId: string): CheatSessionState => states[cheatId] ?? IDLE_STATE, [states]);

  const patchState = useCallback((cheatId: string, patch: Partial<CheatSessionState>) => {
    setStates((prev) => ({ ...prev, [cheatId]: { ...(prev[cheatId] ?? IDLE_STATE), ...patch } }));
  }, []);

  /** Fire-and-forget write-through to the persisted cheat_toggle_state table (see cheat-toggle-store.ts). */
  const persist = useCallback(
    (cheat: CheatDefinition, enabled: boolean, confirmedAddress: string | null, confirmedDataType: string | null) => {
      void window.electronAPI.cheatToggleSet({
        gameId: game.gameId,
        cheatId: cheat.id,
        enabled,
        confirmedAddress,
        dataType: confirmedDataType ?? resolveMemoryDataType(cheat),
      });
    },
    [game.gameId],
  );

  const clearPersisted = useCallback(
    (cheatId: string) => {
      void window.electronAPI.cheatToggleClear({ gameId: game.gameId, cheatId });
    },
    [game.gameId],
  );

  const resolveDriftPrompt = useCallback((proceed: boolean) => {
    driftResolverRef.current?.(proceed);
    driftResolverRef.current = null;
    setDriftPrompt(null);
  }, []);

  const waitForDriftAck = useCallback((warning: string) => {
    return new Promise<boolean>((resolve) => {
      driftResolverRef.current = resolve;
      setDriftPrompt({ warning });
    });
  }, []);

  const resolveCommunityPrompt = useCallback((proceed: boolean) => {
    communityResolverRef.current?.(proceed);
    communityResolverRef.current = null;
    setCommunityPrompt(null);
  }, []);

  const requireCommunityApproval = useCallback((cheat: CheatDefinition) => {
    if (
      !requiresCommunityExecutionApproval(cheat.certLevel) ||
      communityApprovedCheatsRef.current.has(cheat.id)
    ) {
      return Promise.resolve(true);
    }

    // Serialize prompts so concurrent L0 actions cannot overwrite the single
    // resolver ref and leave orphaned promises.
    const ask = (): Promise<boolean> => {
      if (communityApprovedCheatsRef.current.has(cheat.id)) {
        return Promise.resolve(true);
      }
      return new Promise<boolean>((resolve) => {
        communityResolverRef.current = (proceed) => {
          if (proceed) communityApprovedCheatsRef.current.add(cheat.id);
          resolve(proceed);
        };
        setCommunityPrompt({ cheatName: cheat.name });
      });
    };

    const queued = communityApprovalChainRef.current.then(ask, ask);
    communityApprovalChainRef.current = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }, []);

  const hydrateFromZeroInputFeatures = useCallback(
    (features: Array<{ featureId: string; address: string; resolution: string; error?: string }>) => {
      const hints: Record<string, string> = { ...featureHintsRef.current };
      setStates((prev) => {
        const next = { ...prev };
        for (const feature of features) {
          if (feature.resolution === 'failed' || !feature.address || feature.address === '0x0') {
            continue;
          }
          hints[feature.featureId] = feature.address;
          const cheat = game.cheats.find((c) => c.id === feature.featureId);
          const dataType = cheat ? resolveMemoryDataType(cheat) : null;
          const existing = next[feature.featureId] ?? IDLE_STATE;
          next[feature.featureId] = {
            ...existing,
            status: 'confirmed',
            confirmedAddress: feature.address,
            confirmedDataType: existing.confirmedDataType ?? dataType ?? 'int32',
            error: null,
          };
        }
        return next;
      });
      featureHintsRef.current = hints;
    },
    [game.cheats],
  );

  /**
   * P4-13: binds the canonical TrainerRuntime onto the SAME already-attached
   * live-memory session (trainer-bind-runtime reuses it via bindExisting —
   * see trainer-execution-ipc.ts) instead of a second attach. Failure here
   * does not throw — discovery/scan (Phase 2, untouched) still works without
   * a canonical bind — but is recorded so writeValue/startFreeze can fail
   * explicitly instead of silently falling back to a legacy raw write.
   */
  const bindCanonicalRuntime = useCallback(async (pid: number, executableName: string): Promise<void> => {
    try {
      const result = await window.electronAPI.trainerBindRuntime({
        catalogGameId: game.gameId,
        pid,
        executableName,
      });
      if (result?.success) {
        runtimeBoundRef.current = true;
        runtimeBindErrorRef.current = null;
      } else {
        runtimeBoundRef.current = false;
        runtimeBindErrorRef.current = result?.error?.message ?? 'Canonical trainer runtime bind failed.';
      }
    } catch (err) {
      runtimeBoundRef.current = false;
      runtimeBindErrorRef.current = err instanceof Error ? err.message : String(err);
    }
  }, [game.gameId]);

  const ensureAttached = useCallback(async (): Promise<void> => {
    if (attachedRef.current) return;

    const listResult = await window.electronAPI.liveMemoryListProcesses();
    if (!listResult.success || !listResult.processes) {
      throw new Error(listResult.error ?? 'Could not list running processes');
    }

    const match = listResult.processes.find(
      (p) =>
        p.name.toLowerCase() === game.executable.toLowerCase() ||
        (game.aliases ?? []).some((a) => a.toLowerCase() === p.name.toLowerCase()),
    );
    if (!match) {
      const lookedFor = [game.executable, ...(game.aliases ?? [])].join(', ');
      throw new Error(`${game.name} is not running (looked for ${lookedFor})`);
    }

    setZeroInputStatus({ phase: 'preparing', message: 'Zero-Input: attaching and resolving…' });

    const preparePayload = {
      pid: match.pid,
      executableName: match.name,
      catalogGameId: game.gameId,
      userConfirmedOffline: true as const,
      featureHints: featureHintsRef.current,
    };

    const prepareFn = window.electronAPI.liveMemoryZeroInputPrepare;
    if (prepareFn) {
      let prepareResult = await prepareFn(preparePayload);
      if (
        !prepareResult.success &&
        (prepareResult.error === 'executable_fingerprint_mismatch' ||
          prepareResult.fingerprintStatus === 'mismatch' ||
          /fingerprint|mismatch|drift/i.test(String(prepareResult.error ?? prepareResult.blockReason ?? '')))
      ) {
        const warning =
          prepareResult.fingerprintWarning ??
          prepareResult.blockReason ??
          'Executable hash does not match the loaded trainer definition (possible game patch).';
        const proceed = await waitForDriftAck(warning);
        if (!proceed) {
          setZeroInputStatus({ phase: 'error', message: warning });
          throw new Error(warning);
        }
        prepareResult = await prepareFn({ ...preparePayload, driftAcknowledged: true });
      }

      if (prepareResult.success) {
        attachedRef.current = true;
        await bindCanonicalRuntime(match.pid, match.name);
        if (prepareResult.featureHints) {
          featureHintsRef.current = prepareResult.featureHints as Record<string, string>;
        }
        if (Array.isArray(prepareResult.features)) {
          hydrateFromZeroInputFeatures(prepareResult.features);
        }
        setZeroInputStatus({
          phase: 'ready',
          message: 'Zero-Input ready',
          counts: prepareResult.counts,
        });
        return;
      }

      // Fall back to classic attach if prepare failed for a non-fatal reason.
      setZeroInputStatus({
        phase: 'error',
        message: prepareResult.error ?? prepareResult.blockReason ?? 'Zero-Input prepare failed — falling back',
      });
    }

    const attachPayload = {
      pid: match.pid,
      executableName: match.name,
      userConfirmedOffline: true as const,
      catalogGameId: game.gameId,
    };

    let attachResult = await window.electronAPI.liveMemoryAttach(attachPayload);
    if (!attachResult.success && attachResult.error === 'executable_fingerprint_mismatch') {
      const warning =
        attachResult.fingerprintWarning ??
        'Executable hash does not match the loaded trainer definition (possible game patch).';
      const proceed = await waitForDriftAck(warning);
      if (!proceed) {
        throw new Error(warning);
      }
      attachResult = await window.electronAPI.liveMemoryAttach({
        ...attachPayload,
        driftAcknowledged: true,
      });
    }

    if (!attachResult.success) {
      throw new Error(attachResult.guard?.reason ?? attachResult.error ?? 'Failed to attach to process');
    }
    attachedRef.current = true;
    await bindCanonicalRuntime(match.pid, match.name);
    setZeroInputStatus({ phase: 'ready', message: 'Attached (classic path)' });
  }, [game, waitForDriftAck, hydrateFromZeroInputFeatures, bindCanonicalRuntime]);

  const stopFreeze = useCallback(async (cheatId: string) => {
    if (frozenCheatIdRef.current !== cheatId) return;
    // P4-13: stops via the canonical runtime's own per-feature freeze bookkeeping
    // instead of the legacy session-wide liveMemoryFreezeStop.
    await window.electronAPI.trainerDeactivateFeature({ featureId: cheatId });
    frozenCheatIdRef.current = null;
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
      const current = getState(cheat.id);
      const dataType = current.confirmedDataType ?? resolveMemoryDataType(cheat);

      if (!dataType) return { allowed: false, reason: 'Console-command cheat — not memory-backed' };
      if (!current.confirmedAddress) return { allowed: false, reason: 'No confirmed address yet' };
      if (!(await requireCommunityApproval(cheat))) {
        return { allowed: false, reason: 'Community definition execution cancelled' };
      }

      try {
        // A cheat can reach here with a confirmedAddress restored from a persisted session
        // (see the reapply effect below) without ever going through discover()/discoverUnknown()
        // in THIS mount — those are the only other callers that attach. Every write needs an
        // attached session regardless of how it got its address, so attach here too.
        await ensureAttached();

        // P4-13: real mutation is canonical-only — no legacy liveMemoryProposeWrite fallback
        // (mission §18). A bind failure fails explicitly here instead of silently reverting.
        if (!runtimeBoundRef.current) {
          const reason = runtimeBindErrorRef.current ?? 'Canonical trainer runtime is not bound.';
          patchState(cheat.id, { status: 'error', error: reason });
          return { allowed: false, reason };
        }

        // Hands the runtime the address this session's own discovery/resolve flow already
        // confirmed (never a fabricated one — see TrainerRuntime.seedDiscoveredFeatureAddress).
        const seedResult = await window.electronAPI.trainerSeedDiscoveredFeature({
          featureId: cheat.id,
          address: current.confirmedAddress,
          dataType,
        });
        if (!seedResult.success) {
          const reason = seedResult.error?.message ?? 'Could not hand the discovered address to the canonical trainer runtime';
          patchState(cheat.id, { status: 'error', error: reason });
          return { allowed: false, reason };
        }

        const proposeResult = await window.electronAPI.trainerProposeWriteFeature({
          featureId: cheat.id,
          requestedValue: value,
        });
        if (!proposeResult.success) {
          const reason = proposeResult.error?.message ?? 'Propose failed';
          patchState(cheat.id, { status: 'error', error: reason });
          return { allowed: false, reason };
        }
        const proposalId: string = proposeResult.value.proposalId;

        const consentResult = await window.electronAPI.trainerIssueWriteConsent({
          featureId: cheat.id,
          proposalId,
        });
        if (!consentResult.success || !consentResult.value?.consentToken) {
          const reason = consentResult.error?.message ?? 'Consent failed';
          patchState(cheat.id, { status: 'error', error: reason });
          return { allowed: false, reason };
        }

        const confirmResult = await window.electronAPI.trainerConfirmWriteFeature({
          featureId: cheat.id,
          proposalId,
          consentToken: consentResult.value.consentToken,
        });
        if (!confirmResult.success) {
          const reason = confirmResult.error?.message ?? 'Write blocked';
          patchState(cheat.id, { status: 'error', error: reason });
          return { allowed: false, reason };
        }

        writeProposalIdRef.current[cheat.id] = proposalId;
        patchState(cheat.id, { liveValue: value });
        setRatingPrompt({ cheatId: cheat.id });
        return { allowed: true, reason: `Wrote ${value}` };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        patchState(cheat.id, { status: 'error', error: reason });
        return { allowed: false, reason };
      }
    },
    [getState, patchState, ensureAttached, requireCommunityApproval],
  );

  const discover = useCallback(
    async (cheat: CheatDefinition, currentValue: number, range?: { min: number; max: number }) => {
      const dataType = resolveMemoryDataType(cheat);
      if (!dataType) {
        patchState(cheat.id, { status: 'error', error: 'This cheat requires console commands, not memory scanning' });
        return;
      }
      try {
        await ensureAttached();
        const result = await window.electronAPI.liveMemoryScanFirstAutoMatrix({
          value: currentValue,
          min: range?.min ?? currentValue,
          max: range?.max ?? currentValue,
          includeUnknown: true,
          unknownKey: cheat.id,
        });
        if (!result.success || !result.result) {
          patchState(cheat.id, { status: 'error', error: result.error ?? 'Scan failed' });
          return;
        }
        const seen = new Set<string>();
        const candidates: ScanCandidate[] = [];
        for (const bucket of result.result.buckets) {
          if (bucket.skipped) continue;
          for (const match of bucket.matches) {
            const matchType = match.dataType ?? bucket.dataType;
            const key = `${match.address}:${matchType}:${bucket.mode}`;
            if (seen.has(key)) continue;
            seen.add(key);
            candidates.push({
              address: match.address,
              value: match.value,
              dataType: matchType,
              scanMode: bucket.mode,
            });
          }
        }
        patchState(cheat.id, {
          status: 'discovering',
          candidates,
          confirmedDataType: null,
          unknownScanActive: Boolean(result.result.unknown),
          error:
            result.result.totals.truncatedBuckets > 0 || result.result.unknown?.truncated
              ? 'Auto scan truncated by memory budget — narrow to reduce it'
              : null,
        });
      } catch (err) {
        patchState(cheat.id, { status: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    },
    [ensureAttached, patchState],
  );

  /**
   * Shared narrowing step: re-reads every current candidate and keeps the
   * ones matching `comparison` against their own last-observed value. Used
   * by both narrow() (exact new value) and narrowByComparison()
   * (increased/decreased/changed) — the same underlying scanNext, just a
   * different comparison kind, so either can be used repeatedly in any
   * order against a shrinking candidate list without ever needing a fresh
   * baseline snapshot. Auto-matrix candidates are grouped by their discovered
   * data type so a mixed first scan never falls back to one guessed type.
   */
  const narrowWithComparison = useCallback(
    async (cheat: CheatDefinition, comparison: { kind: string; value?: number; min?: number; max?: number }) => {
      const current = getState(cheat.id);
      const fallbackDataType = current.confirmedDataType ?? resolveMemoryDataType(cheat);
      if (!fallbackDataType || current.candidates.length === 0) return;

      try {
        const groups = new Map<string, ScanCandidate[]>();
        for (const candidate of current.candidates) {
          const candidateType = candidate.dataType ?? fallbackDataType;
          groups.set(candidateType, [...(groups.get(candidateType) ?? []), candidate]);
        }

        const narrowed: ScanCandidate[] = [];
        for (const [dataType, candidates] of groups.entries()) {
          const result = await window.electronAPI.liveMemoryScanNext({
            dataType,
            comparison,
            previous: candidates.map((c) => ({ address: c.address, value: c.value })),
          });
          if (!result.success || !result.matches) {
            patchState(cheat.id, { status: 'error', error: result.error ?? 'Narrow failed' });
            return;
          }
          narrowed.push(...result.matches.map((match) => ({ ...match, dataType })));
        }

        if (narrowed.length === 1) {
          const [confirmed] = narrowed;
          const confirmedDataType = confirmed.dataType ?? fallbackDataType;
          patchState(cheat.id, {
            status: 'confirmed',
            candidates: narrowed,
            confirmedAddress: confirmed.address,
            confirmedDataType,
            liveValue: confirmed.value,
            unknownScanActive: false,
          });
          persist(cheat, getState(cheat.id).enabled, confirmed.address, confirmedDataType);
        } else if (narrowed.length > 1) {
          patchState(cheat.id, { status: 'discovering', candidates: narrowed, unknownScanActive: false });
        } else {
          patchState(cheat.id, {
            status: 'error',
            error: 'No candidates matched — try scanning again',
            candidates: [],
            unknownScanActive: false,
          });
        }
      } catch (err) {
        patchState(cheat.id, { status: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    },
    [getState, patchState, persist],
  );

  const narrow = useCallback(
    (cheat: CheatDefinition, newValue: number) => narrowWithComparison(cheat, { kind: 'exact', value: newValue }),
    [narrowWithComparison],
  );

  /** Keeps narrowing the existing candidate list by how the value moved — usable repeatedly, no re-baseline needed. */
  const narrowByComparison = useCallback(
    (cheat: CheatDefinition, comparisonKind: 'increased' | 'decreased' | 'changed' | 'unchanged') =>
      narrowWithComparison(cheat, { kind: comparisonKind }),
    [narrowWithComparison],
  );

  /** Narrows by an exact known delta — e.g. "took exactly 12 damage" — tighter than plain increased/decreased. */
  const narrowByDelta = useCallback(
    (cheat: CheatDefinition, direction: 'increasedBy' | 'decreasedBy', amount: number) =>
      narrowWithComparison(cheat, { kind: direction, value: amount }),
    [narrowWithComparison],
  );

  /** Narrows by the candidate's *current* reading against a fixed threshold, independent of its previous value. */
  const narrowByThreshold = useCallback(
    (cheat: CheatDefinition, direction: 'greaterThan' | 'lessThan', threshold: number) =>
      narrowWithComparison(cheat, { kind: direction, value: threshold }),
    [narrowWithComparison],
  );

  /** Narrows to candidates whose current reading falls within [min, max] inclusive. */
  const narrowByRange = useCallback(
    (cheat: CheatDefinition, min: number, max: number) => narrowWithComparison(cheat, { kind: 'between', min, max }),
    [narrowWithComparison],
  );

  /**
   * "Unknown initial value" first scan — standard memory-researcher workflow:
   * technique for a stat with no visible number (a bar, a percentage with no
   * digits). Captures a baseline snapshot instead of searching for a target
   * value; call narrowUnknown after provoking a real in-game change (taking
   * damage, spending stamina) to turn the snapshot into real candidates.
   */
  const discoverUnknown = useCallback(
    async (cheat: CheatDefinition) => {
      const dataType = resolveMemoryDataType(cheat);
      if (!dataType) {
        patchState(cheat.id, { status: 'error', error: 'This cheat requires console commands, not memory scanning' });
        return;
      }
      try {
        await ensureAttached();
        const result = await window.electronAPI.liveMemoryScanFirstUnknown({ key: cheat.id });
        if (!result.success) {
          patchState(cheat.id, { status: 'error', error: result.error ?? 'Baseline scan failed' });
          return;
        }
        patchState(cheat.id, {
          status: 'discovering',
          unknownScanActive: true,
          candidates: [],
          error: result.truncated ? 'Snapshot truncated by memory budget — results may be incomplete' : null,
        });
      } catch (err) {
        patchState(cheat.id, { status: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    },
    [ensureAttached, patchState],
  );

  /**
   * Consumes the baseline snapshot from discoverUnknown, filtering by how the
   * value moved — tries every type in UNKNOWN_SCAN_DATA_TYPES at once (Cheat
   * Engine's "All" scan type), since a bar with no visible number could be
   * stored as any of them and guessing wrong converges on a false positive
   * (as this project's first Undisputed attempt did, assuming int32 for what
   * turned out to be a float). Once down to one candidate, its own tagged
   * dataType becomes the cheat's confirmedDataType — not a fixed guess.
   */
  const narrowUnknown = useCallback(
    async (cheat: CheatDefinition, comparisonKind: 'increased' | 'decreased' | 'changed') => {
      const dataType = resolveMemoryDataType(cheat);
      if (!dataType) return;

      try {
        const result = await window.electronAPI.liveMemoryScanNextFromUnknown({
          key: cheat.id,
          dataTypes: UNKNOWN_SCAN_DATA_TYPES,
          comparison: { kind: comparisonKind },
        });
        if (!result.success || !result.result) {
          patchState(cheat.id, { status: 'error', error: result.error ?? 'Narrow failed', unknownScanActive: false });
          return;
        }

        const narrowed = result.result.matches;
        if (narrowed.length === 1) {
          const [confirmed] = narrowed;
          patchState(cheat.id, {
            status: 'confirmed',
            candidates: narrowed,
            confirmedAddress: confirmed.address,
            confirmedDataType: confirmed.dataType,
            liveValue: confirmed.value,
            unknownScanActive: false,
          });
          persist(cheat, getState(cheat.id).enabled, confirmed.address, confirmed.dataType);
        } else if (narrowed.length > 1) {
          patchState(cheat.id, { status: 'discovering', candidates: narrowed, unknownScanActive: false });
        } else {
          patchState(cheat.id, {
            status: 'error',
            error: 'No candidates matched — try again with a bigger change',
            candidates: [],
            unknownScanActive: false,
          });
        }
      } catch (err) {
        patchState(cheat.id, {
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
          unknownScanActive: false,
        });
      }
    },
    [patchState, getState, persist],
  );

  /**
   * Bulk-reads every current candidate's live value in one round trip — the
   * backing call for the Watch Live Values panel, which polls this on an
   * interval so the user can visually spot which address correlates with a
   * real in-game change instead of guessing blind via repeated narrow rounds.
   */
  const readCandidatesLive = useCallback(
    async (cheat: CheatDefinition): Promise<ScanCandidate[]> => {
      const current = getState(cheat.id);
      if (current.candidates.length === 0) return [];
      const fallbackType = current.confirmedDataType ?? resolveMemoryDataType(cheat) ?? 'int32';
      const result = await window.electronAPI.liveMemoryReadMany({
        addresses: current.candidates.map((c) => ({ address: c.address, dataType: c.dataType ?? fallbackType })),
      });
      if (!result.success || !result.values) return current.candidates;
      return result.values;
    },
    [getState],
  );

  /**
   * Directly confirms a specific candidate as the cheat's address — the
   * "Use this address" action in the Watch Live Values panel, once the user
   * has visually identified which one moves in sync with a real change.
   * Skips the exact/comparison narrow flow entirely.
   */
  const confirmCandidate = useCallback(
    (cheat: CheatDefinition, candidate: ScanCandidate) => {
      const dataType = candidate.dataType ?? resolveMemoryDataType(cheat);
      patchState(cheat.id, {
        status: 'confirmed',
        confirmedAddress: candidate.address,
        confirmedDataType: dataType ?? null,
        liveValue: candidate.value,
        unknownScanActive: false,
      });
      persist(cheat, getState(cheat.id).enabled, candidate.address, dataType ?? null);
    },
    [patchState, getState, persist],
  );

  const tryResolveStableCheat = useCallback(
    async (cheat: CheatDefinition): Promise<boolean> => {
      if (cheat.requiresDiscovery) return false;
      patchState(cheat.id, { status: 'discovering', error: null });
      try {
        await ensureAttached();

        // Prefer Zero-Input hydrated / hint address before another resolve round-trip.
        const hinted = featureHintsRef.current[cheat.id] ?? getState(cheat.id).confirmedAddress;
        if (hinted) {
          const dataType = getState(cheat.id).confirmedDataType ?? resolveMemoryDataType(cheat);
          patchState(cheat.id, {
            status: 'confirmed',
            confirmedAddress: hinted,
            confirmedDataType: dataType,
          });
          persist(cheat, true, hinted, dataType);
          return true;
        }

        const result = await window.electronAPI.liveMemoryResolveDefinitionFeature?.({
          catalogGameId: game.gameId,
          featureId: cheat.id,
        });
        if (!result?.success || !result.address) {
          patchState(cheat.id, {
            status: 'error',
            error: result?.error ?? 'Could not resolve cheat address from catalog definition',
          });
          return false;
        }

        featureHintsRef.current[cheat.id] = result.address.address;
        patchState(cheat.id, {
          status: 'confirmed',
          confirmedAddress: result.address.address,
          confirmedDataType: result.address.dataType,
          liveValue: result.currentValue ?? null,
        });
        persist(cheat, true, result.address.address, result.address.dataType);
        return true;
      } catch (err) {
        patchState(cheat.id, {
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    },
    [ensureAttached, game.gameId, patchState, persist, getState],
  );

  const toggleCheat = useCallback(
    async (cheat: CheatDefinition, enabled: boolean) => {
      if (!enabled) {
        void stopFreeze(cheat.id);
        // P4-13: a real confirmed write this session gets genuinely rolled back through the
        // canonical runtime (restoring the pre-write value) instead of just forgetting local
        // state and leaving the last written value sitting in game memory.
        const pendingProposalId = writeProposalIdRef.current[cheat.id];
        if (pendingProposalId) {
          delete writeProposalIdRef.current[cheat.id];
          void window.electronAPI.trainerRollbackFeature({ featureId: cheat.id, proposalId: pendingProposalId });
        }
        // Toggling off is the explicit "forget this" action — clear the confirmed address too,
        // not just the enabled flag. Otherwise the next toggle-on reuses a stale (possibly
        // wrong) address instead of starting fresh discovery, which is silently useless if that
        // address turns out to be a false positive.
        patchState(cheat.id, {
          enabled: false,
          status: 'idle',
          confirmedAddress: null,
          confirmedDataType: null,
          candidates: [],
          liveValue: null,
          error: null,
          unknownScanActive: false,
        });
        clearPersisted(cheat.id);
        return;
      }

      if (!(await requireCommunityApproval(cheat))) return;
      patchState(cheat.id, { enabled: true });
      const current = getState(cheat.id);
      if (current.confirmedAddress) {
        void writeValue(cheat, Number(cheat.infiniteValue ?? 1));
        patchState(cheat.id, { status: 'confirmed' });
        persist(cheat, true, current.confirmedAddress, current.confirmedDataType);
      } else if (!cheat.requiresDiscovery) {
        void (async () => {
          const resolved = await tryResolveStableCheat(cheat);
          if (resolved) {
            await writeValue(cheat, Number(cheat.infiniteValue ?? 1));
            patchState(cheat.id, { status: 'confirmed' });
          }
        })();
      } else {
        patchState(cheat.id, { status: 'discovering' });
        persist(cheat, true, null, null);
      }
    },
    [
      getState,
      patchState,
      stopFreeze,
      writeValue,
      persist,
      clearPersisted,
      tryResolveStableCheat,
      requireCommunityApproval,
    ],
  );

  const startFreeze = useCallback(
    async (cheat: CheatDefinition) => {
      const current = getState(cheat.id);
      const dataType = current.confirmedDataType ?? resolveMemoryDataType(cheat);
      if (!dataType || !current.confirmedAddress) return;
      if (!(await requireCommunityApproval(cheat))) return;

      try {
        // Same reasoning as writeValue — a restored confirmedAddress may never have gone
        // through discover()/discoverUnknown() in this mount.
        await ensureAttached();
      } catch (err) {
        patchState(cheat.id, { status: 'error', error: err instanceof Error ? err.message : String(err) });
        return;
      }

      // Only one freeze can be active per session — stop whichever cheat currently owns it.
      if (frozenCheatIdRef.current && frozenCheatIdRef.current !== cheat.id) {
        await stopFreeze(frozenCheatIdRef.current);
      }

      // P4-13: real mutation is canonical-only — no legacy liveMemoryFreeze* fallback (mission §18).
      if (!runtimeBoundRef.current) {
        patchState(cheat.id, { status: 'error', error: runtimeBindErrorRef.current ?? 'Canonical trainer runtime is not bound.' });
        return;
      }

      const seedResult = await window.electronAPI.trainerSeedDiscoveredFeature({
        featureId: cheat.id,
        address: current.confirmedAddress,
        dataType,
      });
      if (!seedResult.success) {
        patchState(cheat.id, {
          status: 'error',
          error: seedResult.error?.message ?? 'Could not hand the discovered address to the canonical trainer runtime',
        });
        return;
      }

      const value = Number(cheat.infiniteValue ?? 1);
      const proposeResult = await window.electronAPI.trainerProposeFreezeFeature({
        featureId: cheat.id,
        value,
        intervalMs: 200,
      });
      if (!proposeResult.success || !proposeResult.value?.proposalId) {
        patchState(cheat.id, { status: 'error', error: proposeResult.error?.message ?? 'Freeze proposal failed' });
        return;
      }
      const proposalId: string = proposeResult.value.proposalId;
      const consentResult = await window.electronAPI.trainerIssueFreezeConsent({
        featureId: cheat.id,
        proposalId,
      });
      if (!consentResult.success || !consentResult.value?.consentToken) {
        patchState(cheat.id, { status: 'error', error: consentResult.error?.message ?? 'Freeze consent failed' });
        return;
      }
      const result = await window.electronAPI.trainerConfirmFreezeFeature({
        featureId: cheat.id,
        proposalId,
        consentToken: consentResult.value.consentToken,
      });
      if (!result.success) {
        patchState(cheat.id, { status: 'error', error: result.error?.message ?? 'Freeze failed to start' });
        return;
      }
      frozenCheatIdRef.current = cheat.id;
      patchState(cheat.id, { isFrozen: true, status: 'frozen' });
    },
    [getState, patchState, stopFreeze, ensureAttached, requireCommunityApproval],
  );

  const toggleFreeze = useCallback(
    (cheat: CheatDefinition, enabled: boolean) => {
      if (enabled) {
        const current = getState(cheat.id);
        if (!current.confirmedAddress && !cheat.requiresDiscovery) {
          void (async () => {
            const resolved = await tryResolveStableCheat(cheat);
            if (resolved) await startFreeze(cheat);
          })();
          return;
        }
        void startFreeze(cheat);
      } else {
        void stopFreeze(cheat.id);
      }
    },
    [getState, startFreeze, stopFreeze, tryResolveStableCheat],
  );

  const applyValue = useCallback(
    async (cheat: CheatDefinition, value: number) => {
      if (!(await requireCommunityApproval(cheat))) return;
      const current = getState(cheat.id);
      if (current.confirmedAddress) {
        void writeValue(cheat, value);
      } else {
        void discover(cheat, value);
      }
    },
    [getState, writeValue, discover, requireCommunityApproval],
  );

  const resetError = useCallback(
    (cheatId: string) => {
      patchState(cheatId, { status: 'idle', error: null, candidates: [], unknownScanActive: false });
    },
    [patchState],
  );

  // Hydrate from the persisted cheat_toggle_state table on mount — restores which cheats
  // were on and their confirmed address from before Solith last closed. This is local
  // UI state only; nothing is written to game memory here (that happens in the reapply effect
  // below, gated on userConfirmedOffline).
  useEffect(() => {
    let cancelled = false;
    window.electronAPI.cheatToggleGetAll({ gameId: game.gameId }).then((result) => {
      if (cancelled || !result.success || !result.states) return;
      setStates((prev) => {
        const next = { ...prev };
        for (const row of result.states!) {
          if (!row.enabled) continue;
          next[row.cheatId] = {
            ...IDLE_STATE,
            enabled: true,
            confirmedAddress: row.confirmedAddress,
            confirmedDataType: row.dataType,
            status: row.confirmedAddress ? 'confirmed' : 'discovering',
          };
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [game.gameId]);

  // Once the user (re-)confirms offline play, silently re-arm every cheat that was persisted
  // as enabled: a confirmed one gets its write reapplied immediately (valid only if Undisputed
  // itself never restarted — a stale address just surfaces as a write error, same as any other
  // failed write); one that was mid-discovery restarts its baseline scan automatically instead
  // of leaving the user to notice and re-click "Don't know the value?" themselves. Runs once per
  // mount — flipping the checkbox off and back on doesn't re-trigger it a second time.
  useEffect(() => {
    if (!userConfirmedOffline || reappliedRef.current) return;
    reappliedRef.current = true;

    void (async () => {
      for (const cheat of game.cheats) {
        const state = getState(cheat.id);
        if (!state.enabled) continue;

        if (state.confirmedAddress) {
          await writeValue(cheat, Number(cheat.infiniteValue ?? 1));
        } else if (state.status === 'discovering') {
          await discoverUnknown(cheat);
        }
      }
    })();
    // Deliberately omits getState/writeValue/discoverUnknown/game.cheats from deps — this must
    // run exactly once when offline is first confirmed (guarded by reappliedRef), not on every
    // render those callbacks are recreated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userConfirmedOffline]);

  useEffect(() => {
    return () => {
      if (attachedRef.current) {
        void window.electronAPI.trainerUnbindRuntime();
        runtimeBoundRef.current = false;
        void window.electronAPI.liveMemoryDetach();
        attachedRef.current = false;
      }
    };
  }, []);

  getStateRef.current = getState;
  toggleCheatRef.current = toggleCheat;

  useEffect(() => {
    if (!userConfirmedOffline) return undefined;
    const slots = cheatsForHotkeySlots(game);
    const unsubscribe = window.electronAPI?.onTrainerHotkey?.((payload) => {
      const slotIndex = parseCheatHotkeySlot(payload.action);
      if (slotIndex == null) return;
      const cheat = slots[slotIndex];
      if (!cheat) return;
      const enabled = getStateRef.current(cheat.id).enabled;
      void toggleCheatRef.current(cheat, !enabled);
    });
    return () => unsubscribe?.();
  }, [game, userConfirmedOffline]);

  // Kick Zero-Input prepare as soon as offline is confirmed (not only on first toggle).
  useEffect(() => {
    if (!userConfirmedOffline) {
      setZeroInputStatus({ phase: 'idle' });
      if (attachedRef.current) {
        attachedRef.current = false;
        void window.electronAPI.trainerUnbindRuntime?.();
        runtimeBoundRef.current = false;
        void window.electronAPI.liveMemoryDetach?.();
      }
      return;
    }
    void ensureAttached().catch((err) => {
      setZeroInputStatus({
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }, [userConfirmedOffline, ensureAttached]);

  return {
    getState,
    zeroInputStatus,
    driftPrompt,
    resolveDriftPrompt,
    communityPrompt,
    resolveCommunityPrompt,
    ratingPrompt,
    dismissRatingPrompt: () => setRatingPrompt(null),
    hotkeyCheats: cheatsForHotkeySlots(game),
    discover,
    narrow,
    narrowByComparison,
    narrowByDelta,
    narrowByThreshold,
    narrowByRange,
    discoverUnknown,
    narrowUnknown,
    readCandidatesLive,
    confirmCandidate,
    toggleCheat,
    toggleFreeze,
    applyValue,
    resetError,
  };
}
