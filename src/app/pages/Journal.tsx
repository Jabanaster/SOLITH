import React, { useState, useEffect } from 'react';

interface JournalProps {
  gameId: string | null;
}

interface JournalEvent {
  id: string;
  timestamp: string;
  type: 'scan' | 'discovery' | 'proposal' | 'backup' | 'apply' | 'rollback' | 'error' | 'recipe' | 'game_added' | 'settings';
  description: string;
  details?: string;
  gameName?: string;
  recipeName?: string;
}

const TYPE_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  scan: { bg: 'rgba(0, 184, 230, 0.15)', text: '#00b8e6', icon: '🔍' },
  discovery: { bg: 'rgba(180, 100, 255, 0.15)', text: '#b464ff', icon: '⚡' },
  proposal: { bg: 'rgba(255, 200, 100, 0.15)', text: '#ffc864', icon: '📝' },
  backup: { bg: 'rgba(255, 150, 100, 0.15)', text: '#ff9664', icon: '📦' },
  apply: { bg: 'rgba(100, 255, 128, 0.15)', text: '#64ff80', icon: '✅' },
  rollback: { bg: 'rgba(255, 100, 100, 0.15)', text: '#ff6464', icon: '🔄' },
  error: { bg: 'rgba(255, 80, 80, 0.2)', text: '#ff5050', icon: '⚠️' },
  recipe: { bg: 'rgba(100, 255, 218, 0.15)', text: '#64ffda', icon: '📚' },
  game_added: { bg: 'rgba(255, 105, 180, 0.15)', text: '#ff69b4', icon: '🎮' },
  settings: { bg: 'rgba(150, 150, 150, 0.15)', text: '#969696', icon: '⚙️' }
};

const Journal: React.FC<JournalProps> = ({ gameId }) => {
  const [events, setEvents] = useState<JournalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<JournalEvent | null>(null);

  useEffect(() => {
    loadJournal();
  }, [gameId]);

  const loadJournal = async () => {
    if (!window.electronAPI) {
      console.error('[Journal] window.electronAPI unavailable — must run inside Electron');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await window.electronAPI.getJournal(gameId || undefined);
      if (Array.isArray(result)) {
        setEvents(result);
      } else {
        console.error('Failed to load journal: unexpected response');
        setEvents([]);
      }
    } catch (e) {
      console.error('Error fetching journal:', e);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="journal-container">
      <div className="section-header" style={{ marginBottom: '24px' }}>
        <h2>Activity Journal</h2>
        <p className="description">A detailed audit log of all automated scans, save comparisons, editor tweaks, backups, and restores performed locally.</p>
      </div>

      {loading ? (
        <div className="empty-state glass">
          <p>Loading journal timeline...</p>
        </div>
      ) : events.length === 0 ? (
        <div className="empty-state glass">
          <h3>No events recorded</h3>
          <p>Scans and edits will log entries here automatically to guarantee transparency and safety.</p>
        </div>
      ) : (
        <div className="timeline" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {events.map((event) => {
            const style = TYPE_COLORS[event.type] || { bg: 'rgba(255,255,255,0.1)', text: '#e0e0e0', icon: '📋' };
            const timeStr = new Date(event.timestamp).toLocaleString();
            
            return (
              <div 
                key={event.id} 
                className="journal-row glass"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  border: '1px solid #2d3a5c',
                  background: 'rgba(30, 30, 50, 0.4)',
                  transition: 'all 0.2s'
                }}
              >
                <div style={{
                  fontSize: '20px',
                  marginRight: '16px',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: style.bg,
                  borderRadius: '50%'
                }}>
                  {style.icon}
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span 
                      style={{
                        fontSize: '10px',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '12px',
                        background: style.bg,
                        color: style.text,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}
                    >
                      {event.type}
                    </span>
                    <span style={{ fontSize: '11px', color: '#8892b0' }}>{timeStr}</span>
                  </div>
                  <div style={{ fontSize: '14px', color: '#e0e0e0', marginTop: '4px', fontWeight: 500 }}>
                    {event.description}
                  </div>
                </div>

                {event.details && (
                  <button 
                    onClick={() => setSelectedEvent(event)}
                    className="btn-secondary"
                    style={{
                      padding: '4px 10px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      borderRadius: '4px',
                      border: '1px solid #2d3a5c'
                    }}
                  >
                    Details
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selectedEvent && (
        <div className="modal-overlay" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div className="modal-content glass" style={{ maxWidth: '600px', width: '100%', padding: '24px' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 16px 0' }}>
              <span>{TYPE_COLORS[selectedEvent.type]?.icon || '📋'}</span>
              <span>Event Details</span>
            </h3>
            
            <div style={{ fontSize: '13px', color: '#8892b0', marginBottom: '16px' }}>
              <div><strong>Time:</strong> {new Date(selectedEvent.timestamp).toLocaleString()}</div>
              <div><strong>Type:</strong> <span style={{ color: TYPE_COLORS[selectedEvent.type]?.text }}>{selectedEvent.type.toUpperCase()}</span></div>
              <div style={{ marginTop: '4px', color: '#e0e0e0', fontSize: '14px', fontWeight: 600 }}>{selectedEvent.description}</div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#64ffda', marginBottom: '6px' }}>Metadata / Payload</label>
              <pre style={{
                background: '#0d0d12',
                padding: '12px',
                borderRadius: '6px',
                overflowX: 'auto',
                fontSize: '12px',
                color: '#a0a0c0',
                border: '1px solid #2d3a5c',
                maxHeight: '300px'
              }}>
                {JSON.stringify(JSON.parse(selectedEvent.details || '{}'), null, 2)}
              </pre>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button 
                onClick={() => setSelectedEvent(null)}
                className="btn-primary"
                style={{
                  padding: '8px 16px',
                  borderRadius: '4px',
                  background: '#64ffda',
                  border: 'none',
                  color: '#0d0d12',
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Journal;
