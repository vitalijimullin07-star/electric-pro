import type { LogLine } from '../App';
import { Section } from '../ui';

export function LogTab({ lines, faults, onClear }: { lines: LogLine[]; faults: { text: string; severe: boolean }[]; onClear: () => void }) {
  return (
    <>
      <Section title="Сейчас">
        {faults.length ? (
          faults.map((f) => (
            <div key={f.text} className={`banner ${f.severe ? 'bad' : 'warn'}`}>
              {f.text}
            </div>
          ))
        ) : (
          <p className="ok-text">Неисправностей нет</p>
        )}
      </Section>
      <Section
        title="Сообщения"
        right={
          <button className="link" onClick={onClear}>
            Очистить
          </button>
        }
      >
        {!lines.length && <p className="hint">Здесь будут сообщения пылесоса: пуск, очистка, фильтр, розетка, неисправности.</p>}
        <div className="log">
          {[...lines].reverse().map((l, i) => (
            <div key={lines.length - i} className={/^!|неисправ|Авари/i.test(l.text) ? 'bad' : ''}>
              <time>{new Date(l.t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
              {l.text.trim()}
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
