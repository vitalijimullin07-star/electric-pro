import { useEditor } from '@editor/store';
import { deleteSchSelection, rotateSchSelection, updateBoardFromSchematic } from '@editor/sch';
import { placedPins, schematicNetlist } from '@core/schematic/netlist';
import { TextInput } from '../common/NumberInput';
import { ComponentProps } from './PropertiesPanel';

/* Свойства на схеме: символ — свойства компонента, метка — имя цепи; без выделения — сводка схемы. */

export function SchPanel() {
  const s = useEditor();
  const p = s.project;
  const sch = p.schematic;
  const sel = s.schSelection;
  if (sel.length === 1 && sel[0].kind === 'symbol') {
    const sym = sch?.symbols[sel[0].id];
    if (sym && p.components[sym.component])
      return (
        <div>
          <ComponentProps id={sym.component} />
          <p className="hint">Цепи выводов задаёт схема: после правок проводов нажмите «Обновить плату по схеме».</p>
        </div>
      );
  }
  if (sel.length === 1 && sel[0].kind === 'label') {
    const l = sch?.labels[sel[0].id];
    if (l) {
      const id = l.id;
      return (
        <div>
          <h3>Метка цепи</h3>
          <div className="field">
            <label>Цепь</label>
            <TextInput value={l.text} onChange={(v) => v.trim() && s.commit((d) => void (d.schematic!.labels[id].text = v.trim()))} />
            <label>Вид</label>
            <select className="sel" value={l.kind ?? 'net'} onChange={(e) => s.commit((d) => void (d.schematic!.labels[id].kind = e.target.value as 'net' | 'power'))}>
              <option value="net">метка</option>
              <option value="power">питание / земля</option>
            </select>
          </div>
          <p className="hint">Все выводы и провода под одноимёнными метками — одна цепь.</p>
          <div className="row">
            <button className="btn" onClick={rotateSchSelection}>
              Повернуть
            </button>
            <button className="btn danger" onClick={deleteSchSelection}>
              Удалить
            </button>
          </div>
        </div>
      );
    }
  }
  if (sel.length) {
    return (
      <div>
        <h3>Выделено: {sel.length}</h3>
        <div className="row">
          <button className="btn" onClick={rotateSchSelection}>
            Повернуть
          </button>
          <button className="btn danger" onClick={deleteSchSelection}>
            Удалить
          </button>
        </div>
      </div>
    );
  }
  const nl = schematicNetlist(p);
  const pins = placedPins(p);
  const open = pins.filter((x) => !nl.pinNet.has(x.component + '#' + x.number));
  return (
    <div>
      <h3>Схема</h3>
      <p className="hint">
        Символов {Object.keys(sch?.symbols ?? {}).length}, проводов {Object.keys(sch?.wires ?? {}).length}, меток {Object.keys(sch?.labels ?? {}).length}, цепей {nl.nets.length}.
      </p>
      <div className="row">
        <button className="btn primary" onClick={updateBoardFromSchematic}>
          Обновить плату по схеме
        </button>
      </div>
      {nl.warnings.map((w) => (
        <p key={w} className="hint" style={{ color: 'var(--warn)' }}>
          {w}
        </p>
      ))}
      <h4>Неподключённые выводы: {open.length}</h4>
      <p className="hint">
        {open
          .slice(0, 40)
          .map((x) => `${x.ref}.${x.number}${x.name && x.name !== x.number ? ` (${x.name})` : ''}`)
          .join(', ')}
        {open.length > 40 ? '…' : ''}
      </p>
      <h4>Как рисовать</h4>
      <ul className="hint" style={{ paddingLeft: 18 }}>
        <li>P — поставить компонент из библиотеки (на плате он встанет справа от контура).</li>
        <li>W — провод: от вывода к выводу, изломы под прямым углом.</li>
        <li>N — метка цепи: одноимённые метки соединены без провода (GND, +5V).</li>
        <li>R — повернуть, X — зеркально, Delete — удалить (деталь удаляется и с платы).</li>
      </ul>
    </div>
  );
}
