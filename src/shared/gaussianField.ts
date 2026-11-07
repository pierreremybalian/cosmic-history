// Main-thread handle on the shared primordial field (HANDOFF §8). Created once by the renderer and
// passed to every scene in RenderContext.field. Scenes must NOT dispose anything obtained from here.

import {

  Data3DTexture,
  DataUtils,
  HalfFloatType,
  InstancedBufferAttribute,
  LinearFilter,
  RepeatWrapping,
  RGBAFormat,
  Vector3,
} from 'three/webgpu';
import { growthFactor } from '../physics/cosmology.ts';
import type { FieldData, ParticleData } from './fieldCore.ts';
import { sampleGrid } from './fieldCore.ts';
import type { FieldRequest, FieldResponse } from './fieldWorker.ts';

/** Box-unit cube is centred on the origin in world space: world = (q − 0.5) · WORLD_BOX. */
export const WORLD_BOX = 10;

/**
 * Visual growth amplitude A(a) used for x = q + A ψ in every structure scene, so the web is continuous
 * across chapters. Real linear growth is D(a); we show D(a)^0.35 (normalised to 1 today) so the web is
 * visible from the dark ages on. Stated in each structure scene's accuracy note.
 */
export const GROWTH_COMPRESSION = 0.35;
export function webAmplitude(a: number): number {
  return Math.pow(Math.max(growthFactor(a), 1e-6), GROWTH_COMPRESSION);
}

export interface FieldAttributes {
  /** vec4: q.xyz (box units 0–1), random 0–1 */
  q: InstancedBufferAttribute;
  /** vec4: ψ.xyz (box units at A = 1), δ/σ at q */
  psi: InstancedBufferAttribute;
  /** vec4: λ₁ λ₂ λ₃ of −∂ψ/∂q, distance to nearest major peak (box units) */
  lambda: InstancedBufferAttribute;
  count: number;
}

export interface FieldTextures {
  /** RGBA16F 3D: R = δ/σ, G = ζ (unit variance), B = smoothed δ/σ, A = 0. Repeat-wrapped. */
  density: Data3DTexture;
  /** RGBA16F 3D: ψ.xyz in box units / σψ, A = |ψ|/σψ. Repeat-wrapped. */
  displacement: Data3DTexture;
}

export interface PrimordialField {
  readonly n: number;
  readonly boxMpcH: number;
  readonly seed: number;
  ready: Promise<void>;
  data: FieldData | null;
  particles: ParticleData | null;
  textures(): FieldTextures;
  attributes(): FieldAttributes;
  /** Halo seeds: peak positions displaced to amplitude A, in world units; [x,y,z,ν] × count. */
  peaksAt(A: number, count: number, out?: Float32Array): Float32Array;
  /** World-space Zel'dovich position of Lagrangian q (box units) at amplitude A. */
  positionAt(qx: number, qy: number, qz: number, A: number, out?: Vector3): Vector3;
  dispose(): void;
}

function to3D(data: Uint16Array, n: number): Data3DTexture {
  const t = new Data3DTexture(data, n, n, n);
  t.format = RGBAFormat;
  t.type = HalfFloatType;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = RepeatWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

export function createPrimordialField(n: number, particleCount: number): PrimordialField {
  const particleSide = Math.max(8, Math.round(Math.cbrt(particleCount)));
  let tex: FieldTextures | null = null;
  let attrs: FieldAttributes | null = null;
  const self: PrimordialField = {
    n,
    boxMpcH: 100,
    seed: 1977,
    data: null,
    particles: null,
    ready: new Promise<void>((resolve, reject) => {
      const worker = new Worker(new URL('./fieldWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<FieldResponse>) => {
        self.data = e.data.field;
        self.particles = e.data.particles;
        console.info(`[field] ${n}³ + ${particleSide ** 3} particles in ${e.data.ms.toFixed(0)} ms`);
        worker.terminate();
        resolve();
      };
      worker.onerror = (err) => {
        worker.terminate();
        reject(err);
      };
      const req: FieldRequest = { n, particleSide };
      worker.postMessage(req);
    }),
    textures() {
      if (tex) return tex;
      const d = self.data;
      if (!d) throw new Error('field not ready');
      const N3 = d.n ** 3;
      const a = new Uint16Array(N3 * 4);
      const b = new Uint16Array(N3 * 4);
      for (let i = 0; i < N3; i++) {
        a[i * 4] = DataUtils.toHalfFloat(d.delta[i]! / d.sigmaDelta);
        a[i * 4 + 1] = DataUtils.toHalfFloat(d.zeta[i]!);
        a[i * 4 + 2] = DataUtils.toHalfFloat(d.deltaSmooth[i]! / d.sigmaSmooth);
        const px = d.psi[i * 3]! / d.sigmaPsi;
        const py = d.psi[i * 3 + 1]! / d.sigmaPsi;
        const pz = d.psi[i * 3 + 2]! / d.sigmaPsi;
        b[i * 4] = DataUtils.toHalfFloat(px);
        b[i * 4 + 1] = DataUtils.toHalfFloat(py);
        b[i * 4 + 2] = DataUtils.toHalfFloat(pz);
        b[i * 4 + 3] = DataUtils.toHalfFloat(Math.sqrt(px * px + py * py + pz * pz));
      }
      tex = { density: to3D(a, d.n), displacement: to3D(b, d.n) };
      return tex;
    },
    attributes() {
      if (attrs) return attrs;
      const p = self.particles;
      if (!p) throw new Error('field not ready');
      attrs = {
        q: new InstancedBufferAttribute(p.q, 4),
        psi: new InstancedBufferAttribute(p.psi, 4),
        lambda: new InstancedBufferAttribute(p.lambda, 4),
        count: p.side ** 3,
      };
      return attrs;
    },
    peaksAt(A, count, out) {
      const d = self.data;
      if (!d) throw new Error('field not ready');
      const k = Math.min(count, d.peaks.length / 4);
      const o = out ?? new Float32Array(k * 4);
      for (let i = 0; i < k; i++) {
        const qx = d.peaks[i * 4]!;
        const qy = d.peaks[i * 4 + 1]!;
        const qz = d.peaks[i * 4 + 2]!;
        const v = self.positionAt(qx, qy, qz, A, _v);
        o[i * 4] = v.x;
        o[i * 4 + 1] = v.y;
        o[i * 4 + 2] = v.z;
        o[i * 4 + 3] = d.peaks[i * 4 + 3]!;
      }
      return o;
    },
    positionAt(qx, qy, qz, A, out = new Vector3()) {
      const d = self.data;
      if (!d) throw new Error('field not ready');
      const x = qx + A * sampleGrid(d.psi, d.n, 3, 0, qx, qy, qz);
      const y = qy + A * sampleGrid(d.psi, d.n, 3, 1, qx, qy, qz);
      const z = qz + A * sampleGrid(d.psi, d.n, 3, 2, qx, qy, qz);
      return out.set((x - 0.5) * WORLD_BOX, (y - 0.5) * WORLD_BOX, (z - 0.5) * WORLD_BOX);
    },
    dispose() {
      tex?.density.dispose();
      tex?.displacement.dispose();
      tex = null;
      attrs = null;
    },
  };
  return self;
}
const _v = new Vector3();
