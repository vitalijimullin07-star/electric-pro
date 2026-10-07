/*
 * Демо: пылесос целиком в браузере — та же прошивка контроллера 5.x (WebAssembly) и модель
 * установки (турбины, тарельчатые клапаны, бак, фильтр), что в Plata. Работает в воркере,
 * в тестах — напрямую.
 */
import { buildVacuumS3Mod } from '../core/examples/vacuum-s3/mod';
import { Simulation, bytesToBase64 } from '../core/sim';
import { Esp32 } from '../core/sim/esp32';
import type { Device } from '../core/sim/devices';
import { parseStatus, type VacStatus } from './protocol';

/** Что можно «сделать руками» с пылесосом в демо. */
export type DemoAction = 'hose' | 'dust' | 'clean' | 'tool' | 'suck' | 'drain' | 'mains';

export interface DemoWorld {
  hoseClosed: boolean;
  tool: boolean;
  dust: number;
  water: number;
  sucking: boolean;
}

export class DemoVacuum {
  onLog: ((line: string) => void) | null = null;
  private tail = '';

  private constructor(readonly sim: Simulation) {
    sim.onSerial = (t) => {
      this.tail += t;
      let i: number;
      while ((i = this.tail.indexOf('\n')) >= 0) {
        const line = this.tail.slice(0, i).replace(/\r$/, '');
        this.tail = this.tail.slice(i + 1);
        if (line && !/^(АВТО|РУЧН|СТОП)/.test(line)) this.onLog?.(line);
      }
    };
  }

  static async create(wasm: Uint8Array, nvs?: Uint8Array, onNvs?: (d: Uint8Array) => void): Promise<DemoVacuum> {
    const p = buildVacuumS3Mod({ name: 'vacuum-s3.wasm', wasm: bytesToBase64(wasm) });
    const esp = await Esp32.create(wasm, { s3: true, nvs, onNvs });
    return new DemoVacuum(new Simulation(p, esp));
  }

  static createSync(wasm: Uint8Array): DemoVacuum {
    return new DemoVacuum(Simulation.createSync(buildVacuumS3Mod({ name: 'vacuum-s3.wasm', wasm: bytesToBase64(wasm) })));
  }

  /** Время вперёд, мс. */
  run(ms: number): void {
    this.sim.run(Math.round(ms * 1000));
  }

  command(line: string): void {
    this.sim.serialWrite(line.trim() + '\n');
  }

  status(): VacStatus | null {
    const esp = this.sim.mcu;
    return esp instanceof Esp32 ? parseStatus(esp.statusJson() ?? '') : null;
  }

  private dev(re: RegExp): Device | undefined {
    return this.sim.devices.find((d) => re.test(d.view().title));
  }

  private air() {
    return this.dev(/Шланг, бак, фильтр/);
  }

  act(a: DemoAction): void {
    const air = this.air();
    const tank = this.dev(/^Бак/);
    if (a === 'hose' && air) this.sim.act(air.id, 'palm');
    if (a === 'dust' && air) this.sim.act(air.id, 'dust');
    if (a === 'clean' && air) this.sim.act(air.id, 'clean');
    if (a === 'tool') {
      const t = this.dev(/розетка: инструмент/);
      if (t) this.sim.act(t.id, 'switch');
    }
    if (a === 'suck' && tank) this.sim.act(tank.id, 'suck');
    if (a === 'drain' && tank) this.sim.act(tank.id, 'drain');
    if (a === 'mains') {
      const m = this.sim.devices.find((d) => d.view().actions?.some((x) => x.key === 'dip'));
      if (m) this.sim.act(m.id, 'dip');
    }
  }

  world(): DemoWorld {
    const v = this.sim.view().plant;
    const air = this.air()?.view();
    const tool = this.dev(/розетка: инструмент/)?.view();
    const dust = air?.readings?.find((r) => r.label === 'пыль на фильтре')?.value ?? 0;
    return {
      hoseClosed: !!air?.actions?.some((x) => x.key === 'palm' && /Открыть/.test(x.label)),
      tool: !!tool?.actions?.some((x) => /Выключить/.test(x.label)),
      dust,
      water: Math.round((v?.tank?.level ?? 0) * 100),
      sucking: !!v?.tank?.sucking,
    };
  }
}
