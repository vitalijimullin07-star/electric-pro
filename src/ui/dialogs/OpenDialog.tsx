import { useState } from 'react';
import { loadRecent, removeRecent, useEditor } from '@editor/store';
import { migrateProject } from '@core/io/project-file';
import { Dialog } from './Dialog';
import { openProject } from '../TopBar';

/** Недавние проекты, сохранённые в браузере, и открытие файла. */
export function OpenDialog() {
  const s = useEditor();
  const [list, setList] = useState(loadRecent());
  return (
    <Dialog
      title="Открыть проект"
      footer={
        <>
          <button className="btn" onClick={s.closeDialog}>
            Закрыть
          </button>
          <button
            className="btn primary"
            onClick={() => {
              s.closeDialog();
              void openProject();
            }}
          >
            Открыть файл…
          </button>
        </>
      }
    >
      <p className="hint">Проекты, которые вы открывали в этом браузере. Текущий проект сохраняется сам; при создании или открытии другого он попадает сюда.</p>
      {!list.length && <p className="hint">Недавних проектов пока нет.</p>}
      <div className="list">
        {list.map((r) => (
          <div key={r.key} className="item" style={{ cursor: 'default' }}>
            <span className="grow">
              <span className="nm">{r.name}</span>
              <div className="ds">
                {r.size} · изменён {new Date(r.modified).toLocaleString('ru-RU')} · компонентов {Object.keys(r.project.components).length}
              </div>
            </span>
            <button
              className="btn sm"
              onClick={() => {
                s.replaceProject(migrateProject(r.project));
                removeRecent(r.key);
                s.closeDialog();
              }}
            >
              Открыть
            </button>
            <button
              className="btn sm danger"
              onClick={() => {
                removeRecent(r.key);
                setList(loadRecent());
              }}
              aria-label="Удалить из недавних"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
