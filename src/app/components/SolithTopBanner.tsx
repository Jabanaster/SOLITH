import React from 'react';
import { solithBranding } from '../assets/branding/index.js';

const TAGLINE = 'Your saves. Your rules. Your machine.';

export const SolithTopBanner: React.FC = () => (
  <header className="solith-top-banner" aria-label="Solith">
    <div className="solith-top-banner__canvas">
      <img
        className="solith-top-banner__backdrop"
        src={solithBranding.bannerBackdrop}
        alt=""
        aria-hidden="true"
        decoding="async"
      />
      <div className="solith-top-banner__shade" aria-hidden="true" />
      <div className="solith-top-banner__brand">
        <img
          className="solith-top-banner__emblem"
          src={solithBranding.trainerController}
          alt=""
          aria-hidden="true"
          decoding="async"
        />
        <div className="solith-top-banner__copy">
          <h1 className="solith-top-banner__title">SOLITH</h1>
          <p className="solith-top-banner__tagline">{TAGLINE}</p>
        </div>
      </div>
    </div>
  </header>
);
