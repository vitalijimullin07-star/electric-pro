/* Прошивка: по кабелю OTG прямо с телефона (файлы — в приложении), по Wi-Fi пылесоса через его страницу. */
import { useEffect, useState } from 'react';
import type { Ctx } from '../ctx';
import { native, nativeInfo, onNative } from '../native';
import { checkFirmware, type FwCheck } from '../fw-check';
import type { FlashImage } from '../esp-flash';
import { bootLog, flashOverUsb, loadImages, readBleCode, type FwBundle } from '../usb';
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
      <UsbFlash boardVer={c.mode === 'device' ? s.ver : undefined} />
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

const MARK: Record<string, string> = { ok: '✓', warn: '⚠', bad: '✗' };

/** Прошить плату по кабелю OTG: телефон → разъём USB платы (родной USB чипа). Перед записью — проверка файла. */
function UsbFlash({ boardVer }: { boardVer?: string }) {
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
  const [own, setOwn] = useState('');
  const [src, setSrc] = useState<'app' | 'file'>('app');
  const [file, setFile] = useState<{ name: string; data: Uint8Array } | null>(null);
  const [picking, setPicking] = useState(false);
  const [imgs, setImgs] = useState<FlashImage[] | null>(null);
  const [check, setCheck] = useState<FwCheck | null>(null);
  const [agree, setAgree] = useState(false);
  useEffect(() => {
    fetch('fw/manifest.json')
      .then((r) => (r.ok ? (r.json() as Promise<FwBundle>) : null))
      .then(setFw)
      .catch(() => setFw(null));
  }, []);
  useEffect(() => {
    if (!fw) return;
    let live = true;
    loadImages(fw, size)
      .then((x) => live && setImgs(x))
      .catch(() => live && setImgs(null));
    return () => {
      live = false;
    };
  }, [fw, size]);
  // Свой файл: Android выбирает его системным окном, данные отдаёт запросом /__picked.
  useEffect(
    () =>
      onNative((e) => {
        if (e.t !== 'file') return;
        setPicking(false);
        if (e.err) {
          setLines((x) => [...x.slice(-30), `Файл не прочитан: ${String(e.err)}`]);
          return;
        }
        if (!e.len) return;
        fetch(`/__picked?${Date.now()}`)
          .then((r) => r.arrayBuffer())
          .then((b) => setFile({ name: String(e.name ?? 'файл'), data: new Uint8Array(b) }))
          .catch((err: Error) => setLines((x) => [...x.slice(-30), `Файл не прочитан: ${err.message}`]));
      }),
    [],
  );
  // Проверка — заново при каждой смене файла, флеша или версии на плате.
  useEffect(() => {
    setAgree(false);
    if (!imgs) return setCheck(null);
    const data = src === 'app' ? imgs[3].data : file?.data;
    if (!data) return setCheck(null);
    setCheck(checkFirmware(data, { flashMb: Number(size), partitions: imgs[1].data, boardVer, allowForeign: src === 'file' }));
  }, [imgs, src, file, size, boardVer]);
  const warned = !!check?.items.some((i) => i.level === 'warn');
  const canFlash = !!check?.ok && (!warned || agree);
  const pick = (v: string) => {
    setSize(v);
    try {
      localStorage.setItem(SIZE_KEY, v);
    } catch {
      /* не запомнили */
    }
  };
  const askCode = async (set?: string) => {
    if (!native) return;
    setBusy(true);
    setCode(null);
    const log = (l: string) => setLines((x) => [...x.slice(-30), l]);
    try {
      setCode(await readBleCode(native, log, set));
      if (set) log('Код на плате сменён: его спросит новый телефон, сопряжённые подключаются как прежде');
    } catch (e) {
      log(`Код не получен: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const monitor = async () => {
    if (!native) return;
    setBusy(true);
    setResult(null);
    setLines([]);
    const log = (l: string) => setLines((x) => [...x.slice(-60), l]);
    try {
      log(`Итог: ${await bootLog(native, log)}`);
    } catch (e) {
      log(`Не получилось: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    if (!native || !fw || !imgs || !check?.ok || !check.app || !canFlash) return;
    setBusy(true);
    setResult(null);
    setLines([]);
    setProg([0, 'подготовка']);
    const log = (l: string) => setLines((x) => [...x.slice(-30), l]);
    try {
      const name = src === 'app' ? `программа ${fw.ver}` : `программа ${check.ver ?? ''} (${file?.name ?? 'файл'})`;
      const images = [...imgs.slice(0, 3), { addr: 0x10000, data: check.app, name }];
      log(`Проверка пройдена: ${name}`);
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
          <div className="small muted">Что прошить</div>
          <Seg
            items={[
              ['app', `Из приложения ${fw.ver}`],
              ['file', 'Свой файл .bin'],
            ]}
            value={src}
            onPick={(v) => setSrc(v as 'app' | 'file')}
            small
          />
          {src === 'file' && (
            <>
              <button
                type="button"
                className="btn wide"
                disabled={busy || picking}
                onClick={() => {
                  setPicking(true);
                  native!.pickFile();
                }}
              >
                {picking ? 'Выбираю файл…' : file ? `Файл: ${file.name} — выбрать другой` : 'Выбрать файл прошивки'}
              </button>
              <p className="small muted">
                Подходят <b>vacuum-s3-app.bin</b> (программа) и <b>…-celikom.bin</b> / <b>…-proshivka.bin</b> (целиком): из файла «целиком» пишется только программа, настройки на плате остаются.
              </p>
            </>
          )}
          {check && (
            <div className={`fwcheck ${check.ok ? (warned ? 'warn' : 'ok') : 'bad'}`}>
              <div className="small">
                <b>{check.ok ? (warned ? 'Проверка: есть предупреждения' : 'Проверка пройдена') : 'Проверка не пройдена — прошивать нельзя'}</b>
              </div>
              {check.items.map((i, k) => (
                <div key={k} className={`small fwi ${i.level}`}>
                  {MARK[i.level]} {i.text}
                </div>
              ))}
              {check.ok && warned && (
                <label className="small fwagree">
                  <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> Предупреждения прочитал — прошить всё равно
                </label>
              )}
            </div>
          )}
          <button type="button" className="btn wide go" onClick={() => void run()} disabled={busy || !canFlash}>
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
              <div className="small muted">Код хранится на плате и не меняется при выключении (прошивка 6.3 и новее).</div>
            </div>
          )}
          <button type="button" className="btn wide" onClick={() => void askCode()} disabled={busy}>
            Узнать код Bluetooth по кабелю
          </button>
          <button type="button" className="btn wide" onClick={() => void monitor()} disabled={busy}>
            Что пишет плата (перезапуск)
          </button>
          <form
            className="cmd"
            onSubmit={(e) => {
              e.preventDefault();
              if (/^\d{6}$/.test(own)) void askCode(own);
            }}
          >
            <input
              value={own}
              onChange={(e) => setOwn(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="Свой код: 6 цифр"
              inputMode="numeric"
              aria-label="Свой код Bluetooth"
            />
            <button type="submit" className="btn" disabled={busy || !/^\d{6}$/.test(own)}>
              Задать
            </button>
          </form>
          {lines.length > 0 && <pre className={`flashlog ${result ?? ''}`}>{lines.join('\n')}</pre>}
          <p className="small muted">Настройки и сопряжения не стираются — пишутся загрузчик, разделы и программа. Около минуты; не отключайте кабель.</p>
        </>
      )}
    </Card>
  );
}
