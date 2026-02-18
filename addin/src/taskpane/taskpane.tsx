import React from 'react';
import { createRoot } from 'react-dom/client';

/* global Office */

Office.onReady(() => {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    return;
  }

  const root = createRoot(rootElement);
  root.render(
    <div style={{ padding: '16px', fontFamily: 'Segoe UI, sans-serif' }}>
      <h2>MSEDB Email Manager</h2>
      <p>MSEDB Add-in Loading...</p>
    </div>
  );
});
