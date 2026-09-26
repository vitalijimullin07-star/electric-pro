import { useEffect, useState } from 'react';
import { loadRecent, removeRecent, useEditor } from '@editor/store';
import { migrateProject } from '@core/io/project-file';
import { safeName } from '@core/io/gerber';
import { listSaved, loadSaved, removeSaved, renameSaved, savedText, storageInfo, type SavedMeta } from '@editor/device-files';
import { Dialog } from './Dialog';
import { askConfirm, askText } from './AskDialog';
import { openProject } from '../TopBar';
import { saveTextFile } from '../files';

const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const kb = (bytes: number) => (bytes > 1e6 ? `${(bytes / 1e6).toFixed(1).replace('.', ',')} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`);

/** «Мои проекты»: сохранённые на устройстве, недавние из браузера и открытие файла. */
export function OpenDialog() {
  const s = useEditor();
  const [saved, setSaved] = useState<SavedMeta[] | null>(null);
  const [error, setError] = useState('');
  const [recent, setRecent] = useState(loadRecent());
  const [info, setInfo] = useState<{ usedMb: number; quotaMb: number; persisted: boolean } | null>(null);

  const refresh = () =>
    listSaved()
      .then(setSaved)
      .catch((e: Error) => {
        setSaved([]);
        setError(e.message);
      });
  useEffect(() => {
    void refresh();
    void storageInfo().then(setInfo);
  }, []);

  const reopen = () => useEditor.getState().openDialog('open');
  const open = async (m: SavedMeta) => {
    try {
      const p = await loadSaved(m.id);
      s.closeDialog();
      s.replaceProject(p, null, m.id);
      s.setMessage(`Открыт проект «${m.name}» с устройства.`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const rename = (m: SavedMeta) =>
    askText({
      title: 'Переименовать проект',
      message: 'Новое имя:',
      value: m.name,
      okLabel: 'Переименовать',
      onOk: (v) => {
        const name = (v ?? '').trim();
        void (async () => {
          if (name && name !== m.name) {
            await renameSaved(m.id, name).catch((e: Error) => s.setMessage(`Не удалось переименовать: ${e.message}`));
            const st = useEditor.getState();
            if (st.deviceId === m.id)
              st.commit((d) => {
                d.meta.name = name;
              });
          }
          reopen();
        })();
      },
      onCancel: reopen,
    });
  const download = async (m: SavedMeta) => {
    try {
      const text = await savedText(m.id);
      const ok = await saveTextFile(safeName(m.name) + '.plata.json', text, 'application/json');
      if (ok) s.setMessage(`Файл «${m.name}» скачан.`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = (m: SavedMeta) =>
    askConfirm({
      title: 'Удалить проект с устройства',
      message: `Удалить «${m.name}» из «Моих проектов»? Вернуть будет нельзя (если не скачивали файл).`,
      okLabel: 'Удалить',
      danger: true,
      onOk: () => {
        void removeSaved(m.id)
          .then(() => {
            if (useEditor.getState().deviceId === m.id) useEditor.setState({ deviceId: null });
          })
          .finally(reopen);
      },
      onCancel: reopen,
    });

  return (
    <Dialog
      title="Мои проекты"
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
      <h4 className="list-head">На устройстве</h4>
      <p className="hint">Сюда сохраняет «Сохранить» (Ctrl+S, значок дискеты вверху) и сюда же попадают открытые файлы. Хранится в памяти устройства, без интернета.</p>
      {error && <p className="hint" style={{ color: 'var(--err)' }}>{error}</p>}
      {saved === null && <p className="hint">Загрузка…</p>}
      {saved && !saved.length && !error && <p className="hint">Сохранённых проектов пока нет. Нажмите «Сохранить» — проект появится здесь.</p>}
      <div className="list saved-list">
        {saved?.map((m) => (
          <div key={m.id} className={`item${m.id === s.deviceId ? ' current' : ''}`} style={{ cursor: 'default' }}>
            <span className="grow" onClick={() => void open(m)} style={{ cursor: 'pointer' }}>
              <span className="nm">
                {m.name}
                {m.id === s.deviceId && <span className="tag ok">открыт</span>}
              </span>
              <div className="ds">
                {[m.size, `деталей ${m.components}`, m.firmware ? `прошивка ${m.firmware}` : '', kb(m.bytes)].filter(Boolean).join(' · ')}
                <br />
                сохранён {when(m.saved)}
              </div>
            </span>
            <span className="saved-btns">
              <button className="btn sm primary" onClick={() => void open(m)}>
                Открыть
              </button>
              <button className="btn sm" title="Переименовать" aria-label="Переименовать" onClick={() => rename(m)}>
                ✎
              </button>
              <button className="btn sm" title="Скачать файлом" aria-label="Скачать файлом" onClick={() => void download(m)}>
                ⬇
              </button>
              <button className="btn sm danger" title="Удалить с устройства" aria-label="Удалить с устройства" onClick={() => remove(m)}>
                ×
              </button>
            </span>
          </div>
        ))}
      </div>
      {info && info.quotaMb > 0 && (
        <p className="hint">
          Занято {info.usedMb.toFixed(1).replace('.', ',')} МБ из {Math.round(info.quotaMb)} МБ.{' '}
          {info.persisted ? 'Браузер хранит постоянно.' : 'Браузер может очистить при нехватке места — установите редактор как приложение или скачайте важные проекты файлом.'}
        </p>
      )}

      {recent.length > 0 && (
        <>
          <h4 className="list-head">Недавние (автосохранение)</h4>
          <p className="hint">Проекты, открытые в этом браузере до другого проекта. Сохраняются сами, но не больше шести.</p>
          <div className="list">
            {recent.map((r) => (
              <div key={r.key} className="item" style={{ cursor: 'default' }}>
                <span className="grow">
                  <span className="nm">{r.name}</span>
                  <div className="ds">
                    {r.size} · изменён {when(r.modified)} · деталей {Object.keys(r.project.components).length}
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
                    setRecent(loadRecent());
                  }}
                  aria-label="Удалить из недавних"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </Dialog>
  );
}
