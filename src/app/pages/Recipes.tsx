import React, { useState, useEffect } from 'react';
import { PageModuleHeader } from '../components/PageModuleHeader.js';

interface RecipesProps {
  gameId: string | null;
}

interface RecipeItem {
  id: string;
  name: string;
  description: string;
  category: string;
  source: string;
  risk: string;
  status: string;
  confidence?: number;
  currentValue?: string | number;
  path?: string;
  target?: string;
}

const CATEGORIES = [
  { id: 'all', label: 'ALL' },
  { id: 'PLAYER', label: 'PLAYER' },
  { id: 'INVENTORY', label: 'INVENTORY' },
  { id: 'STATS', label: 'STATS' },
  { id: 'ENEMIES', label: 'ENEMIES' },
  { id: 'GAME', label: 'GAME' },
  { id: 'UNLOCKS', label: 'UNLOCKS' }
];

const Recipes: React.FC<RecipesProps> = ({ gameId }) => {
  const [recipes, setRecipes] = useState<RecipeItem[]>([]);
  const [activeCategory, setActiveCategory] = useState('all');
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (gameId) {
      loadRecipes();
    }
  }, [gameId]);

  const loadRecipes = async () => {
    if (!window.electronAPI) {
      console.error('[Recipes] window.electronAPI unavailable — must run inside Electron');
      setLoading(false);
      return;
    }
    if (!gameId) { setLoading(false); return; }
    setLoading(true);
    try {
      const result = await window.electronAPI.getRecipes(gameId);
      if (Array.isArray(result)) {
        setRecipes(result);
      } else {
        console.error('Failed to load recipes: unexpected response');
        setRecipes([]);
      }
    } catch (e) {
      console.error('Error fetching recipes:', e);
      setRecipes([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (recipeId: string) => {
    if (!window.electronAPI) return;
    if (!confirm('Are you sure you want to delete this recipe?')) return;
    setDeletingId(recipeId);
    try {
      const result = await window.electronAPI.deleteRecipe(recipeId);
      if (result && !result.error) {
        alert('Recipe deleted successfully!');
        await loadRecipes();
      } else {
        alert(`Failed to delete recipe: ${result?.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error deleting recipe:', error);
      alert('An error occurred while deleting the recipe.');
    } finally {
      setDeletingId(null);
    }
  };

  const filteredRecipes = activeCategory === 'all'
    ? recipes
    : recipes.filter(r => r.category.toUpperCase() === activeCategory.toUpperCase());

  return (
    <div className="recipes-container">
      <PageModuleHeader
        artwork="hoodedProfile"
        title="Trainer Recipes"
        description="Manage your saved trainer configurations. These recipes represent offsets and targets discovered in your game files."
        walkthroughId="recipes"
      />

      <div className="categories-filter" style={{ display: 'flex', gap: '8px', marginBottom: '24px', overflowX: 'auto', paddingBottom: '8px' }}>
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className="btn-secondary"
            style={{
              padding: '6px 16px',
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: 600,
              background: activeCategory === cat.id ? 'rgba(100, 255, 218, 0.15)' : 'transparent',
              borderColor: activeCategory === cat.id ? '#64ffda' : '#2d3a5c',
              color: activeCategory === cat.id ? '#64ffda' : '#a0a0c0',
              cursor: 'pointer'
            }}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="empty-state glass">
          <p>Loading trainer recipes...</p>
        </div>
      ) : filteredRecipes.length === 0 ? (
        <div className="empty-state glass">
          <h3>No recipes in this category</h3>
          <p>Go to the <strong>Discovery Lab</strong> or the <strong>Save Editor</strong> to scan files and generate trainer actions.</p>
        </div>
      ) : (
        <div className="trainer-grid">
          {filteredRecipes.map(recipe => {
            const isBlocked = recipe.status === 'Blocked' || recipe.risk === 'Blocked';
            const isStale = recipe.status === 'Needs Rescan';
            const targetFileName = recipe.target ? recipe.target.replace(/\\/g, '/').split('/').pop() : '';

            return (
              <div key={recipe.id} className={`trainer-card glass ${isBlocked ? 'blocked' : ''} ${isStale ? 'stale' : ''}`} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div className="trainer-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                    <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>{recipe.name}</h4>
                    <span className={`badge risk-${recipe.risk.toLowerCase()}`} style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      fontWeight: 600,
                      background: recipe.risk === 'Safe' ? 'rgba(100, 255, 128, 0.15)' : recipe.risk === 'Risky' ? 'rgba(255, 150, 100, 0.15)' : 'rgba(255, 200, 100, 0.15)',
                      color: recipe.risk === 'Safe' ? '#64ff80' : recipe.risk === 'Risky' ? '#ff9664' : '#ffc864'
                    }}>
                      {recipe.risk}
                    </span>
                  </div>

                  <p className="trainer-desc" style={{ fontSize: '13px', color: '#8892b0', marginBottom: '16px' }}>{recipe.description || 'No description provided.'}</p>
                  
                  <div className="recipe-details" style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '6px', fontSize: '12px', marginBottom: '16px' }}>
                    <div style={{ marginBottom: '6px' }}><strong>Category:</strong> <span style={{ color: '#64ffda' }}>{recipe.category}</span></div>
                    <div style={{ marginBottom: '6px' }}><strong>Target File:</strong> <code style={{ color: '#a0a0c0' }}>{targetFileName}</code></div>
                    <div style={{ marginBottom: '6px' }}><strong>Path Offset:</strong> <code style={{ color: '#e0e0e0' }}>{recipe.path}</code></div>
                    {recipe.confidence !== undefined && (
                      <div><strong>Confidence Score:</strong> <span style={{ color: recipe.confidence >= 70 ? '#64ff80' : '#ffc864' }}>{recipe.confidence}%</span></div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                  <span className={`badge status-${recipe.status.toLowerCase().replace(/ /g, '-')}`} style={{
                    fontSize: '11px',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    background: recipe.status === 'Ready' ? 'rgba(0, 212, 255, 0.15)' : 'rgba(255, 100, 100, 0.15)',
                    color: recipe.status === 'Ready' ? '#00d4ff' : '#ff6464'
                  }}>
                    Status: {recipe.status}
                  </span>
                  
                  <button
                    onClick={() => handleDelete(recipe.id)}
                    className="btn-secondary"
                    disabled={deletingId === recipe.id}
                    style={{
                      padding: '4px 10px',
                      fontSize: '11px',
                      borderColor: 'rgba(255, 100, 100, 0.4)',
                      color: '#ff6464',
                      cursor: 'pointer',
                      background: 'transparent',
                      borderRadius: '4px',
                      border: '1px solid'
                    }}
                  >
                    {deletingId === recipe.id ? 'Deleting...' : '🗑️ Delete'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Recipes;
