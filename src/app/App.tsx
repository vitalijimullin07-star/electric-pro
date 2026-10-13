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
import { AboutDialog, NetDialog, ShortcutsDialog, TextDialog } from '@ui/dialogs/SmallDialogs';
import { AutoDesignDialog } from '@ui/dialogs/AutoDesignDialog';
import { FootprintEditorDialog, type FootprintEditorData } from '@ui/dialogs/FootprintEditor';
import { DfmDialog } from '@ui/dialogs/DfmDialog';
import { LayerMoveDialog } from '@ui/dialogs/LayerMoveDialog';
import { ReplaceDialog, type ReplaceData } from '@ui/dialogs/ReplaceDialog';
import { View3D } from '@ui/dialogs/View3D';
import { StlViewer } from '@ui/dialogs/StlViewer';
import { MODEL_FILES, openStlFiles } from '@ui/stl-session';
import { SchematicView } from '@ui/SchematicView';
import { gfxProfile } from '@render/quality';
import { installBackButton } from '@ui/back-button';
import { SimFullscreen } from '@ui/SimFullscreen';
import { SimTuner } from '@ui/panels/SimTuner';

export function App() {
  const dialog = useEditor((s) => s.dialog);
  const dialogData = useEditor((s) => s.dialogData);
  const dirty = useEditor((s) => s.dirty);
  const mode = useEditor((s) => s.mode);
  const quality = useEditor((s) => s.quality);
  const gfxLevel = useEditor((s) => s.gfxLevel);

  // Уровень графики — атрибутом на <html>: стили выключают размытие и анимацию в экономном режиме.
  useEffect(() => {
    document.documentElement.dataset.gfx = gfxProfile(quality, gfxLevel).level;
  }, [quality, gfxLevel]);

  // Кнопка «Назад» на телефоне закрывает окна и панели, а не приложение.
  useEffect(() => installBackButton(), []);

  // Перетаскивание файлов в окно: модели STL, STEP, IGES (и ZIP с ними) открываются в просмотре.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      const stl = files.filter((f) => MODEL_FILES.test(f.name));
      if (stl.length) void openStlFiles(stl);
      else useEditor.getState().setMessage('Сюда можно перетащить 3D-модели STL, STEP, IGES (или архив ZIP с ними).');
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      const st = useEditor.getState();
      if (dirty && (st.fileName || st.deviceId)) e.preventDefault();
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
      <SimFullscreen />
      <SimTuner />
      {dialog === 'new' && <NewProjectDialog />}
      {dialog === 'export' && <ExportDialog />}
      {dialog === 'open' && <OpenDialog />}
      {(dialog === 'board' || dialog === 'rules') && <BoardDialog />}
      {dialog === 'component' && typeof dialogData === 'string' && <ComponentDialog id={dialogData} />}
      {dialog === 'net' && typeof dialogData === 'string' && <NetDialog id={dialogData} />}
      {dialog === 'text' && <TextDialog data={dialogData} />}
      {dialog === 'autoroute' && <AutoDesignDialog />}
      {dialog === 'shortcuts' && <ShortcutsDialog />}
      {dialog === 'about' && <AboutDialog />}
      {dialog === '3d' && <View3D />}
      {dialog === 'stl' && <StlViewer />}
      {dialog === 'dfm' && <DfmDialog />}
      {dialog === 'layers' && <LayerMoveDialog />}
      {dialog === 'replace' && <ReplaceDialog data={(dialogData ?? {}) as ReplaceData} />}
      {dialog === 'footprint' && <FootprintEditorDialog data={(dialogData ?? {}) as FootprintEditorData} />}
      {(dialog === 'confirm' || dialog === 'prompt') && dialogData ? <AskDialog data={dialogData as AskData} withInput={dialog === 'prompt'} /> : null}
    </div>
  );
}
