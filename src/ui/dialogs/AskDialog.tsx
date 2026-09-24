import { useEffect, useRef, useState } from 'react';
import { useEditor, type AskData } from '@editor/store';
import { Dialog } from './Dialog';

/* Подтверждение и ввод строки внутри приложения: браузерные confirm() и prompt() в изолированных страницах не работают. */

export function askConfirm(o: Omit<AskData, 'value'>): void {
  useEditor.getState().openDialog('confirm', o);
}

export function askText(o: AskData): void {
  useEditor.getState().openDialog('prompt', o);
}

export function AskDialog({ data, withInput }: { data: AskData; withInput: boolean }) {
  const closeDialog = useEditor((s) => s.closeDialog);
  const close = () => {
    closeDialog();
    data.onCancel?.();
  };
  const [value, setValue] = useState(data.value ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const t = setTimeout(() => (withInput ? inputRef.current?.select() : okRef.current?.focus()), 30);
    return () => clearTimeout(t);
  }, [withInput]);
  const ok = () => {
    if (withInput && !value.trim()) return;
    closeDialog();
    data.onOk(withInput ? value.trim() : undefined);
  };
  return (
    <Dialog
      title={data.title}
      size="narrow"
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>
            Отмена
          </button>
          <button ref={okRef} className={`btn ${data.danger ? 'danger' : 'primary'}`} onClick={ok} disabled={withInput && !value.trim()}>
            {data.okLabel ?? 'OK'}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>{data.message}</p>
      {withInput && (
        <input
          ref={inputRef}
          className="inp"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') ok();
            e.stopPropagation();
          }}
        />
      )}
    </Dialog>
  );
}
