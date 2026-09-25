import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setupAutosave } from '@editor/store';
import '@ui/styles.css';
import { installQaHooks } from './qa-hooks';
import { setupPwa } from './pwa';

setupAutosave();
installQaHooks();
setupPwa();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
