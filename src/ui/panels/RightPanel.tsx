import { stableProject, useEditor } from '@editor/store';
import { PropertiesPanel } from './PropertiesPanel';
import { LayersPanel } from './LayersPanel';
import { NetsPanel } from './NetsPanel';
import { LibraryPanel } from './LibraryPanel';
import { DrcPanel } from './DrcPanel';
import { SchPanel } from './SchPanel';
import { SimPanel } from './SimPanel';
import { runDrc } from '@core/model/drc';

const TABS: { id: 'props' | 'layers' | 'nets' | 'library' | 'drc' | 'sim'; label: string }[] = [
  { id: 'props', label: 'Свойства' },
  { id: 'layers', label: 'Слои' },
  { id: 'nets', label: 'Цепи' },
  { id: 'library', label: 'Библиотека' },
  { id: 'drc', label: 'Проверка' },
  { id: 'sim', label: 'Симуляция' },
];

export function RightPanel() {
  const tab = useEditor((s) => s.panelTab);
  const open = useEditor((s) => s.panelOpen);
  const project = useEditor(stableProject);
  const mode = useEditor((s) => s.mode);
  const errors = runDrc(project).errors;
  const simStatus = useEditor((s) => s.sim.status);
  return (
    <aside className={`panel${open ? ' open' : ''}`} style={open ? undefined : { display: window.innerWidth >= 900 ? 'none' : undefined }}>
      <div className="mobile-sheet-handle" onClick={() => useEditor.setState({ panelOpen: false })} />
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" className={tab === t.id ? 'on' : ''} onClick={() => useEditor.setState({ panelTab: t.id })}>
            {t.label}
            {t.id === 'drc' && errors ? <span className="tag err" style={{ marginLeft: 4 }}>{errors}</span> : null}
            {t.id === 'sim' && simStatus !== 'off' ? <span className={`sim-dot ${simStatus}`} /> : null}
          </button>
        ))}
      </div>
      <div className="body">
        {tab === 'props' && (mode === 'sch' ? <SchPanel /> : <PropertiesPanel />)}
        {tab === 'layers' && <LayersPanel />}
        {tab === 'nets' && <NetsPanel />}
        {tab === 'library' && <LibraryPanel />}
        {tab === 'drc' && <DrcPanel />}
        {tab === 'sim' && <SimPanel />}
      </div>
    </aside>
  );
}
