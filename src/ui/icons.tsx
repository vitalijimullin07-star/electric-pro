import type { ToolId } from '@editor/store';

/* Значки инструментов: простые контуры 24×24. */
const P: Record<string, string> = {
  select: 'M5 3l14 8-6 2-3 6z',
  pan: 'M8 12V6a2 2 0 1 1 4 0v5m0-3a2 2 0 1 1 4 0v3m0-1a2 2 0 1 1 4 0v4a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-3l-3-5a2 2 0 0 1 3-2l1 2',
  route: 'M4 20l6-6h5l5-5M4 20a2 2 0 1 0 0 .1M20 9a2 2 0 1 0 0-.1',
  via: 'M12 12m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M12 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0',
  wire: 'M4 17c4-10 12-10 16 0M4 17a1.5 1.5 0 1 0 0 .1M20 17a1.5 1.5 0 1 0 0 .1',
  place: 'M4 8h16v12H4zM8 8V5m4 3V5m4 3V5M8 20v2m4-2v2m4-2v2',
  line: 'M4 20L20 4',
  rect: 'M4 6h16v12H4z',
  circle: 'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0',
  poly: 'M5 9l7-5 8 4-2 9-9 3z',
  text: 'M5 6h14M12 6v13M9 19h6',
  zone: 'M4 6h16v12H4zM4 10l4-4m0 12l12-12M12 18l8-8',
  keepout: 'M4 4h16v16H4zM4 4l16 16M20 4L4 20',
  outline: 'M4 4h11l5 5v11H4zM15 4v5h5',
  measure: 'M3 17L17 3l4 4L7 21zM7 13l2 2m1-5l2 2m1-5l2 2',
  dimension: 'M4 8v10M20 8v10M4 13h16M4 13l3-2m-3 2l3 2M20 13l-3-2m3 2l-3 2M9 7h6',
  undo: 'M9 14L4 9l5-5M4 9h9a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9h-9a6 6 0 0 0 0 12h3',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  panel: 'M4 5h16v14H4zM14 5v14',
  play: 'M7 4l12 8-12 8z',
  check: 'M4 12l5 5L20 6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  trash: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13',
  rotate: 'M20 12a8 8 0 1 1-3-6.2M20 4v5h-5',
  flip: 'M12 3v18M4 8l5 4-5 4zM20 8l-5 4 5 4z',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  open: 'M3 7h6l2 2h10v10H3zM3 7V5h6',
  export: 'M12 3v12M7 8l5-5 5 5M5 15v5h14v-5',
  grid: 'M4 4h16v16H4zM4 12h16M12 4v16',
};

export function Icon({ name, size = 20 }: { name: ToolId | keyof typeof P; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[name] ?? P.select} />
    </svg>
  );
}
