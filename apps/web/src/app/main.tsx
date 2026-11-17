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
