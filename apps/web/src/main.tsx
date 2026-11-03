import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applyDocumentLocale } from './i18n';
import './index.css';

// <html lang dir> follow the chosen language (D-100).
applyDocumentLocale();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
