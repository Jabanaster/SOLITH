import React from 'react';
import type { SolithBrandingArtwork } from '../assets/branding/index.js';
import type { WalkthroughId } from '../help/walkthroughs.js';
import { BrandingArtwork } from './BrandingArtwork.js';
import { PageWalkthrough } from './PageWalkthrough.js';

interface PageModuleHeaderProps {
  artwork: SolithBrandingArtwork;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  walkthroughId?: WalkthroughId;
}

export const PageModuleHeader: React.FC<PageModuleHeaderProps> = ({
  artwork,
  title,
  description,
  actions,
  className = '',
  walkthroughId,
}) => (
  <>
    <div className={`page-module-header${className ? ` ${className}` : ''}`}>
      <div className="page-module-header__main">
        <div className="page-module-header__icon" aria-hidden="true">
          <BrandingArtwork artwork={artwork} size="header" />
        </div>
        <div className="page-module-header__text">
          <h2 className="page-module-header__title">{title}</h2>
          {description != null && description !== '' && (
            <p className="page-module-header__description description">{description}</p>
          )}
        </div>
      </div>
      <div className="page-module-header__side">
        {actions ? <div className="page-module-header__actions">{actions}</div> : null}
        {walkthroughId ? <PageWalkthrough pageId={walkthroughId} /> : null}
      </div>
    </div>
  </>
);
