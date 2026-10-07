import { createRoot } from 'react-dom/client';
import { App } from './App';
import './app.css';

createRoot(document.getElementById('root')!).render(<App />);

// Без сети приложение открывается из кеша (на сайте; с пылесоса — не нужно).
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => undefined);
