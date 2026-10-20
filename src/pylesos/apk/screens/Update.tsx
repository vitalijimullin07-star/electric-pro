/* Прошивка: по кабелю OTG прямо с телефона (файлы — в приложении), по Wi-Fi пылесоса через его страницу. */
import { useEffect, useState } from 'react';
import type { Ctx } from '../ctx';
import { native, nativeInfo } from '../native';
import { flashOverUsb, loadImages, readBleCode, type FwBundle } from '../usb';
import { Card, Icon, Row, Seg } from '../ui';

const SIZE_KEY = 'pylesos-apk-flash-size';

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
        <Row k="Контроллер пылесоса" v={c.mode === 'demo' ? 'демо' : s.ver || '—'} />
        <Row k="Экран пылесоса" v="в прошивке контроллера" />
        <Row k="Приложение" v={info?.app ?? 'в браузере'} />
      </Card>
      <UsbFlash />
      <Card title="По Wi-Fi пылесоса">
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
    </div>
  );
}

/** Прошить плату по кабелю OTG: телефон → разъём USB платы (родной USB чипа). */
function UsbFlash() {
  const [fw, setFw] = useState<FwBundle | null>(null);
  const [size, setSize] = useState<string>(() => {
    try {
      return localStorage.getItem(SIZE_KEY) ?? '8';
    } catch {
      return '8';
    }
  });
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<[number, string] | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [result, setResult] = useState<'ok' | 'bad' | null>(null);
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    fetch('fw/manifest.json')
      .then((r) => (r.ok ? (r.json() as Promise<FwBundle>) : null))
      .then(setFw)
      .catch(() => setFw(null));
  }, []);
  const pick = (v: string) => {
    setSize(v);
    try {
      localStorage.setItem(SIZE_KEY, v);
    } catch {
      /* не запомнили */
    }
  };
  const askCode = async () => {
    if (!native) return;
    setBusy(true);
    setCode(null);
    const log = (l: string) => setLines((x) => [...x.slice(-30), l]);
    try {
      setCode(await readBleCode(native, log));
    } catch (e) {
      log(`Код не получен: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    if (!native || !fw) return;
    setBusy(true);
    setResult(null);
    setLines([]);
    setProg([0, 'подготовка']);
    const log = (l: string) => setLines((x) => [...x.slice(-30), l]);
    try {
      const images = await loadImages(fw, size);
      await flashOverUsb(native, images, Number(size) << 20, (f, what) => setProg([f, what]), log);
      setResult('ok');
      log('Готово: плата перезапущена с новой прошивкой');
      // Без экрана код для Bluetooth больше негде увидеть — спросим у платы, пока кабель на месте.
      await new Promise((r) => setTimeout(r, 4000));
      setCode(await readBleCode(native, log).catch(() => null));
    } catch (e) {
      setResult('bad');
      log(`Не получилось: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="По кабелю с телефона (OTG)">
      {!native ? (
        <p className="small muted">Прошивка по кабелю — в приложении для Android (pylesos.apk).</p>
      ) : !fw ? (
        <p className="small muted">В этой сборке приложения нет файлов прошивки.</p>
      ) : (
        <>
          <p className="small">
            Прошивка контроллера <b>{fw.ver}</b> — внутри приложения, интернет не нужен.
          </p>
          <ol className="steps small">
            <li>
              Кабель OTG (USB-C — USB-C или переходник) — в разъём <b>USB</b> платы, не в COM. Перемычку USB-OTG на плате паять не нужно.
            </li>
            <li>Если Android спросит «Открыть „Пылесос S3“ для USB-устройства?» — отметьте «Всегда» и «ОК»: плата при прошивке переподключается.</li>
            <li>Ничего не нажимайте на плате: телефон сам переведёт её в режим прошивки. Не вышло — держите BOOT, нажмите и отпустите RST, отпустите BOOT и повторите.</li>
          </ol>
          <div className="small muted">Флеш на плате (надпись на модуле: N8R8 — 8 МБ, N16R8 — 16 МБ)</div>
          <Seg items={Object.entries(fw.sizes).map(([k, v]) => [k, v.title] as [string, string])} value={size} onPick={pick} small />
          <button type="button" className="btn wide go" onClick={() => void run()} disabled={busy}>
            {busy ? 'Прошиваю…' : 'Прошить плату'}
          </button>
          {prog && (
            <div className="flashprog" role="progressbar" aria-valuenow={Math.round(prog[0] * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="flashbar">
                <i style={{ width: `${Math.round(prog[0] * 100)}%` }} />
              </div>
              <div className="small muted">
                {Math.round(prog[0] * 100)} % · {prog[1]}
              </div>
            </div>
          )}
          {code && (
            <div className="codebox">
              <div className="small muted">Код для Bluetooth (Android спросит при первом подключении)</div>
              <b>{code}</b>
              <div className="small muted">Код новый после каждого включения платы: подключайте, не выключая её, или спросите снова.</div>
            </div>
          )}
          <button type="button" className="btn wide" onClick={() => void askCode()} disabled={busy}>
            Узнать код Bluetooth по кабелю
          </button>
          {lines.length > 0 && <pre className={`flashlog ${result ?? ''}`}>{lines.join('\n')}</pre>}
          <p className="small muted">Настройки и сопряжения не стираются — пишутся загрузчик, разделы и программа. Около минуты; не отключайте кабель.</p>
        </>
      )}
    </Card>
  );
}
