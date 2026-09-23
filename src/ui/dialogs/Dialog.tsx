import type { ReactNode } from 'react';
import { useEditor } from '@editor/store';

export function Dialog({ title, children, footer, size }: { title: string; children: ReactNode; footer?: ReactNode; size?: 'wide' | 'narrow' }) {
  const close = useEditor((s) => s.closeDialog);
  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`modal${size ? ' ' + size : ''}`} role="dialog" aria-label={title}>
        <header>
          <span>{title}</span>
          <button onClick={close} aria-label="Закрыть">
            ×
          </button>
        </header>
        <div className="content">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}
