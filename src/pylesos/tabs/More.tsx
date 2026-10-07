import { useState } from 'react';
import type { Ctx } from '../App';
import { Confirm, Row, Section, Stepper, Toggle } from '../ui';

export function MoreTab({ s, send, link, onDisconnect }: Ctx & { onDisconnect: () => void }) {
  const [line, setLine] = useState('');
  return (
    <>
      <Section title="Розетка и инструмент">
        <Toggle label="Автозапуск от инструмента" hint="турбины — когда инструмент в розетке берёт ток" on={!!s.tauto} onChange={(on) => send(`tool auto ${on ? 1 : 0}`)} />
        <Stepper label="Порог тока инструмента" value={s.tthr} min={0.1} max={5} step={0.1} unit="А" onSet={(v) => send(`tool thr ${Math.round(v * 10)}`)} />
        <Stepper label="Выбег после инструмента" value={s.runon} min={0} max={30} step={1} unit="с" onSet={(v) => send(`tool runon ${v}`)} />
        <Stepper label="Ударов после инструмента" value={s.tend} min={0} max={10} step={1} onSet={(v) => send(`tool end ${v}`)} />
        <Stepper label="Предел общего тока" hint="автомат на линии" value={s.limit} min={10} max={32} step={1} unit="А" onSet={(v) => send(`tool limit ${v}`)} />
        <Toggle label="Розетка без пылесоса" hint="под напряжением и когда турбины не нужны" on={!!s.sfree} onChange={(on) => send(`tool free ${on ? 1 : 0}`)} />
        <Toggle label="Вторая турбина помогает в авто" on={!!s.t2a} onChange={(on) => send(`t2allow ${on ? 1 : 0}`)} />
      </Section>

      <Section title="Пульт и метки Bluetooth">
        <p className="hint">Привязка беспроводного пульта или метки на инструменте: нажмите и в течение 30 с зажмите кнопку на пульте (метке).</p>
        <button className="btn" onClick={() => send('ble pair')}>
          Привязать пульт или метку
        </button>
      </Section>

      {link.kind === 'wifi' ? <Update /> : (
        <Section title="Обновление прошивки">
          <p className="hint">Обновление — по Wi-Fi пылесоса: подключитесь к его сети и откройте 192.168.4.1, вкладка «Ещё».</p>
        </Section>
      )}

      <Section title="Команда вручную">
        <form
          className="cmd"
          onSubmit={(e) => {
            e.preventDefault();
            if (line.trim()) send(line.trim());
            setLine('');
          }}
        >
          <input value={line} onChange={(e) => setLine(e.target.value)} placeholder="help, status, export…" autoCapitalize="off" autoCorrect="off" />
          <button className="btn">Отправить</button>
        </form>
        <p className="hint">Ответ — во вкладке «Журнал».</p>
      </Section>

      <Section title="О пылесосе">
        <Row k="Прошивка контроллера" v={s.ver} />
        <Row k="Экран на связи" v={s.panel ? 'да' : 'нет'} />
        <Row k="Пульт Bluetooth" v={['нет', 'привязан', 'на связи'][s.remote] ?? '—'} />
        <Row k="Шланг" v={`${s.hosemm} мм`} />
      </Section>

      <div className="pair">
        <Confirm className="btn" onClick={() => send('off')}>
          Выключить пылесос
        </Confirm>
        <button className="btn ghost" onClick={onDisconnect}>
          Отключиться
        </button>
      </div>
    </>
  );
}

/** Обновление и резервная копия — только по Wi-Fi пылесоса (файлы большие). */
function Update() {
  const [msg, setMsg] = useState('');
  const [pr, setPr] = useState(0);
  const up = (file: File | undefined, url: string) => {
    if (!file) return;
    const x = new XMLHttpRequest();
    const d = new FormData();
    d.append('fw', file);
    x.upload.onprogress = (e) => setPr(e.total ? (e.loaded / e.total) * 100 : 0);
    x.onload = () => setMsg(x.responseText);
    x.onerror = () => setMsg('Связь оборвалась');
    x.open('POST', url);
    x.send(d);
    setMsg('Загрузка… турбины остановлены');
  };
  return (
    <Section title="Обновление прошивки">
      <p className="hint">Турбины остановятся. Чужой файл не запишется, а новая прошивка, если не проработает 30 с, откатится на старую. Настройки и паспорта фильтров сохраняются.</p>
      <label className="file">
        Контроллер (vacuum-s3-app.bin)
        <input type="file" accept=".bin" onChange={(e) => up(e.target.files?.[0], '/fw')} />
      </label>
      <label className="file">
        Экран (vacuum-panel-app.bin), ~3 минуты
        <input type="file" accept=".bin" onChange={(e) => up(e.target.files?.[0], '/fwp')} />
      </label>
      {pr > 0 && <progress max={100} value={pr} />}
      {msg && <p>{msg}</p>}
      <h3>Резервная копия настроек</h3>
      <a className="btn" href="/cfg" download="pylesos-s3-nastroyki.txt">
        Скачать настройки
      </a>
      <label className="file">
        Восстановить из файла
        <input
          type="file"
          accept=".txt"
          onChange={(e) =>
            e.target.files?.[0]?.text().then((t) =>
              fetch('/cfg', { method: 'POST', body: t.trim() })
                .then((r) => r.text())
                .then(setMsg),
            )
          }
        />
      </label>
    </Section>
  );
}
