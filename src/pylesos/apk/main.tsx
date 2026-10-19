import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadFonts } from './fonts';
import './apk.css';

loadFonts();
createRoot(document.getElementById('root')!).render(<App />);
