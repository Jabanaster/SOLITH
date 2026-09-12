import { app, ipcMain, BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defaultCtLibraryPaths, getCtLibraryGameDetail } from '../src/core/ct-library/search.js';
import { verifyCatalogGameIdForExecutable } from '../src/core/live-memory/attach-catalog-verification.js';
import {
  LiveMemoryListProcessesSchema,
  LiveMemoryAttachSchema,
  LiveMemoryZeroInputPrepareSchema,
  LiveMemoryDetachSchema,
  LiveMemoryReadSchema,
  LiveMemoryProposeWriteSchema,
  LiveMemoryIssueWriteConsentSchema,
  LiveMemoryConfirmWriteSchema,
  LiveMemoryRollbackSchema,
  LiveMemoryScanFirstSchema,
  LiveMemoryScanFirstAutoMatrixSchema,
  LiveMemoryScanNextSchema,
  LiveMemoryScanFirstUnknownSchema,
  LiveMemoryScanNextFromUnknownSchema,
  LiveMemoryReadManySchema,
  LiveMemoryCorrelationEmptySchema,
  LiveMemoryCorrelationEventSchema,
  LiveMemoryCorrelationStartSchema,
  LiveMemoryFreezeProposeSchema,
  LiveMemoryFreezeIssueConsentSchema,
  LiveMemoryFreezeConfirmSchema,
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
  InProcessIssueInjectorConsentSchema,
  InProcessConfirmInjectorSchema,
  InProcessRegisterInjectorHelperSchema,
} from './ipc-validation.js';
import type { ScanMatch } from '../src/core/live-memory/types.js';
import type { LiveMemorySession } from '../src/core/live-memory/live-memory-session.js';
import type { MemoryManager } from '../src/core/live-memory/memory-manager.js';
import type { MemoryAuditLog } from '../src/core/live-memory/audit-log.js';
import type { LiveCorrelationWatcher } from '../src/core/live-memory/live-correlation-watcher.js';
import { setCrashReportContext } from '../src/core/crash/local-crash-reporter.js';
import { hashInstalledExecutableForCatalog } from '../src/core/live-memory/installed-exe-hash.js';
import {
  wireSessionCleanupOnDestroy,
  wireSessionCleanupOnNavigate,
  type DestroyableEmitter,
  type NavigableEmitter,
} from '../src/core/live-memory/session-cleanup.js';
import { validateIpcSender } from './sender-validation.js';
import { isTrainerCapabilityEnabled } from '../src/core/settings/unlock-trainer-capabilities.js';
import { revokeWriteConsentsForSession, clearWriteConsentStore } from '../src/core/consent/write-consent.js';
import { clearSelectionsForWindow, clearAllProcessSelections } from '../src/core/security/process-selection-registry.js';
import { unregisterTrustedWindow, clearAllTrustedWindows } from '../src/core/security/trusted-sender-registry.js';
import { runCleanup, type CleanupResult } from '../src/core/live-memory/cleanup-coordinator.js';
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

const ctLibraryPaths = defaultCtLibraryPaths(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));

/**
 * Renderer never supplies a PID, module name, address, or offset — only an
 * opaque reference into the trusted, on-disk CT library. Everything the
 * actual read needs (module/baseOffset/pointerChain/dataType) is re-derived
 * server-side from that trusted data, never taken from the payload. This is
 * the "approved trainer card identity, not an arbitrary raw memory request"
 * boundary Mission 3 requires.
 */
const TrainerDeckReadValueSchema = z
  .object({
    /** Format: "<gameId>:<sourceSha256>:<cheatId>" — matches CtLibrarySearchResult.id exactly. */
    libraryEntryId: z.string().min(1).max(500),
  })
  .strict();

export function registerLiveMemoryIpc(): void {
  ipcMain.handle('live-memory-list-processes', async (event) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
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
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      if (!(await isFeatureEnabled())) return { success: false, error: 'feature_disabled' };

      const parsed = LiveMemoryAttachSchema.parse(payload);

      const mod = await getLiveMemoryModule();

      // Mission 20 hardening: never trust a renderer-supplied catalogGameId
      // verbatim — a Trainer Deck card's game-binding gate (trainer-deck-read.ts)
      // relies entirely on this value being genuine, so it must be
      // independently re-derived from the trusted catalog here, the same way
      // catalog-process-watch.ts's background poller does it, not accepted
      // as-is from the IPC payload.
      let verifiedCatalogGameId: string | undefined;
      if (parsed.catalogGameId) {
        const { searchCatalog } = await import('../src/core/trainer-catalog/store.js');
        const catalogEntries = searchCatalog('', 500, 0).entries.map((entry) => ({
          catalogGameId: entry.catalogGameId,
          displayName: entry.displayName,
          executables: entry.executables,
        }));
        verifiedCatalogGameId = verifyCatalogGameIdForExecutable(
          parsed.catalogGameId,
          parsed.executableName,
          parsed.pid,
          catalogEntries,
          mod.matchCatalogProcess,
        );
      }

      disposeSession(event.sender.id);
      const session = new mod.LiveMemorySession(mod.nativeMemoryDriver);
      const executableHashSHA256 =
        parsed.executableHashSHA256 ??
        (verifiedCatalogGameId
          ? hashInstalledExecutableForCatalog(verifiedCatalogGameId, parsed.executableName) ??
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
        verifiedCatalogGameId
      ) {
        fingerprint = {
          executableHashSHA256,
          executableHashPrefixes: parsed.executableHashPrefixes,
          targetSHA256: parsed.targetSHA256,
          driftAcknowledged: parsed.driftAcknowledged,
          catalogGameId: verifiedCatalogGameId,
        };
      }

      if (verifiedCatalogGameId) {
        const { getModPackForGame, getDefinitionPayload } = await import('../src/core/trainer-catalog/store.js');
        const { modPackToSolithDefinition, definitionFingerprintFields } = await import(
          '../src/core/definitions/mod-pack-adapter.js'
        );
        const definition =
          getDefinitionPayload(verifiedCatalogGameId) ??
          (() => {
            const pack = getModPackForGame(verifiedCatalogGameId!);
            return pack ? modPackToSolithDefinition(pack) : null;
          })();
        if (definition) {
          const fields = definitionFingerprintFields(definition);
          fingerprint = {
            ...fingerprint,
            catalogGameId: verifiedCatalogGameId,
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
        const bundle = bindSessionBundle(event.sender.id, session, mod, event.sender);
        refreshCrashContext(bundle);
        maybeStartAvowedWingdkBackups({
          executableName: parsed.executableName,
          catalogGameId: verifiedCatalogGameId,
          manager: bundle.manager,
        });
        if (result.fingerprintWarning && verifiedCatalogGameId) {
          const { quarantineDefinition } = await import('../src/core/trainer-catalog/definition-quarantine.js');
          quarantineDefinition(verifiedCatalogGameId, result.fingerprintWarning);
        }
      }
      return result;
    } catch (error) {
      return { success: false, error: sanitize(error, 'attach_failed') };
    }
  });

  ipcMain.handle('live-memory-zero-input-prepare', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      if (!(await isFeatureEnabled())) return { success: false, error: 'feature_disabled' };

      const parsed = LiveMemoryZeroInputPrepareSchema.parse(payload);
      const mod = await getLiveMemoryModule();

      // Mission 1 fix (hostile review follow-up): zero-input-prepare trusted
      // the renderer-supplied catalogGameId verbatim, exactly like
      // live-memory-attach did before its own fix. Concretely exploitable
      // here too: hashInstalledExecutableForCatalog(catalogGameId, exeName)
      // returns null when that (catalogGameId, executableName) pairing
      // isn't a real installed record, which makes verifyDefinitionFingerprint
      // return status:'skipped' (not 'mismatch') — and fingerprintBlocksAttach
      // only blocks on 'mismatch', never on 'skipped'. So a lie about
      // catalogGameId silently degrades to "no fingerprint check" instead of
      // being rejected. Reusing the exact same verification used for
      // live-memory-attach, not a second weaker verifier.
      const { searchCatalog } = await import('../src/core/trainer-catalog/store.js');
      const zeroInputCatalogEntries = searchCatalog('', 500, 0).entries.map((entry) => ({
        catalogGameId: entry.catalogGameId,
        displayName: entry.displayName,
        executables: entry.executables,
      }));
      const verifiedZeroInputCatalogGameId = verifyCatalogGameIdForExecutable(
        parsed.catalogGameId,
        parsed.executableName,
        parsed.pid,
        zeroInputCatalogEntries,
        mod.matchCatalogProcess,
      );
      if (!verifiedZeroInputCatalogGameId) {
        return {
          success: false,
          error: 'catalog_identity_unverified',
          planAllowed: false,
          blockReason: 'The claimed game does not match the trusted catalog for this executable.',
        };
      }

      const { loadCatalogDefinition } = await import('../src/core/definitions/load-catalog-definition.js');
      const definition = loadCatalogDefinition(verifiedZeroInputCatalogGameId);

      disposeSession(event.sender.id);
      const session = new mod.LiveMemorySession(mod.nativeMemoryDriver);
      const bundle = bindSessionBundle(event.sender.id, session, mod, event.sender);

      const executableHashSHA256 =
        parsed.executableHashSHA256 ??
        hashInstalledExecutableForCatalog(verifiedZeroInputCatalogGameId, parsed.executableName) ??
        undefined;
      const storedHints = featureHintStore.get(verifiedZeroInputCatalogGameId) ?? {};
      const featureHints = { ...storedHints, ...(parsed.featureHints ?? {}) };

      const evidence = await mod.observeRemoteConnections(parsed.pid);
      const result = await mod.prepareZeroInputSession(
        session,
        {
          detection: {
            catalogGameId: verifiedZeroInputCatalogGameId,
            displayName: definition?.title ?? verifiedZeroInputCatalogGameId,
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
        quarantineDefinition(verifiedZeroInputCatalogGameId, result.fingerprintWarning);
      }

      const nextHints: Record<string, string> = { ...storedHints };
      for (const feature of result.features ?? []) {
        if (feature.resolution !== 'failed' && feature.address && feature.address !== '0x0') {
          nextHints[feature.featureId] = feature.address;
        }
      }
      featureHintStore.set(verifiedZeroInputCatalogGameId, nextHints);
      refreshCrashContext(bundle);

      maybeStartAvowedWingdkBackups({
        executableName: parsed.executableName,
        catalogGameId: verifiedZeroInputCatalogGameId,
        manager: bundle.manager,
      });

      const readyPayload = {
        catalogGameId: verifiedZeroInputCatalogGameId,
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
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      LiveMemoryDetachSchema.parse({});
      disposeSession(event.sender.id);
      return { success: true };
    } catch (error) {
      return { success: false, error: sanitize(error, 'detach_failed') };
    }
  });

  ipcMain.handle('live-memory-read', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      const bundle = requireBundle(event);
      const parsed = LiveMemoryReadSchema.parse(payload);
      const value = bundle.manager.read({ address: BigInt(parsed.address), dataType: parsed.dataType });
      refreshCrashContext(bundle);
      return { success: true, value };
    } catch (error) {
      return { success: false, error: sanitize(error, 'read_failed') };
    }
  });

  /**
   * Read-only, Trainer-Deck-scoped bridge (Mission 2/3). Deliberately does
   * NOT reuse LiveMemoryReadSchema's raw {address,dataType} shape — this
   * handler never trusts a renderer-supplied address at all. It re-resolves
   * the card's moduleName/baseOffset/pointerChain/dataType itself from the
   * trusted CT-library shard on disk, keyed only by an opaque reference id,
   * then delegates the actual read to readTrainerDeckCard (read-preflight.ts
   * + the production adapter) — no write/freeze/Lua/AA capability anywhere
   * in this path.
   */
  ipcMain.handle('trainer-deck-read-value', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { status: 'blocked', reason: `sender_rejected:${senderCheck.reason}` };

      if (event.sender.isDestroyed()) return { status: 'blocked', reason: 'sender_invalid' };
      const bundle = sessions.get(event.sender.id);
      if (!bundle || !bundle.session.isAttached()) return { status: 'not_attached' };

      const parsed = TrainerDeckReadValueSchema.parse(payload);
      const sessionCatalogGameId =
        typeof bundle.session.getCatalogGameId === 'function' ? bundle.session.getCatalogGameId() : null;

      const mod = await getLiveMemoryModule();
      const lookup = mod.parseLibraryEntryId(parsed.libraryEntryId);
      const detail = lookup ? await getCtLibraryGameDetail(ctLibraryPaths, lookup.gameId) : null;
      const readState = mod.authorizeTrainerDeckRead(parsed.libraryEntryId, sessionCatalogGameId, detail, bundle.session);
      refreshCrashContext(bundle);
      return readState;
    } catch (error) {
      return { status: 'blocked', reason: sanitize(error, 'trainer_deck_read_failed') };
    }
  });

  ipcMain.handle('live-memory-propose-write', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      const bundle = requireBundle(event);
      const parsed = LiveMemoryProposeWriteSchema.parse(payload);
      // Staging only — destructive confirm requires a consumed consent artifact.
      const proposal = bundle.manager.proposeWrite(
        { address: BigInt(parsed.address), dataType: parsed.dataType },
        parsed.requestedValue,
        { writeIntent: 'stage', userApproved: false, reason: 'ipc_propose' },
      );
      refreshCrashContext(bundle);
      return { success: true, proposal: { ...proposal, target: { ...proposal.target, address: proposal.target.address.toString() } } };
    } catch (error) {
      return { success: false, error: sanitize(error, 'propose_failed') };
    }
  });

  ipcMain.handle('live-memory-issue-write-consent', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      const bundle = requireBundle(event);
      const parsed = LiveMemoryIssueWriteConsentSchema.parse(payload);
      const identityError = bundle.session.verifyAttachedProcessIdentity();
      if (identityError) {
        return { success: false, error: identityError };
      }
      const liveProposal = bundle.session.getPendingWriteProposal(parsed.proposalId);
      if (!liveProposal) {
        return { success: false, error: 'Unknown write proposal.' };
      }
      const identity = bundle.session.getAttachedIdentity();
      if (!identity) {
        return { success: false, error: 'incomplete_process_identity' };
      }
      const {
        requestPrivilegedWriteConsent,
        formatMemoryWriteConsentLines,
        parentWindowFromEvent,
      } = await import('./privileged-consent-dialog.js');
      const binding = {
        operation: 'live_memory_confirm_write' as const,
        sessionKey: String(event.sender.id),
        proposalId: liveProposal.proposalId,
        attachedPid: identity.pid,
        attachedExecutableName: identity.executableName,
        executablePath: identity.executablePath,
        processStartTime: identity.startTime,
        volumeSerialNumber: identity.volumeSerialNumber,
        fileIndex: identity.fileIndex,
        attachedExeSha256: identity.exeSha256,
        address: liveProposal.target.address.toString(),
        dataType: liveProposal.target.dataType,
        currentValue: liveProposal.currentValue,
        requestedValue: liveProposal.requestedValue,
      };
      const result = await requestPrivilegedWriteConsent(parentWindowFromEvent(event), {
        title: 'Approve live memory write',
        lines: formatMemoryWriteConsentLines({
          attachedExecutableName: identity.executableName,
          attachedPid: identity.pid,
          executablePath: identity.executablePath,
          address: liveProposal.target.address.toString(),
          dataType: liveProposal.target.dataType,
          currentValue: liveProposal.currentValue,
          requestedValue: liveProposal.requestedValue,
          proposalId: liveProposal.proposalId,
        }),
        binding,
      });
      if (result.approved === false) {
        return { success: false, error: result.reason };
      }
      return { success: true, consent: result.consent };
    } catch (error) {
      return { success: false, error: sanitize(error, 'issue_write_consent_failed') };
    }
  });

  ipcMain.handle('live-memory-confirm-write', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      const bundle = requireBundle(event);
      const parsed = LiveMemoryConfirmWriteSchema.parse(payload);
      const identityError = bundle.session.verifyAttachedProcessIdentity();
      if (identityError) {
        return { success: false, error: identityError };
      }
      const liveProposal = bundle.session.getPendingWriteProposal(parsed.proposalId);
      if (!liveProposal) {
        return { success: false, error: 'Unknown write proposal.' };
      }
      const identity = bundle.session.getAttachedIdentity();
      if (!identity) {
        return { success: false, error: 'incomplete_process_identity' };
      }
      const consentBinding = {
        operation: 'live_memory_confirm_write' as const,
        sessionKey: String(event.sender.id),
        proposalId: liveProposal.proposalId,
        attachedPid: identity.pid,
        attachedExecutableName: identity.executableName,
        executablePath: identity.executablePath,
        processStartTime: identity.startTime,
        volumeSerialNumber: identity.volumeSerialNumber,
        fileIndex: identity.fileIndex,
        attachedExeSha256: identity.exeSha256,
        address: liveProposal.target.address.toString(),
        dataType: liveProposal.target.dataType,
        currentValue: liveProposal.currentValue,
        requestedValue: liveProposal.requestedValue,
      };
      const result = await bundle.manager.confirmWrite(parsed.proposalId, {
        consentToken: parsed.consentToken,
        consentBinding,
        reason: 'ipc_confirm',
      });
      refreshCrashContext(bundle);
      return serializeWriteResult(result);
    } catch (error) {
      return { success: false, error: sanitize(error, 'confirm_write_failed') };
    }
  });

  ipcMain.handle('live-memory-rollback', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      const bundle = requireBundle(event);
      const parsed = LiveMemoryRollbackSchema.parse(payload);
      const result = await bundle.manager.rollback(parsed.proposalId);
      refreshCrashContext(bundle);
      return serializeWriteResult(result);
    } catch (error) {
      return { success: false, error: sanitize(error, 'rollback_failed') };
    }
  });

  // Guarded (Phase 7 finding): session binding is per-webContents, not per-frame,
  // so an unguarded read-only channel is still reachable by any trusted-window type
  // sharing that sender id — see requireTrustedSender's frame/window-type check.
  ipcMain.handle('live-memory-scan-first', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
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

  // Read-only UX-first scan: one manual action fans out across compatible
  // scan modes and value types, plus an optional unknown-value baseline.
  ipcMain.handle('live-memory-scan-first-auto-matrix', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      const session = requireSession(event);
      const parsed = LiveMemoryScanFirstAutoMatrixSchema.parse(payload);
      const result = session.scanFirstAutoMatrix({
        value: parsed.value,
        min: parsed.min,
        max: parsed.max,
        modes: parsed.modes,
        dataTypes: parsed.dataTypes,
        includeUnknown: parsed.includeUnknown,
        unknownKey: parsed.unknownKey,
        bounds: {
          maxRegionBytes: parsed.maxRegionBytes,
          maxTotalBytes: parsed.maxTotalBytes,
          maxMatches: parsed.maxMatches,
        },
        unknownBounds: {
          maxRegionBytes: parsed.unknownMaxRegionBytes,
          maxTotalBytes: parsed.unknownMaxTotalBytes,
        },
      });
      return { success: true, result: serializeAutoMatrixResult(result) };
    } catch (error) {
      return { success: false, error: sanitize(error, 'scan_first_auto_matrix_failed') };
    }
  });

  ipcMain.handle('live-memory-scan-next', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
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
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
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
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
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
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
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

  ipcMain.handle('live-memory-correlation-start', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      const bundle = requireBundle(event);
      const parsed = LiveMemoryCorrelationStartSchema.parse(payload);
      const mod = await getLiveMemoryModule();
      const access = bundle.session.getMemoryAccessOrThrow();
      bundle.correlationWatcher?.stop();
      let lastReportSentAt = 0;
      const reportIntervalMs = parsed.reportIntervalMs ?? 333;
      bundle.correlationWatcher = new mod.LiveCorrelationWatcher({
        driver: access.driver,
        handle: access.handle,
        candidates: parsed.candidates,
        pollIntervalMs: parsed.pollIntervalMs,
        epsilon: parsed.epsilon,
        eventLookbackMs: parsed.eventLookbackMs,
        onReport: (report: unknown) => {
          const now = Date.now();
          if (!event.sender.isDestroyed() && now - lastReportSentAt >= reportIntervalMs) {
            lastReportSentAt = now;
            event.sender.send('live-memory-correlation-report', report);
          }
        },
      });
      bundle.correlationWatcher.start();
      return { success: true, report: bundle.correlationWatcher.getReport() };
    } catch (error) {
      return { success: false, error: sanitize(error, 'correlation_start_failed') };
    }
  });

  ipcMain.handle('live-memory-correlation-poll', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      LiveMemoryCorrelationEmptySchema.parse(payload ?? {});
      const bundle = requireBundle(event);
      if (!bundle.correlationWatcher) return { success: false, error: 'correlation_watcher_not_started' };
      return { success: true, report: bundle.correlationWatcher.pollOnce() };
    } catch (error) {
      return { success: false, error: sanitize(error, 'correlation_poll_failed') };
    }
  });

  ipcMain.handle('live-memory-correlation-event', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      const parsed = LiveMemoryCorrelationEventSchema.parse(payload);
      const bundle = requireBundle(event);
      if (!bundle.correlationWatcher) return { success: false, error: 'correlation_watcher_not_started' };
      return { success: true, report: bundle.correlationWatcher.recordEvent(parsed) };
    } catch (error) {
      return { success: false, error: sanitize(error, 'correlation_event_failed') };
    }
  });

  ipcMain.handle('live-memory-correlation-stop', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      LiveMemoryCorrelationEmptySchema.parse(payload ?? {});
      const bundle = requireBundle(event);
      bundle.correlationWatcher?.stop();
      bundle.correlationWatcher = null;
      return { success: true };
    } catch (error) {
      return { success: false, error: sanitize(error, 'correlation_stop_failed') };
    }
  });

  // Freeze propose/issue-consent/confirm (Batch B1.1) — mirrors the write
  // propose/issue-consent/confirm flow above. A freeze can no longer be
  // started via a single privileged call (the old 'live-memory-freeze-start'
  // handler took address/value/interval directly and started writing
  // immediately). All 3 steps also enforce trusted-sender validation, not
  // just liveness — see requireTrustedSender below.
  ipcMain.handle('live-memory-freeze-propose', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      const bundle = requireBundle(event);
      if (!(await isFeatureEnabled())) return { success: false, error: 'feature_disabled' };
      const parsed = LiveMemoryFreezeProposeSchema.parse(payload);
      const proposal = bundle.session.proposeFreeze(
        { address: BigInt(parsed.address), dataType: parsed.dataType },
        parsed.value,
        parsed.intervalMs,
      );
      refreshCrashContext(bundle);
      return {
        success: true,
        proposal: { ...proposal, target: { ...proposal.target, address: proposal.target.address.toString() } },
      };
    } catch (error) {
      return { success: false, error: sanitize(error, 'freeze_propose_failed') };
    }
  });

  ipcMain.handle('live-memory-freeze-issue-consent', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      const bundle = requireBundle(event);
      if (!(await isFeatureEnabled())) return { success: false, error: 'feature_disabled' };
      const parsed = LiveMemoryFreezeIssueConsentSchema.parse(payload);
      const identityError = bundle.session.verifyAttachedProcessIdentity();
      if (identityError) {
        return { success: false, error: identityError };
      }
      const proposal = bundle.session.getPendingFreezeProposal(parsed.proposalId);
      if (!proposal) {
        return { success: false, error: 'Unknown freeze proposal.' };
      }
      const identity = bundle.session.getAttachedIdentity();
      if (!identity) {
        return { success: false, error: 'incomplete_process_identity' };
      }
      const {
        requestPrivilegedWriteConsent,
        formatFreezeConsentLines,
        parentWindowFromEvent,
      } = await import('./privileged-consent-dialog.js');
      const { MAX_FREEZE_DURATION_MS } = await getLiveMemoryModule();
      const binding = {
        operation: 'live_memory_freeze_start' as const,
        sessionKey: String(event.sender.id),
        proposalId: proposal.proposalId,
        attachedPid: identity.pid,
        attachedExecutableName: identity.executableName,
        executablePath: identity.executablePath,
        processStartTime: identity.startTime,
        volumeSerialNumber: identity.volumeSerialNumber,
        fileIndex: identity.fileIndex,
        attachedExeSha256: identity.exeSha256,
        address: proposal.target.address.toString(),
        dataType: proposal.target.dataType,
        freezeValue: proposal.value,
        freezeIntervalMs: proposal.intervalMs,
        freezeMaxDurationMs: MAX_FREEZE_DURATION_MS,
        windowId: event.sender.id,
      };
      const result = await requestPrivilegedWriteConsent(parentWindowFromEvent(event), {
        title: 'Approve live memory freeze',
        lines: formatFreezeConsentLines({
          attachedExecutableName: identity.executableName,
          attachedPid: identity.pid,
          executablePath: identity.executablePath,
          address: proposal.target.address.toString(),
          dataType: proposal.target.dataType,
          value: proposal.value,
          intervalMs: proposal.intervalMs,
          maxDurationMs: MAX_FREEZE_DURATION_MS,
          proposalId: proposal.proposalId,
        }),
        binding,
      });
      if (result.approved === false) {
        return { success: false, error: result.reason };
      }
      return { success: true, consent: result.consent };
    } catch (error) {
      return { success: false, error: sanitize(error, 'freeze_issue_consent_failed') };
    }
  });

  ipcMain.handle('live-memory-freeze-start', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      const bundle = requireBundle(event);
      // Re-checked here (not just at propose time): if the feature flag is disabled between
      // propose and confirm, confirm must fail closed rather than honoring a stale proposal.
      if (!(await isFeatureEnabled())) return { success: false, error: 'feature_disabled' };
      const parsed = LiveMemoryFreezeConfirmSchema.parse(payload);
      const identityError = bundle.session.verifyAttachedProcessIdentity();
      if (identityError) {
        return { success: false, error: identityError };
      }
      const proposal = bundle.session.getPendingFreezeProposal(parsed.proposalId);
      if (!proposal) {
        return { success: false, error: 'Unknown or already-consumed freeze proposal.' };
      }
      const identity = bundle.session.getAttachedIdentity();
      if (!identity) {
        return { success: false, error: 'incomplete_process_identity' };
      }
      const { MAX_FREEZE_DURATION_MS } = await getLiveMemoryModule();
      const consentBinding = {
        operation: 'live_memory_freeze_start' as const,
        sessionKey: String(event.sender.id),
        proposalId: proposal.proposalId,
        attachedPid: identity.pid,
        attachedExecutableName: identity.executableName,
        executablePath: identity.executablePath,
        processStartTime: identity.startTime,
        volumeSerialNumber: identity.volumeSerialNumber,
        fileIndex: identity.fileIndex,
        attachedExeSha256: identity.exeSha256,
        address: proposal.target.address.toString(),
        dataType: proposal.target.dataType,
        freezeValue: proposal.value,
        freezeIntervalMs: proposal.intervalMs,
        freezeMaxDurationMs: MAX_FREEZE_DURATION_MS,
        windowId: event.sender.id,
      };
      const result = await bundle.manager.freezeStart(parsed.proposalId, {
        consentToken: parsed.consentToken,
        consentBinding,
      });
      refreshCrashContext(bundle);
      return result;
    } catch (error) {
      return { success: false, error: sanitize(error, 'freeze_start_failed') };
    }
  });

  ipcMain.handle('live-memory-freeze-stop', async (event) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
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
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
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
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
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
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
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
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
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
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
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
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
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
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
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
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
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
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
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
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
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
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
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
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
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
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
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
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
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
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
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
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      const session = requireSession(event);
      const parsed = InProcessProposeInjectorSchema.parse(payload);
      if (!(await isInProcessEnabled())) return { success: false, error: 'in_process_disabled' };

      const attachedExecutableName = session.getAttachedExecutableName() ?? '';
      const attachedPid = session.getAttachedPid();
      if (attachedPid == null) {
        return { success: false, error: 'Injector launch requires an attached CrimsonDesert.exe session.' };
      }
      const identityError = session.verifyAttachedProcessIdentity();
      if (identityError) {
        return { success: false, error: identityError };
      }
      const { evaluateInProcessGate } = await import('../src/core/in-process-script/guards.js');
      const gate = evaluateInProcessGate({
        featureEnabled: true,
        userConfirmedOffline: session.isOfflineConfirmed() && parsed.userConfirmedOffline === true,
        userApprovedAction: parsed.userApprovedAction,
        executableName: attachedExecutableName,
      });
      if (!gate.allowed) return { success: false, error: gate.reason };

      const { getAppPaths } = await import('../src/shared/app-paths.js');
      const paths = await getAppPaths();
      const {
        proposeInjectorLaunch,
        getDefaultInjectorHelpersRoot,
        setInjectorAuditSink,
      } = await import('../src/core/in-process-script/injector-launcher.js');
      ensureInjectorAuditSink(paths.userDataRoot, setInjectorAuditSink);
      const helpersRoot = getDefaultInjectorHelpersRoot(paths.userDataRoot);
      fs.mkdirSync(helpersRoot, { recursive: true });
      const proposal = proposeInjectorLaunch({
        exePath: parsed.exePath,
        attachedExecutableName,
        attachedPid,
        helpersRoot,
        gate: {
          featureEnabled: true,
          userConfirmedOffline: session.isOfflineConfirmed() && parsed.userConfirmedOffline === true,
          userApprovedAction: parsed.userApprovedAction,
          executableName: attachedExecutableName,
        },
      });
      return { success: true, proposal };
    } catch (error) {
      return { success: false, error: sanitize(error, 'in_process_propose_injector_failed') };
    }
  });

  ipcMain.handle('in-process-issue-injector-consent', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      const session = requireSession(event);
      const parsed = InProcessIssueInjectorConsentSchema.parse(payload);
      if (!(await isInProcessEnabled())) return { success: false, error: 'in_process_disabled' };
      const identityError = session.verifyAttachedProcessIdentity();
      if (identityError) return { success: false, error: identityError };
      const { getInjectorProposal } = await import('../src/core/in-process-script/injector-launcher.js');
      const proposal = getInjectorProposal(parsed.proposalId);
      if (!proposal) return { success: false, error: 'Unknown injector launch proposal.' };
      const identity = session.getAttachedIdentity();
      if (!identity) return { success: false, error: 'incomplete_process_identity' };
      const {
        requestPrivilegedWriteConsent,
        formatInjectorConsentLines,
        parentWindowFromEvent,
      } = await import('./privileged-consent-dialog.js');
      const binding = {
        operation: 'injector_confirm_launch' as const,
        sessionKey: String(event.sender.id),
        proposalId: proposal.proposalId,
        attachedPid: identity.pid,
        attachedExecutableName: identity.executableName,
        executablePath: identity.executablePath,
        processStartTime: identity.startTime,
        volumeSerialNumber: identity.volumeSerialNumber,
        fileIndex: identity.fileIndex,
        attachedExeSha256: identity.exeSha256,
        exePath: proposal.exePath,
        exeSha256: proposal.sha256,
      };
      const result = await requestPrivilegedWriteConsent(parentWindowFromEvent(event), {
        title: 'Approve injector helper launch',
        lines: formatInjectorConsentLines({
          attachedExecutableName: identity.executableName,
          attachedPid: identity.pid,
          executablePath: identity.executablePath,
          helperPath: proposal.exePath,
          helperSha256: proposal.sha256,
          proposalId: proposal.proposalId,
        }),
        binding,
      });
      if (result.approved === false) return { success: false, error: result.reason };
      return { success: true, consent: result.consent };
    } catch (error) {
      return { success: false, error: sanitize(error, 'in_process_issue_injector_consent_failed') };
    }
  });

  ipcMain.handle('in-process-register-injector-helper', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      const parsed = InProcessRegisterInjectorHelperSchema.parse(payload);
      if (!(await isInProcessEnabled())) return { success: false, error: 'in_process_disabled' };
      const { getAppPaths } = await import('../src/shared/app-paths.js');
      const paths = await getAppPaths();
      const {
        getDefaultInjectorHelpersRoot,
        sha256File,
        isUnderInjectorHelpersRoot,
        isWindowsSystemExecutablePath,
      } = await import('../src/core/in-process-script/injector-launcher.js');
      const {
        upsertHelperManifestEntry,
        relativeHelperPath,
        queryAuthenticodePublisher,
      } = await import('../src/core/in-process-script/helper-manifest.js');
      const helpersRoot = getDefaultInjectorHelpersRoot(paths.userDataRoot);
      fs.mkdirSync(helpersRoot, { recursive: true });
      const resolved = path.resolve(parsed.exePath);
      if (!fs.existsSync(resolved) || !resolved.toLowerCase().endsWith('.exe')) {
        return { success: false, error: 'Helper executable not found.' };
      }
      if (isWindowsSystemExecutablePath(resolved)) {
        return { success: false, error: 'Refusing to register Windows system executables.' };
      }
      if (!isUnderInjectorHelpersRoot(resolved, helpersRoot)) {
        return { success: false, error: 'Helper must reside under injector-helpers.' };
      }
      const sha256 = sha256File(resolved);
      const publisher = queryAuthenticodePublisher(resolved);
      const {
        requestPrivilegedApproval,
        parentWindowFromEvent,
      } = await import('./privileged-consent-dialog.js');
      const decision = await requestPrivilegedApproval(parentWindowFromEvent(event), {
        title: 'Register injector helper',
        lines: [
          'Operation: register sealed injector helper',
          `Path: ${resolved}`,
          `SHA-256: ${sha256}`,
          `Publisher: ${publisher ?? '(unsigned / unavailable)'}`,
          'Consequence: this hash will be allowed for future injector launches while the seal remains valid.',
        ],
      });
      if (!decision.approved) {
        return { success: false, error: decision.reason };
      }
      const entry = upsertHelperManifestEntry(helpersRoot, {
        relativePath: relativeHelperPath(helpersRoot, resolved),
        sha256,
        publisher,
        registeredAt: new Date().toISOString(),
      });
      return { success: true, entry: entry.entries.find((e) => e.sha256 === sha256) };
    } catch (error) {
      return { success: false, error: sanitize(error, 'in_process_register_helper_failed') };
    }
  });

  ipcMain.handle('in-process-confirm-injector-launch', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      const session = requireSession(event);
      const parsed = InProcessConfirmInjectorSchema.parse(payload);
      if (!(await isInProcessEnabled())) return { success: false, error: 'in_process_disabled' };

      const remoteConnections = await session.observeAttachedRemoteConnections();
      const { getAppPaths } = await import('../src/shared/app-paths.js');
      const paths = await getAppPaths();
      const {
        confirmInjectorLaunch,
        getInjectorProposal,
        getDefaultInjectorHelpersRoot,
        setInjectorAuditSink,
      } = await import('../src/core/in-process-script/injector-launcher.js');
      ensureInjectorAuditSink(paths.userDataRoot, setInjectorAuditSink);
      const proposal = getInjectorProposal(parsed.proposalId);
      if (!proposal) {
        return { success: false, error: 'Unknown injector launch proposal.' };
      }
      const identity = session.getAttachedIdentity();
      if (!identity) {
        return { success: false, error: 'incomplete_process_identity' };
      }
      const consentBinding = {
        operation: 'injector_confirm_launch' as const,
        sessionKey: String(event.sender.id),
        proposalId: proposal.proposalId,
        attachedPid: identity.pid,
        attachedExecutableName: identity.executableName,
        executablePath: identity.executablePath,
        processStartTime: identity.startTime,
        volumeSerialNumber: identity.volumeSerialNumber,
        fileIndex: identity.fileIndex,
        attachedExeSha256: identity.exeSha256,
        exePath: proposal.exePath,
        exeSha256: proposal.sha256,
      };
      const result = await confirmInjectorLaunch({
        proposalId: parsed.proposalId,
        attachedExecutableName: identity.executableName,
        attachedPid: identity.pid,
        helpersRoot: getDefaultInjectorHelpersRoot(paths.userDataRoot),
        verifyLiveIdentity: () => session.verifyAttachedProcessIdentity(),
        consentToken: parsed.consentToken,
        consentBinding,
        gate: {
          featureEnabled: true,
          userConfirmedOffline: session.isOfflineConfirmed(),
          userApprovedAction: parsed.userApprovedAction,
          executableName: identity.executableName,
        },
        remoteConnections,
        acceptedConnectionBaseline: session.getAcceptedConnectionBaseline(),
      });
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
  correlationWatcher: LiveCorrelationWatcher | null;
}

const sessions = new Map<number, SessionBundle>();
/** catalogGameId → featureId → last resolved absolute address. */
const featureHintStore = new Map<string, Record<string, string>>();

// Gate 2.1: narrow, read-only test-only introspection so the packaged
// lifecycle harness can verify a session was actually torn down after a
// real renderer crash — the crashed webContents itself can no longer be
// queried once its JS context is gone. Read-only, no security-relevant
// side effect. Unavailable unless SOLITH_TEST_BUILD=1.
export function __testHasSessionForOwner(senderId: number): boolean {
  if (process.env.SOLITH_TEST_BUILD !== '1') {
    throw new Error('__testHasSessionForOwner is only available when SOLITH_TEST_BUILD=1.');
  }
  return sessions.has(senderId);
}

if (process.env.SOLITH_TEST_BUILD === '1') {
  (globalThis as Record<string, unknown>).__solithTestHasSessionForOwner = __testHasSessionForOwner;
}

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

function bindSessionBundle(
  senderId: number,
  session: LiveMemorySession,
  mod: any,
  webContents: DestroyableEmitter & NavigableEmitter,
): SessionBundle {
  const audit = new mod.MemoryAuditLog({ filePath: memoryAuditFilePath() });
  const manager = new mod.MemoryManager(session, audit);
  const bundle: SessionBundle = { session, audit, manager, correlationWatcher: null };
  session.setOwnerId(String(senderId));
  session._injectFreezeFeatureFlagCheck(() => isTrainerCapabilityEnabled('v2LiveModeEnabled'));
  sessions.set(senderId, bundle);
  wireSessionCleanupOnDestroy(webContents, () => disposeSession(senderId));
  // Batch B1.1: a full-page reload/navigation of the owning window must tear down the
  // session too — 'destroyed' alone does not fire on reload, so without this an active
  // freeze (or a stale rollback ledger) would silently survive a reload.
  wireSessionCleanupOnNavigate(webContents, () => disposeSession(senderId));
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

// Gate 2.1: narrow test-only seam so the packaged lifecycle harness can
// certify cleanup-failure containment (one step throwing must not halt the
// remaining steps or leave writes unblocked) against the real packaged app,
// not only the fake-driven unit tests. Unavailable unless SOLITH_TEST_BUILD=1
// is set in the process env — normal packaged launches never set this, so
// the setter throws and no step is ever forced to fail.
const IS_TEST_BUILD = process.env.SOLITH_TEST_BUILD === '1';
const testForcedCleanupFailureSteps = IS_TEST_BUILD ? new Set<string>() : undefined;

export function __setTestForcedCleanupFailureStep(step: string): void {
  if (!testForcedCleanupFailureSteps) {
    throw new Error('__setTestForcedCleanupFailureStep is only available when SOLITH_TEST_BUILD=1.');
  }
  testForcedCleanupFailureSteps.add(step);
}

export function __clearTestForcedCleanupFailureSteps(): void {
  if (!testForcedCleanupFailureSteps) {
    throw new Error('__clearTestForcedCleanupFailureSteps is only available when SOLITH_TEST_BUILD=1.');
  }
  testForcedCleanupFailureSteps.clear();
}

if (IS_TEST_BUILD) {
  (globalThis as Record<string, unknown>).__solithSetTestForcedCleanupFailureStep =
    __setTestForcedCleanupFailureStep;
  (globalThis as Record<string, unknown>).__solithClearTestForcedCleanupFailureSteps =
    __clearTestForcedCleanupFailureSteps;
}

// Gate 2.3: the renderer/preload/IPC freeze propose -> issue-consent ->
// confirmed-start flow is now fully wired (see 'live-memory-freeze-propose',
// 'live-memory-freeze-issue-consent', and 'live-memory-freeze-start' above,
// and electron/preload.ts's liveMemoryFreezePropose/
// liveMemoryFreezeRequestConsent/liveMemoryFreezeStart). The Gate 2.2 Resume
// test-only __testStartFreezeForOwner hook that previously stood in for this
// broken path has been removed — packaged lifecycle tests now start freezes
// through the real production API surface instead.

function maybeThrowForTestInjectedCleanupFailure(step: string): void {
  if (testForcedCleanupFailureSteps?.has(step)) {
    throw new Error(`Gate 2.1 test-injected cleanup failure: ${step}`);
  }
}

function disposeSession(senderId: number, removeTrustedOwnership = false): CleanupResult | null {
  const existing = sessions.get(senderId);
  if (!existing) {
    clearSelectionsForWindow(senderId);
    revokeWriteConsentsForSession(String(senderId));
    if (removeTrustedOwnership) unregisterTrustedWindow(senderId);
    return null;
  }
  const result = runCleanup({
    ownerId: String(senderId),
    markRevoking: () => existing.session.beginCleanupRevocation(),
    blockFutureWrites: () => existing.session.beginCleanupRevocation(),
    revokeConsentTokens: () => {
      maybeThrowForTestInjectedCleanupFailure('revoke_consent_tokens');
      revokeWriteConsentsForSession(String(senderId));
    },
    revokePendingProposals: () => existing.session.revokePendingAuthorizationsForCleanup(),
    stopFreezeSchedulers: () => existing.session.stopFreezeForCleanup(),
    detachMemorySessions: () => {
      existing.correlationWatcher?.stop();
      existing.manager.setSnapshotListener(null);
      existing.session.detachMemoryForCleanup();
    },
    clearRollbackRecords: () => existing.session.clearRollbackRecordsForCleanup(),
    clearProcessSelections: () => clearSelectionsForWindow(senderId),
    removeTrustedWindowOwnership: () => { if (removeTrustedOwnership) unregisterTrustedWindow(senderId); },
    audit: (event) => existing.audit.append({ op: 'abort', reason: event }),
  });
  sessions.delete(senderId);
  if (sessions.size === 0) {
    resetAvowedWingdkBackupSession();
    setCrashReportContext(undefined);
  }
  return result;
}

export function disposeLiveMemorySessionForOwner(senderId: number): CleanupResult | null {
  return disposeSession(senderId, true);
}

/**
 * Disposes every active live-memory session (Batch B1.1) — call from
 * app.on('will-quit') so an active freeze/rollback ledger doesn't linger
 * past a graceful app shutdown signal (process termination would end it
 * either way, but this makes the teardown deterministic and observable
 * rather than implicit).
 */
export function disposeAllLiveMemorySessions(): CleanupResult[] {
  const results: CleanupResult[] = [];
  for (const senderId of Array.from(sessions.keys())) {
    const result = disposeSession(senderId, true);
    if (result) results.push(result);
  }
  clearWriteConsentStore();
  clearAllProcessSelections();
  clearAllTrustedWindows();
  return results;
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

/**
 * Real sender identity validation (Batch B1.1) — used by the 3 handlers this
 * batch targets (freeze propose/issue-consent/confirm, rollback). Beyond
 * `isDestroyed()`, this confirms the sender is a registered Solith window,
 * in its own main frame (not devtools/a child frame), still showing an
 * allowed Solith URL. See src/core/security/trusted-sender-registry.ts.
 */
function requireTrustedSender(event: IpcMainInvokeEvent): { ok: true } | { ok: false; reason: string } {
  const result = validateIpcSender(event, ['main']);
  if (!result.ok) return { ok: false, reason: result.reason ?? 'unknown' };
  return { ok: true };
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

function serializeTypedMatches(matches: Array<ScanMatch & { dataType?: string }>) {
  return matches.map((m) => ({
    address: m.address.toString(),
    value: m.value,
    ...(m.dataType ? { dataType: m.dataType } : {}),
  }));
}

function serializeScanResult(result: { matches: ScanMatch[]; regionsScanned: number; bytesScanned: number; truncated: boolean }) {
  return {
    matches: serializeMatches(result.matches),
    regionsScanned: result.regionsScanned,
    bytesScanned: result.bytesScanned,
    truncated: result.truncated,
  };
}

function serializeAutoMatrixResult(result: {
  buckets: Array<{
    mode: string;
    dataType: string;
    matches: Array<ScanMatch & { dataType?: string }>;
    regionsScanned: number;
    bytesScanned: number;
    truncated: boolean;
    skipped?: boolean;
    reason?: string;
  }>;
  unknown?: { regionsScanned: number; bytesScanned: number; truncated: boolean };
  totals: {
    buckets: number;
    matches: number;
    regionsScanned: number;
    bytesScanned: number;
    truncatedBuckets: number;
    skippedBuckets: number;
    unknownCaptured: boolean;
  };
  readOnly: boolean;
  executable: boolean;
}) {
  return {
    ...result,
    buckets: result.buckets.map((bucket) => ({
      ...bucket,
      matches: serializeTypedMatches(bucket.matches),
    })),
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

let injectorAuditSinkWired = false;
function ensureInjectorAuditSink(
  userDataRoot: string,
  setSink: (sink: ((entry: { at: string; op: 'propose' | 'confirm'; allowed: boolean; reason: string; proposalId?: string; exePath?: string; attachedExecutableName?: string; attachedPid?: number | null; spawnedPid?: number }) => void) | null) => void,
): void {
  if (injectorAuditSinkWired) return;
  const logPath = path.join(userDataRoot, 'logs', 'injector-audit.jsonl');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  setSink((entry) => {
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  });
  injectorAuditSinkWired = true;
}
