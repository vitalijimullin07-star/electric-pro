/* Экран пылесоса в вертикальном положении: то же изображение по ширине телефона; боком — во весь экран. */
import type { Ctx } from '../ctx';
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
  return (
    <div className={`panel-note ${c.full ? 'full' : ''}`}>
      <b>Экран пылесоса появится после обновления его прошивки до 6.1</b>
      <span>Пылесос будет присылать телефону то же, что своему экрану, и картинка здесь станет точь-в-точь как у него.</span>
    </div>
  );
}
