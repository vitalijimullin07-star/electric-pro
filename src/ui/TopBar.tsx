import { useEffect, useRef, useState } from 'react';
import { useEditor } from '@editor/store';
import { parseProjectFile, serializeProject, PROJECT_EXT } from '@core/io/project-file';
import { importLegacyVacuumProject } from '@core/examples';
import { openTextFile, saveTextFile } from './files';
import { safeName } from '@core/io/gerber';
import { deleteSelection, flipSelection, rotateSelection, selectAll } from '@editor/commands';
import { clearRouting } from '@core/model/edit';
import { Icon } from './icons';

/* Верхняя строка меню в духе EasyEDA: Файл, Правка, Вид, Плата, Трассировка, Экспорт, Справка. */

type Item = { label: string; kbd?: string; action?: () => void; disabled?: boolean } | 'sep';

function Menu({ label, items, open, onOpen }: { label: string; items: Item[]; open: boolean; onOpen: (v: boolean) => void }) {
  return (
    <div className={`menu${open ? ' open' : ''}`}>
      <button onClick={() => onOpen(!open)} onMouseEnter={() => open || undefined}>
        {label}
      </button>
      {open && (
        <div className="drop" role="menu">
          {items.map((it, i) =>
            it === 'sep' ? (
              <hr key={i} />
            ) : (
              <button
                key={i}
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  onOpen(false);
                  it.action?.();
                }}
              >
                <span>{it.label}</span>
                {it.kbd && <kbd>{it.kbd}</kbd>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export async function saveProject(): Promise<void> {
  const s = useEditor.getState();
  const name = s.fileName ?? safeName(s.project.meta.name) + PROJECT_EXT;
  const ok = await saveTextFile(name, serializeProject(s.project, true), 'application/json');
  if (ok) useEditor.setState({ dirty: false, fileName: name, message: `Сохранено: ${name}` });
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
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const s = useEditor();
  const p = s.project;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener('pointerdown', onDoc);
    const onSave = () => void saveProject();
    const onOpen = () => void openProject();
    window.addEventListener('plata:save', onSave);
    window.addEventListener('plata:open', onOpen);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      window.removeEventListener('plata:save', onSave);
      window.removeEventListener('plata:open', onOpen);
    };
  }, []);

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
        { label: 'Выделить всё', kbd: 'Ctrl+A', action: selectAll },
        { label: 'Удалить выделенное', kbd: 'Del', action: deleteSelection, disabled: !s.selection.length },
        { label: 'Повернуть на 90°', kbd: 'R', action: () => rotateSelection(90), disabled: !s.selection.length },
        { label: 'На другую сторону', kbd: 'F', action: flipSelection, disabled: !s.selection.length },
        'sep',
        { label: 'Свойства компонента…', action: () => s.openDialog('component', s.selection.find((r) => r.kind === 'component')?.id), disabled: !s.selection.some((r) => r.kind === 'component') },
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
        'sep',
        { label: 'Автотрассировка…', action: () => s.openDialog('autoroute') },
        { label: 'Стереть все дорожки', action: () => {
          if (confirm('Стереть все дорожки, переходные и перемычки? Отменить можно через Ctrl+Z.')) s.commit((d) => clearRouting(d));
        } },
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
        <Menu key={m.id} label={m.label} items={m.items} open={open === m.id} onOpen={(v) => setOpen(v ? m.id : null)} />
      ))}
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
