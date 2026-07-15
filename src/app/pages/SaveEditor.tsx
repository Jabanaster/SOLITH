import React, { useState, useEffect } from 'react';
import { PageModuleHeader } from '../components/PageModuleHeader.js';
import { GameScopePicker } from '../components/GameScopePicker.js';
import { SAVE_EDIT_RISK_COPY } from '../save-edit-risk-labels.js';
import {
  LOCAL_ONLY_SAFETY_MESSAGE,
  operationFailedBeforeWriteMessage,
  userSafeErrorDetail,
} from '../reliability-messages.js';

interface SaveEditorProps {
  gameId: string | null;
  mode?: 'save' | 'data';
}

interface SaveField {
  path: string;
  value: any;
  type: string;
  risk: string;
}

interface DataSuggestion {
  name: string;
  description: string;
  category: string;
  path: string;
  currentValue: any;
  valueType: string;
  suggestedValue: any;
  risk: string;
}

const DEMO_GAME_ID = 'demo-game-quest-id-000000000000';

function riskDisplayLabel(risk: string): string {
  const normalized = risk.toLowerCase();
  if (normalized === 'safe') return 'Low risk';
  if (normalized === 'caution') return 'Caution';
  if (normalized === 'risky') return 'Risky';
  if (normalized === 'blocked') return 'Blocked';
  return risk || 'Unreviewed';
}

function riskClassName(risk: string): string {
  const normalized = risk.toLowerCase();
  if (normalized === 'safe') return 'safe';
  if (normalized === 'caution') return 'caution';
  if (normalized === 'risky') return 'risky';
  if (normalized === 'blocked') return 'blocked';
  return 'caution';
}

function isElevatedRisk(risk: string): boolean {
  const normalized = risk.toLowerCase();
  return normalized === 'caution' || normalized === 'risky';
}

const SAVE_EDIT_RISK_ORDER = ['read_only', 'preview_only', 'executable', 'blocked'] as const;

const SaveEditor: React.FC<SaveEditorProps> = ({ gameId: initialGameId, mode = 'save' }) => {
  const [scopeGameId, setScopeGameId] = useState<string | null>(initialGameId);
  const [saveFiles, setSaveFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [fields, setFields] = useState<SaveField[]>([]);
  const [suggestions, setSuggestions] = useState<DataSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [editingField, setEditingField] = useState<SaveField | DataSuggestion | null>(null);
  const [newValue, setNewValue] = useState('');
  const [applying, setApplying] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  useEffect(() => {
    if (initialGameId) setScopeGameId(initialGameId);
  }, [initialGameId]);

  useEffect(() => {
    if (scopeGameId) {
      void loadSaveFiles();
      setFields([]);
      setSuggestions([]);
      setSelectedFile('');
    } else {
      setSaveFiles([]);
    }
  }, [scopeGameId, mode]);

  const loadSaveFiles = async () => {
    if (!window.electronAPI) return;
    if (!scopeGameId) return;
    setLoading(true);
    try {
      const files = await window.electronAPI.detectSaveFiles(scopeGameId);
      setSaveFiles(files || []);
      if (!files?.length) {
        setStatusMessage('No save files found yet — scan save locations or browse for a file.');
      } else {
        setStatusMessage('');
      }
    } catch (e) {
      console.error('Failed to load save files:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleScanLocations = async () => {
    if (!scopeGameId || !window.electronAPI) return;
    setScanning(true);
    try {
      const discovered = await window.electronAPI.discoverSaveLocations(scopeGameId);
      for (const loc of discovered) {
        if (loc.approvalState === 'Awaiting Approval' || loc.approvalState === 'Suggested') {
          await window.electronAPI.approveSaveLocation(loc.id);
        }
      }
      setStatusMessage(`Scanned ${discovered.length} folder(s) — reloading files…`);
      await loadSaveFiles();
    } finally {
      setScanning(false);
    }
  };

  const handleBrowseFile = async () => {
    if (!scopeGameId || !window.electronAPI?.pickSaveFile) return;
    const result = await window.electronAPI.pickSaveFile(scopeGameId);
    if (result.canceled) return;
    if (!result.success || !result.filePath) {
      setStatusMessage(result.error ?? 'Could not open file picker.');
      return;
    }
    setSaveFiles((prev) => (prev.includes(result.filePath!) ? prev : [...prev, result.filePath!]));
    setSelectedFile(result.filePath);
    await handleFileChange({ target: { value: result.filePath } } as React.ChangeEvent<HTMLSelectElement>);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!window.electronAPI || !scopeGameId) return;
    const filePath = e.target.value;
    setSelectedFile(filePath);
    if (!filePath) {
      setFields([]);
      setSuggestions([]);
      return;
    }

    setLoading(true);
    try {
      const res = await window.electronAPI.parseSave(scopeGameId, filePath);
      if (res && !res.error) {
        setFields(res.values || []);
        
        // Fetch suggestions if in data mode
        if (mode === 'data') {
          const sug = await window.electronAPI.suggestDataEdits(scopeGameId, filePath);
          setSuggestions(Array.isArray(sug) ? sug : []);
        } else {
          setSuggestions([]);
        }
      } else {
        setFields([]);
        setSuggestions([]);
      }
    } catch (err) {
      console.error('Failed to parse file:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleEditClick = (field: SaveField | DataSuggestion) => {
    setEditingField(field);
    const initialVal = 'value' in field ? field.value : field.currentValue;
    setNewValue(String(initialVal !== undefined ? initialVal : ''));
  };

  const handleApplyEdit = async () => {
    if (!editingField || !scopeGameId || !selectedFile || !window.electronAPI) return;
    setApplying(true);
    try {
      const pathStr = editingField.path;
      const oldValue = 'value' in editingField ? editingField.value : editingField.currentValue;
      
      let parsedNewVal: any = newValue;
      const type = 'type' in editingField ? editingField.type : editingField.valueType;
      
      if (type === 'number') parsedNewVal = Number(newValue);
      else if (type === 'boolean') parsedNewVal = newValue === 'true';

      // 1. Create Proposal
      const proposal = await window.electronAPI.createProposalForEdit(scopeGameId, selectedFile, pathStr, oldValue, parsedNewVal);
      if (!proposal) {
        alert('Failed to generate edit proposal');
        return;
      }

      // 2. Apply Proposal
      const res = await window.electronAPI.applyProposal(proposal);
      if (res.success) {
        const fileName = selectedFile.replace(/\\/g, '/').split('/').pop() || '';
        alert(`Successfully applied modification to ${fileName}!`);
        setEditingField(null);
        // Reload file contents
        handleFileChange({ target: { value: selectedFile } } as any);
      } else {
        alert(operationFailedBeforeWriteMessage());
      }
    } catch (err) {
      console.error('Failed to apply edit:', userSafeErrorDetail(err));
      alert(operationFailedBeforeWriteMessage());
    } finally {
      setApplying(false);
    }
  };

  const filteredFields = fields.filter(f => 
    f.path.toLowerCase().includes(filterText.toLowerCase()) ||
    String(f.value).toLowerCase().includes(filterText.toLowerCase())
  );
  const isDemoGame = scopeGameId === DEMO_GAME_ID;

  return (
    <div className="save-editor-container content-panel">
      <PageModuleHeader
        artwork={mode === 'save' ? 'saveTools' : 'hoodedProfile'}
        title={mode === 'save' ? 'Save Editor' : 'Data Editor'}
        description={
          mode === 'save'
            ? 'Inspect local save values and apply supported save-field edits with backup and rollback.'
            : 'Review data-file suggestions before any supported write path is used.'
        }
        actions={
          <div className="save-editor-toolbar">
            <button type="button" className="btn-secondary" onClick={() => void loadSaveFiles()} disabled={!scopeGameId || loading}>
              Refresh files
            </button>
            <button type="button" className="btn-secondary" onClick={() => void handleScanLocations()} disabled={!scopeGameId || scanning}>
              {scanning ? 'Scanning…' : 'Scan save folders'}
            </button>
            <button type="button" className="btn-primary" onClick={() => void handleBrowseFile()} disabled={!scopeGameId}>
              Browse file…
            </button>
          </div>
        }
      />

      <GameScopePicker
        value={scopeGameId}
        onChange={(id) => setScopeGameId(id)}
        label="Target game"
        hint="Required before scanning or opening save/data files."
      />

      {statusMessage && <p className="tcp-host-message" role="status">{statusMessage}</p>}

      <div className="tcp-summary-strip glass">
        <span><strong>Mode</strong> {mode === 'data' ? 'Data suggestions' : 'Save fields'}</span>
        <span><strong>Files</strong> {saveFiles.length}</span>
        <span><strong>Local only</strong> Yes</span>
        <button type="button" className="tcp-details-toggle" onClick={() => setDetailsExpanded((v) => !v)}>
          {detailsExpanded ? 'Hide safety details' : 'Safety details'}
        </button>
      </div>

      {detailsExpanded && (
        <div className="file-selector-panel glass" data-testid="save-edit-risk-legend">
          <p className="description">{LOCAL_ONLY_SAFETY_MESSAGE}</p>
          <div className="risk-state-legend">
            {SAVE_EDIT_RISK_ORDER.map((state) => {
              const copy = SAVE_EDIT_RISK_COPY[state];
              return (
                <div key={state} className={`badge risk-state-${state.replace(/_/g, '-')}`}>
                  <strong>{copy.label}</strong>
                  <span>{copy.summary}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="file-selector-panel glass">
        <label htmlFor="save-file-select">Select target file</label>
        <div className={`badge ${isDemoGame ? 'risk-caution' : 'risk-safe'}`}>
          {isDemoGame ? 'Demo fixture edit' : 'Registered scope'}
        </div>
        {!scopeGameId ? (
          <select id="save-file-select" disabled><option>Choose a game first</option></select>
        ) : loading && saveFiles.length === 0 ? (
          <select id="save-file-select" disabled><option>Loading detected files…</option></select>
        ) : (
          <select id="save-file-select" value={selectedFile} onChange={handleFileChange}>
            <option value="">— Choose file —</option>
            {saveFiles.map((file) => (
              <option key={file} value={file}>{file.replace(/\\/g, '/').split('/').pop()} ({file})</option>
            ))}
          </select>
        )}
      </div>

      {selectedFile && mode === 'data' && suggestions.length > 0 && (
        <div className="suggestions-section">
          <h3>⚡ Smart Data Tweaks Suggestions</h3>
          <div className="suggestion-grid">
            {suggestions.map((sug, idx) => (
              <div key={idx} className="suggestion-card glass" onClick={() => handleEditClick(sug)}>
                <div className="suggestion-card-header">
                  <h4>{sug.name}</h4>
                  <span className={`badge category-badge ${sug.category.toLowerCase()}`}>{sug.category}</span>
                </div>
                <p>{sug.description}</p>
                <div className="suggestion-values">
                  <span>Current: <strong>{String(sug.currentValue)}</strong></span>
                  <span>Suggested: <strong className="highlight">{String(sug.suggestedValue)}</strong></span>
                </div>
                <div className="suggestion-card-footer">
                  <span className={`badge risk-${riskClassName(sug.risk)}`}>{riskDisplayLabel(sug.risk)}</span>
                  <button className="btn-action btn-sm">Review and Apply Edit</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedFile && (
        <div className="fields-section">
          <div className="section-subheader">
            <h3>Discovered Key/Value Paths ({filteredFields.length})</h3>
            <input 
              type="text" 
              placeholder="Search keys or values..." 
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="search-input"
            />
          </div>

          {filteredFields.length === 0 ? (
            <div className="empty-state glass">
              <p>No matching values found in the file.</p>
            </div>
          ) : (
            <div className="table-wrapper glass">
              <table className="fields-table">
                <thead>
                  <tr>
                    <th>Path</th>
                    <th>Current Value</th>
                    <th>Type</th>
                    <th>Safety Assessment</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFields.map(field => {
                    const isBlocked = field.risk === 'Blocked';
                    return (
                      <tr key={field.path}>
                        <td><code>{field.path}</code></td>
                        <td>{String(field.value)}</td>
                        <td><span className="type-badge">{field.type}</span></td>
                        <td>
                          <span className={`badge risk-${field.risk.toLowerCase()}`}>
                            {riskDisplayLabel(field.risk)}
                          </span>
                        </td>
                        <td>
                          <button 
                            disabled={isBlocked}
                            onClick={() => handleEditClick(field)}
                            className="btn-action btn-sm"
                          >
                            {isBlocked ? 'Locked' : '✏️ Edit'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {editingField && (
        <div className="modal-overlay">
          <div className="modal-content glass">
            <h3>Modify Parameter</h3>
            <p className="modal-description">
              Supported XML, JSON, and INI save-field writes require explicit approval. Solith creates a verified backup before writing and offers rollback after a supported write.
            </p>
            <p className={`modal-description ${isDemoGame ? 'risk-caution' : 'risk-safe'}`}>
              {isDemoGame ? 'Demo fixture edit' : 'Registered game edit'}
            </p>
            
            <div className="recipe-details-box">
              <div><strong>Path:</strong> <code>{editingField.path}</code></div>
              <div><strong>Current Value:</strong> {String('value' in editingField ? editingField.value : editingField.currentValue)}</div>
              <div><strong>Risk assessment:</strong> <span className={`badge risk-${riskClassName(editingField.risk)}`}>{riskDisplayLabel(editingField.risk)}</span></div>
              <div><strong>Blocked means:</strong> unsupported formats, unsafe paths, unsupported controls, and rejected operations cannot be executed.</div>
            </div>

            {isElevatedRisk(editingField.risk) && (
              <div className={`recipe-details-box risk-${riskClassName(editingField.risk)}`}>
                <strong>{riskDisplayLabel(editingField.risk)} edit:</strong> review the target value carefully before applying.
              </div>
            )}

            <div className="input-group">
              <label>New Value</label>
              <input
                type="text"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
              />
            </div>

            <div className="modal-actions">
              <button 
                onClick={handleApplyEdit} 
                className="btn-primary"
                disabled={applying}
              >
                {applying ? 'Applying edit...' : 'Review and Apply Edit'}
              </button>
              <button onClick={() => setEditingField(null)} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SaveEditor;
