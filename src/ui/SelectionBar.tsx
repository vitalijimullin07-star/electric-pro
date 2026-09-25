import { useEditor } from '@editor/store';
import { deleteSelection, duplicateSelection, flipSelection, rotateSelection } from '@editor/commands';
import { deleteSchSelection, mirrorSchSelection, rotateSchSelection } from '@editor/sch';
import { Icon } from './icons';

/*
 * Быстрые действия над выделенным — кнопками прямо на холсте (без клавиатуры, на телефоне):
 * повернуть, на другую сторону или слой, дублировать, свойства, удалить.
 */

export function SelectionBar() {
  const sel = useEditor((s) => s.selection);
  const busy = useEditor((s) => s.transaction || !!s.pending);
  if (!sel.length || busy) return null;
  const comp = sel.length === 1 && sel[0].kind === 'component' ? sel[0].id : null;
  const props = () => {
    const st = useEditor.getState();
    if (comp) st.openDialog('component', comp);
    else if (sel.length === 1 && sel[0].kind === 'drawing' && st.project.drawings[sel[0].id]?.kind === 'text') st.openDialog('text', sel[0].id);
    else st.patch({ panelTab: 'props', panelOpen: true });
  };
  return (
    <div className="selbar" role="toolbar" aria-label="Действия с выделенным">
      <button onClick={() => rotateSelection(90)} title="Повернуть на 90° против часовой (R)" aria-label="Повернуть влево">
        <Icon name="rotateLeft" />
      </button>
      <button onClick={() => rotateSelection(-90)} title="Повернуть на 90° по часовой (Shift+R)" aria-label="Повернуть вправо">
        <Icon name="rotate" />
      </button>
      <button onClick={flipSelection} title="На другую сторону или слой (F)" aria-label="На другую сторону">
        <Icon name="flip" />
      </button>
      <button onClick={duplicateSelection} title="Дублировать (Ctrl+D)" aria-label="Дублировать">
        <Icon name="duplicate" />
      </button>
      <button onClick={props} title="Свойства" aria-label="Свойства">
        <Icon name="props" />
      </button>
      <button className="danger" onClick={deleteSelection} title={`Удалить (Del)${sel.length > 1 ? `: ${sel.length} объектов` : ''}`} aria-label="Удалить">
        <Icon name="trash" />
      </button>
      {sel.length > 1 && <span className="n">{sel.length}</span>}
    </div>
  );
}

/** То же для схемы: повернуть, отразить, удалить. */
export function SchSelectionBar() {
  const sel = useEditor((s) => s.schSelection);
  const busy = useEditor((s) => s.transaction || !!s.schPending);
  if (!sel.length || busy) return null;
  return (
    <div className="selbar" role="toolbar" aria-label="Действия с выделенным на схеме">
      <button onClick={() => rotateSchSelection()} title="Повернуть (R)" aria-label="Повернуть">
        <Icon name="rotateLeft" />
      </button>
      <button onClick={() => mirrorSchSelection()} title="Отразить (X)" aria-label="Отразить">
        <Icon name="flip" />
      </button>
      <button className="danger" onClick={() => deleteSchSelection()} title="Удалить (Del)" aria-label="Удалить">
        <Icon name="trash" />
      </button>
      {sel.length > 1 && <span className="n">{sel.length}</span>}
    </div>
  );
}
