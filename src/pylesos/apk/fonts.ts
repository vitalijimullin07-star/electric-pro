/* Шрифты IBM Plex (OFL) — в самом приложении, без интернета: латиница и кириллица. */
import s4c from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-cyrillic-400-normal.woff2?url';
import s4l from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2?url';
import s5c from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-cyrillic-500-normal.woff2?url';
import s5l from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2?url';
import s6c from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-cyrillic-600-normal.woff2?url';
import s6l from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2?url';
import s7c from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-cyrillic-700-normal.woff2?url';
import s7l from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff2?url';
import m4c from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-cyrillic-400-normal.woff2?url';
import m4l from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url';
import m6c from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-cyrillic-600-normal.woff2?url';
import m6l from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2?url';

const CYR = 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116';
const LAT = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

export function loadFonts(): void {
  if (typeof FontFace === 'undefined') return;
  const list: [string, string, number, string][] = [
    ['IBM Plex Sans', s4c, 400, CYR], ['IBM Plex Sans', s4l, 400, LAT],
    ['IBM Plex Sans', s5c, 500, CYR], ['IBM Plex Sans', s5l, 500, LAT],
    ['IBM Plex Sans', s6c, 600, CYR], ['IBM Plex Sans', s6l, 600, LAT],
    ['IBM Plex Sans', s7c, 700, CYR], ['IBM Plex Sans', s7l, 700, LAT],
    ['IBM Plex Mono', m4c, 400, CYR], ['IBM Plex Mono', m4l, 400, LAT],
    ['IBM Plex Mono', m6c, 600, CYR], ['IBM Plex Mono', m6l, 600, LAT],
  ];
  for (const [family, url, weight, range] of list) {
    const f = new FontFace(family, `url(${url}) format('woff2')`, { weight: String(weight), unicodeRange: range, display: 'swap' });
    document.fonts.add(f);
    void f.load().catch(() => undefined);
  }
}
