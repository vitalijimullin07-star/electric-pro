import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '@editor/store';
import { parseProjectFile, serializeProject, PROJECT_EXT } from '@core/io/project-file';
import { importLegacyVacuumProject } from '@core/examples';
import { openTextFile, saveTextFile } from './files';
import { safeName } from '@core/io/gerber';
import { alignSelection, copySelection, cutSelection, deleteSelection, distributeSelection, duplicateSelection, flipSelection, groupSelection, hasClipboard, pasteClipboard, rotateSelection, selectAll, ungroupSelection } from '@editor/commands';
import { clearRouting } from '@core/model/edit';
import { Icon } from './icons';
import { askConfirm } from './dialogs/AskDialog';

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
  const f = await openTextFile('.json,application/json');
  if (!f) return;
  const s = useEditor.getState();
  try {
    const r = parseProjectFile(f.text);
    if (r.kind === 'project') s.replaceProject(r.project, f.name);
    else {
      s.replaceProject(importLegacyVacuumProject(r.file), null);
      s.setMessage('Открыт проект старой версии Plata: перенесены расстановка и дорожки платы пылесоса.');
    }
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

  const menus: { id: string; label: string; items: Item[] }[] = [
    {
      id: 'file',
      label: 'Файл',
      items: [
        { label: 'Новый проект…', kbd: '', action: () => s.openDialog('new') },
        { label: 'Открыть файл проекта…', kbd: 'Ctrl+O', action: () => void openProject() },
        { label: 'Недавние проекты…', action: () => s.openDialog('open') },
        { label: 'Сохранить проект', kbd: 'Ctrl+S', action: () => void saveProject() },
        'sep',
        { label: 'Экспорт: Gerber, SVG, BOM…', action: () => s.openDialog('export') },
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
        { label: 'На другую сторону', kbd: 'F', action: flipSelection, disabled: !s.selection.length },
        'sep',
        { label: 'Свойства компонента…', action: () => s.openDialog('component', s.selection.find((r) => r.kind === 'component')?.id), disabled: !s.selection.some((r) => r.kind === 'component') },
      ],
    },
    {
      id: 'arrange',
      label: 'Упорядочить',
      items: [
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
