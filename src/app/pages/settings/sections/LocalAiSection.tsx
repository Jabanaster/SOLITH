import React, { useState } from 'react';
import type { Settings } from '../../../../shared/types/index.js';

type Props = {
  settings: Settings;
  onUpdate: (key: keyof Settings, value: Settings[keyof Settings]) => void;
};

export const LocalAiSection: React.FC<Props> = ({ settings, onUpdate }) => {
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const provider = settings.aiProvider ?? 'None';

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await window.electronAPI.aiConfigTestConnection({
        provider,
        endpoint: settings.aiEndpoint ?? '',
        model: settings.aiModel ?? '',
      });
      if (!response.success) {
        setTestResult({ success: false, message: response.error ?? 'Test failed.' });
        return;
      }
      setTestResult(response.result ?? { success: false, message: 'No result returned.' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="settings-section">
      <p className="settings-field-hint">
        Local AI is entirely optional. It only produces value explanations and naming suggestions — it never gets
        write access to a game's memory, and Solith works fully with rule-based explanations if no AI is configured.
      </p>

      <div className="settings-field">
        <label className="settings-field__label" htmlFor="ai-provider-select">
          Provider
        </label>
        <select
          id="ai-provider-select"
          value={provider}
          onChange={(e) => {
            onUpdate('aiProvider', e.target.value as Settings['aiProvider']);
            setTestResult(null);
          }}
        >
          <option value="None">None (rule-based explanations only)</option>
          <option value="Ollama">Ollama</option>
          <option value="LM Studio">LM Studio</option>
        </select>
      </div>

      {provider !== 'None' && (
        <>
          <div className="settings-field">
            <label className="settings-field__label" htmlFor="ai-endpoint-input">
              Endpoint
            </label>
            <input
              id="ai-endpoint-input"
              type="text"
              placeholder={provider === 'Ollama' ? 'http://localhost:11434' : 'http://localhost:1234'}
              value={settings.aiEndpoint ?? ''}
              onChange={(e) => onUpdate('aiEndpoint', e.target.value)}
            />
          </div>
          <div className="settings-field">
            <label className="settings-field__label" htmlFor="ai-model-input">
              Model
            </label>
            <input
              id="ai-model-input"
              type="text"
              value={settings.aiModel ?? ''}
              onChange={(e) => onUpdate('aiModel', e.target.value)}
            />
          </div>
        </>
      )}

      <div className="settings-field settings-actions">
        <button type="button" onClick={() => void handleTestConnection()} disabled={testing}>
          Test connection
        </button>
      </div>

      {testResult && (
        <p className="settings-field-hint">{testResult.success ? 'Connected — ' : ''}{testResult.message}</p>
      )}
    </div>
  );
};

export default LocalAiSection;
