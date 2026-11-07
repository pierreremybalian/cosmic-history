// Shared by the three structure scenes (darkAges → firstStars → reionization), so the same universe and the
// same camera run straight through the chapter boundaries:
//  · one camera rig, a function of u = chapter ordinal + local (0–3), plus the same idle drift from `elapsed`
//    (both scenes in a transition receive the same elapsed, so their frames line up);
//  · the shared cosmic web (src/shared/web.ts) re-centred on the densest group of peaks — the field is periodic,
//    so shifting the box is invisible — and faded to a soft ball so no cube edges show;
//  · halo seeds = the field's density peaks (same order, same positions in all three scenes);
//  · the spherical-collapse rule ν σ A ≥ δc that decides which halos have formed at amplitude A.

import {
  AdditiveBlending,
  BackSide,
  MeshBasicNodeMaterial,
  SpriteNodeMaterial,
  Vector3,
  Vector4,
  type Data3DTexture,
  type PerspectiveCamera,
} from 'three/webgpu';
import {
  Fn,
  Loop,
  cameraPosition,
  clamp,
  exp,
  float,
  floor,
  fract,
  hash,
  instanceIndex,
  max,
  positionWorld,
  screenCoordinate,
  smoothstep,
  sqrt,
  texture3D,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
} from 'three/tsl';
import type { Node, UniformArrayNode } from 'three/webgpu';
import { densityColorNode } from '../../shared/color.ts';
import type { FloatUniform } from '../../render/globals.ts';
import { WORLD_BOX, type PrimordialField } from '../../shared/gaussianField.ts';
import { createCosmicWeb, type CosmicWeb, type CosmicWebOptions } from '../../shared/web.ts';
import type { RenderContext } from '../types.ts';

export const STRUCTURE = {
  /** Soft spherical region of the box that is drawn (world units, box = 10). */
  ballRadius: 4.7,
  ballFeather: 1.5,
  /** Web sprites fade/shrink within this distance of the camera (avoids huge near quads). */
  nearFade: [0.3, 1.5] as const,
  /** Focus = ν-weighted centroid of the densest group among the top peaks (re-centred to the origin). */
  focus: { candidates: 24, kernel: 1.3, groupRadius: 1.4, refAmplitude: 0.42 },
  /** Peaks further than this from the focus are not used as halo sites (keeps them inside the ball). */
  siteRadius: 3.9,
  fov: 42,
  /**
   * Camera keys over u (0–1 darkAges, 1–2 firstStars, 2–3 reionization): distance to the focus, elevation and
   * azimuth in degrees. Close in the uniform haze → wide web → dolly into the first star-forming halos → wide.
   */
  camKeys: [
    { u: 0.0, dist: 2.7, elev: 6, az: -12 },
    { u: 0.5, dist: 4.3, elev: 11, az: 6 },
    { u: 1.0, dist: 7.6, elev: 17, az: 28 },
    { u: 1.32, dist: 4.4, elev: 13, az: 40 },
    { u: 1.58, dist: 3.15, elev: 9, az: 50 },
    { u: 2.0, dist: 3.7, elev: 12, az: 64 },
    { u: 2.3, dist: 6.2, elev: 16, az: 74 },
    { u: 2.65, dist: 7.9, elev: 19, az: 86 },
    { u: 3.0, dist: 8.5, elev: 20, az: 96 },
  ],
  /** Idle drift (identical in all three scenes). */
  idleOrbitRadPerS: 0.011,
  idleBobDeg: 2.2,
  idleBobRate: 0.043,
  /** Spherical-collapse linear overdensity (Gunn & Gott 1972). */
  deltaCollapse: 1.686,
} as const;

/** Piecewise-linear lookup in [x, y] keys (scene brightness ramps keyed on local). */
export function ramp(keys: readonly (readonly [number, number])[], x: number): number {
  if (x <= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i++) {
    const [b, vb] = keys[i]!;
    if (x <= b) {
      const [a, va] = keys[i - 1]!;
      return va + ((vb - va) * (x - a)) / (b - a);
    }
  }
  return keys[keys.length - 1]![1];
}

/** Chapter ordinals used for u. */
export const ORDINAL = { darkAges: 0, firstStars: 1, reionization: 2 } as const;

// ── Camera ────────────────────────────────────────────────────────────────
const keys = STRUCTURE.camKeys;
type Channel = 'dist' | 'elev' | 'az';
function slope(i: number, ch: Channel): number {
  if (i <= 0 || i >= keys.length - 1) return 0; // calm at both ends of the journey
  return (keys[i + 1]![ch] - keys[i - 1]![ch]) / (keys[i + 1]!.u - keys[i - 1]!.u);
}
function sample(u: number, ch: Channel): number {
  if (u <= keys[0]!.u) return keys[0]![ch];
  const last = keys[keys.length - 1]!;
  if (u >= last.u) return last[ch];
  let i = 0;
  while (i < keys.length - 2 && u > keys[i + 1]!.u) i++;
  const a = keys[i]!;
  const b = keys[i + 1]!;
  const h = b.u - a.u;
  const s = (u - a.u) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  return (
    (2 * s3 - 3 * s2 + 1) * a[ch] + (s3 - 2 * s2 + s) * h * slope(i, ch) + (-2 * s3 + 3 * s2) * b[ch] + (s3 - s2) * h * slope(i + 1, ch)
  );
}

const DEG = Math.PI / 180;
/** Places the shared camera for u ∈ [0, 3]; looks at the focus (origin). Allocation-free. Returns the distance. */
export function applyStructureCamera(camera: PerspectiveCamera, u: number, elapsed: number): number {
  const dist = sample(u, 'dist');
  const elev = (sample(u, 'elev') + STRUCTURE.idleBobDeg * Math.sin(elapsed * STRUCTURE.idleBobRate)) * DEG;
  const az = sample(u, 'az') * DEG + elapsed * STRUCTURE.idleOrbitRadPerS;
  camera.position.set(Math.sin(az) * Math.cos(elev) * dist, Math.sin(elev) * dist, Math.cos(az) * Math.cos(elev) * dist);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return dist;
}

/** Camera distance to the focus at u (for scenes that scale effects with framing). */
export function structureCameraDistance(u: number): number {
  return sample(u, 'dist');
}

// ── Periodic helpers ─────────────────────────────────────────────────────
const wrap = (v: number) => v - WORLD_BOX * Math.floor(v / WORLD_BOX + 0.5);

/**
 * World shift that moves the densest group of peaks to the origin. Deterministic for a given field, so all three
 * scenes agree.
 */
export function focusShift(field: PrimordialField, out = new Vector3()): Vector3 {
  const d = field.data;
  if (!d) throw new Error('field not ready');
  const f = STRUCTURE.focus;
  const n = Math.min(f.candidates, d.peaks.length / 4);
  const pos = field.peaksAt(f.refAmplitude, n);
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) {
      const dx = wrap(pos[j * 4]! - pos[i * 4]!);
      const dy = wrap(pos[j * 4 + 1]! - pos[i * 4 + 1]!);
      const dz = wrap(pos[j * 4 + 2]! - pos[i * 4 + 2]!);
      s += pos[j * 4 + 3]! * Math.exp(-(dx * dx + dy * dy + dz * dz) / (2 * f.kernel * f.kernel));
    }
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  // ν-weighted centroid of the group around the best peak (periodic offsets relative to it).
  let wx = 0;
  let wy = 0;
  let wz = 0;
  let w = 0;
  for (let j = 0; j < n; j++) {
    const dx = wrap(pos[j * 4]! - pos[best * 4]!);
    const dy = wrap(pos[j * 4 + 1]! - pos[best * 4 + 1]!);
    const dz = wrap(pos[j * 4 + 2]! - pos[best * 4 + 2]!);
    if (dx * dx + dy * dy + dz * dz > f.groupRadius * f.groupRadius) continue;
    const nu = pos[j * 4 + 3]!;
    wx += dx * nu;
    wy += dy * nu;
    wz += dz * nu;
    w += nu;
  }
  return out.set(-(pos[best * 4]! + wx / w), -(pos[best * 4 + 1]! + wy / w), -(pos[best * 4 + 2]! + wz / w));
}

// ── Halo seeds ───────────────────────────────────────────────────────────
/**
 * The field's peaks that fall inside the drawn ball, highest ν first, re-centred. `update(A)` moves them with
 * the Zel'dovich displacement at amplitude A (the very same positions as ctx.field.peaksAt). Allocation-free.
 */
export class HaloSeeds {
  readonly count: number;
  /** [x, y, z, ν] × count, re-centred world units. */
  readonly pos: Float32Array;
  /** [x, y, z] × count at A = 0 (Lagrangian), re-centred. */
  readonly lagrangian: Float32Array;
  readonly nuMax: number;
  readonly nuMin: number;
  /** Index of each seed in the field's peak list (to match seeds between sets). */
  readonly peakIndex: Int32Array;
  private readonly q: Float32Array;
  private readonly v = new Vector3();
  constructor(
    private readonly field: PrimordialField,
    private readonly shift: Vector3,
    maxCount: number,
    radius: number = STRUCTURE.siteRadius,
  ) {
    const d = field.data;
    if (!d) throw new Error('field not ready');
    const total = d.peaks.length / 4;
    const all = field.peaksAt(STRUCTURE.focus.refAmplitude, total);
    const keep: number[] = [];
    for (let i = 0; i < total && keep.length < maxCount; i++) {
      const x = wrap(all[i * 4]! + shift.x);
      const y = wrap(all[i * 4 + 1]! + shift.y);
      const z = wrap(all[i * 4 + 2]! + shift.z);
      if (Math.hypot(x, y, z) < radius) keep.push(i);
    }
    this.count = keep.length;
    this.peakIndex = Int32Array.from(keep);
    this.q = new Float32Array(this.count * 4);
    this.pos = new Float32Array(this.count * 4);
    this.lagrangian = new Float32Array(this.count * 3);
    keep.forEach((src, k) => {
      for (let c = 0; c < 4; c++) this.q[k * 4 + c] = d.peaks[src * 4 + c]!;
    });
    this.nuMax = this.count ? this.q[3]! : 1;
    this.nuMin = this.count ? this.q[(this.count - 1) * 4 + 3]! : 0;
    this.update(0);
    for (let k = 0; k < this.count; k++) {
      this.lagrangian[k * 3] = this.pos[k * 4]!;
      this.lagrangian[k * 3 + 1] = this.pos[k * 4 + 1]!;
      this.lagrangian[k * 3 + 2] = this.pos[k * 4 + 2]!;
    }
  }
  update(A: number): void {
    const q = this.q;
    for (let k = 0; k < this.count; k++) {
      this.field.positionAt(q[k * 4]!, q[k * 4 + 1]!, q[k * 4 + 2]!, A, this.v);
      this.pos[k * 4] = wrap(this.v.x + this.shift.x);
      this.pos[k * 4 + 1] = wrap(this.v.y + this.shift.y);
      this.pos[k * 4 + 2] = wrap(this.v.z + this.shift.z);
      this.pos[k * 4 + 3] = q[k * 4 + 3]!;
    }
  }
  /** Copy seed k into a Vector4 (xyz + w). */
  write(k: number, out: Vector4, w: number): void {
    out.set(this.pos[k * 4]!, this.pos[k * 4 + 1]!, this.pos[k * 4 + 2]!, w);
  }
}

/** Peak height ν at which halos have collapsed for amplitude A: ν σ_smooth A = δc (spherical collapse). */
export function collapseNu(field: PrimordialField, A: number): number {
  const s = field.data?.sigmaSmooth ?? 1;
  return STRUCTURE.deltaCollapse / Math.max(1e-6, s * A);
}

// ── The re-centred, ball-faded web ───────────────────────────────────────
export interface StructureWeb extends CosmicWeb {
  /** World shift (set once from focusShift). */
  shift: { value: Vector3 };
  /**
   * Sprites nearer than this keep the on-screen size they would have here (world size × d/ref), so particles
   * passing the lens stay fine dust instead of bokeh discs. Set each frame (≈ 0.8 × camera distance).
   */
  refDist: { value: number };
}

/**
 * createCosmicWeb with its world position re-wrapped around the focus (periodic, so the filaments are unchanged),
 * a soft spherical boundary and a near-camera fade. All other uniforms are the shared web's.
 */
export function createStructureWeb(ctx: RenderContext, shift: Vector3, opts: CosmicWebOptions = {}): StructureWeb {
  const web = createCosmicWeb(ctx, opts);
  const m = web.material;
  const uShift = uniform(shift.clone());
  const W = m.positionNode as Node<'vec3'>;
  const Wp = fract(W.add(uShift).div(WORLD_BOX).add(0.5)).sub(0.5).mul(WORLD_BOX);
  m.positionNode = Wp;
  const R = STRUCTURE.ballRadius;
  const ball = float(1).sub(smoothstep(R - STRUCTURE.ballFeather, R, Wp.length()));
  const near = smoothstep(STRUCTURE.nearFade[0], STRUCTURE.nearFade[1], Wp.sub(cameraPosition).length());
  const uRef = uniform(3);
  const d = Wp.sub(cameraPosition).length();
  const fade = varying(ball.mul(near));
  m.scaleNode = (m.scaleNode as Node<'float'>).mul(near).mul(clamp(d.div(uRef), 0.1, 1));
  m.colorNode = (m.colorNode as Node<'vec3'>).mul(fade);
  return Object.assign(web, { shift: uShift, refDist: uRef });
}

// ── Field sampling for volumes ───────────────────────────────────────────
/** Per-pixel raymarch jitter (white noise: reads as film grain, unlike patterned noise without TAA). */
export function ign(): Node<'float'> {
  const sc = floor(screenCoordinate);
  return hash(sc.x.add(sc.y.mul(4099)));
}

export interface FieldNodes {
  density: Data3DTexture;
  displacement: Data3DTexture;
  /** rms |ψ| in box units (texture holds ψ/σψ). */
  sigmaPsi: number;
  /** rms of the smoothed δ at a = 1 (texture B holds δ_s/σ_s). */
  sigmaSmooth: number;
  shift: Vector3;
}

export function fieldNodes(field: PrimordialField, shift: Vector3): FieldNodes {
  const d = field.data;
  if (!d) throw new Error('field not ready');
  const t = field.textures();
  return { density: t.density, displacement: t.displacement, sigmaPsi: d.sigmaPsi, sigmaSmooth: d.sigmaSmooth, shift: shift.clone() };
}

/** Box coordinates (texture uvw, repeat-wrapped) of a re-centred world point. */
export function boxCoord(f: FieldNodes, x: Node<'vec3'>): Node<'vec3'> {
  return x.sub(vec3(f.shift.x, f.shift.y, f.shift.z)).div(WORLD_BOX).add(0.5);
}

/**
 * Smoothed linear overdensity δ_s·A of the matter now at world x: one fixed-point step of the inverse Zel'dovich
 * map (q ≈ x − A ψ(x)), then the smoothed primordial δ at q. Good while A |∂ψ| < 1, i.e. through reionization.
 */
export function eulerianDelta(f: FieldNodes, x: Node<'vec3'>, A: Node<'float'>): Node<'float'> {
  const b = boxCoord(f, x);
  const psi = texture3D(f.displacement, b).xyz.mul(f.sigmaPsi);
  const q = b.sub(psi.mul(A));
  return texture3D(f.density, q).b.mul(f.sigmaSmooth).mul(A);
}

/** Entry/exit distances of the ray (ro, rd) through the ball of radius R at the origin: vec2(t0 ≥ 0, t1). */
export function ballSpan(ro: Node<'vec3'>, rd: Node<'vec3'>, R: number): Node<'vec2'> {
  const b = ro.dot(rd);
  const c = ro.dot(ro).sub(R * R);
  const h = sqrt(max(b.mul(b).sub(c), 0));
  return vec2(max(b.negate().sub(h), 0), b.negate().add(h));
}

// ── Shared materials ─────────────────────────────────────────────────────
/** Radial coordinate on a sprite quad: 0 at the centre, 1 at the edge. */
export const spriteR = (): Node<'float'> => uv().sub(0.5).length().mul(2);

/**
 * Collapsed dark-matter halos at the field's peaks: a soft glow in the density colour map (colour mapped).
 * seeds[i] = (x, y, z, glow 0–1), glow from the spherical-collapse rule on the CPU.
 */
export function haloMaterial(seeds: UniformArrayNode<'vec4'>, uSize: FloatUniform, uPeak: FloatUniform): SpriteNodeMaterial {
  const m = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  const s = seeds.element(instanceIndex);
  const w = s.w;
  m.positionNode = s.xyz;
  m.scaleNode = uSize.mul(w.mul(0.6).add(0.4));
  const r = spriteR();
  const core = exp(r.mul(r).mul(-26));
  const halo = exp(r.mul(r).mul(-5)).mul(0.22);
  const edge = float(1).sub(smoothstep(0.75, 1.0, r));
  const col = densityColorNode(w.mul(0.25).add(0.72));
  m.colorNode = col.mul(core.add(halo)).mul(edge).mul(w.mul(w)).mul(uPeak);
  m.opacityNode = float(1);
  return m;
}

/**
 * Smooth dark-matter density haze (colour mapped): raymarch of the ball, emission ∝ (e^{1.4δ} − 0.55)⁺ where δ is the
 * smoothed linear overdensity of the matter now at each point (inverse Zel'dovich). Nearly uniform and faint while
 * δ ≪ 1; voids go black and sheets/filaments glow as δ grows. Complements the sharp caustics of the particle web.
 */
export function hazeMaterial(f: FieldNodes, uA: FloatUniform, uBright: FloatUniform, steps: number): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({ side: BackSide, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending });
  const R = STRUCTURE.ballRadius;
  m.colorNode = Fn(() => {
    const ro = cameraPosition;
    const rd = positionWorld.sub(ro).normalize();
    const span = ballSpan(ro, rd, R);
    const dt = span.y.sub(span.x).div(steps);
    const jit = ign();
    const acc = vec3(0).toVar();
    Loop(steps, ({ i }) => {
      const t = span.x.add(float(i).add(jit).mul(dt));
      const p = ro.add(rd.mul(t));
      const d = eulerianDelta(f, p, uA);
      const e = max(exp(d.mul(1.4)).sub(0.55), 0);
      const ball = float(1).sub(smoothstep(R - STRUCTURE.ballFeather, R, p.length()));
      const near = smoothstep(0.2, 1.4, t);
      acc.addAssign(densityColorNode(clamp(d.mul(0.2).add(0.32), 0, 1)).mul(e.mul(ball).mul(near)));
    });
    return acc.mul(dt).mul(uBright);
  })();
  m.opacityNode = float(1);
  return m;
}
