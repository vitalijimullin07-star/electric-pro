import { useEffect, useState } from 'react';
import { useEditor } from '@editor/store';
import { Dialog } from './Dialog';
import { TextInput, LenInput, useUnits } from '../common/NumberInput';
import { addDrawing } from '@core/model/edit';
import { renameNetChecked } from '@editor/commands';
import type { Vec2 } from '@core/math/vec';
import { startAutoroute } from '@core/router/client';
import { autoGrid } from '@core/router/autoroute';
import { addTrack, addVia, addWire, clearRouting } from '@core/model/edit';
import { computeConnectivity } from '@core/model/connectivity';
import type { LayerId } from '@core/model/types';
import { LAYERS } from '@core/model/layers';

/* Небольшие диалоги: цепь, надпись, автотрассировка, справка. */

export function NetDialog({ id }: { id: string }) {
  const s = useEditor();
  const n = s.project.nets[id];
  if (!n) return null;
  return (
    <Dialog title={`Цепь ${n.name}`} size="narrow">
      <div className="field">
        <label>Имя</label>
        <TextInput value={n.name} onChange={(v) => renameNetChecked(id, v)} />
        <label>Описание</label>
        <TextInput value={n.description ?? ''} onChange={(v) => s.commit((d) => void (d.nets[id] && (d.nets[id].description = v || undefined)))} />
        <label>Класс</label>
        <select className="sel" value={n.netClass} onChange={(e) => s.commit((d) => void (d.nets[id] && (d.nets[id].netClass = e.target.value)))}>
          {Object.values(s.project.netClasses).map((c) => (
            <option key={c.name} value={c.name}>
              {c.name} — дорожка {c.trackWidth} мм, зазор {c.clearance} мм
            </option>
          ))}
        </select>
      </div>
    </Dialog>
  );
}

export function TextDialog({ data }: { data: unknown }) {
  const s = useEditor();
  const existingId = typeof data === 'string' ? data : null;
  const at = (data as { at?: Vec2 })?.at ?? { x: 0, y: 0 };
  const existing = existingId ? s.project.drawings[existingId] : null;
  const [text, setText] = useState(existing?.kind === 'text' ? existing.text : '');
  const [size, setSize] = useState(existing?.kind === 'text' ? existing.size : s.textSize);
  const [layer, setLayer] = useState<LayerId>(existing?.layer ?? (s.drawLayer.endsWith('Cu') ? 'F.Silk' : s.drawLayer));
  const { label: U } = useUnits();
  useEffect(() => {
    setTimeout(() => (document.getElementById('text-dialog-input') as HTMLInputElement | null)?.focus(), 30);
  }, []);
  const ok = () => {
    if (!text.trim()) return;
    s.commit((d) => {
      if (existingId && d.drawings[existingId]?.kind === 'text') {
        const t = d.drawings[existingId];
        if (t.kind === 'text') {
          t.text = text;
          t.size = size;
          t.layer = layer;
        }
      } else addDrawing(d, { kind: 'text', layer, at, text, size, thickness: Math.max(0.12, size * 0.15), align: 'center' });
    });
    s.patch({ textSize: size });
    s.closeDialog();
  };
  return (
    <Dialog
      title={existing ? 'Надпись' : 'Новая надпись'}
      size="narrow"
      footer={
        <>
          <button className="btn" onClick={s.closeDialog}>
            Отмена
          </button>
          <button className="btn primary" onClick={ok} disabled={!text.trim()}>
            {existing ? 'Сохранить' : 'Поставить'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>Текст</label>
        <input
          id="text-dialog-input"
          className="inp"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') ok();
            e.stopPropagation();
          }}
        />
        <label>Высота, {U}</label>
        <LenInput value={size} min={0.3} onChange={setSize} />
        <label>Слой</label>
        <select className="sel" value={layer} onChange={(e) => setLayer(e.target.value as LayerId)}>
          {(['F.Silk', 'B.Silk', 'F.Cu', 'B.Cu', 'F.Fab'] as LayerId[]).map((l) => (
            <option key={l} value={l}>
              {LAYERS[l].name}
            </option>
          ))}
        </select>
      </div>
      <p className="hint">Шрифт штриховой: латиница, цифры и кириллица. Так надпись одинаково выглядит на экране, в SVG и в Gerber.</p>
    </Dialog>
  );
}

export function AutorouteDialog() {
  const s = useEditor();
  const p = s.project;
  const conn = computeConnectivity(p);
  const [keep, setKeep] = useState(conn.total - conn.unrouted > 0);
  const [grid, setGrid] = useState<number>(autoGrid(p));
  const [iters, setIters] = useState(30);
  const [job, setJob] = useState<ReturnType<typeof startAutoroute> | null>(null);
  const r = s.routing;
  const oneLayer = p.board.copperLayers === 1;

  const run = () => {
    const base = keep ? p : (() => p)();
    s.patch({ routing: { running: true, iteration: 0, conflicts: 0, fraction: 0, message: 'Подготовка…' } });
    const j = startAutoroute(base, { grid, iterations: iters, keepExisting: keep, allowWires: oneLayer, allowVias: !oneLayer }, (info) =>
      s.patch({ routing: { running: true, iteration: info.iteration, conflicts: info.conflicts, fraction: info.fraction, message: `Проход ${info.iteration}: спорных клеток ${info.conflicts}` } }),
    );
    setJob(j);
    j.promise
      .then((res) => {
        s.commit((d) => {
          if (!keep) clearRouting(d);
          for (const t of res.tracks) addTrack(d, t);
          for (const v of res.vias) addVia(d, v);
          for (const w of res.wires) addWire(d, w.a, w.b);
        });
        const c2 = computeConnectivity(useEditor.getState().project);
        s.patch({
          routing: { running: false, iteration: res.iterations, conflicts: res.conflicts, fraction: 1 },
          message: `Разведено за ${(res.ms / 1000).toFixed(1)} с: дорожек ${res.tracks.length}, ${oneLayer ? 'перемычек' : 'переходных'} ${oneLayer ? res.wires.length : res.vias.length}${res.failed ? `, не проведено связей: ${res.failed} (заменены перемычками)` : ''}. Не разведено цепей: ${c2.unrouted}.`,
        });
        s.closeDialog();
      })
      .catch((e: Error) => {
        s.patch({ routing: { running: false, iteration: 0, conflicts: 0, fraction: 0 }, message: 'Автотрассировка прервана: ' + e.message });
        setJob(null);
      });
  };
  const cancel = () => {
    job?.cancel();
    setJob(null);
    s.patch({ routing: { running: false, iteration: 0, conflicts: 0, fraction: 0 }, message: 'Автотрассировка отменена.' });
  };

  return (
    <Dialog
      title="Автотрассировка"
      size="narrow"
      footer={
        r.running ? (
          <button className="btn danger" onClick={cancel}>
            Остановить
          </button>
        ) : (
          <>
            <button className="btn" onClick={s.closeDialog}>
              Отмена
            </button>
            <button className="btn primary" onClick={run} disabled={!conn.total}>
              Развести
            </button>
          </>
        )
      }
    >
      <p className="hint">
        {oneLayer
          ? 'Односторонняя плата: дорожки по нижней меди, где не пройти — перемычки проводом с площадками. '
          : 'Двусторонняя плата: дорожки на обоих слоях, переходные отверстия где нужно. '}
        Метод согласования конфликтов: несколько проходов, спорные места дорожают. Учитываются зазоры классов, области правил и зона 230 В.
      </p>
      <div className="field">
        <label>Сетка, мм</label>
        <select className="sel" value={String(grid)} onChange={(e) => setGrid(+e.target.value)} disabled={r.running}>
          {[...new Set([autoGrid(p), 0.5, 0.635, 0.8, 1.0, 1.27, 2.54])].sort((a, b) => a - b).map((g) => (
            <option key={g} value={String(g)}>
              {String(g).replace('.', ',')}
              {Math.abs(g - autoGrid(p)) < 1e-9 ? ' — по правилам' : ''}
            </option>
          ))}
        </select>
        <label>Проходов, до</label>
        <input className="inp" type="number" min={4} max={80} value={iters} onChange={(e) => setIters(+e.target.value || 30)} disabled={r.running} />
        <label>Существующие дорожки</label>
        <select className="sel" value={keep ? 'keep' : 'redo'} onChange={(e) => setKeep(e.target.value === 'keep')} disabled={r.running}>
          <option value="redo">стереть и развести всё заново</option>
          <option value="keep">оставить, развести только недоведённые цепи</option>
        </select>
      </div>
      <p className="hint">
        Цепей к разводке: {keep ? conn.unrouted : conn.total}. Результат можно отменить (Ctrl+Z).
      </p>
      {r.running && (
        <>
          <div className="progress">
            <div style={{ width: `${Math.round(r.fraction * 100)}%` }} />
          </div>
          <p className="hint">{r.message}</p>
        </>
      )}
    </Dialog>
  );
}

export function ShortcutsDialog() {
  const rows: [string, string][] = [
    ['S / W / V / J / P / T / M / H', 'Инструменты: выбор, дорожка, переходное, перемычка, компонент, надпись, линейка, рука'],
    ['R, Shift+R', 'Повернуть на 90° (при установке — корпус)'],
    ['F', 'Компонент на другую сторону'],
    ['L', 'Переключить активный медный слой'],
    ['V при трассировке', 'Поставить переходное и перейти на другой слой'],
    ['/', 'Изгиб: сначала диагональ или сначала прямо'],
    ['Backspace при трассировке', 'Убрать последний изгиб'],
    ['Двойной щелчок', 'Закончить дорожку или многоугольник; по компоненту — свойства'],
    ['Esc', 'Отменить действие, снять выделение, вернуться к выбору'],
    ['Delete', 'Удалить выделенное'],
    ['Стрелки, Shift+стрелки', 'Сдвинуть выделенное на шаг сетки, на 10 шагов'],
    ['N', 'Подсветить цепь выделенной дорожки'],
    ['G', 'Сетка'],
    ['Ctrl+Z / Ctrl+Y', 'Отменить / повторить'],
    ['Ctrl+A', 'Выделить всё'],
    ['Ctrl+C / Ctrl+X / Ctrl+V', 'Копировать, вырезать, вставить под курсор'],
    ['Ctrl+D', 'Дублировать выделенное'],
    ['Ctrl+S / Ctrl+O', 'Сохранить / открыть файл проекта'],
    ['Колесо, +, −, 0', 'Масштаб; 0 — вся плата'],
    ['Средняя кнопка, пробел+тяга, правая кнопка', 'Двигать вид'],
    ['Два пальца', 'Масштаб и сдвиг на телефоне'],
  ];
  return (
    <Dialog title="Горячие клавиши" size="narrow">
      <div className="kbd-grid">
        {rows.map(([k, v]) => (
          <span key={k} style={{ display: 'contents' }}>
            <kbd>{k}</kbd>
            <span>{v}</span>
          </span>
        ))}
      </div>
    </Dialog>
  );
}

export function AboutDialog() {
  return (
    <Dialog title="Plata" size="narrow">
      <p>Редактор печатных плат в браузере. Ничего не нужно устанавливать, работает на компьютере и телефоне, проект хранится в браузере и в файле.</p>
      <ul className="hint" style={{ paddingLeft: 18 }}>
        <li>Библиотека корпусов с реальными размерами: SMD и выводные, разъёмы, модули (ESP32, Arduino, Pico, HLK-PM01…), шаблоны плат.</li>
        <li>Один или два слоя меди, переходные отверстия и перемычки проводом, классы цепей с зазором 6 мм для 230 В.</li>
        <li>Проверка правил на лету, автотрассировка, экспорт Gerber/Excellon для завода и SVG 1:1 для ЛУТ.</li>
      </ul>
      <p className="hint">Размеры корпусов с пометкой «типовые» проверьте по даташиту перед заказом: распечатайте сборочный вид 1:1 и приложите детали.</p>
    </Dialog>
  );
}
