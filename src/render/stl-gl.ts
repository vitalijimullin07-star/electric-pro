import type { StlModel, V3 } from '@core/io/stl';

/*
 * WebGL-вид моделей STL: освещение «от камеры», острые рёбра, плоскость разреза с заливкой
 * сечения (изнанка граней за разрезом красится плоским цветом), сетка стола, оси у начала
 * координат, точки замера. Без сторонних библиотек. Мир: Z — вверх.
 */

export interface StlItem {
  key: string;
  model: StlModel;
  /** Цвет 0…1. */
  color: V3;
  visible: boolean;
  /** Сдвиг модели в мире, мм (раскладка «рядом»). */
  offset: V3;
  /** Плоскость разреза действует на эту модель (false — показывать целиком). */
  clip?: boolean;
}

export interface StlCam {
  yaw: number;
  pitch: number;
  dist: number;
  target: V3;
  ortho: boolean;
}

export interface StlClip {
  axis: 0 | 1 | 2;
  /** Положение плоскости в мире, мм. */
  pos: number;
  /** false — убрана часть с большей координатой, true — с меньшей. */
  flip: boolean;
}

export interface StlDrawOpts {
  /** Единицы файла → мм. */
  scale: number;
  clip: StlClip | null;
  edges: boolean;
  grid: { z: number; minX: number; maxX: number; minY: number; maxY: number; step: number } | null;
  /** Длина осей у начала координат, мм; 0 — не рисовать. */
  axes: number;
  /** Точки замера в мире. */
  marks: V3[];
  /** Выделенная модель — рёбра цветом выделения. */
  hi: string | null;
  dpr: number;
}

/** Угол обзора по вертикали, рад. */
export const STL_FOV = 0.6;
const FOV = STL_FOV;

type M4 = Float32Array;
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Положение и оси камеры: x — вправо, y — вверх экрана, z — от сцены к камере. */
export function camBasis(c: StlCam): { eye: V3; x: V3; y: V3; z: V3 } {
  const cp = Math.cos(c.pitch);
  const z: V3 = [cp * Math.sin(c.yaw), -cp * Math.cos(c.yaw), Math.sin(c.pitch)];
  const eye: V3 = [c.target[0] + c.dist * z[0], c.target[1] + c.dist * z[1], c.target[2] + c.dist * z[2]];
  // Строго сверху или снизу «верх» экрана задаёт поворот вокруг вертикали.
  const up: V3 = Math.abs(Math.sin(c.pitch)) > 0.999 ? [Math.sin(c.yaw) * Math.sign(c.pitch), Math.cos(c.yaw) * Math.sign(c.pitch), 0] : [0, 0, 1];
  const x = norm(cross(up, z));
  return { eye, x, y: cross(z, x), z };
}

function viewProj(c: StlCam, aspect: number): M4 {
  const { eye, x, y, z } = camBasis(c);
  const v = new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  let p: M4;
  if (c.ortho) {
    const hh = c.dist * Math.tan(FOV / 2);
    const hw = hh * aspect;
    const n = -c.dist * 10;
    const f = c.dist * 30;
    p = new Float32Array([1 / hw, 0, 0, 0, 0, 1 / hh, 0, 0, 0, 0, -2 / (f - n), 0, 0, 0, -(f + n) / (f - n), 1]);
  } else {
    const n = c.dist / 400;
    const f = c.dist * 40;
    const t = 1 / Math.tan(FOV / 2);
    p = new Float32Array([t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]);
  }
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += p[k * 4 + j] * v[i * 4 + k];
      o[i * 4 + j] = s;
    }
  return o;
}

const HEAD = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

const MESH_VS = `attribute vec3 aPos; attribute vec3 aNrm;
uniform mat4 uVp; uniform vec3 uOff; uniform float uScale;
varying vec3 vNrm; varying vec3 vW;
void main() { vec3 w = aPos * uScale + uOff; vW = w; vNrm = aNrm; gl_Position = uVp * vec4(w, 1.0); }`;

const MESH_FS = `${HEAD}varying vec3 vNrm; varying vec3 vW;
uniform vec3 uColor; uniform vec3 uEye; uniform vec4 uClip; uniform bool uClipOn;
void main() {
  if (uClipOn && dot(uClip.xyz, vW) > uClip.w) discard;
  vec3 n = normalize(vNrm);
  if (!gl_FrontFacing) {
    // Изнанка за плоскостью разреза — заливка сечения.
    if (uClipOn) { gl_FragColor = vec4(uColor * 0.5 + vec3(0.16, 0.05, 0.04), 1.0); return; }
    n = -n;
  }
  vec3 v = normalize(uEye - vW);
  vec3 l = normalize(v + vec3(0.0, 0.0, 0.7));
  float d1 = max(dot(n, l), 0.0);
  float d2 = max(dot(n, normalize(vec3(-0.5, 0.35, 0.8))), 0.0);
  float sp = pow(max(dot(n, normalize(l + v)), 0.0), 48.0);
  gl_FragColor = vec4(uColor * (0.26 + 0.62 * d1 + 0.16 * d2) + vec3(0.18 * sp), 1.0);
}`;

const LINE_VS = `attribute vec3 aPos;
uniform mat4 uVp; uniform vec3 uOff; uniform float uScale; uniform float uPt;
varying vec3 vW;
void main() { vec3 w = aPos * uScale + uOff; vW = w; gl_Position = uVp * vec4(w, 1.0); gl_PointSize = uPt; }`;

const LINE_FS = `${HEAD}varying vec3 vW;
uniform vec4 uColor; uniform vec4 uClip; uniform bool uClipOn; uniform bool uRound;
void main() {
  if (uClipOn && dot(uClip.xyz, vW) > uClip.w) discard;
  if (uRound) { vec2 c = gl_PointCoord - vec2(0.5); if (dot(c, c) > 0.25) discard; }
  gl_FragColor = uColor;
}`;

interface Gpu {
  model: StlModel;
  pos: WebGLBuffer;
  nrm: WebGLBuffer;
  lines: WebGLBuffer | null;
  nLines: number;
}

export class StlGl {
  private gl: WebGLRenderingContext;
  private mesh: WebGLProgram;
  private line: WebGLProgram;
  private gpu = new Map<string, Gpu>();
  private items: StlItem[] = [];
  private tmp: WebGLBuffer;

  constructor(
    private canvas: HTMLCanvasElement,
    antialias = true,
  ) {
    const gl = (canvas.getContext('webgl', { antialias, preserveDrawingBuffer: true }) ?? canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) throw new Error('браузер не поддерживает WebGL');
    this.gl = gl;
    this.mesh = this.program(MESH_VS, MESH_FS);
    this.line = this.program(LINE_VS, LINE_FS);
    this.tmp = gl.createBuffer()!;
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
  }

  private program(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'шейдер');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    if (vs.includes('aNrm')) gl.bindAttribLocation(p, 1, 'aNrm');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'программа');
    return p;
  }

  /** Модели для показа: новые загружаются в видеопамять, убранные — освобождаются. */
  setItems(items: StlItem[]): void {
    const gl = this.gl;
    const keep = new Set(items.map((i) => i.key));
    for (const [k, g] of this.gpu) {
      if (keep.has(k) && items.find((i) => i.key === k)!.model === g.model) continue;
      [g.pos, g.nrm, g.lines].forEach((b) => b && gl.deleteBuffer(b));
      this.gpu.delete(k);
    }
    for (const it of items) {
      if (this.gpu.has(it.key)) continue;
      const buf = (data: Float32Array) => {
        const b = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        return b;
      };
      const lines = it.model.edges?.lines;
      this.gpu.set(it.key, {
        model: it.model,
        pos: buf(it.model.positions),
        nrm: buf(it.model.normals),
        lines: lines?.length ? buf(lines) : null,
        nLines: lines ? lines.length / 3 : 0,
      });
    }
    this.items = items;
  }

  private size(dpr: number): [number, number] {
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return [w, h];
  }

  draw(cam: StlCam, o: StlDrawOpts): void {
    const gl = this.gl;
    const [w, h] = this.size(o.dpr);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.07, 0.086, 0.105, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const vp = viewProj(cam, w / h);
    const eye = camBasis(cam).eye;
    const clip: [number, number, number, number] | null = o.clip
      ? (() => {
          const s = o.clip.flip ? -1 : 1;
          const n: [number, number, number, number] = [0, 0, 0, s * o.clip.pos];
          n[o.clip.axis] = s;
          return n;
        })()
      : null;
    const U = (p: WebGLProgram, name: string) => gl.getUniformLocation(p, name);

    // Сетка стола и оси — до моделей, полупрозрачные.
    gl.useProgram(this.line);
    gl.uniformMatrix4fv(U(this.line, 'uVp'), false, vp);
    gl.uniform1i(U(this.line, 'uClipOn'), 0);
    gl.uniform1i(U(this.line, 'uRound'), 0);
    gl.uniform1f(U(this.line, 'uPt'), 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const raw = (data: number[], mode: number, rgba: [number, number, number, number]) => {
      if (!data.length) return;
      gl.uniform3f(U(this.line, 'uOff'), 0, 0, 0);
      gl.uniform1f(U(this.line, 'uScale'), 1);
      gl.uniform4f(U(this.line, 'uColor'), ...rgba);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.tmp);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(mode, 0, data.length / 3);
    };
    if (o.grid) {
      const g = o.grid;
      const minor: number[] = [];
      const major: number[] = [];
      const z = g.z;
      for (let x = Math.ceil(g.minX / g.step) * g.step; x <= g.maxX + 1e-9; x += g.step) (Math.round(x / g.step) % 10 === 0 ? major : minor).push(x, g.minY, z, x, g.maxY, z);
      for (let y = Math.ceil(g.minY / g.step) * g.step; y <= g.maxY + 1e-9; y += g.step) (Math.round(y / g.step) % 10 === 0 ? major : minor).push(g.minX, y, z, g.maxX, y, z);
      gl.depthMask(false);
      raw(minor, gl.LINES, [0.6, 0.7, 0.8, 0.1]);
      raw(major, gl.LINES, [0.6, 0.7, 0.8, 0.22]);
      gl.depthMask(true);
    }
    if (o.axes > 0) {
      const a = o.axes;
      raw([0, 0, 0, a, 0, 0], gl.LINES, [0.95, 0.35, 0.3, 0.9]);
      raw([0, 0, 0, 0, a, 0], gl.LINES, [0.4, 0.85, 0.4, 0.9]);
      raw([0, 0, 0, 0, 0, a], gl.LINES, [0.35, 0.6, 1, 0.9]);
    }
    gl.disable(gl.BLEND);
    gl.disableVertexAttribArray(0);

    // Модели.
    const m = this.mesh;
    gl.useProgram(m);
    gl.uniformMatrix4fv(U(m, 'uVp'), false, vp);
    gl.uniform3f(U(m, 'uEye'), eye[0], eye[1], eye[2]);
    if (clip) gl.uniform4f(U(m, 'uClip'), ...clip);
    gl.uniform1f(U(m, 'uScale'), o.scale);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    for (const it of this.items) {
      const g = this.gpu.get(it.key);
      if (!g || !it.visible) continue;
      gl.uniform1i(U(m, 'uClipOn'), clip && it.clip !== false ? 1 : 0);
      gl.uniform3f(U(m, 'uOff'), ...it.offset);
      gl.uniform3f(U(m, 'uColor'), ...it.color);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.pos);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.nrm);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, g.model.triangles * 3);
    }
    gl.disableVertexAttribArray(1);
    gl.disable(gl.POLYGON_OFFSET_FILL);

    // Острые рёбра.
    const l = this.line;
    gl.useProgram(l);
    gl.uniformMatrix4fv(U(l, 'uVp'), false, vp);
    if (clip) gl.uniform4f(U(l, 'uClip'), ...clip);
    gl.uniform1f(U(l, 'uPt'), 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (const it of this.items) {
      const g = this.gpu.get(it.key);
      if (!g || !it.visible || !g.lines || (!o.edges && it.key !== o.hi)) continue;
      gl.uniform1i(U(l, 'uClipOn'), clip && it.clip !== false ? 1 : 0);
      gl.uniform3f(U(l, 'uOff'), ...it.offset);
      gl.uniform1f(U(l, 'uScale'), o.scale);
      const c: [number, number, number, number] = it.key === o.hi ? [0.31, 0.7, 1, 1] : [0, 0, 0, 0.55];
      gl.uniform4f(U(l, 'uColor'), ...c);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.lines);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.LINES, 0, g.nLines);
    }

    // Точки замера — поверх всего.
    if (o.marks.length) {
      gl.disable(gl.DEPTH_TEST);
      gl.uniform1i(U(l, 'uClipOn'), 0);
      const pts = o.marks.flat();
      if (o.marks.length >= 2) raw(pts.slice(0, 6), gl.LINES, [1, 0.85, 0.2, 1]);
      gl.uniform1f(U(l, 'uPt'), Math.round(9 * o.dpr));
      gl.uniform1i(U(l, 'uRound'), 1);
      raw(pts, gl.POINTS, [1, 0.85, 0.2, 1]);
      gl.uniform1i(U(l, 'uRound'), 0);
      gl.enable(gl.DEPTH_TEST);
    }
    gl.disable(gl.BLEND);
    gl.disableVertexAttribArray(0);
  }

  /** Луч в мире из точки холста (CSS-пиксели от левого верхнего угла). */
  ray(cam: StlCam, px: number, py: number): { o: V3; d: V3 } {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    const nx = (2 * px) / w - 1;
    const ny = 1 - (2 * py) / h;
    const { eye, x, y, z } = camBasis(cam);
    const hh = Math.tan(FOV / 2);
    const hw = hh * (w / h);
    if (cam.ortho) {
      const s = cam.dist;
      const d: V3 = [-z[0], -z[1], -z[2]];
      const back = cam.dist * 10;
      const o: V3 = [0, 1, 2].map((k) => eye[k] + (x[k] * nx * hw + y[k] * ny * hh) * s - d[k] * back) as V3;
      return { o, d };
    }
    return { o: eye, d: norm([0, 1, 2].map((k) => -z[k] + x[k] * nx * hw + y[k] * ny * hh) as V3) };
  }

  snapshot(): string {
    return this.canvas.toDataURL('image/png');
  }

  dispose(): void {
    const gl = this.gl;
    for (const g of this.gpu.values()) [g.pos, g.nrm, g.lines].forEach((b) => b && gl.deleteBuffer(b));
    this.gpu.clear();
    gl.deleteBuffer(this.tmp);
  }
}
