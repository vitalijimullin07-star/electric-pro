import { stableProject, useEditor } from '@editor/store';
import { PropertiesPanel } from './PropertiesPanel';
import { LayersPanel } from './LayersPanel';
import { NetsPanel } from './NetsPanel';
import { LibraryPanel } from './LibraryPanel';
import { DrcPanel } from './DrcPanel';
import { runDrc } from '@core/model/drc';

const TABS: { id: 'props' | 'layers' | 'nets' | 'library' | 'drc'; label: string }[] = [
  { id: 'props', label: 'Свойства' },
  { id: 'layers', label: 'Слои' },
  { id: 'nets', label: 'Цепи' },
  { id: 'library', label: 'Библиотека' },
  { id: 'drc', label: 'Проверка' },
];

export function RightPanel() {
  const tab = useEditor((s) => s.panelTab);
  const open = useEditor((s) => s.panelOpen);
  const project = useEditor(stableProject);
  const errors = runDrc(project).errors;
  return (
    <aside className={`panel${open ? ' open' : ''}`} style={open ? undefined : { display: window.innerWidth >= 900 ? 'none' : undefined }}>
      <div className="mobile-sheet-handle" onClick={() => useEditor.setState({ panelOpen: false })} />
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" className={tab === t.id ? 'on' : ''} onClick={() => useEditor.setState({ panelTab: t.id })}>
            {t.label}
            {t.id === 'drc' && errors ? <span className="tag err" style={{ marginLeft: 4 }}>{errors}</span> : null}
          </button>
        ))}
      </div>
      <div className="body">
        {tab === 'props' && <PropertiesPanel />}
        {tab === 'layers' && <LayersPanel />}
        {tab === 'nets' && <NetsPanel />}
        {tab === 'library' && <LibraryPanel />}
        {tab === 'drc' && <DrcPanel />}
      </div>
    </aside>
  );
}
