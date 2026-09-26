import { useEditor, type AskData } from '@editor/store';
import { leaveSchematic, setSchTool } from '@editor/sch';

/*
 * Кнопка «Назад» (Android, жест назад, Alt+← на компьютере). В истории браузера
 * всегда лежит «защитная» запись: «Назад» снимает её, мы закрываем верхний слой
 * (меню, окно, панель, начатое действие, инструмент, выделение, схему) и кладём
 * запись обратно. Если закрывать нечего — подсказка; второе нажатие в течение
 * 2,5 с выходит из редактора.
 */

type Handler = () => boolean;
const extra: Handler[] = [];

/** Своя обработка «Назад» для слоя вне состояния редактора (открытое меню). Вернуть true, если закрыли. */
export function onBack(h: Handler): () => void {
  extra.push(h);
  return () => {
    const i = extra.lastIndexOf(h);
    if (i >= 0) extra.splice(i, 1);
  };
}

const narrow = () => typeof window !== 'undefined' && window.innerWidth < 900;

/** Закрыть верхний слой интерфейса. false — закрывать нечего. */
export function handleBack(): boolean {
  for (let i = extra.length - 1; i >= 0; i--) if (extra[i]()) return true;
  const s = useEditor.getState();
  if (s.dialog) {
    const ask = s.dialog === 'confirm' || s.dialog === 'prompt' ? (s.dialogData as AskData | null) : null;
    s.closeDialog();
    ask?.onCancel?.();
    return true;
  }
  if (s.panelOpen && narrow()) {
    s.patch({ panelOpen: false });
    return true;
  }
  if (s.mode === 'sch') {
    if (s.schPending) s.patch({ schPending: null });
    else if (s.schTool !== 'select') setSchTool('select');
    else if (s.schSelection.length) s.patch({ schSelection: [] });
    else leaveSchematic();
    return true;
  }
  if (s.pending) {
    s.patch({ pending: null, highlightNet: null });
    s.setMessage('Отменено.');
    return true;
  }
  if (s.tool !== 'select') {
    s.setTool('select');
    return true;
  }
  if (s.selection.length || s.highlightNet) {
    s.patch({ selection: [], highlightNet: null });
    return true;
  }
  return false;
}

const GUARD = { plataBack: true };
const guarded = () => !!(history.state as { plataBack?: boolean } | null)?.plataBack;

export function installBackButton(): () => void {
  if (typeof window === 'undefined' || !window.history?.pushState) return () => undefined;
  const arm = () => {
    if (!guarded()) history.pushState(GUARD, '');
  };
  arm();
  let rearm: ReturnType<typeof setTimeout> | undefined;
  const onPop = () => {
    clearTimeout(rearm);
    if (handleBack()) return arm();
    // Закрывать нечего: защитной записи сейчас нет, следующий «Назад» уведёт из редактора.
    useEditor.getState().setMessage('Нажмите «Назад» ещё раз, чтобы выйти из редактора.');
    rearm = setTimeout(arm, 2500);
  };
  window.addEventListener('popstate', onPop);
  return () => {
    clearTimeout(rearm);
    window.removeEventListener('popstate', onPop);
  };
}
