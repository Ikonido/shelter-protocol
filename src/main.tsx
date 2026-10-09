import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { StoreProvider } from './store';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { initPwa } from './lib/pwa';
import { applySettings, getSettings } from './lib/settings';
import { loadLang } from './i18n/registry';
import { unlockAudio } from './lib/feedback';
import { startAutoCheck } from './lib/updateStore';

applySettings();
unlockAudio();
initPwa();
if (import.meta.env.PROD) startAutoCheck();

// Словарь выбранного языка грузится до первого показа: иначе интерфейс мигнул бы русским. Не загрузился (нет сети и нет кеша) — играем по-русски.
loadLang(getSettings().lang)
  .catch(() => undefined)
  .then(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <ErrorBoundary>
          <StoreProvider>
            <App />
          </StoreProvider>
        </ErrorBoundary>
      </StrictMode>,
    );
  });
