import React, { useMemo, useState } from 'react';
import type {
  CorrelationCandidate,
  CorrelationCandidateState,
  CorrelationDirection,
  CorrelationReport,
  PlayerCorrelationEvent,
} from '../../core/live-memory/live-correlation-watcher.js';
import { buildOcrCorrelationEvent } from '../../core/ocr/local-ocr.js';

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
  appIconDataUrl?: string;
}

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
            <img src={selectedOcrSource.thumbnailDataUrl} alt={`Preview of ${selectedOcrSource.name}`} />
            <div className="live-correlation-ocr-controls">
              <div className="live-correlation-roi-grid">
                {(['x', 'y', 'width', 'height'] as const).map((key) => (
                  <label key={key}>
                    ROI {key}
                    <input
                      type="number"
                      min={0}
                      value={ocrRoi[key]}
                      onChange={(event) =>
                        setOcrRoi((current) => ({ ...current, [key]: Math.max(0, Number(event.target.value) || 0) }))
                      }
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
