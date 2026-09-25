import { useEditor, type SchTool, type ToolId } from '@editor/store';
import { deleteSchSelection, mirrorSchSelection, rotateSchSelection, setSchTool } from '@editor/sch';
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
  { id: 'dimension', title: 'Размер (размерная линия)' },
];

const SCH_TOOLS: { id: SchTool; title: string; icon: string; key?: string }[] = [
  { id: 'select', title: 'Выбор и перемещение', icon: 'select', key: 'S' },
  { id: 'pan', title: 'Двигать лист', icon: 'pan', key: 'H' },
  { id: 'wire', title: 'Провод', icon: 'route', key: 'W' },
  { id: 'label', title: 'Метка цепи', icon: 'text', key: 'N' },
  { id: 'place', title: 'Поставить компонент', icon: 'place', key: 'P' },
];

function SchToolBar() {
  const tool = useEditor((s) => s.schTool);
  const sel = useEditor((s) => s.schSelection.length);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  return (
    <nav className="toolbar" aria-label="Инструменты схемы">
      {SCH_TOOLS.map((t, i) => (
        <span key={t.id} style={{ display: 'contents' }}>
          {i === 2 && <span className="sep" />}
          <button
            className={`tbtn${tool === t.id ? ' on' : ''}`}
            title={t.title + (t.key ? ` (${t.key})` : '')}
            aria-label={t.title}
            onClick={() => {
              setSchTool(t.id);
              if (t.id === 'place') useEditor.setState({ panelTab: 'library', panelOpen: true });
            }}
          >
            <Icon name={t.icon as ToolId} />
            {t.key && <span className="key">{t.key}</span>}
          </button>
        </span>
      ))}
      <span className="sep" />
      <button className="tbtn" title="Повернуть (R)" aria-label="Повернуть" onClick={rotateSchSelection} disabled={!sel} style={{ opacity: sel ? 1 : 0.35 }}>
        <Icon name="rotate" />
      </button>
      <button className="tbtn" title="Зеркально (X)" aria-label="Зеркально" onClick={mirrorSchSelection} disabled={!sel} style={{ opacity: sel ? 1 : 0.35 }}>
        <Icon name="flip" />
      </button>
      <button className="tbtn" title="Удалить (Delete)" aria-label="Удалить" onClick={deleteSchSelection} disabled={!sel} style={{ opacity: sel ? 1 : 0.35 }}>
        <Icon name="trash" />
      </button>
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

export function ToolBar() {
  const mode = useEditor((s) => s.mode);
  return mode === 'sch' ? <SchToolBar /> : <PcbToolBar />;
}

function PcbToolBar() {
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
