import React, { useCallback, useEffect, useState } from 'react';
import type { IdentityReviewItem, IdentityReviewResolution } from '../../../../core/trainer-catalog/identity-review.js';

const REASON_LABEL: Record<string, string> = {
  'slug-collision': 'Slug collision',
  'title-source-ambiguity': 'Title/source ambiguity',
  'metadata-conflict': 'Metadata conflict',
  'identity-conflict': 'Identity conflict',
};

const RESOLUTION_ACTIONS: Array<{ id: IdentityReviewResolution; label: string }> = [
  { id: 'keep-existing', label: 'Keep existing' },
  { id: 'accept-incoming', label: 'Accept incoming' },
  { id: 'treat-separate', label: 'Treat as separate' },
  { id: 'ignore', label: 'Ignore / defer' },
];

function RecordCard({ title, record }: { title: string; record: IdentityReviewItem['leftRecord'] }) {
  return (
    <div className="identity-review-record">
      <h4>{title}</h4>
      <dl>
        <dt>Title</dt>
        <dd>{record.entry.displayName}</dd>
        <dt>Catalog ID</dt>
        <dd className="identity-review-id">{record.entry.catalogGameId}</dd>
        <dt>Provider</dt>
        <dd>{record.provider}</dd>
        <dt>Verification</dt>
        <dd>{record.entry.verificationStatus}</dd>
        {record.sourceUrl ? (
          <>
            <dt>Source</dt>
            <dd className="identity-review-id">{record.sourceUrl}</dd>
          </>
        ) : null}
        {record.entry.steamAppId != null ? (
          <>
            <dt>Steam App ID</dt>
            <dd>{record.entry.steamAppId}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

export const AdvancedSection: React.FC = () => {
  const [items, setItems] = useState<IdentityReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!window.electronAPI?.trainerCatalogIdentityReviewList) {
      setError('Identity review is unavailable in this build.');
      return;
    }
    const result = await window.electronAPI.trainerCatalogIdentityReviewList();
    if (result.success) {
      setItems(result.items ?? []);
      setError(null);
    } else {
      setError(result.error ?? 'Failed to load review queue.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resolve = async (id: string, resolution: IdentityReviewResolution) => {
    if (!window.electronAPI?.trainerCatalogIdentityReviewResolve) return;
    setResolvingId(id);
    try {
      const result = await window.electronAPI.trainerCatalogIdentityReviewResolve({ id, resolution });
      if (result.success) {
        setItems((prev) => (prev ? prev.filter((item) => item.id !== id) : prev));
      } else {
        setError(result.error ?? 'Failed to resolve review item.');
      }
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div className="settings-section">
      <div className="settings-field">
        <h3>Catalog identity review</h3>
        <p>
          Community catalog syncs that could not be safely auto-merged with an existing entry wait
          here for a manual decision. Nothing is deleted or overwritten until you resolve an item.
        </p>
      </div>

      {error ? (
        <p className="identity-review-error" role="alert">{error}</p>
      ) : null}

      {items === null ? (
        <p>Loading review queue…</p>
      ) : items.length === 0 ? (
        <p className="identity-review-empty">No pending catalog identity reviews.</p>
      ) : (
        <ul className="identity-review-list" aria-label="Pending catalog identity reviews">
          {items.map((item) => (
            <li key={item.id} className="identity-review-item">
              <div className="identity-review-item-header">
                <span className="identity-review-reason">{REASON_LABEL[item.reason] ?? item.reason}</span>
              </div>
              <div className="identity-review-compare">
                <RecordCard title="Existing" record={item.leftRecord} />
                <RecordCard title="Incoming" record={item.rightRecord} />
              </div>
              <div className="identity-review-actions">
                {RESOLUTION_ACTIONS.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    disabled={resolvingId === item.id}
                    onClick={() => resolve(item.id, action.id)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
