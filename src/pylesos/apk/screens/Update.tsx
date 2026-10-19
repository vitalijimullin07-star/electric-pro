/* Прошивка: версии и обновление. Загрузка из приложения (Wi-Fi напрямую или Bluetooth) — с прошивкой 6.1;
 * пока — по Wi-Fi пылесоса через его страницу. */
import type { Ctx } from '../ctx';
import { nativeInfo } from '../native';
import { Card, Icon, Row } from '../ui';

export function Update(c: Ctx) {
  const info = nativeInfo();
  const { s, send } = c;
  return (
    <div className="screen">
      <header className="bar">
        <button type="button" className="iconbtn" aria-label="Назад" onClick={() => c.open(null)}>
          {Icon.back}
        </button>
        <h1 className="grow">Прошивка</h1>
      </header>
      <Card>
        <Row k="Контроллер пылесоса" v={s.ver || '—'} />
        <Row k="Экран пылесоса" v="в прошивке контроллера" />
        <Row k="Приложение" v={info?.app ?? 'в браузере'} />
      </Card>
      <Card title="Как обновить сейчас">
        <ol className="steps small">
          <li>Включите Wi-Fi пылесоса — кнопка ниже (или на его экране «Ещё → Телефон»).</li>
          <li>Подключите телефон к сети Pylesos-S3-… (пароль — на экране пылесоса).</li>
          <li>
            Откройте в браузере <b>192.168.4.1</b> → «Ещё» → файл <b>vacuum-s3-app.bin</b>.
          </li>
        </ol>
        <button type="button" className="btn wide" onClick={() => send(s.wifi ? 'wifi off' : 'wifi on')} disabled={c.mode === 'demo'}>
          {s.wifi ? 'Выключить Wi-Fi пылесоса' : 'Включить Wi-Fi пылесоса'}
        </button>
        <p className="small muted">Если новая прошивка не проработает 30 с, пылесос сам вернётся на прежнюю. Настройки и паспорта фильтров сохраняются.</p>
      </Card>
      <Card title="Скоро — прямо из приложения">
        <p className="small muted">
          С прошивкой 6.1 файл можно будет выбрать здесь: по Wi-Fi напрямую (~15 с, интернет телефона остаётся через мобильную сеть) или по Bluetooth (~1 мин). Экран пылесоса
          в телефоне (повернуть боком) обновится вместе с прошивкой.
        </p>
      </Card>
    </div>
  );
}
