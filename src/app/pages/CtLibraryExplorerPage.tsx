import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { PageModuleHeader } from '../components/PageModuleHeader.js';
import type { CtLibraryGameSummary, CtLibrarySummaryIndex } from '../../core/ct-library/types.js';
import type { CtLibrarySearchResult } from '../../core/ct-library/search.js';
import type { CtZipCatalogEntry } from '../../core/registry/compile-ct-zip.js';
import {
  ctImportUiReducer,
  friendlyCtImportError,
  idleCtImportUiState,
} from '../../core/ct-library/import-state.js';
import { createCtImportSingleFlight } from '../../core/ct-library/import-single-flight.js';
import {
  evaluateCtLibraryEntryForPromotion,
  promoteCtLibraryEntry,
  type CtLibraryPromotionAttempt,
} from '../../core/ct-library/promote-bridge.js';
import styles from './CtLibraryExplorerPage.module.css';

type KindFilter = 'all' | 'pointer' | 'script' | 'aob';

interface SearchResponse {
  success: boolean;
  available: boolean;
  summary?: CtLibrarySummaryIndex;
  total: number;
  results: CtLibrarySearchResult[];
  error?: string;
}

interface DetailResponse {
  success: boolean;
  available: boolean;
  game?: CtLibraryGameSummary;
  tables: CtZipCatalogEntry[];
  error?: string;
}

interface CtZipPreviewResponse {
  success: boolean;
  jobId: string;
  archivePath?: string;
  filename?: string;
  totals?: CtZipCatalogEntry extends never ? never : {
    ctFiles: number;
    compiledTables: number;
    rejectedTables: number;
    pointers: number;
    scripts: number;
    aobSignatures: number;
    cheats: number;
  };
  rejected?: Array<{ archivePath: string; reason: string }>;
  games?: Array<{
    game: string;
    tableName: string;
    archivePath: string;
    counts: CtZipCatalogEntry['counts'];
  }>;
  error?: string;
  errorCode?: string;
}

function formatNumber(value: number | undefined): string {
  return (value ?? 0).toLocaleString();
}

function newImportJobId(): string {
  return `ct-library-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function tableForResult(tables: CtZipCatalogEntry[], result: CtLibrarySearchResult | null): CtZipCatalogEntry | null {
  if (!result) return null;
  return tables.find((table) => table.sourceSha256 === result.sourceSha256 && table.archivePath === result.archivePath) ?? null;
}

type CtLibraryCheat = CtZipCatalogEntry['cheats'][number];

function cheatForResult(table: CtZipCatalogEntry | null, result: CtLibrarySearchResult | null): CtLibraryCheat | null {
  if (!table || !result) return null;
  return table.cheats.find((cheat) => result.id === `${result.gameId}:${table.sourceSha256}:${cheat.id}`) ?? null;
}

type TrainerDeckReadUiState =
  | { status: 'idle' }
  | { status: 'reading' }
  | { status: 'value'; value: number; address: string }
  | { status: 'not_attached' }
  | { status: 'blocked'; reason: string }
  | { status: 'failed'; reason: string };

/** Plain-language translation of raw IPC block reasons — never surfaces raw internals by default. */
function describeBlockReason(reason: string): string {
  const known: Record<string, string> = {
    wrong_game_session: 'The currently attached game does not match this cheat\'s game.',
    session_not_game_bound: 'The current session is not bound to a known game — attach through the game catalog to enable reads.',
    unknown_game: 'This game is no longer in the CT library.',
    unknown_library_entry: 'This cheat entry could not be found in the CT library anymore.',
    malformed_library_entry_id: 'This cheat entry reference is malformed.',
    sender_invalid: 'This window is no longer valid.',
  };
  if (known[reason]) return known[reason];
  if (reason.startsWith('sender_rejected:')) return 'This window is not authorized to read live values.';
  // Anything else (adapter refusal reasons like "Malformed base offset", preflight
  // block codes, etc.) is already plain language from evaluateCtLibraryEntryForPromotion
  // / read-preflight.ts — passed through as-is rather than replaced with something vaguer.
  return reason;
}

type EntryStatusTone = 'ready' | 'oracle' | 'unsupported';

interface EntryStatus {
  label: string;
  tone: EntryStatusTone;
  explanation: string;
}

/** User-facing status for a library entry — plain language, no raw internal field names. */
function describeEntryStatus(cheat: CtLibraryCheat | null): EntryStatus {
  if (!cheat) {
    return { label: 'Unknown', tone: 'unsupported', explanation: 'No entry selected.' };
  }
  if (cheat.kind === 'aob') {
    return {
      label: 'AOB signature (scan-only)',
      tone: 'oracle',
      explanation: 'This is a byte-pattern signature, not a fixed address. It can locate code in memory but is not promotable to a Trainer Deck toggle yet.',
    };
  }
  if (cheat.kind === 'script') {
    const isLua = cheat.metadata?.scriptType === 'lua';
    return {
      label: isLua ? 'Lua script' : 'Script-dependent',
      tone: 'oracle',
      explanation: isLua
        ? 'This entry requires executing a Lua script. Solith never executes CT scripts, so it is reference-only.'
        : 'This entry requires running an Auto Assembler script. Solith never executes CT scripts, so it is reference-only.',
    };
  }
  // kind === 'pointer'
  const liveResolution = cheat.metadata?.liveResolution;
  if (!cheat.metadata) {
    return {
      label: 'Version unknown / legacy data',
      tone: 'unsupported',
      explanation: 'This entry was imported before Solith tracked resolver details. It has no module/offset information on file.',
    };
  }
  if (liveResolution === 'resolvable') {
    return {
      label: 'Native-ready',
      tone: 'ready',
      explanation: 'This entry has a real module and a stable offset. It can be promoted to a Trainer Deck toggle.',
    };
  }
  if (liveResolution === 'absolute_only') {
    return {
      label: 'Unsupported (session-only address)',
      tone: 'unsupported',
      explanation: 'This entry only has a raw memory address with no module, so it is not stable across game restarts and cannot be safely promoted.',
    };
  }
  return {
    label: 'Unsupported (incomplete resolver)',
    tone: 'unsupported',
    explanation: 'This entry is missing the module name or offset needed to locate it reliably.',
  };
}

function DetailPanel({
  result,
  detail,
}: {
  result: CtLibrarySearchResult | null;
  detail: DetailResponse | null;
}) {
  const table = tableForResult(detail?.tables ?? [], result);
  const cheat = cheatForResult(table, result);
  const metadata = cheat?.metadata;
  const [promotion, setPromotion] = useState<CtLibraryPromotionAttempt | null>(null);

  const eligibility = cheat ? evaluateCtLibraryEntryForPromotion(cheat) : null;

  const handlePromote = () => {
    if (!result || !table || !cheat) return;
    setPromotion(
      promoteCtLibraryEntry(
        { gameId: result.gameId, displayName: result.gameDisplayName },
        { tableName: table.tableName, archivePath: table.archivePath, sourceSha256: table.sourceSha256 },
        cheat,
      ),
    );
    setReadValueState({ status: 'idle' });
  };

  const [readValueState, setReadValueState] = useState<TrainerDeckReadUiState>({ status: 'idle' });

  const handleReadValue = async () => {
    if (!result) return;
    setReadValueState({ status: 'reading' });
    if (!window.electronAPI?.trainerDeckReadValue) {
      setReadValueState({ status: 'blocked', reason: 'Trainer Deck read bridge is unavailable outside the Electron shell.' });
      return;
    }
    try {
      const response = await window.electronAPI.trainerDeckReadValue({ libraryEntryId: result.id });
      if (response.status === 'value') {
        setReadValueState({ status: 'value', value: response.value, address: response.address });
      } else if (response.status === 'not_attached') {
        setReadValueState({ status: 'not_attached' });
      } else {
        setReadValueState({ status: 'blocked', reason: describeBlockReason(response.reason) });
      }
    } catch (error) {
      setReadValueState({ status: 'failed', reason: error instanceof Error ? error.message : String(error) });
    }
  };

  if (!result) {
    return (
      <section className={styles.detail} aria-label="CT Library detail">
        <h2>Select an entry</h2>
        <p className={styles.meta}>Cheat Engine tables are displayed as metadata only. Scripts are never executed here.</p>
      </section>
    );
  }

  const entryStatus = describeEntryStatus(cheat);

  return (
    <section className={styles.detail} aria-label="CT Library detail">
      <div className={styles.pillRow}>
        <span className={styles.safetyPill}>metadata-only</span>
        <span className={styles.safetyPill}>executable=false</span>
        <span className={styles.safetyPill}>L0</span>
      </div>
      <div className={`${styles.statusBanner} ${styles[`status_${entryStatus.tone}`]}`}>
        <strong>{entryStatus.label}</strong>
        <p className={styles.meta}>{entryStatus.explanation}</p>
      </div>
      <h2>{result.title}</h2>
      <p className={styles.meta}>{result.type.toUpperCase()} · {result.gameDisplayName}</p>
      <dl className={styles.kv}>
        <dt>Game</dt>
        <dd>{result.gameDisplayName}</dd>
        <dt>Table</dt>
        <dd>{result.tableName}</dd>
        <dt>Archive path</dt>
        <dd>{result.archivePath}</dd>
        <dt>Source hash</dt>
        <dd>{result.sourceSha256.slice(0, 16)}…</dd>
        <dt>Pointer records</dt>
        <dd>{formatNumber(table?.counts.pointers)}</dd>
        <dt>Scripts</dt>
        <dd>{formatNumber(table?.counts.scripts)}</dd>
        <dt>AOB signatures</dt>
        <dd>{formatNumber(table?.counts.aobSignatures)}</dd>
        <dt>Rejections</dt>
        <dd>{formatNumber(table?.counts.rejections)}</dd>
        <dt>Warnings</dt>
        <dd>{formatNumber(table?.counts.warnings)}</dd>
      </dl>
      {table?.rejectedEntries && table.rejectedEntries.length > 0 && (
        <section className={styles.rejectionReport} aria-label="CT rejection report">
          <h3>Rejection report</h3>
          <p className={styles.meta}>Rejected entries remain metadata-only and are not promoted to executable controls.</p>
          <ul>
            {table.rejectedEntries.slice(0, 6).map((entry, index) => (
              <li key={`${entry.name}-${index}`}>
                <strong>{entry.name}</strong>
                <span>{entry.rejection_reason ?? entry.reason}</span>
              </li>
            ))}
          </ul>
          {table.rejectedEntries.length > 6 && (
            <p className={styles.meta}>Showing 6 of {formatNumber(table.rejectedEntries.length)} rejected entries.</p>
          )}
        </section>
      )}
      {metadata && (
        <details className={styles.metadataPanel}>
          <summary>Technical details (module, offsets, raw pattern)</summary>
          {result.type === 'aob' && (
            <dl className={styles.kv}>
              <dt>Symbol</dt>
              <dd>{metadata.symbol ?? result.title}</dd>
              <dt>Scan type</dt>
              <dd>{metadata.scanType ?? 'unknown'}</dd>
              <dt>Module</dt>
              <dd>{metadata.moduleName ?? 'module-less / process-wide'}</dd>
              <dt>Pattern</dt>
              <dd><code>{metadata.pattern ?? 'not available'}</code></dd>
              <dt>Source entry</dt>
              <dd>{metadata.sourceEntry ?? 'unknown'}</dd>
              <dt>Line</dt>
              <dd>{formatNumber(metadata.lineNumber)}</dd>
              <dt>Completeness</dt>
              <dd>{metadata.completeness ?? 'unknown'}</dd>
              <dt>Warnings</dt>
              <dd>{metadata.warnings?.length ? metadata.warnings.join('; ') : 'none'}</dd>
            </dl>
          )}
          {result.type === 'pointer' && (
            <dl className={styles.kv}>
              <dt>Data type</dt>
              <dd>{metadata.dataType ?? 'unknown'}</dd>
              <dt>Module</dt>
              <dd>{metadata.moduleName ?? 'unknown'}</dd>
              <dt>Raw address</dt>
              <dd><code>{metadata.rawAddress ?? 'not available'}</code></dd>
              <dt>Base offset</dt>
              <dd><code>{metadata.baseOffset ?? 'not restart-stable'}</code></dd>
              <dt>Pointer chain</dt>
              <dd>{metadata.pointerChain?.length ? metadata.pointerChain.map((offset) => `0x${offset.toString(16)}`).join(' → ') : 'none'}</dd>
              <dt>Resolution</dt>
              <dd>{metadata.liveResolution ?? 'metadata-only'}</dd>
            </dl>
          )}
          {result.type === 'script' && (
            <dl className={styles.kv}>
              <dt>Script type</dt>
              <dd>{metadata.scriptType ?? 'unknown'}</dd>
              <dt>Excerpt</dt>
              <dd><code>{metadata.scriptExcerpt ?? 'not available'}</code></dd>
            </dl>
          )}
        </details>
      )}
      {result.type === 'pointer' && eligibility && (
        <div className={styles.promotionPanel} aria-label="Trainer Deck promotion">
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={!eligibility.eligible}
            onClick={handlePromote}
            title={eligibility.eligible ? undefined : eligibility.reason}
          >
            Add to Trainer Deck
          </button>
          {!eligibility.eligible && <p className={styles.meta}>Not promotable: {eligibility.reason}</p>}
          {promotion?.eligible && (
            <dl className={styles.kv}>
              <dt>Promoted card</dt>
              <dd>{promotion.result.card.label}</dd>
              <dt>Freeze-eligible</dt>
              <dd>{String(promotion.result.card.freezeEligible)}</dd>
              <dt>Data type</dt>
              <dd>{promotion.result.card.dataType}</dd>
              <dt>Module</dt>
              <dd>{promotion.result.card.moduleName}</dd>
              <dt>Base offset</dt>
              <dd><code>{promotion.result.card.baseOffset}</code></dd>
              <dt>Pointer chain</dt>
              <dd>{promotion.result.card.pointerChain.map((o) => `0x${o.toString(16)}`).join(' → ') || 'none'}</dd>
            </dl>
          )}
          {promotion && !promotion.eligible && <p className={styles.meta}>Promotion refused: {promotion.reason}</p>}
          <p className={styles.meta}>
            This builds an in-memory trainer definition and Trainer Deck card model only — it never attaches to a
            process or writes memory.
          </p>
          {promotion?.eligible && (
            <div className={styles.readValuePanel} aria-label="Trainer Deck read value">
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => void handleReadValue()}
                disabled={readValueState.status === 'reading'}
              >
                {readValueState.status === 'reading' ? 'Reading…' : 'Read value'}
              </button>
              {readValueState.status === 'not_attached' && (
                <p className={styles.meta}>Not attached — attach to the game first to read its current value.</p>
              )}
              {readValueState.status === 'value' && (
                <p className={styles.meta}>
                  Current value: <strong>{readValueState.value}</strong>
                </p>
              )}
              {readValueState.status === 'blocked' && (
                <p className={styles.meta}>Blocked: {readValueState.reason}</p>
              )}
              {readValueState.status === 'failed' && (
                <p className={styles.meta}>Read failed: {readValueState.reason}</p>
              )}
              <details className={styles.metadataPanel}>
                <summary>Technical details</summary>
                <dl className={styles.kv}>
                  <dt>Library entry id</dt>
                  <dd><code>{result.id}</code></dd>
                  {readValueState.status === 'value' && (
                    <>
                      <dt>Resolved address</dt>
                      <dd><code>{readValueState.address}</code></dd>
                    </>
                  )}
                </dl>
              </details>
            </div>
          )}
        </div>
      )}
      <p className={styles.safety}>
        This explorer does not attach to a process, run Auto Assembler, download trainers, or write memory.
        Pointers and AOB signatures shown here are research metadata only and are not bound to LiveWatch execution paths.
      </p>
    </section>
  );
}

export default function CtLibraryExplorerPage() {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [gameId, setGameId] = useState('all');
  const [summary, setSummary] = useState<CtLibrarySummaryIndex | null>(null);
  const [results, setResults] = useState<CtLibrarySearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [importState, dispatchImport] = useReducer(ctImportUiReducer, idleCtImportUiState);
  const [pendingPreview, setPendingPreview] = useState<CtZipPreviewResponse | null>(null);
  const [pendingSelectionId, setPendingSelectionId] = useState<string | null>(null);
  const importSingleFlight = useRef(createCtImportSingleFlight()).current;

  const selected = useMemo(
    () => results.find((result) => result.id === selectedId) ?? results[0] ?? null,
    [results, selectedId],
  );

  const load = useCallback(async () => {
    if (!window.electronAPI?.ctLibrarySearch) {
      setMessage('CT Library Explorer is unavailable outside the Electron shell.');
      return;
    }
    setLoading(true);
    try {
      const response = await window.electronAPI.ctLibrarySearch({
        query,
        kind,
        gameId: gameId === 'all' ? undefined : gameId,
        limit: 100,
        offset: 0,
      }) as SearchResponse;
      if (!response.success) {
        setMessage(response.error ?? 'CT Library search failed.');
        setResults([]);
        return;
      }
      setSummary(response.summary ?? null);
      setResults(response.results ?? []);
      setTotal(response.total ?? 0);
      setSelectedId(response.results?.[0]?.id ?? null);
      setMessage(response.available ? '' : 'No CT Library metadata has been imported yet.');
    } finally {
      setLoading(false);
    }
  }, [gameId, kind, query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return window.electronAPI?.onCtLibraryImportProgress?.((progress) => {
      dispatchImport({ type: 'progress', progress });
    });
  }, []);

  useEffect(() => {
    if (!selected || !window.electronAPI?.ctLibraryGameDetail) {
      setDetail(null);
      return;
    }
    void (async () => {
      const response = await window.electronAPI.ctLibraryGameDetail({ gameId: selected.gameId }) as DetailResponse;
      setDetail(response);
    })();
  }, [selected]);

  const games = summary?.games ?? [];

  const handlePickZipForPreview = async () => {
    await importSingleFlight.run(async () => {
    const api = window.electronAPI;
    if (!api?.ctLibraryPickZip || !api?.ctLibraryImportZipPreview) {
      setMessage('CT ZIP import is unavailable outside the Electron shell.');
      return;
    }
    const picked = await api.ctLibraryPickZip();
    if (picked.status === 'cancelled') return;
    if (picked.status === 'error') {
      setMessage(friendlyCtImportError(picked.errorCode, picked.error));
      return;
    }
    const jobId = newImportJobId();
    dispatchImport({ type: 'start', jobId, label: 'Building Preview...' });
    setPendingPreview(null);
    setPendingSelectionId(null);
    setMessage('');
    try {
      const result = await api.ctLibraryImportZipPreview({ selectionId: picked.selectionId, jobId }) as CtZipPreviewResponse;
      if (result.success) {
        dispatchImport({
          type: 'complete',
          progress: {
            jobId,
            phase: 'complete',
            label: 'Preview Ready.',
            processedTables: result.totals?.compiledTables,
            totalTables: result.totals?.ctFiles,
          },
        });
        setPendingPreview(result);
        setPendingSelectionId(picked.selectionId);
        setMessage(
          `Preview ready — ${formatNumber(result.totals?.compiledTables)} tables, ${formatNumber(result.totals?.cheats)} metadata entries. Confirm Import to persist.`,
        );
      } else {
        dispatchImport({
          type: result.errorCode === 'ABORT_ERR' ? 'cancelled' : 'failed',
          errorCode: result.errorCode,
          errorMessage: result.error,
        });
        setMessage(friendlyCtImportError(result.errorCode, result.error));
      }
    } catch (error) {
      dispatchImport({ type: 'failed', errorCode: 'PREVIEW_FAILED', errorMessage: String(error) });
      setMessage(friendlyCtImportError('PREVIEW_FAILED', String(error)));
    }
    });
  };

  const handleConfirmImportZip = async () => {
    await importSingleFlight.run(async () => {
    const api = window.electronAPI;
    if (!api?.ctLibraryImportZipStart || !pendingSelectionId) {
      setMessage('No CT ZIP preview is ready to confirm.');
      return;
    }
    const confirmed = window.confirm(
      'Confirm metadata-only CT ZIP import? Solith will persist parsed pointers, scripts, AOBs, rejections, and warnings. It will not execute CT scripts or attach to a process.',
    );
    if (!confirmed) {
      setMessage('CT ZIP import declined. Preview wrote no catalog records.');
      return;
    }
    const jobId = newImportJobId();
    dispatchImport({ type: 'start', jobId, label: 'Writing Metadata Catalog...' });
    setMessage('');
    try {
      const result = await api.ctLibraryImportZipStart({ selectionId: pendingSelectionId, jobId });
      if (result.success) {
        dispatchImport({
          type: 'complete',
          progress: {
            jobId,
            phase: 'complete',
            label: 'Import Complete.',
            processedTables: result.totals?.compiledTables,
            totalTables: result.totals?.ctFiles,
          },
        });
        setMessage(
          `Imported CT library archive — ${formatNumber(result.totals?.compiledTables)} tables, ${formatNumber(result.totals?.cheats)} metadata entries.`,
        );
        setPendingPreview(null);
        setPendingSelectionId(null);
        await load();
      } else {
        dispatchImport({
          type: result.errorCode === 'ABORT_ERR' ? 'cancelled' : 'failed',
          errorCode: result.errorCode,
          errorMessage: result.error,
        });
        setMessage(friendlyCtImportError(result.errorCode, result.error));
      }
    } catch (error) {
      dispatchImport({ type: 'failed', errorMessage: String(error) });
      setMessage(friendlyCtImportError(null, String(error)));
    }
    });
  };

  const handleDeclineImportZip = () => {
    setPendingPreview(null);
    setPendingSelectionId(null);
    dispatchImport({ type: 'reset' });
    setMessage('CT ZIP import declined. Preview wrote no catalog records.');
  };

  const handleCancelImport = async () => {
    if (!importState.jobId) return;
    await window.electronAPI?.ctLibraryImportZipCancel?.({ jobId: importState.jobId });
  };

  return (
    <main className={styles.page}>
      <PageModuleHeader
        artwork="hoodedProfile"
        title="CT Library Explorer"
        description="Search and inspect compiled Cheat Engine table metadata without executing scripts or touching a live process."
        walkthroughId="ct-library"
        actions={
          <div className={styles.headerActions}>
            <button
              id="ct-library-import-zip"
              type="button"
              className={styles.primaryBtn}
              onClick={() => void handlePickZipForPreview()}
              disabled={importState.status === 'running'}
            >
              Import CT ZIP
            </button>
          </div>
        }
      />

      {importState.status !== 'idle' && (
        <section
          className={`${styles.importPanel} ${importState.status === 'failed' ? styles.importPanelError : ''}`}
          aria-live="polite"
          aria-labelledby="ct-library-import-heading"
        >
          <div>
            <h2 id="ct-library-import-heading">CT Library Import</h2>
            <p>{importState.errorMessage ?? importState.progress?.label ?? 'Preparing metadata-only import...'}</p>
            {typeof importState.progress?.processedTables === 'number' && (
              <small>
                Tables processed: {importState.progress.processedTables}
                {typeof importState.progress.totalTables === 'number'
                  ? ` / ${importState.progress.totalTables}`
                  : ''}
              </small>
            )}
          </div>
          <div className={styles.importActions}>
            {importState.status === 'running' && (
              <button type="button" className={styles.cancelBtn} onClick={() => void handleCancelImport()}>
                Cancel Import
              </button>
            )}
            {(importState.status === 'failed' || importState.status === 'cancelled' || importState.status === 'complete') && (
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => {
                  dispatchImport({ type: 'reset' });
                  setPendingPreview(null);
                  setPendingSelectionId(null);
                  void handlePickZipForPreview();
                }}
              >
                Retry / Import Another ZIP
              </button>
            )}
          </div>
        </section>
      )}

      {pendingPreview?.success && (
        <section className={styles.importPanel} aria-label="CT ZIP import preview">
          <div>
            <h2>Preview: {pendingPreview.filename ?? 'CT ZIP archive'}</h2>
            <p>
              Nothing has been written yet. Review the metadata summary, then confirm or decline the import.
            </p>
            <small>
              CT files: {formatNumber(pendingPreview.totals?.ctFiles)}
              {' · '}Compiled: {formatNumber(pendingPreview.totals?.compiledTables)}
              {' · '}Rejected: {formatNumber(pendingPreview.totals?.rejectedTables)}
              {' · '}Cheats: {formatNumber(pendingPreview.totals?.cheats)}
              {' · '}Pointers: {formatNumber(pendingPreview.totals?.pointers)}
              {' · '}Scripts: {formatNumber(pendingPreview.totals?.scripts)}
              {' · '}AOBs: {formatNumber(pendingPreview.totals?.aobSignatures)}
            </small>
            {(pendingPreview.games?.length ?? 0) > 0 && (
              <small>
                Preview sample: {pendingPreview.games!.slice(0, 5).map((entry) => entry.game).join(', ')}
                {pendingPreview.games!.length > 5 ? '…' : ''}
              </small>
            )}
            {(pendingPreview.rejected?.length ?? 0) > 0 && (
              <small>
                Rejections: {pendingPreview.rejected!.slice(0, 3).map((entry) => `${entry.archivePath}: ${entry.reason}`).join(' | ')}
                {pendingPreview.rejected!.length > 3 ? '…' : ''}
              </small>
            )}
          </div>
          <div className={styles.importActions}>
            <button type="button" className={styles.primaryBtn} onClick={() => void handleConfirmImportZip()}>
              Confirm Import
            </button>
            <button type="button" className={styles.cancelBtn} onClick={handleDeclineImportZip}>
              Decline
            </button>
          </div>
        </section>
      )}

      <section className={styles.summaryGrid} aria-label="CT Library summary">
        <div className={styles.card}><span>CT files</span><strong>{formatNumber(summary?.totals.ctFiles)}</strong></div>
        <div className={styles.card}><span>Games</span><strong>{formatNumber(summary?.games.length)}</strong></div>
        <div className={styles.card}><span>Cheats</span><strong>{formatNumber(summary?.totals.cheats)}</strong></div>
        <div className={styles.card}><span>Pointers</span><strong>{formatNumber(summary?.totals.pointers)}</strong></div>
        <div className={styles.card}><span>Scripts</span><strong>{formatNumber(summary?.totals.scripts)}</strong></div>
        <div className={styles.card}><span>AOBs</span><strong>{formatNumber(summary?.totals.aobSignatures)}</strong></div>
      </section>

      <section className={styles.toolbar} aria-label="CT Library filters">
        <label>
          Search table, game, cheat, AOB, or script name
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="health, gold, aob, Avowed..."
          />
        </label>
        <label>
          Game
          <select value={gameId} onChange={(event) => setGameId(event.target.value)}>
            <option value="all">All games</option>
            {games.slice(0, 1000).map((game) => (
              <option key={game.gameId} value={game.gameId}>
                {game.displayName} ({formatNumber(game.cheatCount)})
              </option>
            ))}
          </select>
        </label>
        <label>
          Entry type
          <select value={kind} onChange={(event) => setKind(event.target.value as KindFilter)}>
            <option value="all">All metadata</option>
            <option value="pointer">Pointers</option>
            <option value="script">Scripts</option>
            <option value="aob">AOB signatures</option>
          </select>
        </label>
      </section>

      {message && <p className={styles.empty}>{message}</p>}

      <div className={styles.layout}>
        <section className={styles.results} aria-label="CT Library results">
          <h2>{loading ? 'Searching…' : `Matches ${formatNumber(results.length)} / ${formatNumber(total)}`}</h2>
          <div className={styles.resultList}>
            {results.map((result) => (
              <button
                key={result.id}
                type="button"
                className={styles.resultRow}
                aria-pressed={selected?.id === result.id}
                onClick={() => setSelectedId(result.id)}
              >
                <span className={styles.pillRow}>
                  <span className={styles.pill}>{result.type}</span>
                  <span className={styles.safetyPill}>metadata-only</span>
                </span>
                <strong>{result.title}</strong>
                <span className={styles.meta}>{result.gameDisplayName} · {result.tableName}</span>
              </button>
            ))}
            {!loading && results.length === 0 && (
              <p className={styles.empty}>No metadata entries matched these filters.</p>
            )}
          </div>
        </section>
        <DetailPanel key={selected?.id ?? 'none'} result={selected} detail={detail} />
      </div>
    </main>
  );
}
