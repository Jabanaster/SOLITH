import React, { useEffect, useState } from 'react';

export const AboutSection: React.FC = () => {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await (window as any).electronAPI?.getAppVersion?.();
        if (!cancelled && typeof result === 'string') setVersion(result);
      } catch {
        // ignore — browser mode has no electronAPI
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="settings-section">
      <div className="settings-field">
        <span className="settings-field__label">Version</span>
        <span>{version ?? 'Unknown'}</span>
      </div>
    </div>
  );
};
