import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './app/styles/index.css';

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
