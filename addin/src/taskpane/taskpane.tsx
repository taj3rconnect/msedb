import React from 'react';
import { createRoot } from 'react-dom/client';
import './app.css';
import App from './App';

/* global Office */

Office.onReady(() => {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    return;
  }

  const root = createRoot(rootElement);
  root.render(<App />);
});
