import React, { useState, useEffect } from 'react';

interface TrainerItem {
  id: string;
  name: string;
  description: string;
  category: string;
  source: string;
  risk: string;
  status: string;
  confidence?: number;
  currentValue?: string | number;
  newValue?: string | number;
  path?: string;
  target?: string;
  hotkey?: string;
  inputType?: 'number' | 'toggle' | 'slider' | 'dropdown';
  min?: number;
  max?: number;
  options?: string[];
}

interface TrainerPageProps {
  gameId: string;
  category: string;
  onBack: () => void;
}

const TrainerPage: React.FC<TrainerPageProps> = ({ gameId, category, onBack }) => {
  const [trainerItems, setTrainerItems] = useState<TrainerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [customValues, setCustomValues] = useState<Record<string, any>>({});

  useEffect(() => {
    loadTrainerItems();
  }, [gameId, category]);

  const loadTrainerItems = async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.getRecipes(gameId);
      if (result && !result.error) {
        setTrainerItems(result);
        
        // Initialize custom values dictionary
        const values: Record<string, any> = {};
        result.forEach((item: TrainerItem) => {
          values[item.id] = item.currentValue !== undefined ? item.currentValue : '';
        });
        setCustomValues(values);
      } else {
        console.error('Failed to load recipes:', result?.error);
        setTrainerItems([]);
      }
    } catch (error) {
      console.error('Error loading recipes:', error);
      setTrainerItems([]);
    } finally {
      setLoading(false);
    }
  };

  const handleValueChange = (itemId: string, val: any) => {
    setCustomValues(prev => ({
      ...prev,
      [itemId]: val
    }));
  };

  const handleApply = async (itemId: string) => {
    const item = trainerItems.find(i => i.id === itemId);
    if (!item || !item.path || !item.target) return;
    
    const value = customValues[itemId];
    if (value === undefined || value === '') return;

    setApplyingId(itemId);
    try {
      let parsedValue: any = value;
      if (item.inputType === 'number') {
        parsedValue = Number(value);
      } else if (item.inputType === 'toggle') {
        parsedValue = value === true || value === 'true';
      }

      // Create Proposal
      const proposal = await window.electronAPI.createProposalForEdit(
        gameId, 
        item.target, 
        item.path, 
        item.currentValue, 
        parsedValue, 
        item.id
      );

      if (!proposal) {
        alert('Failed to generate trainer edit proposal');
        return;
      }

      // Apply Proposal
      const res = await window.electronAPI.applyProposal(proposal);
      if (res.success) {
        alert('Trainer action applied successfully! Backup created.');
        await loadTrainerItems(); // Refresh current values
      } else {
        alert(`Apply failed: ${res.error}`);
      }
    } catch (e) {
      console.error('Apply error:', e);
      alert('An error occurred while applying the trainer.');
    } finally {
      setApplyingId(null);
    }
  };

  const filteredItems = category === 'all' 
    ? trainerItems 
    : trainerItems.filter(item => item.category.toLowerCase() === category.toLowerCase());

  return (
    <div className="trainer-page">
      {loading ? (
        <div className="empty-state glass">
          <p>Loading trainer items...</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="empty-state glass">
          <h3>No trainer recipes created</h3>
          <p>Go to the <strong>Discovery Lab</strong> or the <strong>Save Editor</strong> to scan files and generate trainer buttons.</p>
        </div>
      ) : (
        <div className="trainer-grid">
          {filteredItems.map(item => {
            const isBlocked = item.status === 'Blocked' || item.risk === 'Blocked';
            const isStale = item.status === 'Needs Rescan';
            const value = customValues[item.id];

            return (
              <div key={item.id} className={`trainer-card glass ${isBlocked ? 'blocked' : ''} ${isStale ? 'stale' : ''}`}>
                <div className="trainer-header">
                  <h4>{item.name}</h4>
                  <div className="badges-wrapper">
                    <span className="badge badge-source">{item.source}</span>
                    <span className={`badge risk-${item.risk.toLowerCase()}`}>{item.risk}</span>
                    <span className={`badge status-${item.status.toLowerCase().replace(/ /g, '-')}`}>
                      {item.status}
                    </span>
                  </div>
                </div>
                
                <p className="trainer-desc">{item.description}</p>
                <div className="trainer-path-box">
                  <code>{item.path}</code>
                </div>

                <div className="trainer-body">
                  <div className="value-display">
                    <span>Current Value:</span>
                    <strong>{item.currentValue !== undefined ? String(item.currentValue) : 'Not found'}</strong>
                  </div>

                  <div className="trainer-controls">
                    {item.inputType === 'toggle' ? (
                      <label className="switch">
                        <input 
                          type="checkbox" 
                          checked={!!value}
                          onChange={(e) => handleValueChange(item.id, e.target.checked)}
                          disabled={isBlocked || applyingId === item.id}
                        />
                        <span className="slider round"></span>
                      </label>
                    ) : (
                      <input 
                        type="number" 
                        value={value} 
                        onChange={(e) => handleValueChange(item.id, e.target.value)}
                        placeholder="New value"
                        disabled={isBlocked || applyingId === item.id}
                        className="value-input"
                      />
                    )}
                    
                    <button 
                      className="btn-apply btn-sm"
                      onClick={() => handleApply(item.id)}
                      disabled={isBlocked || applyingId === item.id || value === undefined || value === ''}
                    >
                      {applyingId === item.id ? 'Applying...' : 'Apply'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TrainerPage;
