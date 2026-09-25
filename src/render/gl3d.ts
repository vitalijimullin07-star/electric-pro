import type { Mesh, Scene3D } from '@core/render/scene3d';

/*
 * Минимальный WebGL-рендерер для 3D-вида платы: освещение с двух сторон,
 * текстуры верха и низа платы, орбитальная камера. Без сторонних библиотек.
 */

type M4 = Float32Array;

function perspective(fovy: number, aspect: number, near: number, far: number): M4 {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

function lookAt(eye: number[], c: number[], up: number[]): M4 {
  const z = norm([eye[0] - c[0], eye[1] - c[1], eye[2] - c[2]]);
  const x = norm(crossV(up, z));
  const y = crossV(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}

function mul(a: M4, b: M4): M4 {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
      o[i * 4 + j] = s;
    }
  return o;
}

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crossV = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

const VS = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUv;
uniform mat4 uMvp;
varying vec3 vNrm; varying vec2 vUv;
void main() { vNrm = aNrm; vUv = aUv; gl_Position = uMvp * vec4(aPos, 1.0); }`;

const FS = `
precision mediump float;
varying vec3 vNrm; varying vec2 vUv;
uniform vec3 uColor; uniform bool uTex; uniform sampler2D uSampler; uniform vec3 uLight;
void main() {
  vec3 base = uTex ? texture2D(uSampler, vUv).rgb : uColor;
  float d = abs(dot(normalize(vNrm), normalize(uLight)));
  float d2 = abs(dot(normalize(vNrm), normalize(vec3(-0.4, 0.6, 0.3))));
  gl_FragColor = vec4(base * (0.38 + 0.52 * d + 0.18 * d2), 1.0);
}`;

interface GpuMesh {
  vbo: WebGLBuffer;
  nbo: WebGLBuffer;
  ubo: WebGLBuffer | null;
  ibo: WebGLBuffer;
  count: number;
  color: [number, number, number];
  texture?: 'top' | 'bottom';
  wide: boolean;
}

export interface Camera {
  yaw: number;
  pitch: number;
  dist: number;
  target: [number, number, number];
}

export class GlView {
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private meshes: GpuMesh[] = [];
  private tex: Record<'top' | 'bottom', WebGLTexture | null> = { top: null, bottom: null };
  private uintOk: boolean;
  /** Наибольшая сторона текстуры, которую поддерживает видеокарта. */
  maxTex: number;

  constructor(
    private canvas: HTMLCanvasElement,
    o: { antialias?: boolean } = {},
  ) {
    const gl = (canvas.getContext('webgl', { antialias: o.antialias ?? true, preserveDrawingBuffer: true, powerPreference: o.antialias === false ? 'low-power' : 'high-performance' }) ??
      canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) throw new Error('Браузер не поддерживает WebGL');
    this.gl = gl;
    this.uintOk = !!gl.getExtension('OES_element_index_uint');
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'шейдер');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'программа');
    this.prog = prog;
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
  }

  setScene(scene: Scene3D, textures: Record<'top' | 'bottom', HTMLCanvasElement>): void {
    const gl = this.gl;
    for (const m of this.meshes) [m.vbo, m.nbo, m.ubo, m.ibo].forEach((b) => b && gl.deleteBuffer(b));
    this.meshes = scene.meshes.filter((m) => m.indices.length).flatMap((m) => this.upload(m));
    for (const side of ['top', 'bottom'] as const) {
      if (this.tex[side]) gl.deleteTexture(this.tex[side]);
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textures[side]);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.tex[side] = t;
    }
  }

  private upload(m: Mesh): GpuMesh[] {
    const gl = this.gl;
    const wide = m.positions.length / 3 > 65535;
    if (wide && !this.uintOk) return [];
    const buf = (data: ArrayBufferView, target: number) => {
      const b = gl.createBuffer()!;
      gl.bindBuffer(target, b);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      return b;
    };
    return [
      {
        vbo: buf(new Float32Array(m.positions), gl.ARRAY_BUFFER),
        nbo: buf(new Float32Array(m.normals), gl.ARRAY_BUFFER),
        ubo: m.uvs ? buf(new Float32Array(m.uvs), gl.ARRAY_BUFFER) : null,
        ibo: buf(wide ? new Uint32Array(m.indices) : new Uint16Array(m.indices), gl.ELEMENT_ARRAY_BUFFER),
        count: m.indices.length,
        color: m.color,
        texture: m.texture,
        wide,
      },
    ];
  }

  draw(cam: Camera, dpr: number): void {
    const gl = this.gl;
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.07, 0.086, 0.105, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const cp = Math.cos(cam.pitch);
    const eye = [cam.target[0] + cam.dist * cp * Math.sin(cam.yaw), cam.target[1] - cam.dist * cp * Math.cos(cam.yaw), cam.target[2] + cam.dist * Math.sin(cam.pitch)];
    // У камеры строго сверху «верх» экрана — ось Y платы.
    const up = Math.abs(Math.sin(cam.pitch)) > 0.999 ? [Math.sin(cam.yaw), Math.cos(cam.yaw), 0] : [0, 0, 1];
    const mvp = mul(perspective(0.6, w / Math.max(1, h), Math.max(0.5, cam.dist / 200), cam.dist * 20), lookAt(eye, cam.target, up));
    const prog = this.prog;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uMvp'), false, mvp);
    gl.uniform3f(gl.getUniformLocation(prog, 'uLight'), eye[0] - cam.target[0] + 20, eye[1] - cam.target[1] + 40, eye[2] - cam.target[2] + 60);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    const aNrm = gl.getAttribLocation(prog, 'aNrm');
    const aUv = gl.getAttribLocation(prog, 'aUv');
    const uColor = gl.getUniformLocation(prog, 'uColor');
    const uTex = gl.getUniformLocation(prog, 'uTex');
    gl.uniform1i(gl.getUniformLocation(prog, 'uSampler'), 0);
    for (const m of this.meshes) {
      gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.nbo);
      gl.enableVertexAttribArray(aNrm);
      gl.vertexAttribPointer(aNrm, 3, gl.FLOAT, false, 0, 0);
      if (m.ubo && m.texture) {
        gl.bindBuffer(gl.ARRAY_BUFFER, m.ubo);
        gl.enableVertexAttribArray(aUv);
        gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.tex[m.texture]);
        gl.uniform1i(uTex, 1);
      } else {
        if (aUv >= 0) {
          gl.disableVertexAttribArray(aUv);
          gl.vertexAttrib2f(aUv, 0, 0);
        }
        gl.uniform1i(uTex, 0);
      }
      gl.uniform3f(uColor, m.color[0], m.color[1], m.color[2]);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
      gl.drawElements(gl.TRIANGLES, m.count, m.wide ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
    }
  }

  snapshot(): string {
    return this.canvas.toDataURL('image/png');
  }

  dispose(): void {
    const gl = this.gl;
    for (const m of this.meshes) [m.vbo, m.nbo, m.ubo, m.ibo].forEach((b) => b && gl.deleteBuffer(b));
    for (const t of Object.values(this.tex)) if (t) gl.deleteTexture(t);
    this.meshes = [];
  }
}
