import React, { useEffect, useRef, useState } from 'react';
import type { SolithDefinitionV1 } from '../../core/definitions/schema.v1.js';
import styles from './PublishDefinitionModal.module.css';

export function PublishDefinitionModal({
  definition,
  onClose,
  onPublished,
}: {
  definition: SolithDefinitionV1;
  onClose: () => void;
  onPublished: (id: string) => void;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const mountedRef = useRef(true);
  const onCloseRef = useRef(onClose);
  const submittingRef = useRef(false);
  onCloseRef.current = onClose;

  const [executableHash, setExecutableHash] = useState(definition.targetSHA256 ?? '');
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const hashValid = /^[a-f0-9]{64}$/i.test(executableHash);
  submittingRef.current = submitting;

  useEffect(() => {
    mountedRef.current = true;
    previousFocusRef.current = document.activeElement as HTMLElement;
    const overlay = overlayRef.current;
    const selector =
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
    overlay?.querySelector<HTMLElement>(selector)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (!overlay) return;
      if (event.key === 'Escape' && !submittingRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = overlay.querySelectorAll<HTMLElement>(selector);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      mountedRef.current = false;
      document.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, []);

  const publish = async () => {
    if (!hashValid || !accepted || submittingRef.current) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await window.electronAPI.publishToCommunity({
        definition,
        executableHash,
      });
      if (!mountedRef.current) return;
      if (!result.success || !result.published) {
        setError(
          result.error === 'community_sync_disabled'
            ? 'Enable Community Sync in Settings before publishing.'
            : result.error ?? 'Publishing failed.',
        );
        return;
      }
      onPublished(result.published.id);
    } catch {
      if (!mountedRef.current) return;
      setError('Publishing failed. Check your connection and try again.');
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  };

  return (
    <div
      ref={overlayRef}
      className="dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-definition-title"
      aria-describedby="publish-definition-description"
      onClick={() => { if (!submittingRef.current) onCloseRef.current(); }}
    >
      <div className={`dialog-box ${styles.modal}`} onClick={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <h3 id="publish-definition-title">Publish community definition</h3>
          <button
            type="button"
            className="dialog-close"
            onClick={() => onCloseRef.current()}
            disabled={submitting}
            aria-label="Close publish definition dialog"
          >
            ✕
          </button>
        </div>
        <div className="dialog-body">
          <p id="publish-definition-description">
            Review the definition before it is submitted to the Solith Definition Hub as
            unverified community research.
          </p>
          <dl className={styles.summary}>
            <div><dt>Game</dt><dd>{definition.title}</dd></div>
            <div><dt>Executable</dt><dd>{definition.target.executables.join(', ')}</dd></div>
            <div><dt>Memory features</dt><dd>{definition.memoryFeatures?.length ?? 0}</dd></div>
            <div><dt>Certification</dt><dd>Community (Scan Required)</dd></div>
          </dl>
          <label className={styles.field}>
            Target game executable SHA-256
            <input
              value={executableHash}
              onChange={(event) => setExecutableHash(event.target.value.trim())}
              placeholder="64 hexadecimal characters"
              spellCheck={false}
              aria-invalid={executableHash.length > 0 && !hashValid}
            />
          </label>
          <p className={styles.hint}>
            Use the game executable hash, not the external trainer hash. Absolute user paths,
            author identity, and certification claims are removed by the Electron main process.
          </p>
          <label className={styles.disclaimer}>
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
            />
            I confirm this is my own research, contains no personal data, targets offline or
            single-player use only, and will be published as unverified L0 community data.
          </label>
          {error && <p className={styles.error} role="alert">{error}</p>}
        </div>
        <div className="dialog-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onCloseRef.current()}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void publish()}
            disabled={!hashValid || !accepted || submitting}
          >
            {submitting ? 'Publishing…' : 'Publish as L0 Community'}
          </button>
        </div>
      </div>
    </div>
  );
}
