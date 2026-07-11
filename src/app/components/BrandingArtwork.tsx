import React from 'react';
import { solithBranding, type SolithBrandingArtwork } from '../assets/branding/index.js';

export type BrandingArtworkSize = 'nav' | 'section' | 'header' | 'empty';

interface BrandingArtworkProps {
  artwork: SolithBrandingArtwork;
  size?: BrandingArtworkSize;
  className?: string;
}

export const BrandingArtwork: React.FC<BrandingArtworkProps> = ({
  artwork,
  size = 'nav',
  className = '',
}) => (
  <img
    src={solithBranding[artwork]}
    alt=""
    aria-hidden="true"
    className={`branding-artwork branding-artwork--${size}${className ? ` ${className}` : ''}`}
  />
);
