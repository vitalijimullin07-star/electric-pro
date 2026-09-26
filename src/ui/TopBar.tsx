import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '@editor/store';
import { parseProjectFile, serializeProject, PROJECT_EXT } from '@core/io/project-file';
import { openFileBytes, saveTextFile } from './files';
import { safeName } from '@core/io/gerber';
import { footprintsFromFiles, importFootprintFiles, importKicadBoardFile, importLayFile, openKicadBoardText, openLayBytes } from './library-io';
import { addUserFootprints } from '@editor/userlib';
import { installApp } from '../app/pwa';
import { enterSchematic, leaveSchematic, mirrorSchSelection, rotateSchSelection, setSchTool, updateBoardFromSchematic } from '@editor/sch';
import { exportSchematicPdf } from '@core/io/sch-pdf';
import type { SchTool } from '@editor/store';

function enterSchematicTool(t: SchTool): void {
  enterSchematic();
  setSchTool(t);
}

async function printSchematic(): Promise<void> {
  const s = useEditor.getState();
  const r = exportSchematicPdf(s.project);
  if (!r) return s.setMessage('Схема пуста.');
  const ok = await saveTextFile(`${safeName(s.project.meta.name)}-schematic.pdf`, r.bytes, 'application/pdf');
  if (ok !== false) s.setMessage(`Схема сохранена в PDF (лист ${r.paper}).`);
}
import { alignSelection, copySelection, cutSelection, deleteSelection, distributeSelection, duplicateSelection, flipSelection, groupSelection, hasClipboard, pasteClipboard, rotateSelection, selectAll, ungroupSelection } from '@editor/commands';
import { clearRouting } from '@core/model/edit';
import { Icon } from './icons';
import { askConfirm } from './dialogs/AskDialog';
import { QUALITY_NAMES, detectLevel, type QualityMode } from '@render/quality';
import { simRuntime } from '@editor/sim-runtime';
import { loadFirmware } from './panels/SimPanel';

/* Верхняя строка меню в духе EasyEDA: Файл, Правка, Вид, Плата, Трассировка, Экспорт, Справка. */

type Item = { label: string; kbd?: string; action?: () => void; disabled?: boolean } | 'sep';

/*
 * Выпадающий список рисуется в портале поверх всего окна (position: fixed): строка меню
 * прокручивается по горизонтали на телефоне и обрезала бы всё, что ниже её высоты.
 */
function MenuDrop({ items, anchor, onClose, dropRef }: { items: Item[]; anchor: DOMRect; onClose: () => void; dropRef: React.RefObject<HTMLDivElement | null> }) {
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom, maxHeight: window.innerHeight - anchor.bottom - 8 });
  useLayoutEffect(() => {
    const el = dropRef.current;
    const w = el?.offsetWidth ?? 250;
    const left = Math.max(4, Math.min(anchor.left, window.innerWidth - w - 4));
    setPos({ left, top: anchor.bottom, maxHeight: window.innerHeight - anchor.bottom - 8 });
  }, [anchor, dropRef]);
  return createPortal(
    <div className="menu-drop" role="menu" ref={dropRef} style={{ left: pos.left, top: pos.top, maxHeight: pos.maxHeight }}>
      {items.map((it, i) =>
        it === 'sep' ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.action?.();
            }}
          >
            <span>{it.label}</span>
            {it.kbd && <kbd>{it.kbd}</kbd>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

export async function saveProject(): Promise<void> {
  const s = useEditor.getState();
  const name = s.fileName ?? safeName(s.project.meta.name) + PROJECT_EXT;
  try {
    const ok = await saveTextFile(name, serializeProject(s.project, true), 'application/json');
    useEditor.setState(ok ? { dirty: false, fileName: name, message: `Сохранено: ${name}` } : { message: 'Сохранение отменено.' });
  } catch (e) {
    useEditor.setState({ message: `Не удалось сохранить: ${(e as Error).message}` });
  }
}

export async function openProject(): Promise<void> {
  const file = await openFileBytes('.json,.kicad_pcb,.kicad_mod,.lay,.lay6,application/json');
  if (!file) return;
  const s = useEditor.getState();
  if (/\.lay6?$/i.test(file.name)) return openLayBytes(file.name, file.bytes);
  const f = { name: file.name, text: file.text() };
  if (/\.kicad_pcb$/i.test(f.name)) return openKicadBoardText(f.name, f.text);
  if (/\.kicad_mod$/i.test(f.name)) {
    const { fps, errors } = footprintsFromFiles([f]);
    if (!fps.length) return s.setMessage(errors.join('; '));
    addUserFootprints(fps);
    s.setTool('place');
    s.patch({ placeFootprint: fps[0].id, panelTab: 'library', panelOpen: true });
    return s.setMessage(`Корпус «${fps[0].name}» добавлен в «Мои корпуса». Щёлкните по плате, чтобы поставить.`);
  }
  try {
    const r = parseProjectFile(f.text);
    if (r.kind === 'project') s.replaceProject(r.project, f.name);
    else s.setMessage('Это файл первой версии Plata (плата пылесоса) — такие файлы больше не открываются.');
  } catch (e) {
    s.setMessage((e as Error).message || 'Не удалось открыть файл.');
  }
}

export function TopBar() {
  const [open, setOpen] = useState<{ id: string; anchor: DOMRect } | null>(null);
  const ref = useRef<HTMLElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const s = useEditor();
  const p = s.project;

  useEffect(() => {
    const onSave = () => void saveProject();
    const onOpen = () => void openProject();
    window.addEventListener('plata:save', onSave);
    window.addEventListener('plata:open', onOpen);
    return () => {
      window.removeEventListener('plata:save', onSave);
      window.removeEventListener('plata:open', onOpen);
    };
  }, []);

  // Пока меню открыто: щелчок мимо, Esc, прокрутка строки меню или изменение окна его закрывают.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || dropRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    const bar = ref.current;
    document.addEventListener('pointerdown', onDoc, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    bar?.addEventListener('scroll', close);
    return () => {
      document.removeEventListener('pointerdown', onDoc, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      bar?.removeEventListener('scroll', close);
    };
  }, [open]);

  const openMenu = (id: string, btn: HTMLElement) => setOpen({ id, anchor: btn.getBoundingClientRect() });

  const toggle = (k: keyof typeof s.show) => s.patch({ show: { ...s.show, [k]: !s.show[k] } });
  const mark = (v: boolean) => (v ? '✓ ' : ' ');
  const setQuality = (q: QualityMode) => {
    // «Авто» заново оценивает устройство: вдруг раньше понизили из-за разовой задержки.
    s.patch(q === 'auto' ? { quality: q, gfxLevel: detectLevel() } : { quality: q });
    s.setMessage(
      q === 'eco'
        ? 'Экономная графика: обычная чёткость, без теней и свечения — меньше нагрев и расход батареи.'
        : q === 'high'
          ? 'Максимальная графика: полная чёткость экрана, свечение, блики и анимация.'
          : q === 'balanced'
            ? 'Сбалансированная графика: чёткость до 2×, свечение и блики без анимации.'
            : 'Качество подбирается по устройству и снижается, если кадры рисуются медленно.',
    );
  };

  const menus: { id: string; label: string; items: Item[] }[] = [
    {
      id: 'file',
      label: 'Файл',
      items: [
        { label: 'Новый проект…', kbd: '', action: () => s.openDialog('new') },
        { label: 'Открыть файл проекта…', kbd: 'Ctrl+O', action: () => void openProject() },
        { label: 'Недавние проекты…', action: () => s.openDialog('open') },
        { label: 'Импорт платы KiCad (.kicad_pcb)…', action: () => void importKicadBoardFile() },
        { label: 'Импорт платы Sprint Layout (.lay)…', action: () => void importLayFile() },
        { label: 'Импорт корпусов KiCad (.kicad_mod)…', action: () => void importFootprintFiles() },
        { label: 'Сохранить проект', kbd: 'Ctrl+S', action: () => void saveProject() },
        'sep',
        { label: 'Экспорт: Gerber, SVG, BOM…', action: () => s.openDialog('export') },
        { label: 'Проверка для производства…', action: () => s.openDialog('dfm') },
        'sep',
        { label: 'Настройки платы и правила…', action: () => s.openDialog('board') },
      ],
    },
    {
      id: 'edit',
      label: 'Правка',
      items: [
        { label: 'Отменить', kbd: 'Ctrl+Z', action: s.undo, disabled: !s.past.length },
        { label: 'Повторить', kbd: 'Ctrl+Y', action: s.redo, disabled: !s.future.length },
        'sep',
        { label: 'Вырезать', kbd: 'Ctrl+X', action: cutSelection, disabled: !s.selection.length },
        { label: 'Копировать', kbd: 'Ctrl+C', action: copySelection, disabled: !s.selection.length },
        { label: 'Вставить', kbd: 'Ctrl+V', action: () => pasteClipboard(null), disabled: !hasClipboard() },
        { label: 'Дублировать', kbd: 'Ctrl+D', action: duplicateSelection, disabled: !s.selection.length },
        'sep',
        { label: 'Выделить всё', kbd: 'Ctrl+A', action: selectAll },
        { label: 'Удалить выделенное', kbd: 'Del', action: deleteSelection, disabled: !s.selection.length },
        { label: 'Повернуть на 90°', kbd: 'R', action: () => rotateSelection(90), disabled: !s.selection.length },
        { label: 'На другую сторону или слой', kbd: 'F', action: flipSelection, disabled: !s.selection.length },
        { label: 'Перенос между слоями…', action: () => s.openDialog('layers') },
        'sep',
        { label: 'Заменить корпуса у деталей…', action: () => s.openDialog('replace', {}), disabled: !Object.keys(s.project.components).length },
        { label: 'Свойства компонента…', action: () => s.openDialog('component', s.selection.find((r) => r.kind === 'component')?.id), disabled: !s.selection.some((r) => r.kind === 'component') },
      ],
    },
    {
      id: 'sch',
      label: 'Схема',
      items: [
        s.mode === 'sch' ? { label: 'Перейти к плате', action: leaveSchematic } : { label: 'Открыть схему', action: enterSchematic },
        { label: 'Обновить плату по схеме', action: updateBoardFromSchematic, disabled: !p.schematic },
        { label: 'Добавить на схему детали с платы', action: enterSchematic },
        'sep',
        { label: 'Провод', kbd: 'W', action: () => (s.mode === 'sch' ? setSchTool('wire') : enterSchematicTool('wire')) },
        { label: 'Метка цепи', kbd: 'N', action: () => (s.mode === 'sch' ? setSchTool('label') : enterSchematicTool('label')) },
        { label: 'Повернуть', kbd: 'R', action: rotateSchSelection, disabled: s.mode !== 'sch' || !s.schSelection.length },
        { label: 'Зеркально', kbd: 'X', action: mirrorSchSelection, disabled: s.mode !== 'sch' || !s.schSelection.some((r) => r.kind === 'symbol') },
        'sep',
        { label: 'Печать схемы (PDF)', action: () => void printSchematic(), disabled: !p.schematic || !Object.keys(p.schematic.symbols).length },
      ],
    },
    {
      id: 'sim',
      label: 'Симуляция',
      items: [
        { label: 'Загрузить прошивку (.hex)…', action: () => void loadFirmware() },
        s.sim.status === 'running'
          ? { label: 'Пауза', action: () => simRuntime.pause() }
          : { label: s.sim.status === 'paused' ? 'Продолжить' : 'Старт', action: () => (s.sim.status === 'paused' ? simRuntime.resume() : (simRuntime.start(), s.patch({ panelTab: 'sim', panelOpen: true }))), disabled: !p.firmware },
        { label: 'Сброс (с начала)', action: () => simRuntime.start(), disabled: s.sim.status === 'off' },
        { label: 'Стоп', action: () => simRuntime.stop(), disabled: s.sim.status === 'off' },
        'sep',
        { label: 'Монитор порта, датчики, выводы…', action: () => s.patch({ panelTab: 'sim', panelOpen: true }) },
      ],
    },
    {
      id: 'arrange',
      label: 'Упорядочить',
      items: [
        {
          label: mark(s.followTracks) + 'Дорожки тянутся за компонентом',
          action: () => {
            s.patch({ followTracks: !s.followTracks });
            s.setMessage(s.followTracks ? 'Дорожки остаются на месте: к оторванным выводам покажутся воздушные линии.' : 'Концы дорожек будут ехать за компонентом с изломом 45°.');
          },
        },
        'sep',
        { label: 'Выровнять по левому краю', action: () => alignSelection('left'), disabled: s.selection.length < 2 },
        { label: 'Выровнять по правому краю', action: () => alignSelection('right'), disabled: s.selection.length < 2 },
        { label: 'Выровнять по верху', action: () => alignSelection('top'), disabled: s.selection.length < 2 },
        { label: 'Выровнять по низу', action: () => alignSelection('bottom'), disabled: s.selection.length < 2 },
        { label: 'Центры по вертикали', action: () => alignSelection('hcenter'), disabled: s.selection.length < 2 },
        { label: 'Центры по горизонтали', action: () => alignSelection('vcenter'), disabled: s.selection.length < 2 },
        'sep',
        { label: 'Распределить по горизонтали', action: () => distributeSelection('h'), disabled: s.selection.length < 3 },
        { label: 'Распределить по вертикали', action: () => distributeSelection('v'), disabled: s.selection.length < 3 },
        'sep',
        { label: 'Сгруппировать', kbd: 'Ctrl+G', action: groupSelection, disabled: s.selection.length < 2 },
        { label: 'Разгруппировать', kbd: 'Ctrl+Shift+G', action: ungroupSelection, disabled: !s.selection.length },
      ],
    },
    {
      id: 'view',
      label: 'Вид',
      items: [
        { label: mark(s.show.grid) + 'Сетка', kbd: 'G', action: () => toggle('grid') },
        { label: mark(s.show.ratsnest) + 'Воздушные линии', action: () => toggle('ratsnest') },
        { label: mark(s.show.drc) + 'Отметки проверки', action: () => toggle('drc') },
        { label: mark(s.show.refs) + 'Позиционные обозначения', action: () => toggle('refs') },
        { label: mark(s.show.values) + 'Номиналы', action: () => toggle('values') },
        { label: mark(s.show.courtyard) + 'Габариты корпусов', action: () => toggle('courtyard') },
        { label: mark(s.show.fab) + 'Сборочный слой', action: () => toggle('fab') },
        'sep',
        { label: '3D-вид платы', kbd: '3', action: () => s.openDialog('3d') },
        'sep',
        ...(['auto', 'high', 'balanced', 'eco'] as QualityMode[]).map((q) => ({
          label: mark(s.quality === q) + 'Графика: ' + QUALITY_NAMES[q].toLowerCase() + (q === 'auto' ? ` (сейчас ${QUALITY_NAMES[s.gfxLevel].toLowerCase()})` : ''),
          action: () => setQuality(q),
        })),
        'sep',
        { label: 'Вся плата', kbd: '0', action: () => window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' })) },
        { label: 'Переключить активный слой', kbd: 'L', action: () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l' })) },
        { label: (s.panelOpen ? '✓ ' : ' ') + 'Боковая панель', action: () => s.patch({ panelOpen: !s.panelOpen }) },
      ],
    },
    {
      id: 'place',
      label: 'Разместить',
      items: [
        { label: 'Компонент из библиотеки…', kbd: 'P', action: () => {
          s.setTool('place');
          s.patch({ panelTab: 'library', panelOpen: true });
        } },
        { label: 'Цепи: список и создание…', action: () => s.patch({ panelTab: 'nets', panelOpen: true }) },
        'sep',
        { label: 'Надпись', kbd: 'T', action: () => s.setTool('text') },
        { label: 'Размерная линия', action: () => s.setTool('dimension') },
        { label: 'Область правил (запрет, 230 В)', action: () => s.setTool('keepout') },
        { label: 'Полигон меди', action: () => s.setTool('zone') },
        { label: 'Новый контур платы', action: () => s.setTool('outline') },
      ],
    },
    {
      id: 'route',
      label: 'Трассировка',
      items: [
        { label: 'Дорожка', kbd: 'W', action: () => s.setTool('route') },
        { label: 'Переходное отверстие', kbd: 'V', action: () => s.setTool('via') },
        { label: 'Перемычка проводом', kbd: 'J', action: () => s.setTool('wire') },
        { label: mark(!!s.project.rules.teardrops) + 'Каплевидные переходы', action: () => {
          const on = !s.project.rules.teardrops;
          s.commit((d) => void (d.rules.teardrops = on || undefined));
          s.setMessage(on ? 'Капли включены: дорожки плавно расширяются у площадок и переходных (где хватает зазора).' : 'Капли выключены.');
        } },
        'sep',
        { label: 'Автотрассировка…', action: () => s.openDialog('autoroute') },
        { label: 'Стереть все дорожки', action: () =>
          askConfirm({ title: 'Стереть все дорожки', message: 'Стереть все дорожки, переходные и перемычки? Вернуть можно через Ctrl+Z.', okLabel: 'Стереть', danger: true, onOk: () => s.commit((d) => clearRouting(d)) }) },
        'sep',
        { label: 'Проверка правил (DRC)', action: () => s.patch({ panelTab: 'drc', panelOpen: true }) },
      ],
    },
    {
      id: 'help',
      label: 'Справка',
      items: [
        { label: 'Горячие клавиши', action: () => s.openDialog('shortcuts') },
        { label: s.installable ? 'Установить как приложение' : 'Как установить приложение', action: () => void installApp() },
        { label: 'О программе', action: () => s.openDialog('about') },
      ],
    },
  ];

  return (
    <header className="topbar" ref={ref}>
      <span className="brand">
        <svg viewBox="0 0 32 32" aria-hidden>
          <rect width="32" height="32" rx="6" fill="#1b3a2a" />
          <circle cx="9" cy="9" r="3.5" fill="#e8b061" />
          <circle cx="23" cy="23" r="3.5" fill="#e8b061" />
          <path d="M9 9h8v14h6" stroke="#e8b061" strokeWidth="3" fill="none" strokeLinejoin="round" />
        </svg>
        Plata
      </span>
      <span className="mode-switch" role="tablist" aria-label="Что редактировать">
        <button role="tab" aria-selected={s.mode === 'pcb'} className={s.mode === 'pcb' ? 'on' : ''} onClick={leaveSchematic}>
          Плата
        </button>
        <button role="tab" aria-selected={s.mode === 'sch'} className={s.mode === 'sch' ? 'on' : ''} onClick={() => s.mode !== 'sch' && enterSchematic()}>
          Схема
        </button>
      </span>
      {menus.map((m) => (
        <div key={m.id} className={`menu${open?.id === m.id ? ' open' : ''}`}>
          <button
            aria-haspopup="menu"
            aria-expanded={open?.id === m.id}
            onClick={(e) => (open?.id === m.id ? setOpen(null) : openMenu(m.id, e.currentTarget))}
            onPointerEnter={(e) => {
              // Как в обычных программах: если одно меню открыто, наведение открывает соседнее.
              if (open && open.id !== m.id && e.pointerType === 'mouse') openMenu(m.id, e.currentTarget);
            }}
          >
            {m.label}
          </button>
        </div>
      ))}
      {open && (() => {
        const m = menus.find((x) => x.id === open.id);
        return m ? <MenuDrop items={m.items} anchor={open.anchor} onClose={() => setOpen(null)} dropRef={dropRef} /> : null;
      })()}
      <span className="title" title={p.meta.description ?? ''}>
        <b>{p.meta.name}</b>
        {s.dirty ? ' •' : ''} · {p.board.copperLayers === 1 ? 'односторонняя' : 'двусторонняя'}
      </span>
      <button className="ibtn" style={{ marginLeft: 6 }} title="Сохранить (Ctrl+S)" aria-label="Сохранить" onClick={() => void saveProject()}>
        <Icon name="save" size={18} />
      </button>
    </header>
  );
}
