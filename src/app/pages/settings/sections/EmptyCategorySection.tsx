import React from 'react';

type Props = {
  categoryLabel: string;
};

/** Truthful empty state for a Settings category with no implemented controls yet. */
export const EmptyCategorySection: React.FC<Props> = ({ categoryLabel }) => (
  <div className="settings-empty-state" role="status">
    <p>No configurable options in this category yet.</p>
    <p className="settings-empty-state__hint">
      {categoryLabel} controls that already exist elsewhere in Solith remain where they are today.
    </p>
  </div>
);
