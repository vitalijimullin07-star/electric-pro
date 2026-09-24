import { create } from 'zustand';
import { produce } from 'immer';
import type { Vec2 } from '@core/math/vec';
import { LAYER_ORDER } from '@core/model/layers';
import { createProject } from '@core/model/project';
import type { CopperLayer, ItemRef, LayerId, Project } from '@core/model/types';
import type { DisplayUnit } from '@core/units';
import { touch } from '@core/model/edit';
import { EXAMPLES } from '@core/examples';
import { migrateProject } from '@core/io/project-file';
import { safeStorage } from './storage';

/*
 * Состояние редактора. Проект неизменяем: каждое действие делает новую
 * версию через immer, а история хранит предыдущие версии целиком.
 */

export type ToolId = 'select' | 'pan' | 'route' | 'via' | 'wire' | 'place' | 'line' | 'rect' | 'circle' | 'poly' | 'text' | 'zone' | 'keepout' | 'outline' | 'measure';

export type DialogId = 'new' | 'export' | 'board' | 'rules' | 'component' | 'net' | 'autoroute' | 'about' | 'text' | 'shortcuts' | 'open' | 'confirm' | 'prompt' | null;

/** Данные окна подтверждения или ввода: браузерные confirm()/prompt() в изолированных страницах запрещены. */
export interface AskData {
  title: string;
  message: string;
  okLabel?: string;
  danger?: boolean;
  /** Для окна ввода: начальное значение. */
  value?: string;
  onOk(value?: string): void;
  onCancel?(): void;
}

export interface RecentEntry {
  key: string;
  name: string;
  modified: string;
  size: string;
  project: Project;
}

export interface ViewState {
  /** Мировая точка в левом верхнем углу холста. */
  x: number;
  y: number;
  /** Пикселей на мм. */
  scale: number;
}

export interface Pending {
  kind: 'route' | 'poly' | 'wire' | 'measure' | 'box';
  points: Vec2[];
  cursor: Vec2 | null;
  layer?: CopperLayer;
  width?: number;
  net?: string | null;
  /** Для рамки выделения — начальная точка. */
  start?: Vec2;
  /** Точки предпросмотра от последней вершины к курсору (изгиб 45°). */
  preview?: Vec2[];
}

export interface RouteProgress {
  running: boolean;
  iteration: number;
  conflicts: number;
  fraction: number;
  message?: string;
}

export interface EditorState {
  project: Project;
  past: Project[];
  future: Project[];
  /** Идёт ли перетаскивание: история уже записана, промежуточные состояния не сохраняем. */
  transaction: boolean;

  selection: ItemRef[];
  hover: ItemRef | null;
  tool: ToolId;
  prevTool: ToolId;
  activeLayer: CopperLayer;
  layerVisible: Record<LayerId, boolean>;
  show: { ratsnest: boolean; drc: boolean; grid: boolean; refs: boolean; values: boolean; courtyard: boolean; fab: boolean; pads: boolean };
  grid: number;
  snap: boolean;
  units: DisplayUnit;
  view: ViewState;
  routeWidth: number | 'auto';
  placeFootprint: string | null;
  drawLayer: LayerId;
  drawWidth: number;
  textSize: number;
  pending: Pending | null;
  measure: { a: Vec2; b: Vec2 } | null;
  message: string;
  dialog: DialogId;
  dialogData: unknown;
  routing: RouteProgress;
  panelTab: 'props' | 'layers' | 'nets' | 'library' | 'drc';
  panelOpen: boolean;
  fileName: string | null;
  dirty: boolean;
  highlightNet: string | null;

  commit(fn: (draft: Project) => void): void;
  beginTransaction(): void;
  updateTransaction(fn: (draft: Project) => void): void;
  endTransaction(): void;
  undo(): void;
  redo(): void;
  replaceProject(p: Project, fileName?: string | null): void;
  set<K extends keyof EditorState>(key: K, value: EditorState[K]): void;
  patch(partial: Partial<EditorState>): void;
  setTool(t: ToolId): void;
  select(items: ItemRef[], add?: boolean): void;
  clearSelection(): void;
  setMessage(m: string): void;
  openDialog(d: DialogId, data?: unknown): void;
  closeDialog(): void;
  toggleLayer(l: LayerId): void;
}

export const AUTOSAVE_KEY = 'plata2:autosave';
export const SETTINGS_KEY = 'plata2:settings';
export const RECENT_KEY = 'plata2:recent';
const RECENT_LIMIT = 6;

export function loadRecent(): RecentEntry[] {
  try {
    const raw = safeStorage.getItem(RECENT_KEY);
    if (raw) return JSON.parse(raw) as RecentEntry[];
  } catch {
    /* пусто */
  }
  return [];
}

/** Кладёт проект в список недавних (в браузере), чтобы новый проект не стёр прежний. */
export function pushRecent(p: Project): void {
  if (!safeStorage.available()) return;
  const key = p.meta.created + '|' + p.meta.name;
  const xs = p.board.outline.map((q) => q.x);
  const ys = p.board.outline.map((q) => q.y);
  const entry: RecentEntry = { key, name: p.meta.name, modified: p.meta.modified, size: `${(Math.max(...xs) - Math.min(...xs)).toFixed(0)}×${(Math.max(...ys) - Math.min(...ys)).toFixed(0)} мм`, project: p };
  const list = [entry, ...loadRecent().filter((r) => r.key !== key)].slice(0, RECENT_LIMIT);
  // Если не влезает, сохраняем меньше проектов.
  for (let n = list.length; n > 0; n--) if (safeStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, n)))) return;
}

export function removeRecent(key: string): void {
  safeStorage.setItem(RECENT_KEY, JSON.stringify(loadRecent().filter((r) => r.key !== key)));
}

const allVisible = (): Record<LayerId, boolean> => Object.fromEntries(LAYER_ORDER.map((l) => [l, true])) as Record<LayerId, boolean>;

function loadInitialProject(): { project: Project; fileName: string | null } {
  try {
    const raw = safeStorage.getItem(AUTOSAVE_KEY);
    if (raw) {
      const obj = JSON.parse(raw) as { project: Project; fileName: string | null };
      if (obj && obj.project && obj.project.format) return { project: migrateProject(obj.project), fileName: obj.fileName ?? null };
    }
  } catch {
    /* нет сохранения — открываем пример */
  }
  return { project: EXAMPLES[0].create(), fileName: null };
}

function loadSettings(): Partial<EditorState> {
  try {
    const raw = safeStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw) as Partial<EditorState>;
  } catch {
    /* по умолчанию */
  }
  return {};
}

const HISTORY_LIMIT = 100;

export const useEditor = create<EditorState>((set, get) => {
  const initial = typeof window !== 'undefined' ? loadInitialProject() : { project: createProject(), fileName: null };
  const settings = typeof window !== 'undefined' ? loadSettings() : {};
  return {
    project: initial.project,
    past: [],
    future: [],
    transaction: false,
    selection: [],
    hover: null,
    tool: 'select',
    prevTool: 'select',
    activeLayer: initial.project.board.copperLayers === 1 ? 'B.Cu' : 'F.Cu',
    layerVisible: allVisible(),
    show: { ratsnest: true, drc: true, grid: true, refs: true, values: false, courtyard: false, fab: false, pads: true },
    grid: settings.grid ?? 0.635,
    snap: settings.snap ?? true,
    units: settings.units ?? 'mm',
    view: { x: -5, y: -5, scale: 4 },
    routeWidth: 'auto',
    placeFootprint: null,
    drawLayer: 'F.Silk',
    drawWidth: 0.15,
    textSize: 1.2,
    pending: null,
    measure: null,
    message: 'Выберите инструмент слева или нажмите на объект.',
    dialog: null,
    dialogData: null,
    routing: { running: false, iteration: 0, conflicts: 0, fraction: 0 },
    panelTab: 'props',
    panelOpen: typeof window !== 'undefined' ? window.innerWidth >= 900 : true,
    fileName: initial.fileName,
    dirty: false,
    highlightNet: null,

    commit(fn) {
      const s = get();
      const next = produce(s.project, (d) => {
        fn(d);
        touch(d);
      });
      if (next === s.project) return;
      set({ project: next, past: [...s.past.slice(-HISTORY_LIMIT), s.project], future: [], dirty: true });
    },
    beginTransaction() {
      const s = get();
      if (s.transaction) return;
      set({ transaction: true, past: [...s.past.slice(-HISTORY_LIMIT), s.project], future: [] });
    },
    updateTransaction(fn) {
      const s = get();
      const next = produce(s.project, (d) => {
        fn(d);
      });
      if (next !== s.project) set({ project: next, dirty: true });
    },
    endTransaction() {
      const s = get();
      if (!s.transaction) return;
      if (s.past.length && s.past[s.past.length - 1] === s.project) set({ transaction: false, past: s.past.slice(0, -1) });
      else {
        set({ transaction: false, project: produce(s.project, (d) => touch(d)) });
      }
    },
    undo() {
      const s = get();
      if (!s.past.length || s.transaction) return;
      const prev = s.past[s.past.length - 1];
      set({ project: prev, past: s.past.slice(0, -1), future: [s.project, ...s.future].slice(0, HISTORY_LIMIT), selection: [], pending: null, dirty: true, message: 'Отменено.' });
    },
    redo() {
      const s = get();
      if (!s.future.length || s.transaction) return;
      const next = s.future[0];
      set({ project: next, past: [...s.past, s.project], future: s.future.slice(1), selection: [], pending: null, dirty: true, message: 'Повторено.' });
    },
    replaceProject(p, fileName = null) {
      const cur = get().project;
      if (cur !== p && (Object.keys(cur.components).length || Object.keys(cur.tracks).length || Object.keys(cur.drawings).length)) pushRecent(cur);
      set({
        project: p,
        past: [],
        future: [],
        selection: [],
        hover: null,
        pending: null,
        measure: null,
        highlightNet: null,
        activeLayer: p.board.copperLayers === 1 ? 'B.Cu' : 'F.Cu',
        fileName,
        dirty: false,
        tool: 'select',
        message: `Открыт проект «${p.meta.name}».`,
      });
    },
    set(key, value) {
      set({ [key]: value } as Partial<EditorState>);
    },
    patch(partial) {
      set(partial);
    },
    setTool(t) {
      const s = get();
      set({ tool: t, prevTool: s.tool === t ? s.prevTool : s.tool, pending: null, measure: t === 'measure' ? s.measure : null, placeFootprint: t === 'place' ? s.placeFootprint : null, message: TOOL_HINTS[t] });
    },
    select(items, add = false) {
      const s = get();
      if (!add) {
        set({ selection: items });
        return;
      }
      const keys = new Set(s.selection.map((i) => i.kind + ':' + i.id));
      const out = [...s.selection];
      for (const it of items) {
        const k = it.kind + ':' + it.id;
        if (keys.has(k)) {
          const idx = out.findIndex((x) => x.kind + ':' + x.id === k);
          out.splice(idx, 1);
          keys.delete(k);
        } else {
          out.push(it);
          keys.add(k);
        }
      }
      set({ selection: out });
    },
    clearSelection() {
      set({ selection: [], highlightNet: null });
    },
    setMessage(m) {
      set({ message: m });
    },
    openDialog(d, data = null) {
      set({ dialog: d, dialogData: data });
    },
    closeDialog() {
      set({ dialog: null, dialogData: null });
    },
    toggleLayer(l) {
      const s = get();
      set({ layerVisible: { ...s.layerVisible, [l]: !s.layerVisible[l] } });
    },
  };
});

export const TOOL_HINTS: Record<ToolId, string> = {
  select: 'Нажмите на объект, чтобы выбрать; тяните, чтобы переместить. Рамка — выделение нескольких. R — повернуть, F — на другую сторону, Delete — удалить.',
  pan: 'Тяните холст, чтобы двигать. Колесо — масштаб.',
  route: 'Нажмите на площадку или дорожку — начало. Каждый щелчок ставит изгиб, щелчок по площадке цепи заканчивает. V — переходное и смена слоя, Backspace — убрать изгиб, Esc — отмена.',
  via: 'Щелчок ставит переходное отверстие.',
  wire: 'Перемычка проводом: щелчок на первой площадке, щелчок на второй.',
  place: 'Выберите корпус в библиотеке справа. Щелчок ставит компонент, R — поворот, Esc — закончить.',
  line: 'Линия: щелчок — начало, щелчок — конец. Esc — закончить.',
  rect: 'Прямоугольник: два щелчка по углам.',
  circle: 'Окружность: центр, затем радиус.',
  poly: 'Многоугольник: щелчки по вершинам, двойной щелчок — замкнуть.',
  text: 'Щелчок ставит надпись.',
  zone: 'Полигон меди: щелчки по вершинам, двойной щелчок — замкнуть.',
  keepout: 'Область правил: щелчки по вершинам, двойной щелчок — замкнуть. Потом задайте ограничения в свойствах.',
  outline: 'Новый контур платы: щелчки по вершинам, двойной щелчок — замкнуть. Прямоугольник проще задать в настройках платы.',
  measure: 'Линейка: два щелчка.',
};

/** Сохранение проекта и настроек в браузере (с задержкой, чтобы не тормозить). */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function setupAutosave(): void {
  useEditor.subscribe((s, prev) => {
    if (s.project === prev.project && s.grid === prev.grid && s.units === prev.units && s.snap === prev.snap) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      safeStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ project: s.project, fileName: s.fileName }));
      safeStorage.setItem(SETTINGS_KEY, JSON.stringify({ grid: s.grid, units: s.units, snap: s.snap }));
    }, 600);
  });
}
