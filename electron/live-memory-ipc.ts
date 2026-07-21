import { app, ipcMain, BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import {
  LiveMemoryListProcessesSchema,
  LiveMemoryAttachSchema,
  LiveMemoryZeroInputPrepareSchema,
  LiveMemoryDetachSchema,
  LiveMemoryReadSchema,
  LiveMemoryProposeWriteSchema,
  LiveMemoryConfirmWriteSchema,
  LiveMemoryRollbackSchema,
  LiveMemoryScanFirstSchema,
  LiveMemoryScanNextSchema,
  LiveMemoryScanFirstUnknownSchema,
  LiveMemoryScanNextFromUnknownSchema,
  LiveMemoryReadManySchema,
  LiveMemoryFreezeStartSchema,
  LiveMemoryFreezeStopSchema,
  LiveMemoryFreezeStatusSchema,
  LiveMemoryListControlsSchema,
  LiveMemoryResolveControlSchema,
  LiveMemoryResolveDefinitionFeatureSchema,
  LiveMemoryPointerScanSchema,
  LiveMemoryScanAobSchema,
  ResearchViewSchema,
  ResearchHexSchema,
  ResearchPointerAnalyzeSchema,
  ResearchResolvePathSchema,
  ResearchSnapshotDiffSchema,
  ResearchSnapshotSaveSchema,
  InProcessProposeHookSchema,
  InProcessConfirmHookSchema,
  InProcessProposeInjectorSchema,
  InProcessConfirmInjectorSchema,
} from './ipc-validation.js';
import type { ScanMatch } from '../src/core/live-memory/types.js';
import type { LiveMemorySession } from '../src/core/live-memory/live-memory-session.js';
import type { MemoryManager } from '../src/core/live-memory/memory-manager.js';
import type { MemoryAuditLog } from '../src/core/live-memory/audit-log.js';
import { setCrashReportContext } from '../src/core/crash/local-crash-reporter.js';
import { hashInstalledExecutableForCatalog } from '../src/core/live-memory/installed-exe-hash.js';
import {
  onAvowedMemoryManagerSnapshotEvent,
  onAvowedProcessAttached,
  resetAvowedWingdkBackupSession,
} from './avowed-wingdk-backup-watch.js';

/**
 * Live Memory Trainer IPC — feature-flagged (`v2LiveModeEnabled`, off by
 * default), single-player/offline only (PROJECT_SPEC.md Section 3.1).
 *
 * Ownership model mirrors the V2 session monitor and TrainerHost handlers:
 * event.sender.id is the sole session-ownership key, never a value supplied
 * in the IPC payload — one renderer sender owns at most one attached session.
 *
 * No memory access of any kind occurs unless the feature flag is enabled AND
 * the caller explicitly confirms the single-player / private-play waiver
 * (Trust Shift — connection counts are advisory only; see evaluateWriteConsent).
 * Writes still go through MemoryManager / WritePolicyGate where configured.
 */

let liveMemoryModule: any = null;

async function getLiveMemoryModule() {
  if (!liveMemoryModule) {
    liveMemoryModule = await import('../src/core/live-memory/index.js');
  }
  return liveMemoryModule;
}

export function registerLiveMemoryIpc(): void {
  ipcMain.handle('live-memory-list-processes', async (event) => {
    try {
      if (event.sender.isDestroyed()) return { success: false, error: 'sender_invalid' };
      LiveMemoryListProcessesSchema.parse({});
      if (!(await isFeatureEnabled())) return { success: false, error: 'feature_disabled' };

      const mod = await getLiveMemoryModule();
      return { success: true, processes: mod.listLiveMemoryProcesses() };
    } catch (error) {
      return { success: false, error: sanitize(error, 'list_processes_failed') };
    }
  });

  ipcMain.handle('live-memory-attach', async (event, payload: unknown) => {
    try {
      if (event.sender.isDestroyed()) return { success: false, error: 'sender_invalid' };
      if (!(await isFeatureEnabled())) return { success: false, error: 'feature_disabled' };

      const parsed = LiveMemoryAttachSchema.parse(payload);

      const mod = await getLiveMemoryModule();
      disposeSession(event.sender.id);
      const session = new mod.LiveMemorySession(mod.nativeMemoryDriver);
      const executableHashSHA256 =
        parsed.executableHashSHA256 ??
        (parsed.catalogGameId
          ? hashInstalledExecutableForCatalog(parsed.catalogGameId, parsed.executableName) ??
            undefined
          : undefined);

      let fingerprint:
        | {
            executableHashSHA256?: string;
            executableHashPrefixes?: string[];
            targetSHA256?: string;
            driftAcknowledged?: boolean;
            connectionBaseline?: number;
            catalogGameId?: string;
          }
        | undefined;

      if (
        executableHashSHA256 ||
        parsed.executableHashPrefixes?.length ||
        parsed.targetSHA256 ||
        parsed.catalogGameId
      ) {
        fingerprint = {
          executableHashSHA256,
          executableHashPrefixes: parsed.executableHashPrefixes,
          targetSHA256: parsed.targetSHA256,
          driftAcknowledged: parsed.driftAcknowledged,
          catalogGameId: parsed.catalogGameId,
        };
      }

      if (parsed.catalogGameId) {
        const { getModPackForGame, getDefinitionPayload } = await import('../src/core/trainer-catalog/store.js');
        const { modPackToSolithDefinition, definitionFingerprintFields } = await import(
          '../src/core/definitions/mod-pack-adapter.js'
        );
        const definition =
          getDefinitionPayload(parsed.catalogGameId) ??
          (() => {
            const pack = getModPackForGame(parsed.catalogGameId!);
            return pack ? modPackToSolithDefinition(pack) : null;
          })();
        if (definition) {
          const fields = definitionFingerprintFields(definition);
          fingerprint = {
            ...fingerprint,
            catalogGameId: parsed.catalogGameId,
            executableHashPrefixes:
              fingerprint?.executableHashPrefixes && fingerprint.executableHashPrefixes.length > 0
                ? fingerprint.executableHashPrefixes
                : fields.executableHashPrefixes,
            targetSHA256: fingerprint?.targetSHA256 ?? fields.targetSHA256,
            connectionBaseline: fields.connectionBaseline,
            driftAcknowledged: fingerprint?.driftAcknowledged,
            executableHashSHA256: fingerprint?.executableHashSHA256 ?? executableHashSHA256,
          };
        }
      }

      const result = await session.attach(
        { pid: parsed.pid, executableName: parsed.executableName },
        parsed.userConfirmedOffline,
        fingerprint,
      );

      if (result.success) {
        const bundle = bindSessionBundle(event.sender.id, session, mod);
        refreshCrashContext(bundle);
        maybeStartAvowedWingdkBackups({
          executableName: parsed.executableName,
          catalogGameId: parsed.catalogGameId,
          manager: bundle.manager,
        });
        if (result.fingerprintWarning && parsed.catalogGameId) {
          const { quarantineDefinition } = await import('../src/core/trainer-catalog/definition-quarantine.js');
          quarantineDefinition(parsed.catalogGameId, result.fingerprintWarning);
        }
      }
      return result;
    } catch (error) {
      return { success: false, error: sanitize(error, 'attach_failed') };
    }
  });

  ipcMain.handle('live-memory-zero-input-prepare', async (event, payload: unknown) => {
    try {
      if (event.sender.isDestroyed()) return { success: false, error: 'sender_invalid' };
      if (!(await isFeatureEnabled())) return { success: false, error: 'feature_disabled' };

      const parsed = LiveMemoryZeroInputPrepareSchema.parse(payload);
      const mod = await getLiveMemoryModule();
      const { loadCatalogDefinition } = await import('../src/core/definitions/load-catalog-definition.js');
      const definition = loadCatalogDefinition(parsed.catalogGameId);

      disposeSession(event.sender.id);
      const session = new mod.LiveMemorySession(mod.nativeMemoryDriver);
      const bundle = bindSessionBundle(event.sender.id, session, mod);

      const executableHashSHA256 =
        parsed.executableHashSHA256 ??
        hashInstalledExecutableForCatalog(parsed.catalogGameId, parsed.executableName) ??
        undefined;
      const storedHints = featureHintStore.get(parsed.catalogGameId) ?? {};
      const featureHints = { ...storedHints, ...(parsed.featureHints ?? {}) };

      const evidence = await mod.observeRemoteConnections(parsed.pid);
      const result = await mod.prepareZeroInputSession(
        session,
        {
          detection: {
            catalogGameId: parsed.catalogGameId,
            displayName: definition?.title ?? parsed.catalogGameId,
            pid: parsed.pid,
            executable: parsed.executableName,
          },
          definition,
          userConfirmedOffline: parsed.userConfirmedOffline,
          remoteConnections: evidence,
          executableHashSHA256,
          driftAcknowledged: parsed.driftAcknowledged,
          fuzzyOptions:
            parsed.maxFuzzyDistance != null ? { maxDistance: parsed.maxFuzzyDistance } : undefined,
          featureHints,
        },
        bundle.audit,
      );

      if (!result.success) {
        disposeSession(event.sender.id);
        return {
          success: false,
          error: result.error ?? 'prepare_failed',
          planAllowed: result.plan.allowed,
          blockReason: result.plan.blockReason,
          fingerprintStatus: result.plan.fingerprint.status,
          fingerprintWarning: result.fingerprintWarning,
          attachError: result.attachError,
          executableHashSHA256,
        };
      }

      if (result.fingerprintWarning) {
        const { quarantineDefinition } = await import('../src/core/trainer-catalog/definition-quarantine.js');
        quarantineDefinition(parsed.catalogGameId, result.fingerprintWarning);
      }

      const nextHints: Record<string, string> = { ...storedHints };
      for (const feature of result.features ?? []) {
        if (feature.resolution !== 'failed' && feature.address && feature.address !== '0x0') {
          nextHints[feature.featureId] = feature.address;
        }
      }
      featureHintStore.set(parsed.catalogGameId, nextHints);
      refreshCrashContext(bundle);

      maybeStartAvowedWingdkBackups({
        executableName: parsed.executableName,
        catalogGameId: parsed.catalogGameId,
        manager: bundle.manager,
      });

      const readyPayload = {
        catalogGameId: parsed.catalogGameId,
        pid: parsed.pid,
        executable: parsed.executableName,
        counts: result.counts,
        features: result.features,
        featureHints: nextHints,
      };

      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('zero-input-ready', readyPayload);
        }
      }

      return {
        success: true,
        planAllowed: true,
        fingerprintStatus: result.plan.fingerprint.status,
        fingerprintWarning: result.fingerprintWarning,
        counts: result.counts,
        features: result.features,
        executableHashSHA256,
        featureHints: nextHints,
      };
    } catch (error) {
      disposeSession(event.sender.id);
      return { success: false, error: sanitize(error, 'zero_input_prepare_failed') };
    }
  });

  ipcMain.handle('live-memory-detach', async (event) => {
    try {
      LiveMemoryDetachSchema.parse({});
      disposeSession(event.sender.id);
      return { success: true };
    } catch (error) {
      return { success: false, error: sanitize(error, 'detach_failed') };
    }
  });

  ipcMain.handle('live-memory-read', async (event, payload: unknown) => {
    try {
      const bundle = requireBundle(event);
      const parsed = LiveMemoryReadSchema.parse(payload);
      const value = bundle.manager.read({ address: BigInt(parsed.address), dataType: parsed.dataType });
      refreshCrashContext(bundle);
      return { success: true, value };
    } catch (error) {
      return { success: false, error: sanitize(error, 'read_failed') };
    }
  });

  ipcMain.handle('live-memory-propose-write', async (event, payload: unknown) => {
    try {
      const bundle = requireBundle(event);
      const parsed = LiveMemoryProposeWriteSchema.parse(payload);
      const proposal = bundle.manager.proposeWrite(
        { address: BigInt(parsed.address), dataType: parsed.dataType },
        parsed.requestedValue,
      );
      refreshCrashContext(bundle);
      // Serialize bigint address to a string for the structured-clone IPC boundary.
      return { success: true, proposal: { ...proposal, target: { ...proposal.target, address: proposal.target.address.toString() } } };
    } catch (error) {
      return { success: false, error: sanitize(error, 'propose_failed') };
    }
  });

  ipcMain.handle('live-memory-confirm-write', async (event, payload: unknown) => {
    try {
      const bundle = requireBundle(event);
      const parsed = LiveMemoryConfirmWriteSchema.parse(payload);
      const result = await bundle.manager.confirmWrite(parsed.proposalId);
      refreshCrashContext(bundle);
      return serializeWriteResult(result);
    } catch (error) {
      return { success: false, error: sanitize(error, 'confirm_write_failed') };
    }
  });

  ipcMain.handle('live-memory-rollback', async (event, payload: unknown) => {
    try {
      const bundle = requireBundle(event);
      const parsed = LiveMemoryRollbackSchema.parse(payload);
      const manifest = {
        ...parsed.manifest,
        target: { ...parsed.manifest.target, address: BigInt(parsed.manifest.target.address) },
      };
      const result = await bundle.manager.rollback(manifest);
      refreshCrashContext(bundle);
      return { success: result.success, guard: result.guard, error: result.error };
    } catch (error) {
      return { success: false, error: sanitize(error, 'rollback_failed') };
    }
  });

  // Read-only: no guard check needed here, nothing is written to the process.
  ipcMain.handle('live-memory-scan-first', async (event, payload: unknown) => {
    try {
      const session = requireSession(event);
      const parsed = LiveMemoryScanFirstSchema.parse(payload);
      const result = session.scanFirst(parsed.dataType, parsed.targetValue, {
        maxRegionBytes: parsed.maxRegionBytes,
        maxTotalBytes: parsed.maxTotalBytes,
        maxMatches: parsed.maxMatches,
      });
      return { success: true, result: serializeScanResult(result) };
    } catch (error) {
      return { success: false, error: sanitize(error, 'scan_first_failed') };
    }
  });

  ipcMain.handle('live-memory-scan-next', async (event, payload: unknown) => {
    try {
      const session = requireSession(event);
      const parsed = LiveMemoryScanNextSchema.parse(payload);
      const previous: ScanMatch[] = parsed.previous.map((m) => ({ address: BigInt(m.address), value: m.value }));
      const matches = session.scanNext(parsed.dataType, parsed.comparison, previous);
      return { success: true, matches: serializeMatches(matches) };
    } catch (error) {
      return { success: false, error: sanitize(error, 'scan_next_failed') };
    }
  });

  // "Unknown initial value" first scan — for a stat with no visible number (a bar, a
  // percentage with no digits). Read-only, same as scan-first: nothing is written.
  ipcMain.handle('live-memory-scan-first-unknown', async (event, payload: unknown) => {
    try {
      const session = requireSession(event);
      const parsed = LiveMemoryScanFirstUnknownSchema.parse(payload);
      const result = session.scanFirstUnknown(parsed.key, {
        maxRegionBytes: parsed.maxRegionBytes,
        maxTotalBytes: parsed.maxTotalBytes,
      });
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: sanitize(error, 'scan_first_unknown_failed') };
    }
  });

  // Consumes the snapshot from scan-first-unknown; filters by comparison against the baseline,
  // trying every dataType in parsed.dataTypes at each offset (multi-type "All" scan).
  // Survivors are typically still numerous enough that the renderer should route them into the
  // Watch Live Values panel next, not assume a single address — this endpoint's job is only to
  // turn "every writable byte" into a workable candidate list, one real filter.
  ipcMain.handle('live-memory-scan-next-from-unknown', async (event, payload: unknown) => {
    try {
      const session = requireSession(event);
      const parsed = LiveMemoryScanNextFromUnknownSchema.parse(payload);
      const result = session.scanNextFromUnknown(parsed.key, parsed.dataTypes, parsed.comparison, {
        maxMatches: parsed.maxMatches,
      });
      return {
        success: true,
        result: {
          matches: result.matches.map((m) => ({ address: m.address.toString(), value: m.value, dataType: m.dataType })),
          regionsScanned: result.regionsScanned,
          bytesScanned: result.bytesScanned,
          truncated: result.truncated,
        },
      };
    } catch (error) {
      return { success: false, error: sanitize(error, 'scan_next_from_unknown_failed') };
    }
  });

  // Watch Live Values panel — bulk-reads a candidate list on a poll interval so the user can
  // visually spot which address correlates with a real in-game change instead of guessing blind
  // via repeated increased/decreased narrow rounds.
  ipcMain.handle('live-memory-read-many', async (event, payload: unknown) => {
    try {
      const session = requireSession(event);
      const parsed = LiveMemoryReadManySchema.parse(payload);
      const results = session.readMany(parsed.addresses.map((a) => ({ address: BigInt(a.address), dataType: a.dataType })));
      return {
        success: true,
        values: results.map((r) => ({ address: r.address.toString(), value: r.value, dataType: r.dataType })),
      };
    } catch (error) {
      return { success: false, error: sanitize(error, 'read_many_failed') };
    }
  });

  ipcMain.handle('live-memory-freeze-start', async (event, payload: unknown) => {
    try {
      const session = requireSession(event);
      const parsed = LiveMemoryFreezeStartSchema.parse(payload);
      const result = session.startFreeze(
        { address: BigInt(parsed.address), dataType: parsed.dataType },
        parsed.value,
        parsed.intervalMs,
      );
      return result;
    } catch (error) {
      return { success: false, error: sanitize(error, 'freeze_start_failed') };
    }
  });

  ipcMain.handle('live-memory-freeze-stop', async (event) => {
    try {
      const session = requireSession(event);
      LiveMemoryFreezeStopSchema.parse({});
      const status = session.stopFreeze();
      return { success: true, status: serializeFreezeStatus(status) };
    } catch (error) {
      return { success: false, error: sanitize(error, 'freeze_stop_failed') };
    }
  });

  ipcMain.handle('live-memory-freeze-status', async (event) => {
    try {
      const session = requireSession(event);
      LiveMemoryFreezeStatusSchema.parse({});
      return { success: true, status: serializeFreezeStatus(session.getFreezeStatus()) };
    } catch (error) {
      return { success: false, error: sanitize(error, 'freeze_status_failed') };
    }
  });

  // Read-only: Phase 4 schema.v1-only live controls (legacy catalog removed).
  ipcMain.handle('live-memory-list-controls', async (event) => {
    try {
      const session = requireSession(event);
      LiveMemoryListControlsSchema.parse({});
      const executableName = session.getAttachedExecutableName();
      if (!executableName) return { success: true, controls: [], source: null };
      const mod = await getLiveMemoryModule();
      const listed = mod.listLiveControlsFromSchema({
        executableName,
        catalogGameId: typeof session.getCatalogGameId === 'function' ? session.getCatalogGameId() : undefined,
      });
      return {
        success: true,
        controls: listed.controls.map(serializeControlSummary),
        source: listed.source,
        catalogGameId: listed.catalogGameId,
      };
    } catch (error) {
      return { success: false, error: sanitize(error, 'list_controls_failed') };
    }
  });

  // Read-only: Phase 4 schema.v1-only resolve.
  // Does not write anything — the caller still goes through proposeWrite/confirmWrite (and
  // therefore the online-session guard) to actually change it.
  ipcMain.handle('live-memory-resolve-control', async (event, payload: unknown) => {
    try {
      const session = requireSession(event);
      const parsed = LiveMemoryResolveControlSchema.parse(payload);
      const mod = await getLiveMemoryModule();
      const executableName = session.getAttachedExecutableName() ?? undefined;
      const catalogGameId =
        typeof session.getCatalogGameId === 'function' ? session.getCatalogGameId() ?? undefined : undefined;
      const resolved = mod.resolveLiveControlFromSchema(parsed.controlId, {
        executableName,
        catalogGameId: catalogGameId ?? undefined,
      });
      if (!resolved.control) return { success: false, error: 'unknown_control' };

      const address = resolved.feature
        ? session.resolveMemoryFeature(resolved.feature)
        : session.resolveControl(resolved.control);
      const currentValue = session.readValue(address);
      return {
        success: true,
        address: { address: address.address.toString(), dataType: address.dataType },
        currentValue,
        source: resolved.source,
      };
    } catch (error) {
      return { success: false, error: sanitize(error, 'resolve_control_failed') };
    }
  });

  ipcMain.handle('live-memory-resolve-definition-feature', async (event, payload: unknown) => {
    try {
      const session = requireSession(event);
      const parsed = LiveMemoryResolveDefinitionFeatureSchema.parse(payload);
      const { getModPackForGame, getDefinitionPayload } = await import('../src/core/trainer-catalog/store.js');
      const { modPackToSolithDefinition } = await import('../src/core/definitions/mod-pack-adapter.js');

      const definition =
        getDefinitionPayload(parsed.catalogGameId) ??
        (() => {
          const pack = getModPackForGame(parsed.catalogGameId);
          return pack ? modPackToSolithDefinition(pack) : null;
        })();
      if (!definition) return { success: false, error: 'no_definition' };

      const feature = definition.memoryFeatures?.find((f) => f.id === parsed.featureId);
      if (!feature) return { success: false, error: 'unknown_feature' };

      const address = session.resolveMemoryFeature(feature);
      const currentValue = session.readValue(address);
      return {
        success: true,
        address: { address: address.address.toString(), dataType: address.dataType },
        currentValue,
      };
    } catch (error) {
      return { success: false, error: sanitize(error, 'resolve_definition_feature_failed') };
    }
  });

  ipcMain.handle('live-memory-pointer-scan', async (event, payload: unknown) => {
    try {
      const session = requireSession(event);
      const parsed = LiveMemoryPointerScanSchema.parse(payload);
      if (!(await isFeatureEnabled())) return { success: false, error: 'feature_disabled' };

      const scanResult = session.pointerScan(BigInt(parsed.address), {
        maxDepth: parsed.maxDepth,
        maxOffsetPerLevel: parsed.maxOffsetPerLevel,
      });

      return {
        success: true,
        result: {
          candidates: scanResult.candidates.map((c) => ({
            moduleName: c.moduleName,
            moduleOffset: `0x${c.moduleOffset.toString(16)}`,
            offsets: c.offsets,
            depth: c.depth,
          })),
          truncated: scanResult.truncated,
          levelsSearched: scanResult.levelsSearched,
          scansPerformed: scanResult.scansPerformed,
        },
      };
    } catch (error) {
      return { success: false, error: sanitize(error, 'pointer_scan_failed') };
    }
  });

  ipcMain.handle('live-memory-scan-aob', async (event, payload: unknown) => {
    try {
      const session = requireSession(event);
      const parsed = LiveMemoryScanAobSchema.parse(payload);
      if (!(await isFeatureEnabled())) return { success: false, error: 'feature_disabled' };

      const result = session.scanAobSignature(parsed.signature, parsed.moduleName);
      if (!result) return { success: true, found: false };
      return { success: true, found: true, address: result.address };
    } catch (error) {
      return { success: false, error: sanitize(error, 'aob_scan_failed') };
    }
  });

  // ── Phase 9 research tools (read-only) ─────────────────────────────────────

  ipcMain.handle('research:view', async (event, payload: unknown) => {
    try {
      const bundle = requireBundle(event);
      const parsed = ResearchViewSchema.parse(payload);
      if (!(await isFeatureEnabled())) return { success: false, error: 'feature_disabled' };

      const mod = await getLiveMemoryModule();
      const { driver, handle } = bundle.session.getMemoryAccessOrThrow();
      const viewer = new mod.MemoryViewer(driver);
      const entries = viewer.readTypedValues(handle, parsed.address, parsed.types);
      bundle.audit.append({
        op: 'read',
        address: parsed.address,
        reason: 'research:view',
        pid: bundle.session.getAttachedPid() ?? undefined,
        executableName: bundle.session.getAttachedExecutableName() ?? undefined,
      });
      return { success: true, entries };
    } catch (error) {
      return { success: false, error: sanitize(error, 'research_view_failed') };
    }
  });

  ipcMain.handle('research:hex', async (event, payload: unknown) => {
    try {
      const bundle = requireBundle(event);
      const parsed = ResearchHexSchema.parse(payload);
      if (!(await isFeatureEnabled())) return { success: false, error: 'feature_disabled' };

      const mod = await getLiveMemoryModule();
      const { driver, handle } = bundle.session.getMemoryAccessOrThrow();
      const inspector = new mod.HexInspector(driver);
      const window = inspector.inspect(handle, parsed.address, parsed.size);
      bundle.audit.append({
        op: 'read',
        address: parsed.address,
        reason: `research:hex:size=${window.size}`,
        pid: bundle.session.getAttachedPid() ?? undefined,
        executableName: bundle.session.getAttachedExecutableName() ?? undefined,
      });
      return { success: true, window };
    } catch (error) {
      return { success: false, error: sanitize(error, 'research_hex_failed') };
    }
  });

  ipcMain.handle('research:pointer-analyze', async (event, payload: unknown) => {
    try {
      const bundle = requireBundle(event);
      const parsed = ResearchPointerAnalyzeSchema.parse(payload);
      if (!(await isFeatureEnabled())) return { success: false, error: 'feature_disabled' };

      const mod = await getLiveMemoryModule();
      const scanResult = bundle.session.pointerScan(BigInt(parsed.address), {
        maxDepth: parsed.maxDepth,
        maxOffsetPerLevel: parsed.maxOffsetPerLevel,
      });
      const analyzer = new mod.PointerCandidateAnalyzer();
      const report = analyzer.analyze(parsed.address, scanResult.candidates, {
        truncated: scanResult.truncated,
      });
      bundle.audit.append({
        op: 'scan',
        address: parsed.address,
        reason: `research:pointer-analyze:candidates=${report.candidateCount}`,
        pid: bundle.session.getAttachedPid() ?? undefined,
        executableName: bundle.session.getAttachedExecutableName() ?? undefined,
      });
      return {
        success: true,
        report,
        levelsSearched: scanResult.levelsSearched,
        scansPerformed: scanResult.scansPerformed,
      };
    } catch (error) {
      return { success: false, error: sanitize(error, 'research_pointer_analyze_failed') };
    }
  });

  /** Phase 2 — resolve module+offset[+chain] on the attached session only. */
  ipcMain.handle('research:resolve-path', async (event, payload: unknown) => {
    try {
      const bundle = requireBundle(event);
      const parsed = ResearchResolvePathSchema.parse(payload);
      if (!(await isFeatureEnabled())) return { success: false, error: 'feature_disabled' };

      const mod = await getLiveMemoryModule();
      const { driver, handle } = bundle.session.getMemoryAccessOrThrow();
      const moduleOffset = Number.parseInt(parsed.baseOffset.slice(2), 16);
      if (!Number.isFinite(moduleOffset)) {
        return { success: false, error: 'invalid_base_offset' };
      }
      const address = mod.resolvePointerPath(driver, handle, {
        moduleName: parsed.moduleName,
        moduleOffset,
        offsets: parsed.pointerChain,
      });
      const hex = `0x${address.toString(16)}`;
      bundle.audit.append({
        op: 'resolve',
        address: hex,
        reason: `research:resolve-path:${parsed.moduleName}+${parsed.baseOffset}`,
        pid: bundle.session.getAttachedPid() ?? undefined,
        executableName: bundle.session.getAttachedExecutableName() ?? undefined,
        waiverAssumed: bundle.session.isOfflineConfirmed(),
      });
      return { success: true, address: hex };
    } catch (error) {
      return { success: false, error: sanitize(error, 'research_resolve_path_failed') };
    }
  });

  ipcMain.handle('research:snapshot-diff', async (event, payload: unknown) => {
    try {
      if (event.sender.isDestroyed()) return { success: false, error: 'sender_invalid' };
      const parsed = ResearchSnapshotDiffSchema.parse(payload);
      if (!(await isFeatureEnabled())) return { success: false, error: 'feature_disabled' };

      const mod = await getLiveMemoryModule();
      const mgr = new mod.SessionSnapshotManager();
      const diff = mgr.diff(parsed.old, parsed.new);
      return { success: true, diff };
    } catch (error) {
      return { success: false, error: sanitize(error, 'research_snapshot_diff_failed') };
    }
  });

  ipcMain.handle('research:snapshot-save', async (event, payload: unknown) => {
    try {
      if (event.sender.isDestroyed()) return { success: false, error: 'sender_invalid' };
      const parsed = ResearchSnapshotSaveSchema.parse(payload);
      if (!(await isFeatureEnabled())) return { success: false, error: 'feature_disabled' };

      const sessionsRoot = path.join(app.getPath('userData'), 'research-sessions');
      const mod = await getLiveMemoryModule();
      const mgr = new mod.SessionSnapshotManager();
      const snap = mgr.create({
        pid: parsed.snapshot.pid,
        processName: parsed.snapshot.processName,
        watchlist: parsed.snapshot.watchlist,
        matchSetIds: parsed.snapshot.matchSetIds,
        moduleBases: parsed.snapshot.moduleBases,
        notes: parsed.snapshot.notes,
        pointerTarget: parsed.snapshot.pointerTarget,
        timestamp: parsed.snapshot.timestamp,
      });
      const filePath = mgr.saveToDirectory(sessionsRoot, snap, parsed.label);
      const attached = sessions.get(event.sender.id);
      if (attached?.session.isAttached()) {
        attached.audit.append({
          op: 'read',
          reason: `research:snapshot-save:${path.basename(filePath)}`,
          pid: attached.session.getAttachedPid() ?? snap.pid,
          executableName: attached.session.getAttachedExecutableName() ?? snap.processName,
        });
      }
      return { success: true, filePath, snapshot: snap };
    } catch (error) {
      return { success: false, error: sanitize(error, 'research_snapshot_save_failed') };
    }
  });

  ipcMain.handle('in-process-propose-hook', async (event, payload: unknown) => {
    try {
      const session = requireSession(event);
      const parsed = InProcessProposeHookSchema.parse(payload);
      if (!(await isInProcessEnabled())) return { success: false, error: 'in_process_disabled' };

      const gate = await evaluateInProcessGateForSession(session, parsed.userApprovedAction);
      if (!gate.allowed) return { success: false, error: gate.reason };

      const { proposeHookInstall } = await import('../src/core/in-process-script/hook-engine.js');
      const proposal = proposeHookInstall(parsed.plan);
      return { success: true, proposal };
    } catch (error) {
      return { success: false, error: sanitize(error, 'in_process_propose_hook_failed') };
    }
  });

  ipcMain.handle('in-process-confirm-hook', async (event, payload: unknown) => {
    try {
      const session = requireSession(event);
      const parsed = InProcessConfirmHookSchema.parse(payload);
      if (!(await isInProcessEnabled())) return { success: false, error: 'in_process_disabled' };

      const gate = await evaluateInProcessGateForSession(session, parsed.userApprovedAction);
      if (!gate.allowed) return { success: false, error: gate.reason };

      const guard = await session.recheckOnlineGuard();
      if (!guard.allowed) return { success: false, guard, error: guard.reason };

      const access = session.getMemoryAccess();
      if (!access) return { success: false, error: 'not_attached' };

      const { installHookFromProposal } = await import('../src/core/in-process-script/hook-engine.js');
      const manifest = installHookFromProposal({
        sessionKey: String(event.sender.id),
        proposalId: parsed.proposalId,
        driver: access.driver,
        handle: access.handle,
      });
      return { success: true, manifest, guard };
    } catch (error) {
      return { success: false, error: sanitize(error, 'in_process_confirm_hook_failed') };
    }
  });

  ipcMain.handle('in-process-rollback-hook', async (event) => {
    try {
      const session = requireSession(event);
      if (!(await isInProcessEnabled())) return { success: false, error: 'in_process_disabled' };

      const access = session.getMemoryAccess();
      if (!access) return { success: false, error: 'not_attached' };

      const { rollbackHook } = await import('../src/core/in-process-script/hook-engine.js');
      const rolled = rollbackHook({
        sessionKey: String(event.sender.id),
        driver: access.driver,
        handle: access.handle,
      });
      return { success: rolled };
    } catch (error) {
      return { success: false, error: sanitize(error, 'in_process_rollback_hook_failed') };
    }
  });

  ipcMain.handle('in-process-propose-injector-launch', async (event, payload: unknown) => {
    try {
      if (event.sender.isDestroyed()) return { success: false, error: 'sender_invalid' };
      const parsed = InProcessProposeInjectorSchema.parse(payload);
      if (!(await isInProcessEnabled())) return { success: false, error: 'in_process_disabled' };

      const { getSettings } = await import('../src/core/settings/index.js');
      const settings = getSettings();
      const { evaluateInProcessGate } = await import('../src/core/in-process-script/guards.js');
      const gate = evaluateInProcessGate({
        featureEnabled: settings.inProcessScriptExecutionEnabled === true,
        userConfirmedOffline: parsed.userConfirmedOffline,
        userApprovedAction: parsed.userApprovedAction,
        executableName: 'CrimsonDesert.exe',
      });
      if (!gate.allowed) return { success: false, error: gate.reason };

      const { proposeInjectorLaunch } = await import('../src/core/in-process-script/injector-launcher.js');
      const proposal = proposeInjectorLaunch(parsed.exePath);
      return { success: true, proposal };
    } catch (error) {
      return { success: false, error: sanitize(error, 'in_process_propose_injector_failed') };
    }
  });

  ipcMain.handle('in-process-confirm-injector-launch', async (event, payload: unknown) => {
    try {
      if (event.sender.isDestroyed()) return { success: false, error: 'sender_invalid' };
      const parsed = InProcessConfirmInjectorSchema.parse(payload);
      if (!(await isInProcessEnabled())) return { success: false, error: 'in_process_disabled' };

      const { confirmInjectorLaunch } = await import('../src/core/in-process-script/injector-launcher.js');
      const result = await confirmInjectorLaunch(parsed.proposalId);
      return { success: true, pid: result.pid };
    } catch (error) {
      return { success: false, error: sanitize(error, 'in_process_confirm_injector_failed') };
    }
  });
}

// ── Per-sender session ownership ─────────────────────────────────────────────

interface SessionBundle {
  session: LiveMemorySession;
  audit: MemoryAuditLog;
  manager: MemoryManager;
}

const sessions = new Map<number, SessionBundle>();
/** catalogGameId → featureId → last resolved absolute address. */
const featureHintStore = new Map<string, Record<string, string>>();

function memoryAuditFilePath(): string {
  return path.join(app.getPath('userData'), 'logs', 'memory-audit.jsonl');
}

function refreshCrashContext(bundle: SessionBundle | undefined): void {
  if (!bundle || !bundle.session.isAttached()) {
    if (sessions.size === 0) setCrashReportContext(undefined);
    return;
  }
  setCrashReportContext({
    pid: bundle.session.getAttachedPid() ?? undefined,
    executableName: bundle.session.getAttachedExecutableName() ?? undefined,
    recentAuditLines: bundle.audit.recent(25).map((entry) => JSON.stringify(entry)),
  });
}

function bindSessionBundle(senderId: number, session: LiveMemorySession, mod: any): SessionBundle {
  const audit = new mod.MemoryAuditLog({ filePath: memoryAuditFilePath() });
  const manager = new mod.MemoryManager(session, audit);
  const bundle: SessionBundle = { session, audit, manager };
  sessions.set(senderId, bundle);
  return bundle;
}

function maybeStartAvowedWingdkBackups(input: {
  executableName: string;
  catalogGameId?: string;
  manager: MemoryManager;
}): void {
  const { config, watcherStarted } = onAvowedProcessAttached({
    executableName: input.executableName,
    catalogGameId: input.catalogGameId,
  });
  if (config || watcherStarted) {
    input.manager.setSnapshotListener(() => {
      onAvowedMemoryManagerSnapshotEvent();
    });
  }
}

function disposeSession(senderId: number): void {
  const existing = sessions.get(senderId);
  if (existing) {
    existing.manager.setSnapshotListener(null);
    existing.session.detach();
    sessions.delete(senderId);
  }
  if (sessions.size === 0) {
    resetAvowedWingdkBackupSession();
    setCrashReportContext(undefined);
  }
}

function requireBundle(event: IpcMainInvokeEvent): SessionBundle {
  if (event.sender.isDestroyed()) throw new Error('sender_invalid');
  const bundle = sessions.get(event.sender.id);
  if (!bundle || !bundle.session.isAttached()) throw new Error('not_attached');
  refreshCrashContext(bundle);
  return bundle;
}

function requireSession(event: IpcMainInvokeEvent): LiveMemorySession {
  return requireBundle(event).session;
}

function serializeControlSummary(control: {
  id: string;
  label: string;
  description: string;
  dataType: string;
  constraints?: { min?: number; max?: number };
}) {
  // Deliberately omits pointerPath/evidence/discoveredAt — the renderer only needs
  // enough to display the control and request a resolve/propose by id.
  return {
    id: control.id,
    label: control.label,
    description: control.description,
    dataType: control.dataType,
    constraints: control.constraints,
  };
}

function serializeMatches(matches: ScanMatch[]) {
  return matches.map((m) => ({ address: m.address.toString(), value: m.value }));
}

function serializeScanResult(result: { matches: ScanMatch[]; regionsScanned: number; bytesScanned: number; truncated: boolean }) {
  return {
    matches: serializeMatches(result.matches),
    regionsScanned: result.regionsScanned,
    bytesScanned: result.bytesScanned,
    truncated: result.truncated,
  };
}

function serializeFreezeStatus(status: {
  active: boolean;
  target: { address: { address: bigint; dataType: string }; value: number } | null;
  lastGuard: unknown;
  stopReason?: string;
  tickCount: number;
}) {
  return {
    ...status,
    target: status.target
      ? { ...status.target, address: { ...status.target.address, address: status.target.address.address.toString() } }
      : null,
  };
}

function serializeWriteResult(result: { success: boolean; manifest?: unknown; guard?: unknown; error?: string }) {
  if (!result.success || !result.manifest) return result;
  const manifest = result.manifest as { target: { address: bigint } };
  return {
    ...result,
    manifest: { ...manifest, target: { ...manifest.target, address: manifest.target.address.toString() } },
  };
}

async function isFeatureEnabled(): Promise<boolean> {
  const mod = await import('../src/core/settings/unlock-trainer-capabilities.js');
  return mod.isTrainerCapabilityEnabled('v2LiveModeEnabled');
}

async function isInProcessEnabled(): Promise<boolean> {
  const { getSettings } = await import('../src/core/settings/index.js');
  const settings = getSettings();
  return settings.inProcessScriptExecutionEnabled === true && (await isFeatureEnabled());
}

async function evaluateInProcessGateForSession(
  session: LiveMemorySession,
  userApprovedAction: boolean,
): Promise<{ allowed: boolean; reason: string }> {
  const { getSettings } = await import('../src/core/settings/index.js');
  const settings = getSettings();
  const { evaluateInProcessGate } = await import('../src/core/in-process-script/guards.js');
  return evaluateInProcessGate({
    featureEnabled: settings.inProcessScriptExecutionEnabled === true,
    userConfirmedOffline: session.isOfflineConfirmed(),
    userApprovedAction,
    executableName: session.getAttachedExecutableName() ?? '',
  });
}

function sanitize(error: unknown, fallback: string): string {
  if (error instanceof Error && (error.message === 'not_attached' || error.message === 'sender_invalid')) {
    return error.message;
  }
  // The real message never reaches the renderer (deliberately — avoids leaking internal
  // details like file paths or native error text into UI-facing strings) but gets lost
  // entirely without this, making every failure here indistinguishable from every other.
  // eslint-disable-next-line no-console
  console.error(`[live-memory-ipc] ${fallback}:`, error);
  return fallback;
}
