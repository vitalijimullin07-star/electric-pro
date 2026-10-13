import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import occtimportjs from 'occt-import-js';
import { cadParts, OCCT_PARAMS, type OcctResult } from '../src/core/io/step';
import { buildModel, modelKind, modelSources, splitBodies, stlSize } from '../src/core/io/stl';
import { strToU8, zipSync } from 'fflate';

const fixture = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/step/${n}`, import.meta.url)));

describe('STEP и IGES (OpenCascade)', () => {
  it('сборка AS1: 18 деталей с именами узлов, все замкнуты, объём по деталям', async () => {
    const occt = await occtimportjs();
    const parts = cadParts(occt.ReadStepFile(fixture('as1_pe_203.stp'), OCCT_PARAMS) as OcctResult);
    expect(parts).toHaveLength(18);
    expect(parts[0].name).toBe('PLATE');
    expect(parts[0].path).toBe('AS1_PE_ASM');
    // Безликое «SOLID» заменено именем узла, повторы пронумерованы.
    expect(parts.filter((p) => p.name.startsWith('L_BRACKET_ASSEMBLY_ASM')).length).toBe(14);
    expect(new Set(parts.map((p) => p.name)).size).toBe(18);
    expect(parts[0].normals).not.toBeNull();
    const models = parts.map((p) => buildModel(p.positions, p.name, p.normals ?? undefined));
    for (const m of models) expect(m.edges).toMatchObject({ open: 0, nonManifold: 0, bodies: 1 });
    // Плита: 4572 × 508 × 3810 мм (180 × 20 × 150 дюймов).
    expect(stlSize(models[0]).map((v) => Math.round(v))).toEqual([4572, 508, 3810]);
  }, 60_000);

  it('IGES: куб 10 мм', async () => {
    const occt = await occtimportjs();
    const parts = cadParts(occt.ReadIgesFile(fixture('cube-10x10.igs'), OCCT_PARAMS) as OcctResult);
    expect(parts).toHaveLength(1);
    const m = buildModel(parts[0].positions, parts[0].name);
    expect(stlSize(m).map((v) => Math.round(v * 1000) / 1000)).toEqual([10, 10, 10]);
    expect(m.volume).toBeCloseTo(1000, 3);
  }, 60_000);

  it('неверный файл — понятная ошибка', async () => {
    const occt = await occtimportjs();
    expect(() => cadParts(occt.ReadStepFile(strToU8('не STEP'), OCCT_PARAMS) as OcctResult)).toThrow(/не прочитан/);
  }, 60_000);

  it('вид файла по имени и STEP из ZIP', () => {
    expect([modelKind('a.STEP'), modelKind('b.stp'), modelKind('c.igs'), modelKind('d.stl'), modelKind('e.txt')]).toEqual(['step', 'step', 'iges', 'stl', null]);
    const z = zipSync({ 'сборка/узел.stp': fixture('as1_pe_203.stp'), 'сборка/куб.igs': fixture('cube-10x10.igs'), 'прочее.pdf': strToU8('x') });
    expect(modelSources('Сборка.zip', z).map((s) => `${s.name}:${s.kind}`)).toEqual(['сборка/куб.igs:iges', 'сборка/узел.stp:step']);
  });

  it('разбиение на тела: сборка в одном файле — по деталям', async () => {
    const occt = await occtimportjs();
    const parts = cadParts(occt.ReadStepFile(fixture('as1_pe_203.stp'), OCCT_PARAMS) as OcctResult);
    // Все детали одним телом-файлом (как «сборка.stl») — разбивается обратно на 18.
    const all = new Float32Array(parts.reduce((a, p) => a + p.positions.length, 0));
    let o = 0;
    for (const p of parts) {
      all.set(p.positions, o);
      o += p.positions.length;
    }
    const whole = buildModel(all, 'сборка.stl');
    expect(whole.edges!.bodies).toBe(18);
    const bodies = splitBodies(whole);
    expect(bodies).toHaveLength(18);
    expect(bodies[0].name).toBe('сборка.stl · тело 1');
    const sum = bodies.reduce((a, b) => a + b.volume, 0);
    expect(sum).toBeCloseTo(whole.volume, 0);
  }, 60_000);
});
