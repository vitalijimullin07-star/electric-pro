/*
 * Разреженное LU-разложение для узлового метода. Разложение делается один раз на набор
 * состояний ключей (диод открыт, транзистор включён…) и запоминается движком; каждый шаг
 * по времени — только прямая и обратная подстановка, число умножений — по ненулевым
 * элементам множителей, а не n².
 *
 * Ведущий элемент — по Марковицу с порогом: среди элементов столбца не меньше 0,1 от
 * наибольшего выбирается тот, что меньше всего заполняет матрицу. Узловые матрицы почти
 * всегда разрежены (у узла 2–5 соседей), так что заполнение небольшое.
 */

export class LuFactor {
  constructor(
    readonly n: number,
    /** Строка и столбец ведущего элемента на шаге k. */
    readonly pr: Int32Array,
    readonly pc: Int32Array,
    readonly piv: Float64Array,
    /** Множители: для шага k — строки lRow[lStart[k]…lStart[k+1]) и множители lVal. */
    readonly lStart: Int32Array,
    readonly lRow: Int32Array,
    readonly lVal: Float64Array,
    /** Строка U шага k без ведущего: столбцы uCol и значения uVal. */
    readonly uStart: Int32Array,
    readonly uCol: Int32Array,
    readonly uVal: Float64Array,
  ) {}

  /** Решить A·x = b. b портится (в нём — промежуточный результат). */
  solve(b: Float64Array, x: Float64Array): void {
    const { n, pr, pc, piv, lStart, lRow, lVal, uStart, uCol, uVal } = this;
    for (let k = 0; k < n; k++) {
      const bk = b[pr[k]];
      if (bk === 0) continue;
      for (let q = lStart[k], e = lStart[k + 1]; q < e; q++) b[lRow[q]] -= lVal[q] * bk;
    }
    for (let k = n - 1; k >= 0; k--) {
      let s = b[pr[k]];
      for (let q = uStart[k], e = uStart[k + 1]; q < e; q++) s -= uVal[q] * x[uCol[q]];
      x[pc[k]] = s / piv[k];
    }
  }

  /** Ненулевых в множителях (для оценки скорости). */
  get nnz(): number {
    return this.lRow.length + this.uCol.length + this.n;
  }
}

/**
 * Разложить матрицу n×n (по строкам). Возвращает null, если матрица вырождена (у узла
 * нет пути к земле — движок добавляет малую проводимость на землю, так что это редкость).
 */
export function factor(a: Float64Array, n: number): LuFactor | null {
  const w = a.slice();
  const rowAct = new Uint8Array(n).fill(1);
  const colAct = new Uint8Array(n).fill(1);
  const pr = new Int32Array(n);
  const pc = new Int32Array(n);
  const piv = new Float64Array(n);
  const lStart = new Int32Array(n + 1);
  const uStart = new Int32Array(n + 1);
  const lRow: number[] = [];
  const lVal: number[] = [];
  const uCol: number[] = [];
  const uVal: number[] = [];
  const rowCnt = new Int32Array(n);
  const colCnt = new Int32Array(n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      if (w[i * n + j] !== 0) {
        rowCnt[i]++;
        colCnt[j]++;
      }
  for (let k = 0; k < n; k++) {
    // Ведущий: по столбцам — порог 0,1 от наибольшего, наименьшая цена Марковица.
    let bi = -1;
    let bj = -1;
    let bestCost = Infinity;
    let bestMag = 0;
    for (let j = 0; j < n; j++) {
      if (!colAct[j]) continue;
      let cmax = 0;
      for (let i = 0; i < n; i++) if (rowAct[i]) cmax = Math.max(cmax, Math.abs(w[i * n + j]));
      if (cmax === 0) continue;
      const lim = cmax * 0.1;
      for (let i = 0; i < n; i++) {
        if (!rowAct[i]) continue;
        const m = Math.abs(w[i * n + j]);
        if (m < lim || m === 0) continue;
        const cost = (rowCnt[i] - 1) * (colCnt[j] - 1);
        if (cost < bestCost || (cost === bestCost && m > bestMag)) {
          bestCost = cost;
          bestMag = m;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0) return null;
    const p = w[bi * n + bj];
    pr[k] = bi;
    pc[k] = bj;
    piv[k] = p;
    rowAct[bi] = 0;
    colAct[bj] = 0;
    // Строка U.
    uStart[k] = uCol.length;
    for (let j = 0; j < n; j++)
      if (colAct[j] && w[bi * n + j] !== 0) {
        uCol.push(j);
        uVal.push(w[bi * n + j]);
      }
    // Исключение.
    lStart[k] = lRow.length;
    for (let i = 0; i < n; i++) {
      if (!rowAct[i]) continue;
      const v = w[i * n + bj];
      if (v === 0) continue;
      const m = v / p;
      lRow.push(i);
      lVal.push(m);
      w[i * n + bj] = 0;
      for (let q = uStart[k]; q < uCol.length; q++) {
        const j = uCol[q];
        const before = w[i * n + j];
        const after = before - m * uVal[q];
        w[i * n + j] = after;
        if (before === 0 && after !== 0) {
          rowCnt[i]++;
          colCnt[j]++;
        } else if (before !== 0 && after === 0) {
          rowCnt[i]--;
          colCnt[j]--;
        }
      }
      rowCnt[i]--;
    }
    for (let q = uStart[k]; q < uCol.length; q++) colCnt[uCol[q]]--;
  }
  lStart[n] = lRow.length;
  uStart[n] = uCol.length;
  return new LuFactor(n, pr, pc, piv, lStart, Int32Array.from(lRow), Float64Array.from(lVal), uStart, Int32Array.from(uCol), Float64Array.from(uVal));
}

/* ---------------- комплексное (для АЧХ) ---------------- */

/** Решить комплексную систему (A = ar + i·ai) плотным Гауссом с выбором ведущего. n — до сотни узлов. */
export function solveComplex(ar: Float64Array, ai: Float64Array, br: Float64Array, bi: Float64Array, n: number): { re: Float64Array; im: Float64Array } | null {
  const R = ar.slice();
  const I = ai.slice();
  const xr = br.slice();
  const xi = bi.slice();
  for (let k = 0; k < n; k++) {
    let p = k;
    let pm = 0;
    for (let i = k; i < n; i++) {
      const m = Math.hypot(R[i * n + k], I[i * n + k]);
      if (m > pm) {
        pm = m;
        p = i;
      }
    }
    if (pm === 0) return null;
    if (p !== k) {
      for (let j = 0; j < n; j++) {
        let t = R[k * n + j];
        R[k * n + j] = R[p * n + j];
        R[p * n + j] = t;
        t = I[k * n + j];
        I[k * n + j] = I[p * n + j];
        I[p * n + j] = t;
      }
      let t = xr[k];
      xr[k] = xr[p];
      xr[p] = t;
      t = xi[k];
      xi[k] = xi[p];
      xi[p] = t;
    }
    const pr = R[k * n + k];
    const pi = I[k * n + k];
    const d = pr * pr + pi * pi;
    for (let i = k + 1; i < n; i++) {
      const vr = R[i * n + k];
      const vi = I[i * n + k];
      if (vr === 0 && vi === 0) continue;
      // m = v / p
      const mr = (vr * pr + vi * pi) / d;
      const mi = (vi * pr - vr * pi) / d;
      for (let j = k; j < n; j++) {
        const ur = R[k * n + j];
        const ui = I[k * n + j];
        if (ur === 0 && ui === 0) continue;
        R[i * n + j] -= mr * ur - mi * ui;
        I[i * n + j] -= mr * ui + mi * ur;
      }
      const br0 = xr[k];
      const bi0 = xi[k];
      xr[i] -= mr * br0 - mi * bi0;
      xi[i] -= mr * bi0 + mi * br0;
    }
  }
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = n - 1; k >= 0; k--) {
    let sr = xr[k];
    let si = xi[k];
    for (let j = k + 1; j < n; j++) {
      const ur = R[k * n + j];
      const ui = I[k * n + j];
      if (ur === 0 && ui === 0) continue;
      sr -= ur * re[j] - ui * im[j];
      si -= ur * im[j] + ui * re[j];
    }
    const pr = R[k * n + k];
    const pi = I[k * n + k];
    const d = pr * pr + pi * pi;
    re[k] = (sr * pr + si * pi) / d;
    im[k] = (si * pr - sr * pi) / d;
  }
  return { re, im };
}
