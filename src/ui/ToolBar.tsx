import { useEditor, type ToolId } from '@editor/store';
import { Icon } from './icons';

const TOOLS: { id: ToolId; title: string; key?: string }[] = [
  { id: 'select', title: 'Выбор и перемещение', key: 'S' },
  { id: 'pan', title: 'Двигать вид', key: 'H' },
  { id: 'route', title: 'Дорожка', key: 'W' },
  { id: 'via', title: 'Переходное отверстие', key: 'V' },
  { id: 'wire', title: 'Перемычка проводом', key: 'J' },
  { id: 'place', title: 'Поставить компонент', key: 'P' },
  { id: 'line', title: 'Линия на шелкографии' },
  { id: 'rect', title: 'Прямоугольник' },
  { id: 'circle', title: 'Окружность' },
  { id: 'poly', title: 'Многоугольник' },
  { id: 'text', title: 'Надпись', key: 'T' },
  { id: 'zone', title: 'Полигон меди' },
  { id: 'keepout', title: 'Область правил (запрет, зона 230 В)' },
  { id: 'outline', title: 'Контур платы' },
  { id: 'measure', title: 'Линейка', key: 'M' },
];

export function ToolBar() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  return (
    <nav className="toolbar" aria-label="Инструменты">
      {TOOLS.map((t, i) => (
        <span key={t.id} style={{ display: 'contents' }}>
          {(i === 2 || i === 6 || i === 11 || i === 14) && <span className="sep" />}
          <button
            className={`tbtn${tool === t.id ? ' on' : ''}`}
            title={t.title + (t.key ? ` (${t.key})` : '')}
            aria-label={t.title}
            onClick={() => {
              setTool(t.id);
              if (t.id === 'place') useEditor.setState({ panelTab: 'library', panelOpen: true });
            }}
          >
            <Icon name={t.id} />
            {t.key && <span className="key">{t.key}</span>}
          </button>
        </span>
      ))}
      <span className="sep" />
      <button className="tbtn" title="Отменить (Ctrl+Z)" aria-label="Отменить" onClick={undo} disabled={!canUndo} style={{ opacity: canUndo ? 1 : 0.35 }}>
        <Icon name="undo" />
      </button>
      <button className="tbtn" title="Повторить (Ctrl+Y)" aria-label="Повторить" onClick={redo} disabled={!canRedo} style={{ opacity: canRedo ? 1 : 0.35 }}>
        <Icon name="redo" />
      </button>
    </nav>
  );
}
