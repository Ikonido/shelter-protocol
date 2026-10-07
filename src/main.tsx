import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { StoreProvider } from './store';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { initPwa } from './lib/pwa';
import { applySettings } from './lib/settings';
import { unlockAudio } from './lib/feedback';
import { startAutoCheck } from './lib/updateStore';

applySettings();
unlockAudio();
initPwa();
if (import.meta.env.PROD) startAutoCheck();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <StoreProvider>
        <App />
      </StoreProvider>
    </ErrorBoundary>
  </StrictMode>,
);
