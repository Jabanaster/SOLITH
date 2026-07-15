import React from 'react';
import { solithBranding } from '../assets/branding/index.js';

/** Full raster banner from approved Solith branding (emblem + title + tagline baked in). */
export const SolithTopBanner: React.FC = () => (
  <header className="solith-top-banner" aria-label="Solith — Your saves. Your rules. Your machine.">
    <img
      className="solith-top-banner__full"
      src={solithBranding.topBanner}
      alt="Solith — Your saves. Your rules. Your machine."
      decoding="async"
    />
  </header>
);
