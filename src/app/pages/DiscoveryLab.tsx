import React, { useState, useEffect } from 'react';
import { PageModuleHeader } from '../components/PageModuleHeader.js';
import { exportDiscoveryCandidateToYaml } from '../../core/definitions/export-definition.js';
import { downloadTextFile } from '../utils/download-text-file.js';
import type { DiscoveryAdvisoryComparison, DiscoveryReport } from '../../core/discovery/index.js';
import type { DiscoveryResult } from '../../shared/types';

interface DiscoveryLabProps {
  gameId: string | null;
}

const DiscoveryLab: React.FC<DiscoveryLabProps> = ({ gameId }) => {
  const [saveFiles, setSaveFiles] = useState<string[]>([]);
  const [saveA, setSaveA] = useState('');
  const [saveB, setSaveB] = useState('');
  const [knownValueA, setKnownValueA] = useState('');
  const [knownValueB, setKnownValueB] = useState('');
  
  const [candidates, setCandidates] = useState<DiscoveryResult[]>([]);
  const [advisoryReport, setAdvisoryReport] = useState<DiscoveryReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [creatingRecipe, setCreatingRecipe] = useState<string | null>(null);
  
  // UI states
  const [activeStep, setActiveStep] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [filterRisk, setFilterRisk] = useState('ALL');
  const [showNoise, setShowNoise] = useState(false);
  
  // Modal states
  const [selectedCandidate, setSelectedCandidate] = useState<DiscoveryResult | null>(null);
  const [recipeName, setRecipeName] = useState('');
  const [recipeCategory, setRecipeCategory] = useState('PLAYER');
  const [recipeDescription, setRecipeDescription] = useState('');
  const [recipeInputType, setRecipeInputType] = useState<'number' | 'toggle' | 'slider' | 'dropdown'>('number');
  const [sliderMin, setSliderMin] = useState('0');
  const [sliderMax, setSliderMax] = useState('100');
  const [sliderStep, setSliderStep] = useState('1');
  const [sliderUnit, setSliderUnit] = useState('');
  const [dropdownOptions, setDropdownOptions] = useState<Array<{ label: string; value: string }>>([
    { label: 'Option 1', value: 'option-1' }
  ]);
  const [gameName, setGameName] = useState('Custom Game');
  const [importingToLibrary, setImportingToLibrary] = useState(false);

  useEffect(() => {
    if (gameId) {
      loadSaveFiles();
      void loadGameName();
    }
  }, [gameId]);

  const loadGameName = async () => {
    if (!gameId || !window.electronAPI?.getGames) return;
    try {
      const games = await window.electronAPI.getGames();
      const match = Array.isArray(games) ? games.find((g: { id: string; name?: string }) => g.id === gameId) : null;
      if (match?.name) setGameName(match.name);
    } catch {
      // keep default label
    }
  };

  const loadSaveFiles = async () => {
    if (!window.electronAPI) {
      console.error('[DiscoveryLab] window.electronAPI unavailable — must run inside Electron');
      setLoading(false);
      return;
    }
    if (!gameId) { setLoading(false); return; }
    setLoading(true);
    try {
      const files = await window.electronAPI.detectSaveFiles(gameId);
      setSaveFiles(files || []);
      if (files && files.length >= 2) {
        setSaveA(files[0]);
        setSaveB(files[1]);
      } else if (files && files.length === 1) {
        setSaveA(files[0]);
      }
    } catch (e) {
      console.error('Failed to load save files:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleCompare = async () => {
    if (!saveA || !saveB || !gameId || !window.electronAPI) return;
    setComparing(true);
    try {
      const valA = knownValueA.trim() !== '' ? (isNaN(Number(knownValueA)) ? knownValueA : Number(knownValueA)) : undefined;
      const valB = knownValueB.trim() !== '' ? (isNaN(Number(knownValueB)) ? knownValueB : Number(knownValueB)) : undefined;

      const response = await window.electronAPI.compareSavesReport(saveA, saveB, gameId, valA, valB) as DiscoveryAdvisoryComparison | { error: string };
      if (response && 'error' in response) {
        alert(response.error);
        return;
      }
      if (response && 'results' in response) {
        setCandidates(response.results || []);
        setAdvisoryReport(response.report || null);
      } else {
        setCandidates([]);
        setAdvisoryReport(null);
      }
      setActiveStep(3); // Go to step 3 on comparison success
    } catch (err) {
      console.error('Compare failed:', err);
      alert('Comparison failed. Please verify files are correct and uncorrupted.');
    } finally {
      setComparing(false);
    }
  };

  const handleExportDefinition = (candidate: DiscoveryResult, labelOverride?: string) => {
    if (!gameId || !saveB) {
      alert('Select save files and run a comparison before exporting a definition.');
      return;
    }
    const exportCandidate = labelOverride
      ? { ...candidate, suggestedName: labelOverride, suggestedCategory: recipeCategory }
      : candidate;
    const bundle = exportDiscoveryCandidateToYaml({
      gameId,
      gameName,
      saveFilePath: saveB,
      candidate: exportCandidate,
    });
    downloadTextFile(bundle.filename, bundle.yaml);
    alert(`Exported ${bundle.filename}. Review the YAML before compiling or sharing.`);
  };

  const handleAddToLibrary = async (candidate: DiscoveryResult, labelOverride?: string) => {
    if (!gameId || !saveB) {
      alert('Select save files and run a comparison before adding to the library.');
      return;
    }
    if (!window.electronAPI?.trainerCatalogImportYaml) {
      alert('Trainer Library import is only available in the desktop app.');
      return;
    }

    const exportCandidate = labelOverride
      ? { ...candidate, suggestedName: labelOverride, suggestedCategory: recipeCategory }
      : candidate;
    const bundle = exportDiscoveryCandidateToYaml({
      gameId,
      gameName,
      saveFilePath: saveB,
      candidate: exportCandidate,
    });

    setImportingToLibrary(true);
    try {
      const result = await window.electronAPI.trainerCatalogImportYaml({ yamlText: bundle.yaml });
      if (result.success) {
        alert(
          `Added "${result.title ?? recipeName}" to Trainer Library (${result.cheatCount ?? 0} features). Open Trainer Library to launch it.`,
        );
        setSelectedCandidate(null);
      } else {
        const detail = result.errors?.join('; ') ?? result.error ?? 'Import failed';
        alert(detail);
      }
    } finally {
      setImportingToLibrary(false);
    }
  };

  const openRecipeModal = (candidate: DiscoveryResult) => {
    setSelectedCandidate(candidate);
    setRecipeName(candidate.suggestedName || `Set ${candidate.path}`);
    setRecipeCategory(candidate.suggestedCategory || 'PLAYER');
    setRecipeDescription(candidate.description || '');
    const vt = candidate.valueType || typeof candidate.newValue;
    setRecipeInputType(vt === 'boolean' ? 'toggle' : vt === 'number' ? 'slider' : 'dropdown');
    setDropdownOptions([
      { label: String(candidate.oldValue ?? 'Current'), value: String(candidate.oldValue ?? '') },
      { label: String(candidate.newValue ?? 'Proposed'), value: String(candidate.newValue ?? '') }
    ]);
  };

  const handleCreateRecipe = async () => {
    if (!selectedCandidate || !recipeName || !gameId || !window.electronAPI) return;
    setCreatingRecipe(selectedCandidate.path);
    try {
      const recipeData = {
        gameId,
        name: recipeName,
        category: recipeCategory,
        source: 'SAVE',
        target: saveB,
        path: selectedCandidate.path,
        valueType: selectedCandidate.valueType || typeof selectedCandidate.newValue,
        risk: selectedCandidate.risk ? selectedCandidate.risk.charAt(0).toUpperCase() + selectedCandidate.risk.slice(1) : 'Safe',
        requiresBackup: selectedCandidate.risk === 'risky' || selectedCandidate.risk === 'caution',
        confidence: selectedCandidate.confidence,
        description: recipeDescription,
        inputType: recipeInputType,
        minimum: recipeInputType === 'slider' ? Number(sliderMin) : undefined,
        maximum: recipeInputType === 'slider' ? Number(sliderMax) : undefined,
        step: recipeInputType === 'slider' ? Number(sliderStep) : undefined,
        unit: recipeInputType === 'slider' && sliderUnit.trim() ? sliderUnit.trim() : undefined,
        options: recipeInputType === 'dropdown'
          ? dropdownOptions
              .filter(o => o.label.trim().length > 0 && o.value.trim().length > 0)
              .map(o => ({ label: o.label.trim(), value: o.value.trim() }))
          : undefined
      };
      
      const res = await window.electronAPI.createRecipe(recipeData);
      if (res.success) {
        alert(`Successfully created recipe: "${recipeName}"!`);
        setSelectedCandidate(null);
      } else {
        alert(`Failed to create recipe: ${res.error}`);
      }
    } catch (e) {
      console.error('Create recipe error:', e);
      alert('An error occurred while saving the recipe.');
    } finally {
      setCreatingRecipe(null);
    }
  };

  const getRiskColor = (risk: string) => {
    switch (risk?.toLowerCase()) {
      case 'safe':
        return '#00ff66';
      case 'caution':
        return '#ffb300';
      case 'risky':
        return '#ff6600';
      case 'blocked':
        return '#ff3333';
      default:
        return '#888888';
    }
  };

  // Filter candidates
  const filteredCandidates = candidates.filter(cand => {
    // 1. Search term
    const matchesSearch = cand.path.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          String(cand.oldValue).toLowerCase().includes(searchTerm.toLowerCase()) ||
                          String(cand.newValue).toLowerCase().includes(searchTerm.toLowerCase());
    
    // 2. Category
    const matchesCategory = filterCategory === 'ALL' || cand.suggestedCategory === filterCategory;

    // 3. Risk level
    const matchesRisk = filterRisk === 'ALL' || cand.risk?.toUpperCase() === filterRisk;

    // 4. Noise classification
    const matchesNoise = showNoise || cand.noiseClassification !== 'noise';

    return matchesSearch && matchesCategory && matchesRisk && matchesNoise;
  });

  return (
    <div className="discovery-lab-container">
      <PageModuleHeader
        artwork="hoodedProfile"
        title="Discovery Lab"
        description="Find offsets by comparing save state transitions. Discovery remains advisory and does not by itself grant executable write support."
        walkthroughId="discovery-lab"
      />

      {/* Guided Steps Header */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
        {[1, 2, 3].map(step => (
          <div 
            key={step} 
            onClick={() => step <= activeStep && setActiveStep(step)}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: '6px',
              background: activeStep === step ? 'rgba(100, 255, 218, 0.1)' : 'rgba(22, 33, 62, 0.4)',
              border: activeStep === step ? '1px solid #64ffda' : '1px solid rgba(45, 58, 92, 0.4)',
              color: activeStep === step ? '#64ffda' : '#8892b0',
              textAlign: 'center',
              cursor: step <= activeStep ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s'
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: 600 }}>STEP 0{step}</div>
            <div style={{ fontSize: '13px', fontWeight: 700, marginTop: '2px' }}>
              {step === 1 ? 'Configure Saves' : step === 2 ? 'Known Values (Optional)' : 'Review Discovered'}
            </div>
          </div>
        ))}
      </div>

      {activeStep === 1 && (
        <div className="glass" style={{ padding: '24px', borderRadius: '8px', border: '1px solid #2d3a5c' }}>
          <h3 style={{ marginTop: 0, color: '#64ffda' }}>Choose Saves to Compare</h3>
          <p style={{ color: '#8892b0', fontSize: '13px', marginBottom: '20px' }}>
            Select two save files from your game folder. Save A should represent the "before" state (e.g. before gaining gold) and Save B should represent the "after" state.
          </p>

          <div style={{ display: 'flex', gap: '24px', marginBottom: '24px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', color: '#e0e0e0', fontWeight: 600 }}>Save File A (Before)</label>
              <select 
                value={saveA} 
                onChange={(e) => setSaveA(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '4px',
                  border: '1px solid #2d3a5c',
                  background: '#0d0d12',
                  color: '#ffffff',
                  fontSize: '13px'
                }}
              >
                <option value="">-- Select File A --</option>
                {saveFiles.map(file => (
                  <option key={file} value={file}>{file.replace(/\\/g, '/').split('/').pop()}</option>
                ))}
              </select>
            </div>

            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', color: '#e0e0e0', fontWeight: 600 }}>Save File B (After)</label>
              <select 
                value={saveB} 
                onChange={(e) => setSaveB(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '4px',
                  border: '1px solid #2d3a5c',
                  background: '#0d0d12',
                  color: '#ffffff',
                  fontSize: '13px'
                }}
              >
                <option value="">-- Select File B --</option>
                {saveFiles.map(file => (
                  <option key={file} value={file}>{file.replace(/\\/g, '/').split('/').pop()}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button 
              onClick={() => setActiveStep(2)}
              disabled={!saveA || !saveB}
              className="btn-primary"
              style={{ padding: '10px 20px' }}
            >
              Continue →
            </button>
          </div>
        </div>
      )}

      {activeStep === 2 && (
        <div className="glass" style={{ padding: '24px', borderRadius: '8px', border: '1px solid #2d3a5c' }}>
          <h3 style={{ marginTop: 0, color: '#64ffda' }}>Guided Search (Known Values)</h3>
          <p style={{ color: '#8892b0', fontSize: '13px', marginBottom: '20px' }}>
            If you know the exact value of the variable you want to modify (e.g. you had 100 gold in Save A and 250 gold in Save B), type them below to boost confidence matching.
          </p>

          <div style={{ display: 'flex', gap: '24px', marginBottom: '24px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', color: '#e0e0e0', fontWeight: 600 }}>Known Value in Save A</label>
              <input
                type="text"
                placeholder="e.g. 100"
                value={knownValueA}
                onChange={(e) => setKnownValueA(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '4px',
                  border: '1px solid #2d3a5c',
                  background: '#0d0d12',
                  color: '#ffffff',
                  fontSize: '13px'
                }}
              />
            </div>

            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', color: '#e0e0e0', fontWeight: 600 }}>Known Value in Save B</label>
              <input
                type="text"
                placeholder="e.g. 250"
                value={knownValueB}
                onChange={(e) => setKnownValueB(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '4px',
                  border: '1px solid #2d3a5c',
                  background: '#0d0d12',
                  color: '#ffffff',
                  fontSize: '13px'
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={() => setActiveStep(1)} className="btn-secondary" style={{ padding: '10px 20px' }}>← Back</button>
            <button 
              onClick={handleCompare} 
              disabled={comparing}
              className="btn-primary"
              style={{ padding: '10px 24px', background: '#64ffda', color: '#0d0d12' }}
            >
              {comparing ? '🚀 Comparing...' : '🚀 Compare & Search'}
            </button>
          </div>
        </div>
      )}

      {activeStep === 3 && (
        <div className="results-container">
          {advisoryReport && (
            <div className="glass" style={{ padding: '16px', marginBottom: '24px', border: '1px solid #2d3a5c', borderRadius: '8px' }}>
              <h3 style={{ marginTop: 0, color: '#64ffda' }}>Advisory Diff Summary</h3>
              <p style={{ color: '#8892b0', fontSize: '13px', marginBottom: '12px' }}>
                Advisory evidence only. Unsupported sections stay blocked until mapped to existing accepted supported controls.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
                <span className="badge risk-safe">Advisory candidates: {advisoryReport.changedPaths.length}</span>
                <span className="badge risk-caution">Unsupported sections: {advisoryReport.unsupportedSections.length}</span>
                <span className="badge risk-safe">Compared: {new Date(advisoryReport.comparedAt).toLocaleString()}</span>
              </div>
              <div style={{ display: 'grid', gap: '10px' }}>
                {advisoryReport.files.map(file => (
                  <div key={`${file.label}-${file.fileName}`} style={{ fontSize: '13px', color: '#e0e0e0' }}>
                    <strong style={{ color: '#00d4ff' }}>{file.label.toUpperCase()}:</strong> {file.fileName}
                    <span style={{ color: '#8892b0' }}>
                      {' '}
                      {file.sizeBytes !== null ? `(${file.sizeBytes} bytes)` : '(unavailable)'}
                    </span>
                  </div>
                ))}
              </div>
              {advisoryReport.unsupportedSections.length > 0 && (
                <div style={{ marginTop: '12px' }}>
                  <strong style={{ color: '#ffb300' }}>Blocked or unsupported sections:</strong>
                  <div style={{ fontSize: '12px', color: '#8892b0', marginTop: '6px', wordBreak: 'break-word' }}>
                    {advisoryReport.unsupportedSections.join(', ')}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Filters Bar */}
          <div className="glass" style={{ padding: '16px', marginBottom: '24px', display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center', border: '1px solid #2d3a5c', borderRadius: '8px' }}>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <input
                type="text"
                placeholder="Search candidates..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '4px',
                  border: '1px solid #2d3a5c',
                  background: '#0d0d12',
                  color: '#ffffff',
                  fontSize: '13px'
                }}
              />
            </div>

            <div>
              <select 
                value={filterCategory} 
                onChange={(e) => setFilterCategory(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: '4px', border: '1px solid #2d3a5c', background: '#0d0d12', color: '#ffffff', fontSize: '13px' }}
              >
                <option value="ALL">All Categories</option>
                <option value="PLAYER">PLAYER</option>
                <option value="INVENTORY">INVENTORY</option>
                <option value="STATS">STATS</option>
                <option value="ENEMIES">ENEMIES</option>
                <option value="GAME">GAME</option>
                <option value="UNLOCKS">UNLOCKS</option>
                <option value="DISCOVERY">DISCOVERY</option>
              </select>
            </div>

            <div>
              <select 
                value={filterRisk} 
                onChange={(e) => setFilterRisk(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: '4px', border: '1px solid #2d3a5c', background: '#0d0d12', color: '#ffffff', fontSize: '13px' }}
              >
                <option value="ALL">All Risks</option>
                <option value="SAFE">Safe</option>
                <option value="CAUTION">Caution</option>
                <option value="RISKY">Risky</option>
                <option value="BLOCKED">Blocked</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                id="show-noise-toggle"
                checked={showNoise}
                onChange={(e) => setShowNoise(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <label htmlFor="show-noise-toggle" style={{ fontSize: '13px', color: '#e0e0e0', cursor: 'pointer', userSelect: 'none' }}>
                Show suppressed noise (timestamps, sessions, etc.)
              </label>
            </div>

            <div>
              <button 
                onClick={() => setActiveStep(2)} 
                className="btn-secondary"
                style={{ padding: '8px 14px', fontSize: '12px' }}
              >
                🔄 New Compare
              </button>
            </div>
          </div>

          <h3>Candidates ({filteredCandidates.length})</h3>
          {filteredCandidates.length === 0 ? (
            <div className="empty-state glass">
              <h4>No matches found</h4>
              <p>Try clearing your search term, enabling suppressed noise, or resetting known value filters.</p>
            </div>
          ) : (
            <div className="table-wrapper glass" style={{ border: '1px solid #2d3a5c', borderRadius: '8px', overflow: 'hidden' }}>
              <table className="fields-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: 'rgba(22, 33, 62, 0.95)', borderBottom: '1px solid #2d3a5c', color: '#64ffda', fontSize: '13px' }}>
                    <th style={{ padding: '12px 16px' }}>Path / Offset</th>
                    <th style={{ padding: '12px 16px' }}>Transitions</th>
                    <th style={{ padding: '12px 16px' }}>Category</th>
                    <th style={{ padding: '12px 16px' }}>Confidence & Evidence</th>
                    <th style={{ padding: '12px 16px' }}>Risk</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCandidates.map(cand => {
                    const riskColor = getRiskColor(cand.risk || 'safe');
                    return (
                      <tr key={cand.path} style={{ borderBottom: '1px solid rgba(45, 58, 92, 0.4)', fontSize: '13px' }}>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ color: '#00d4ff', fontWeight: 600 }}>{cand.path}</div>
                          <div style={{ fontSize: '11px', color: '#8892b0', marginTop: '2px' }}>{cand.description}</div>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ color: '#ff3333' }}>{String(cand.oldValue)}</span>
                          <span style={{ margin: '0 8px', color: '#8892b0' }}>→</span>
                          <span style={{ color: '#00ff66' }}>{String(cand.newValue)}</span>
                        </td>
                        <td style={{ padding: '12px 16px', fontWeight: 600, color: '#e0e0e0' }}>
                          {cand.suggestedCategory}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ fontWeight: 600 }}>{cand.confidence}% Match</div>
                          <div style={{ fontSize: '11px', color: '#8892b0', marginTop: '2px', maxWidth: '300px' }}>
                            {cand.evidence || cand.explanation}
                          </div>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{
                            display: 'inline-block',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 600,
                            backgroundColor: riskColor + '20',
                            color: riskColor,
                            border: `1px solid ${riskColor}`
                          }}>
                            {cand.risk ? cand.risk.toUpperCase() : 'SAFE'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          <button
                            onClick={() => handleExportDefinition(cand)}
                            disabled={cand.risk?.toLowerCase() === 'blocked'}
                            className="btn-secondary"
                            style={{
                              padding: '6px 12px',
                              fontSize: '12px',
                              borderRadius: '4px',
                              fontWeight: 600,
                              cursor: cand.risk?.toLowerCase() === 'blocked' ? 'not-allowed' : 'pointer'
                            }}
                          >
                            Export Definition
                          </button>
                          <button
                            onClick={() => openRecipeModal(cand)}
                            disabled={cand.risk?.toLowerCase() === 'blocked'}
                            className="btn-primary"
                            style={{
                              padding: '6px 12px',
                              fontSize: '12px',
                              borderRadius: '4px',
                              background: cand.risk?.toLowerCase() === 'blocked' ? '#3e3e4a' : '#64ffda',
                              color: '#0d0d12',
                              fontWeight: 600,
                              cursor: cand.risk?.toLowerCase() === 'blocked' ? 'not-allowed' : 'pointer'
                            }}
                          >
                            Create Recipe
                          </button>
                          </div>
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

      {selectedCandidate && (
        <div className="modal-overlay" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(10, 10, 15, 0.85)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div className="modal-content glass" style={{
            background: '#16213e',
            border: '1px solid #2d3a5c',
            borderRadius: '8px',
            padding: '24px',
            width: '100%',
            maxWidth: '500px',
            color: '#ffffff'
          }}>
            <h3 style={{ marginTop: 0, marginBottom: '8px', color: '#64ffda' }}>Create Trainer Recipe</h3>
            <p style={{ color: '#8892b0', fontSize: '13px', marginBottom: '20px' }}>
              Confirm details to turn this candidate into a safe, reusable recipe configuration.
            </p>
            
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: '#8892b0', marginBottom: '6px', fontWeight: 600 }}>Trainer Label / Name</label>
              <input
                type="text"
                value={recipeName}
                onChange={(e) => setRecipeName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '4px',
                  border: '1px solid #2d3a5c',
                  background: '#0d0d12',
                  color: '#ffffff',
                  fontSize: '13px'
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: '#8892b0', marginBottom: '6px', fontWeight: 600 }}>Control Type</label>
              <select
                value={recipeInputType}
                onChange={(e) => setRecipeInputType(e.target.value as any)}
                style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #2d3a5c', background: '#0d0d12', color: '#ffffff', fontSize: '13px' }}
              >
                <option value="number">Number</option>
                <option value="toggle">Toggle</option>
                <option value="slider">Slider</option>
                <option value="dropdown">Dropdown</option>
              </select>
            </div>

            {recipeInputType === 'slider' && (
              <div style={{ marginBottom: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                <input type="number" aria-label="Slider minimum" value={sliderMin} onChange={(e) => setSliderMin(e.target.value)} placeholder="Minimum" style={{ padding: '10px', borderRadius: '4px', border: '1px solid #2d3a5c', background: '#0d0d12', color: '#ffffff' }} />
                <input type="number" aria-label="Slider maximum" value={sliderMax} onChange={(e) => setSliderMax(e.target.value)} placeholder="Maximum" style={{ padding: '10px', borderRadius: '4px', border: '1px solid #2d3a5c', background: '#0d0d12', color: '#ffffff' }} />
                <input type="number" aria-label="Slider step" value={sliderStep} onChange={(e) => setSliderStep(e.target.value)} placeholder="Step" style={{ padding: '10px', borderRadius: '4px', border: '1px solid #2d3a5c', background: '#0d0d12', color: '#ffffff' }} />
                <input type="text" aria-label="Slider unit" value={sliderUnit} onChange={(e) => setSliderUnit(e.target.value)} placeholder="Unit (optional)" style={{ padding: '10px', borderRadius: '4px', border: '1px solid #2d3a5c', background: '#0d0d12', color: '#ffffff', gridColumn: '1 / span 3' }} />
              </div>
            )}

            {recipeInputType === 'dropdown' && (
              <div style={{ marginBottom: '16px' }}>
                {dropdownOptions.map((option, index) => (
                  <div key={`${index}-${option.value}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '8px', marginBottom: '8px' }}>
                    <input type="text" aria-label={`Dropdown option ${index + 1} label`} value={option.label} onChange={(e) => setDropdownOptions(prev => prev.map((p, i) => i === index ? { ...p, label: e.target.value } : p))} placeholder="Option label" style={{ padding: '10px', borderRadius: '4px', border: '1px solid #2d3a5c', background: '#0d0d12', color: '#ffffff' }} />
                    <input type="text" aria-label={`Dropdown option ${index + 1} value`} value={option.value} onChange={(e) => setDropdownOptions(prev => prev.map((p, i) => i === index ? { ...p, value: e.target.value } : p))} placeholder="Option value" style={{ padding: '10px', borderRadius: '4px', border: '1px solid #2d3a5c', background: '#0d0d12', color: '#ffffff' }} />
                    <button type="button" className="btn-secondary" onClick={() => setDropdownOptions(prev => prev.filter((_, i) => i !== index))} disabled={dropdownOptions.length <= 1}>Remove</button>
                  </div>
                ))}
                <button type="button" className="btn-secondary" onClick={() => setDropdownOptions(prev => [...prev, { label: '', value: '' }])}>Add Option</button>
              </div>
            )}

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: '#8892b0', marginBottom: '6px', fontWeight: 600 }}>Category</label>
              <select 
                value={recipeCategory} 
                onChange={(e) => setRecipeCategory(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '4px',
                  border: '1px solid #2d3a5c',
                  background: '#0d0d12',
                  color: '#ffffff',
                  fontSize: '13px'
                }}
              >
                <option value="PLAYER">PLAYER</option>
                <option value="INVENTORY">INVENTORY</option>
                <option value="STATS">STATS</option>
                <option value="ENEMIES">ENEMIES</option>
                <option value="GAME">GAME</option>
                <option value="UNLOCKS">UNLOCKS</option>
                <option value="DISCOVERY">DISCOVERY</option>
              </select>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: '#8892b0', marginBottom: '6px', fontWeight: 600 }}>Description</label>
              <textarea
                value={recipeDescription}
                onChange={(e) => setRecipeDescription(e.target.value)}
                rows={3}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '4px',
                  border: '1px solid #2d3a5c',
                  background: '#0d0d12',
                  color: '#ffffff',
                  fontSize: '13px',
                  resize: 'none'
                }}
              />
            </div>

            <div style={{ background: '#0f172a', padding: '12px', borderRadius: '6px', fontSize: '12px', marginBottom: '24px', borderLeft: `3px solid ${getRiskColor(selectedCandidate.risk || 'safe')}` }}>
              <div style={{ marginBottom: '4px' }}><strong>Path:</strong> <code>{selectedCandidate.path}</code></div>
              <div style={{ marginBottom: '4px' }}><strong>Value Type:</strong> <code>{selectedCandidate.valueType || typeof selectedCandidate.newValue}</code></div>
              <div style={{ marginBottom: '4px' }}><strong>Risk Level:</strong> <span style={{ color: getRiskColor(selectedCandidate.risk || 'safe'), fontWeight: 600 }}>{selectedCandidate.risk?.toUpperCase() || 'SAFE'}</span></div>
              <div><strong>Confidence Score:</strong> <code>{selectedCandidate.confidence}%</code></div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button 
                onClick={() => setSelectedCandidate(null)} 
                className="btn-secondary"
                style={{ padding: '8px 16px' }}
              >
                Cancel
              </button>
              <button
                onClick={() => selectedCandidate && handleExportDefinition(selectedCandidate, recipeName)}
                disabled={!recipeName.trim()}
                className="btn-secondary"
                style={{ padding: '8px 16px' }}
              >
                Export YAML
              </button>
              <button
                onClick={() => selectedCandidate && void handleAddToLibrary(selectedCandidate, recipeName)}
                disabled={!recipeName.trim() || importingToLibrary}
                className="btn-secondary"
                style={{ padding: '8px 16px' }}
              >
                {importingToLibrary ? 'Adding…' : 'Add to Library'}
              </button>
              <button 
                onClick={handleCreateRecipe} 
                disabled={creatingRecipe !== null || !recipeName.trim()}
                className="btn-primary"
                style={{ padding: '8px 20px', background: '#64ffda', color: '#0d0d12', fontWeight: 600 }}
              >
                {creatingRecipe ? 'Saving...' : 'Save Recipe'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DiscoveryLab;
