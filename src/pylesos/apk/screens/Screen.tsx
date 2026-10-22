/* Экран пылесоса в вертикальном положении: то же изображение по ширине телефона; боком — во весь экран. */
import { useEffect, useState } from 'react';
import type { Ctx } from '../ctx';
import type { PanelMirror } from '../panel-mirror';
import { Panel } from '../Panel';
import { Icon } from '../ui';

export function ScreenTab(c: Ctx) {
  return (
    <div className="screen">
      <header className="bar">
        <button type="button" className="iconbtn" aria-label="Назад" onClick={() => c.open(null)}>
          {Icon.back}
        </button>
        <h1 className="grow">Экран пылесоса</h1>
        <span className="muted small">копия 1:1</span>
      </header>
      <PanelOrNote {...c} />
      <p className="small muted note">
        {Icon.rotate}
        <span>Поверните телефон боком — экран пылесоса во весь размер. Касания уходят на пылесос, как будто нажали на его экран.</span>
      </p>
    </div>
  );
}

export function PanelOrNote(c: Ctx & { full?: boolean }) {
  if (c.demo?.hasPanel) return <Panel src={c.demo} full={c.full} />;
  if (c.demo) return <div className={`panel-note ${c.full ? 'full' : ''}`}>Экран пылесоса запускается…</div>;
  if (c.mirror)
    return (
      <>
        <Panel src={c.mirror} full={c.full} />
        {!c.full && <MirrorState m={c.mirror} on={c.linkState === 'on'} />}
      </>
    );
  return <div className={`panel-note ${c.full ? 'full' : ''}`}>Экран пылесоса — при связи по Bluetooth из приложения.</div>;
}

/** Идут ли строки экрана от пылесоса (их шлёт прошивка 6.3.2 и новее, пока копия экрана открыта). */
function MirrorState({ m, on }: { m: PanelMirror; on: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!on) return <p className="small muted note">Пылесос не на связи — экран оживёт, когда подключится.</p>;
  if (m.lastRx && Date.now() - m.lastRx < 4000) return null;
  return (
    <p className="small muted note">
      Жду строки экрана от пылесоса… Если картинка не оживает за несколько секунд — обновите его прошивку до 6.3.3 (Настройки → Прошивка).
    </p>
  );
}
