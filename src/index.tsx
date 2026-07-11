import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import TrainerOverlayPage from './app/pages/TrainerOverlayPage';
import './app/styles/index.css';

const container = document.getElementById('root');
const root = createRoot(container!);

const isOverlay = window.location.hash === '#trainer-overlay';

root.render(
  <React.StrictMode>
    {isOverlay ? <TrainerOverlayPage /> : <App />}
  </React.StrictMode>
);
