import { useState } from 'react';
import { useEditor } from '@editor/store';
import { TEMPLATES } from '@core/library/templates';
import { EXAMPLES } from '@core/examples';
import { createProject } from '@core/model/project';
import { Dialog } from './Dialog';
import { LenInput } from '../common/NumberInput';

export function NewProjectDialog() {
  const s = useEditor();
  const [tpl, setTpl] = useState<string>('custom');
  const [name, setName] = useState('Новая плата');
  const [w, setW] = useState(100);
  const [h, setH] = useState(80);
  const [r, setR] = useState(2);
  const [layers, setLayers] = useState<1 | 2>(2);
  const [homemade, setHomemade] = useState(false);

  const create = () => {
    if (s.dirty && !confirm('Текущий проект не сохранён в файл (в браузере он останется в истории до следующего изменения). Продолжить?')) return;
    let p;
    if (tpl === 'custom') p = createProject({ name, width: w, height: h, cornerRadius: r, copperLayers: layers, homemade });
    else if (tpl.startsWith('ex:')) p = EXAMPLES.find((e) => e.id === tpl.slice(3))!.create();
    else p = TEMPLATES.find((t) => t.id === tpl)!.create({ homemade: homemade || undefined, copperLayers: tpl === 'blank-lut' ? 1 : layers });
    if (tpl !== 'custom' && !tpl.startsWith('ex:') && name.trim() && name !== 'Новая плата') p.meta.name = name.trim();
    s.replaceProject(p);
    s.closeDialog();
  };

  const groups = ['Пустые', 'Форм-факторы'] as const;
  return (
    <Dialog
      title="Новый проект"
      size="wide"
      footer={
        <>
          <button className="btn" onClick={s.closeDialog}>
            Отмена
          </button>
          <button className="btn primary" onClick={create}>
            Создать
          </button>
        </>
      }
    >
      <div className="cards">
        <button className={`card${tpl === 'custom' ? ' on' : ''}`} onClick={() => setTpl('custom')}>
          <span className="nm">Свой размер</span>
          <span className="ds">Прямоугольная плата с заданными размерами и правилами</span>
          <span className="sz">
            {w} × {h} мм
          </span>
        </button>
        {groups.map((g) =>
          TEMPLATES.filter((t) => t.group === g).map((t) => (
            <button key={t.id} className={`card${tpl === t.id ? ' on' : ''}`} onClick={() => setTpl(t.id)}>
              <span className="nm">{t.name}</span>
              <span className="ds">{t.description}</span>
              <span className="sz">
                {t.size[0]} × {t.size[1]} мм
              </span>
            </button>
          )),
        )}
        {EXAMPLES.map((e) => (
          <button key={e.id} className={`card${tpl === 'ex:' + e.id ? ' on' : ''}`} onClick={() => setTpl('ex:' + e.id)}>
            <span className="nm">Пример: {e.name}</span>
            <span className="ds">{e.description}</span>
            <span className="sz">
              {e.size[0]} × {e.size[1]} мм
            </span>
          </button>
        ))}
      </div>
      {!tpl.startsWith('ex:') && (
        <>
          <h4 style={{ margin: '14px 0 6px' }}>Параметры</h4>
          <div className="field">
            <label>Название</label>
            <input className="inp" value={name} onChange={(e) => setName(e.target.value)} />
            {tpl === 'custom' && (
              <>
                <label>Ширина, мм</label>
                <LenInput value={w} min={5} onChange={setW} />
                <label>Высота, мм</label>
                <LenInput value={h} min={5} onChange={setH} />
                <label>Скругление углов</label>
                <LenInput value={r} min={0} onChange={setR} />
              </>
            )}
            {tpl !== 'blank-lut' && (
              <>
                <label>Слоёв меди</label>
                <select className="sel" value={layers} onChange={(e) => setLayers(+e.target.value as 1 | 2)}>
                  <option value={2}>2 — двусторонняя (завод)</option>
                  <option value={1}>1 — односторонняя (ЛУТ, перемычки проводом)</option>
                </select>
              </>
            )}
            <label>Правила</label>
            <select className="sel" value={homemade ? 'home' : 'factory'} onChange={(e) => setHomemade(e.target.value === 'home')}>
              <option value="factory">Завод: зазор 0,2 мм, дорожка 0,2 мм, переходные 0,6/0,3</option>
              <option value="home">Дома (ЛУТ): зазор 0,3 мм, дорожка 0,4 мм, отверстия от 0,6</option>
            </select>
          </div>
        </>
      )}
    </Dialog>
  );
}
