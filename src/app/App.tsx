import { useEffect } from 'react';
import { useEditor } from '@editor/store';
import { TopBar } from '@ui/TopBar';
import { ToolBar } from '@ui/ToolBar';
import { CanvasView } from '@ui/CanvasView';
import { RightPanel } from '@ui/panels/RightPanel';
import { StatusBar } from '@ui/StatusBar';
import { NewProjectDialog } from '@ui/dialogs/NewProjectDialog';
import { ExportDialog } from '@ui/dialogs/ExportDialog';
import { BoardDialog } from '@ui/dialogs/BoardDialog';
import { ComponentDialog } from '@ui/dialogs/ComponentDialog';
import { OpenDialog } from '@ui/dialogs/OpenDialog';
import { AskDialog } from '@ui/dialogs/AskDialog';
import type { AskData } from '@editor/store';
import { AboutDialog, AutorouteDialog, NetDialog, ShortcutsDialog, TextDialog } from '@ui/dialogs/SmallDialogs';
import { FootprintEditorDialog, type FootprintEditorData } from '@ui/dialogs/FootprintEditor';
import { View3D } from '@ui/dialogs/View3D';
import { SchematicView } from '@ui/SchematicView';

export function App() {
  const dialog = useEditor((s) => s.dialog);
  const dialogData = useEditor((s) => s.dialogData);
  const dirty = useEditor((s) => s.dirty);
  const mode = useEditor((s) => s.mode);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty && useEditor.getState().fileName) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  return (
    <div className="app">
      <TopBar />
      <ToolBar />
      {mode === 'sch' ? <SchematicView /> : <CanvasView />}
      <RightPanel />
      <StatusBar />
      {dialog === 'new' && <NewProjectDialog />}
      {dialog === 'export' && <ExportDialog />}
      {dialog === 'open' && <OpenDialog />}
      {(dialog === 'board' || dialog === 'rules') && <BoardDialog />}
      {dialog === 'component' && typeof dialogData === 'string' && <ComponentDialog id={dialogData} />}
      {dialog === 'net' && typeof dialogData === 'string' && <NetDialog id={dialogData} />}
      {dialog === 'text' && <TextDialog data={dialogData} />}
      {dialog === 'autoroute' && <AutorouteDialog />}
      {dialog === 'shortcuts' && <ShortcutsDialog />}
      {dialog === 'about' && <AboutDialog />}
      {dialog === '3d' && <View3D />}
      {dialog === 'footprint' && <FootprintEditorDialog data={(dialogData ?? {}) as FootprintEditorData} />}
      {(dialog === 'confirm' || dialog === 'prompt') && dialogData ? <AskDialog data={dialogData as AskData} withInput={dialog === 'prompt'} /> : null}
    </div>
  );
}
