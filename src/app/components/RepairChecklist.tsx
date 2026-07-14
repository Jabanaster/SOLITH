import React from 'react';
import styles from './RepairChecklist.module.css';
import { REPAIR_PIPELINE_STEPS, RESTART_VERIFY_CHECKLIST } from '../../core/trainer-deck/build-deck-rows.js';

export function RepairChecklist({
  showLiveRitual = false,
  compact = false,
}: {
  showLiveRitual?: boolean;
  compact?: boolean;
}) {
  const steps = showLiveRitual
    ? [...REPAIR_PIPELINE_STEPS, ...RESTART_VERIFY_CHECKLIST.slice(0, 4)]
    : REPAIR_PIPELINE_STEPS;

  return (
    <section className={compact ? styles.compact : styles.panel} aria-label="Repair pipeline">
      <h3 className={styles.title}>Repair pipeline</h3>
      <ol className={styles.list}>
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {showLiveRitual && (
        <p className={styles.note}>
          Live restart-verify steps require a solo game session (Milestone S).
        </p>
      )}
    </section>
  );
}
