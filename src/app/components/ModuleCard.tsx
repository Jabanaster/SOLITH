import React from 'react';
import { Icon, type IconName } from './icons/index.js';
import styles from './ModuleCard.module.css';

export type ModuleCardStatus = 'safe' | 'caution' | 'blocked' | 'neutral' | 'special';

const STATUS_LABEL: Record<ModuleCardStatus, string> = {
  safe: 'SAFE',
  caution: 'CAUTION',
  blocked: 'BLOCKED',
  neutral: 'READY',
  special: 'SPECIAL',
};

interface ModuleCardProps {
  icon: IconName;
  title: string;
  description: string;
  metadata: string;
  status: ModuleCardStatus;
  footerRight?: string;
}

/**
 * Generic loadout/status module card — left accent rail + icon slot + title/
 * description + metadata row + status chip. Rail and icon-slot color follow
 * `status`: safe=emerald, caution=amber, blocked=danger-red, special=violet
 * (reserved for live-memory/system-flagged modules per the design spec —
 * violet must not be used for `neutral`/general-purpose cards), neutral=cyan.
 */
export const ModuleCard: React.FC<ModuleCardProps> = ({ icon, title, description, metadata, status, footerRight }) => {
  return (
    <div className={`${styles.card} ${styles[status]}`}>
      <div className={styles.top}>
        <div className={styles.iconSlot}>
          <Icon name={icon} size={14} />
        </div>
        <div>
          <div className={styles.title}>{title}</div>
          <div className={styles.description}>{description}</div>
        </div>
      </div>
      <div className={styles.metadata}>{metadata}</div>
      <div className={styles.footer}>
        <span className={styles.statusLabel}>{STATUS_LABEL[status]}</span>
        {footerRight && <span className={styles.footerRight}>{footerRight}</span>}
      </div>
    </div>
  );
};
