import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CorrelationCandidate,
  CorrelationCandidateState,
  CorrelationDirection,
  CorrelationReport,
  PlayerCorrelationEvent,
} from '../../core/live-memory/live-correlation-watcher.js';
import {
  buildOcrCorrelationEvent,
  scaleDisplayRoiToCapture,
  type OcrRegionOfInterest,
} from '../../core/ocr/local-ocr.js';

type CorrelationEventKind = PlayerCorrelationEvent['kind'];

interface LiveCorrelationWatcherPanelProps {
  attached: boolean;
  busy: boolean;
  scanMatches: Array<{ address: string; value: number; dataType?: string; scanMode?: string }>;
  fallbackDataType: string;
  report: CorrelationReport | null;
  active: boolean;
  flashEvent: string | null;
  onStart: (candidates: CorrelationCandidate[]) => void;
  onStop: () => void;
  onEvent: (event: PlayerCorrelationEvent) => void;
}

const EVENT_BUTTONS: Array<{
  kind: CorrelationEventKind;
  label: string;
  icon: string;
  expectedDirection: CorrelationDirection;
}> = [
  { kind: 'took_damage', label: 'Took Damage', icon: '⚔️', expectedDirection: 'decreased' },
  { kind: 'healed', label: 'Healed', icon: '🧪', expectedDirection: 'increased' },
  { kind: 'used_stamina', label: 'Used Stamina', icon: '🏃', expectedDirection: 'decreased' },
  { kind: 'recovered_stamina', label: 'Recovered Stamina', icon: '🫁', expectedDirection: 'increased' },
  { kind: 'spent_resource', label: 'Spent Resource', icon: '💰', expectedDirection: 'decreased' },
  { kind: 'gained_resource', label: 'Gained Resource', icon: '💎', expectedDirection: 'increased' },
  { kind: 'used_item', label: 'Used Item', icon: '🎒', expectedDirection: 'decreased' },
  { kind: 'collected_loot', label: 'Collected Loot', icon: '📦', expectedDirection: 'increased' },
];

const MAX_WATCH_CANDIDATES = 500;

interface OcrSource {
  id: string;
  name: string;
  thumbnailDataUrl: string;
  thumbnailSize?: { width: number; height: number };
  captureSize?: { width: number; height: number };
  appIconDataUrl?: string;
}

interface SavedOcrRegion {
  id: string;
  name: string;
  roi: OcrRegionOfInterest;
}

const OCR_REGION_STORAGE_KEY = 'solith:ocr-regions:v1';
const DEFAULT_CAPTURE_SIZE = { width: 1920, height: 1080 };
const OCR_REGION_PRESETS = ['Health', 'Essence', 'Stamina', 'XP', 'Gold', 'Weight', 'Item Count'];

export default function LiveCorrelationWatcherPanel({
  attached,
  busy,
  scanMatches,
  fallbackDataType,
  report,
  active,
  flashEvent,
  onStart,
  onStop,
  onEvent,
}: LiveCorrelationWatcherPanelProps) {
  const [expectedDelta, setExpectedDelta] = useState('');
  const [customLabel, setCustomLabel] = useState('');
  const [customDirection, setCustomDirection] = useState<CorrelationDirection>('changed');
  const [showNoise, setShowNoise] = useState(false);
  const [ocrSources, setOcrSources] = useState<OcrSource[]>([]);
  const [ocrSourceId, setOcrSourceId] = useState('');
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrMessage, setOcrMessage] = useState('');
  const [ocrRoi, setOcrRoi] = useState({ x: 0, y: 0, width: 420, height: 120 });
  const [lastOcrValue, setLastOcrValue] = useState<number | null>(null);
  const [ocrRegionName, setOcrRegionName] = useState('Health');
  const [savedOcrRegions, setSavedOcrRegions] = useState<SavedOcrRegion[]>([]);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setSavedOcrRegions(loadSavedOcrRegions());
  }, []);

  const candidates = useMemo<CorrelationCandidate[]>(() => {
    const seen = new Set<string>();
    const mapped: CorrelationCandidate[] = [];
    for (const match of scanMatches) {
      const dataType = match.dataType ?? fallbackDataType;
      const key = `${match.address}:${dataType}:${match.scanMode ?? 'scan'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      mapped.push({
        id: key,
        address: match.address,
        value: match.value,
        dataType: dataType as CorrelationCandidate['dataType'],
        source: 'auto-scan',
        scanMode: match.scanMode ?? 'narrowed',
        label: `${dataType}${match.scanMode ? ` · ${match.scanMode}` : ''}`,
      });
      if (mapped.length >= MAX_WATCH_CANDIDATES) break;
    }
    return mapped;
  }, [fallbackDataType, scanMatches]);

  const emitEvent = (base: Omit<PlayerCorrelationEvent, 'expectedDelta' | 'observedAt'>) => {
    const parsedDelta = expectedDelta.trim() ? Number(expectedDelta) : undefined;
    onEvent({
      ...base,
      expectedDelta: Number.isFinite(parsedDelta) ? parsedDelta : undefined,
      lookbackMs: 1500,
      observedAt: new Date().toISOString(),
    });
  };

  const disabled = busy || !attached;
  const canStart = !disabled && candidates.length > 0 && !active;
  const selectedOcrSource = ocrSources.find((source) => source.id === ocrSourceId);
  const captureSize = selectedOcrSource?.captureSize ?? DEFAULT_CAPTURE_SIZE;

  const refreshOcrSources = async () => {
    const api = window.electronAPI;
    setOcrBusy(true);
    setOcrMessage('');
    try {
      const result = await api.localOcrListWindowSources();
      if (result?.success) {
        setOcrSources(result.sources ?? []);
        setOcrSourceId((current) => current || result.sources?.[0]?.id || '');
      } else {
        setOcrMessage(`OCR source list failed: ${result?.error ?? 'unknown error'}`);
      }
    } finally {
      setOcrBusy(false);
    }
  };

  const runOcrTieBreak = async () => {
    if (!ocrSourceId) return;
    const api = window.electronAPI;
    setOcrBusy(true);
    setOcrMessage('Running local OCR on selected window ROI...');
    try {
      const result = await api.localOcrReadWindowRegion({ sourceId: ocrSourceId, roi: ocrRoi });
      if (!result?.success || !result.result) {
        setOcrMessage(`OCR failed: ${result?.error ?? 'unknown error'}`);
        return;
      }
      setLastOcrValue(result.result.value);
      if (result.result.value == null) {
        setOcrMessage(`OCR read "${result.result.normalizedText || result.result.text.trim()}" but found no numeric value.`);
        return;
      }
      const event = buildOcrCorrelationEvent(result.result);
      if (event) onEvent(event);
      setOcrMessage(`OCR observed ${result.result.value} from ${result.sourceName ?? 'selected window'} and sent a read-only tie-break event.`);
    } finally {
      setOcrBusy(false);
    }
  };

  const setRoiField = (key: keyof OcrRegionOfInterest, value: number) => {
    setOcrRoi((current) => ({
      ...current,
      [key]: Math.max(key === 'width' || key === 'height' ? 1 : 0, Math.round(value) || 0),
    }));
  };

  const pointerToDisplayPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width),
      y: Math.min(Math.max(event.clientY - bounds.top, 0), bounds.height),
      bounds,
    };
  };

  const startRoiDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!selectedOcrSource || ocrBusy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointerToDisplayPoint(event);
    dragStartRef.current = { x: point.x, y: point.y };
    const roi = scaleDisplayRoiToCapture(
      { x: point.x, y: point.y, width: 1, height: 1 },
      { width: point.bounds.width, height: point.bounds.height },
      captureSize,
    );
    setOcrRoi(roi);
  };

  const updateRoiDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current || !selectedOcrSource || ocrBusy) return;
    const point = pointerToDisplayPoint(event);
    const x = Math.min(dragStartRef.current.x, point.x);
    const y = Math.min(dragStartRef.current.y, point.y);
    const width = Math.max(Math.abs(point.x - dragStartRef.current.x), 1);
    const height = Math.max(Math.abs(point.y - dragStartRef.current.y), 1);
    const roi = scaleDisplayRoiToCapture(
      { x, y, width, height },
      { width: point.bounds.width, height: point.bounds.height },
      captureSize,
    );
    setOcrRoi(roi);
  };

  const endRoiDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      dragStartRef.current = null;
      setOcrMessage('OCR region selected. Run OCR tie-break or save this region for reuse.');
    }
  };

  const saveCurrentOcrRegion = () => {
    const name = ocrRegionName.trim() || 'OCR Region';
    const nextRegion: SavedOcrRegion = {
      id: slugifyRegionName(name),
      name,
      roi: ocrRoi,
    };
    setSavedOcrRegions((current) => {
      const next = [nextRegion, ...current.filter((region) => region.id !== nextRegion.id)].slice(0, 24);
      saveSavedOcrRegions(next);
      return next;
    });
    setOcrMessage(`Saved OCR region "${name}" locally on this machine.`);
  };

  const loadCurrentOcrRegion = (regionId: string) => {
    const region = savedOcrRegions.find((candidate) => candidate.id === regionId);
    if (!region) return;
    setOcrRegionName(region.name);
    setOcrRoi(region.roi);
    setOcrMessage(`Loaded OCR region "${region.name}".`);
  };

  return (
    <section className="v2-monitor-section live-correlation-panel" aria-label="Read-only live correlation watcher">
      <div className="live-correlation-header">
        <div>
          <h3>AL Live Correlation Watcher <span className="v2-badge">Read-only</span></h3>
          <p className="v2-meta">
            Tracks scanned candidates against player-marked events using a recent-delta lookback window.
            It observes values only; it cannot write, freeze, or promote entries.
          </p>
        </div>
        <div className="v2-controls-row">
          {!active ? (
            <button className="btn-primary" type="button" onClick={() => onStart(candidates)} disabled={!canStart}>
              Start watcher
            </button>
          ) : (
            <button className="btn-secondary" type="button" onClick={onStop} disabled={busy}>
              Stop watcher
            </button>
          )}
        </div>
      </div>

      <p className="v2-meta">
        Candidate feed: {Math.min(scanMatches.length, MAX_WATCH_CANDIDATES)} of {scanMatches.length} scan result(s)
        {scanMatches.length > MAX_WATCH_CANDIDATES ? ' · capped for UI responsiveness' : ''}.
      </p>

      <div className="live-correlation-event-bar" aria-label="Player event triggers">
        <label htmlFor="correlation-delta">Optional exact delta</label>
        <input
          id="correlation-delta"
          type="number"
          value={expectedDelta}
          onChange={(event) => setExpectedDelta(event.target.value)}
          placeholder="e.g. 15"
          disabled={!active}
        />
        {EVENT_BUTTONS.map((event) => (
          <button
            key={event.kind}
            type="button"
            className={`btn-secondary live-correlation-event-button ${flashEvent === event.kind ? 'is-recording' : ''}`}
            onClick={() =>
              emitEvent({
                kind: event.kind,
                label: event.label,
                expectedDirection: event.expectedDirection,
              })
            }
            disabled={!active}
          >
            <span aria-hidden="true">{event.icon}</span> {event.label}
          </button>
        ))}
      </div>

      <div className="live-correlation-custom">
        <input
          type="text"
          value={customLabel}
          onChange={(event) => setCustomLabel(event.target.value)}
          placeholder="Custom event label"
          aria-label="Custom correlation event label"
          disabled={!active}
        />
        <select
          aria-label="Custom event expected direction"
          value={customDirection}
          onChange={(event) => setCustomDirection(event.target.value as CorrelationDirection)}
          disabled={!active}
        >
          <option value="changed">changed</option>
          <option value="increased">increased</option>
          <option value="decreased">decreased</option>
          <option value="unchanged">unchanged</option>
        </select>
        <button
          type="button"
          className={`btn-secondary live-correlation-event-button ${flashEvent === 'custom' ? 'is-recording' : ''}`}
          onClick={() =>
            emitEvent({
              kind: 'custom',
              label: customLabel.trim() || 'Custom event',
              expectedDirection: customDirection,
            })
          }
          disabled={!active}
        >
          Mark custom event
        </button>
      </div>

      {report ? (
        <>
          <div className="live-correlation-totals" role="status">
            <span>{report.totals.polls} polls</span>
            <span>{report.totals.events} events</span>
            <span>{report.totals.strong} strong</span>
            <span>{report.totals.moderate} moderate</span>
            <span>{report.totals.noise + report.totals.unreadable} noise/unreadable</span>
          </div>

          <CandidateSection title="Strong Confidence" candidates={report.strong} empty="No strong candidates yet." />
          <CandidateSection title="Moderate / Weak" candidates={[...report.moderate, ...report.weak]} empty="No middle-tier candidates yet." />

          <div className="v2-controls-row">
            <button type="button" className="btn-secondary" onClick={() => setShowNoise((value) => !value)}>
              {showNoise ? 'Hide noise' : 'Show noise / contradicted'}
            </button>
          </div>
          {showNoise && (
            <CandidateSection
              title="Noise / Unreadable"
              candidates={[...report.noise, ...report.unreadable]}
              empty="No quarantined candidates yet."
            />
          )}
        </>
      ) : (
        <p className="v2-meta">Run an auto scan first, then start the watcher to collect read-only correlation evidence.</p>
      )}

      <div className="live-correlation-ocr" aria-label="Local OCR fallback">
        <h4>AM Screen/OCR fallback <span className="v2-badge">Local only</span></h4>
        <p className="v2-meta">
          Use only when multiple candidates tie. Solith captures a selected app window ROI, reads numbers locally,
          and sends the value back as a read-only confidence tie-breaker.
        </p>
        <div className="v2-controls-row">
          <button type="button" className="btn-secondary" onClick={() => void refreshOcrSources()} disabled={ocrBusy}>
            Refresh window list
          </button>
          <select
            aria-label="OCR window source"
            value={ocrSourceId}
            onChange={(event) => setOcrSourceId(event.target.value)}
            disabled={ocrBusy || ocrSources.length === 0}
          >
            <option value="">Select a window…</option>
            {ocrSources.map((source) => (
              <option key={source.id} value={source.id}>{source.name}</option>
            ))}
          </select>
        </div>
        {selectedOcrSource && (
          <div className="live-correlation-ocr-layout">
            <div
              ref={previewRef}
              className="live-correlation-ocr-preview"
              role="application"
              aria-label="Drag to select OCR region"
              onPointerDown={startRoiDrag}
              onPointerMove={updateRoiDrag}
              onPointerUp={endRoiDrag}
              onPointerCancel={endRoiDrag}
            >
              <img src={selectedOcrSource.thumbnailDataUrl} alt={`Preview of ${selectedOcrSource.name}`} draggable={false} />
              <div className="live-correlation-ocr-roi" style={roiToPercentStyle(ocrRoi, captureSize)} />
              <span className="live-correlation-ocr-hint">Drag over visible numbers</span>
            </div>
            <div className="live-correlation-ocr-controls">
              <div className="live-correlation-region-row">
                <label>
                  Region name
                  <input
                    type="text"
                    value={ocrRegionName}
                    onChange={(event) => setOcrRegionName(event.target.value)}
                    disabled={ocrBusy}
                  />
                </label>
                <button type="button" className="btn-secondary" onClick={saveCurrentOcrRegion} disabled={ocrBusy}>
                  Save region
                </button>
              </div>
              <div className="live-correlation-region-presets" aria-label="OCR region presets">
                {OCR_REGION_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className="btn-secondary"
                    onClick={() => setOcrRegionName(preset)}
                    disabled={ocrBusy}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              {savedOcrRegions.length > 0 && (
                <select
                  aria-label="Saved OCR region"
                  defaultValue=""
                  onChange={(event) => loadCurrentOcrRegion(event.target.value)}
                  disabled={ocrBusy}
                >
                  <option value="">Load saved region…</option>
                  {savedOcrRegions.map((region) => (
                    <option key={region.id} value={region.id}>{region.name}</option>
                  ))}
                </select>
              )}
              <div className="live-correlation-roi-grid">
                {(['x', 'y', 'width', 'height'] as const).map((key) => (
                  <label key={key}>
                    ROI {key}
                    <input
                      type="number"
                      min={key === 'width' || key === 'height' ? 1 : 0}
                      value={ocrRoi[key]}
                      onChange={(event) => setRoiField(key, Number(event.target.value))}
                      disabled={ocrBusy}
                    />
                  </label>
                ))}
              </div>
              <button type="button" className="btn-secondary" onClick={() => void runOcrTieBreak()} disabled={ocrBusy || !active}>
                Run OCR tie-break
              </button>
              {lastOcrValue != null && <p className="v2-meta">Last OCR value: {lastOcrValue}</p>}
            </div>
          </div>
        )}
        {ocrMessage && <p className="v2-meta" role="status">{ocrMessage}</p>}
      </div>
    </section>
  );
}

function CandidateSection({
  title,
  candidates,
  empty,
}: {
  title: string;
  candidates: CorrelationCandidateState[];
  empty: string;
}) {
  return (
    <div className="live-correlation-section">
      <h4>{title}</h4>
      {candidates.length > 0 ? (
        <ul className="v2-scan-results live-correlation-candidates">
          {candidates.slice(0, 40).map((candidate) => (
            <li key={candidate.id ?? `${candidate.address}-${candidate.dataType}`}>
              <div className="live-correlation-candidate-row">
                <div>
                  <strong>{candidate.label ?? candidate.id ?? candidate.address}</strong>{' '}
                  <code>{candidate.address}</code>{' '}
                  <span className="v2-meta">
                    ({candidate.dataType}{candidate.scanMode ? ` · ${candidate.scanMode}` : ''})
                  </span>
                </div>
                <span className={`live-correlation-score score-${candidate.strength}`}>
                  {candidate.score}/100 · {candidate.strength}
                </span>
              </div>
              <div className="live-correlation-trail">
                values: {formatTrail(candidate.recentValues)}
                {candidate.recentDeltas.length > 0 ? ` · deltas: ${formatTrail(candidate.recentDeltas)}` : ''}
              </div>
              <div className="v2-meta">
                matched {candidate.matchedEvents} · contradicted {candidate.contradictedEvents} · changed {candidate.changedPolls}/{candidate.polls} poll(s)
              </div>
              {candidate.reasons.length > 0 && (
                <div className="v2-meta">why: {candidate.reasons.slice(0, 3).join(' · ')}</div>
              )}
            </li>
          ))}
          {candidates.length > 40 && <li className="v2-meta">…and {candidates.length - 40} more</li>}
        </ul>
      ) : (
        <p className="v2-meta">{empty}</p>
      )}
    </div>
  );
}

function formatTrail(values: number[]): string {
  if (values.length === 0) return '—';
  return values
    .slice(-6)
    .map((value) => Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, ''))
    .join(' → ');
}

function roiToPercentStyle(roi: OcrRegionOfInterest, captureSize: { width: number; height: number }): React.CSSProperties {
  const left = `${(roi.x / captureSize.width) * 100}%`;
  const top = `${(roi.y / captureSize.height) * 100}%`;
  const width = `${(roi.width / captureSize.width) * 100}%`;
  const height = `${(roi.height / captureSize.height) * 100}%`;
  return { left, top, width, height };
}

function loadSavedOcrRegions(): SavedOcrRegion[] {
  try {
    const raw = window.localStorage.getItem(OCR_REGION_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedOcrRegion).slice(0, 24);
  } catch {
    return [];
  }
}

function saveSavedOcrRegions(regions: SavedOcrRegion[]): void {
  try {
    window.localStorage.setItem(OCR_REGION_STORAGE_KEY, JSON.stringify(regions));
  } catch {
    // Local persistence is optional; OCR remains usable even if storage is unavailable.
  }
}

function isSavedOcrRegion(value: unknown): value is SavedOcrRegion {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as SavedOcrRegion;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    Boolean(candidate.roi) &&
    ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(candidate.roi[key as keyof OcrRegionOfInterest]))
  );
}

function slugifyRegionName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'ocr-region';
}
