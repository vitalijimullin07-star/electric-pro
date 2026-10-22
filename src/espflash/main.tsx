import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadFonts } from '../pylesos/apk/fonts';
import './flash.css';

loadFonts();
createRoot(document.getElementById('root')!).render(<App />);
