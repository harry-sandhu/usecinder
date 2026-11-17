// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/styles/globals.css';
import { App } from './App';

const redirectKey = 'cinder-redirect-path';
const redirectedPath = window.sessionStorage.getItem(redirectKey);

if (redirectedPath) {
  window.sessionStorage.removeItem(redirectKey);
  window.history.replaceState(null, '', redirectedPath);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
