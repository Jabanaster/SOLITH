import React, { useEffect, useState } from 'react';
import styles from './OnboardingWizard.module.css';
import { BrandingArtwork } from './BrandingArtwork.js';

type OnboardingStep = 'welcome' | 'library' | 'saves' | 'advanced' | 'done';

const STEPS: OnboardingStep[] = ['welcome', 'library', 'saves', 'advanced', 'done'];

export function OnboardingWizard({ onComplete }: { onComplete: () => void }) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && step !== 'done') onComplete();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onComplete, step]);

  const finish = async () => {
    await window.electronAPI?.setSetting?.('onboardingCompleted', true);
    onComplete();
  };

  const next = () => {
    if (stepIndex >= STEPS.length - 1) {
      void finish();
      return;
    }
    setStepIndex((i) => i + 1);
  };

  const back = () => setStepIndex((i) => Math.max(0, i - 1));

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className={styles.panel}>
        <div className={styles.art}>
          <BrandingArtwork artwork="trainerController" size="section" />
        </div>

        {step === 'welcome' && (
          <>
            <h1 id="onboarding-title">Welcome to Solith</h1>
            <p>
              Local-only trainer and save editor for <strong>single-player, offline</strong> games.
              No cloud account, no injection, no anti-cheat interaction.
            </p>
            <ul>
              <li>Trainer Library — thousands of titles with Steam artwork</li>
              <li>Save Editor — propose, approve, backup, then write</li>
              <li>Advanced Scan Mode — expert memory tools when enabled in settings</li>
            </ul>
          </>
        )}

        {step === 'library' && (
          <>
            <h1 id="onboarding-title">Trainer Library</h1>
            <p>
              Search the catalog, sync community listings, or import YAML / CT definitions.
              Verified games launch with one-click cheats; community entries may scan on first session.
            </p>
            <p className={styles.note}>Process watch can notify you when a catalog executable starts.</p>
          </>
        )}

        {step === 'saves' && (
          <>
            <h1 id="onboarding-title">Save editing workflow</h1>
            <p>Every write follows the same safety chain:</p>
            <ol>
              <li>Propose a change and review the diff</li>
              <li>Approve explicitly</li>
              <li>Automatic backup before write</li>
              <li>Verify on disk — rollback if needed</li>
            </ol>
          </>
        )}

        {step === 'advanced' && (
          <>
            <h1 id="onboarding-title">Advanced Scan Mode</h1>
            <p>
              Optional freeform ReadProcessMemory/WriteProcessMemory tools. Turn on
              <code> v2LiveModeEnabled</code> and <code>v2FreeformMemoryEnabled</code> in settings.
            </p>
            <p className={styles.note}>
              You must accept the single-player / private-play waiver before live writes. Connection
              counts may be shown as advisory info after Trust Shift.
            </p>
          </>
        )}

        {step === 'done' && (
          <>
            <h1 id="onboarding-title">You are set</h1>
            <p>Open Trainer Library or add a game to your local library to begin.</p>
          </>
        )}

        <div className={styles.progress} aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s} className={i <= stepIndex ? styles.dotActive : styles.dot} />
          ))}
        </div>

        <div className={styles.actions}>
          {stepIndex > 0 && step !== 'done' && (
            <button type="button" className={styles.secondary} onClick={back}>
              Back
            </button>
          )}
          <button type="button" className={styles.skip} onClick={() => void finish()}>
            Skip
          </button>
          <button type="button" className={styles.primary} onClick={next}>
            {step === 'done' ? 'Get started' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
