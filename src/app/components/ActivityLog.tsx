import React from 'react';
import { Icon } from './icons/index.js';
import styles from './ActivityLog.module.css';

export type ActivityLogTone = 'ok' | 'warn' | 'info';

interface ActivityLogEntry {
  id: string;
  tone: ActivityLogTone;
  text: string;
  timestamp: string;
}

interface ActivityLogProps {
  entries: ActivityLogEntry[];
}

/**
 * Console-styled log module — a header bar over a mono-font body, not a
 * plain black rectangle. Not wired into any page yet.
 */
export const ActivityLog: React.FC<ActivityLogProps> = ({ entries }) => {
  return (
    <div className={styles.log}>
      <div className={styles.head}>
        <Icon name="log" size={13} />
        <span className={styles.label}>Activity Log</span>
      </div>
      <div className={styles.body}>
        {entries.map((entry) => (
          <div key={entry.id}>
            <span className={styles[entry.tone]}>[{entry.tone}]</span> {entry.text}{' '}
            <span className={styles.timestamp}>{entry.timestamp}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
