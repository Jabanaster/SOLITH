import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import TrainerOverlayPage from './app/pages/TrainerOverlayPage';
import WispOverlayPage from './app/pages/WispOverlayPage';
import './app/styles/index.css';
import './app/styles/trainer-control-panel.css';

const container = document.getElementById('root');
const root = createRoot(container!);

const route = window.location.hash;
if (route === '#wisp-overlay') {
  document.documentElement.classList.add('wisp-overlay-document');
  document.body.classList.add('wisp-overlay-document');
}

root.render(
  <React.StrictMode>
    {route === '#trainer-overlay'
      ? <TrainerOverlayPage />
      : route === '#wisp-overlay'
        ? <WispOverlayPage />
        : <App />}
  </React.StrictMode>
);
