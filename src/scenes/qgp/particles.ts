// Shared toolkit for the early-universe descent (qgp → hadrons → leptons): one visual language for three scenes.
//
// Everything here is stateless on the GPU: a particle's position is a closed-form function of its instance
// index (hashed into seeds), a few scene uniforms and a motion clock. Clocks are the CPU integral of a speed
// factor over wall time (∫β(local) dt), so motion can slow down smoothly (the Higgs beat) without the phase
// jumps that `β(local)·elapsed` would cause; scrubbing backwards just re-evaluates the same functions.
//
// Rendering is one idiom: additive camera-facing streak sprites. A sprite spans the segment tail → head
// (head = position now, tail = position one trail-window ago), so moving particles leave honest motion trails
// whose length is their speed, and still particles are round dots. Width has a pixel floor and a depth-of-
// field blur; both conserve energy, so tiny far particles do not shimmer and near ones bloom into bokeh.

import {
  AdditiveBlending,
  BackSide,
  Color,
  Mesh,
  MeshBasicNodeMaterial,
  SphereGeometry,
  Sprite,
  SpriteNodeMaterial,
  Vector3,
  type PerspectiveCamera,
} from 'three/webgpu';
import {
  abs,
  atan,
  cameraPosition,
  cameraViewMatrix,
  cameraWorldMatrix,
  clamp,
  cos,
  exp,
  float,
  floor,
  fract,
  hash,
  instanceIndex,

  length,
  max,
  min,
  mix,
  mx_noise_float,
  normalize,
  positionWorld,
  screenCoordinate,
  sin,
  smoothstep,
  sqrt,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { blackbodyNode } from '../../render/globals.ts';
import { CHAPTERS } from '../../time/chapters.ts';
import type { RenderContext } from '../types.ts';

export type F = Node<'float'>;
export type V3 = Node<'vec3'>;
export type U = Node<'uint'>;

const mkF = () => uniform(0);
const mkV3 = () => uniform(new Vector3());
const mkC = () => uniform(new Color());
export type FloatU = ReturnType<typeof mkF>;
export type Vec3U = ReturnType<typeof mkV3>;
export type ColorU = ReturnType<typeof mkC>;

// ── Seeds ───────────────────────────────────────────────────────────────────

const STRIDE = 64;

/** The instance index as a uint node. */
export const iid = (): U => instanceIndex as unknown as U; // typed as IndexNode; it is a uint in both backends

/** Uniform random in [0,1) for id and channel k (k < 64): PCG hash, no buffers. */
export function rand(id: U, k: number): F {
  return hash(id.mul(STRIDE).add(k));
}

/** Uniform random re-rolled every integer cycle c (a float node holding an integer). */
export function randC(id: U, k: number, c: F): F {
  return hash(id.mul(STRIDE).add(k).add(c.toUint().mul(40503)));
}

/** A derived id from a base id and a small integer-valued float node (e.g. a member or hadron index). */
export function hashU(id: U, k: F): U {
  return id.mul(STRIDE).add(k.toUint()) as U;
}

export function rand3(id: U, k: number): V3 {
  return vec3(rand(id, k), rand(id, k + 1), rand(id, k + 2));
}

export function rand3C(id: U, k: number, c: F): V3 {
  return vec3(randC(id, k, c), randC(id, k + 1, c), randC(id, k + 2, c));
}

/** Uniform unit vector from two uniform randoms. */
export function unitVec(u: F, v: F): V3 {
  const z = u.mul(2).sub(1);
  const r = sqrt(max(float(1).sub(z.mul(z)), 0));
  const phi = v.mul(Math.PI * 2);
  return vec3(r.mul(cos(phi)), r.mul(sin(phi)), z);
}

/** Smooth 0→1 ramp. */
export const ease = (x: F): F => smoothstep(0, 1, x);

/** 1 when h < frac, 0 when h > frac (soft over `soft`). Used to reveal/retire particles by rank. */
export function below(h: F, frac: F | number, soft = 0.03): F {
  const f = typeof frac === 'number' ? float(frac) : frac;
  return float(1).sub(smoothstep(f.sub(soft), f, h));
}

/** Cheap divergence-free swirl (Arnold–Beltrami–Childress), in [-2, 2]³. */
export function abc(p: V3): V3 {
  return vec3(sin(p.z).add(cos(p.y).mul(0.62)), sin(p.x).mul(0.81).add(cos(p.z)), sin(p.y).mul(0.62).add(cos(p.x).mul(0.81)));
}

/** Two orthonormal vectors perpendicular to unit `a`. */
export function basis(a: V3): [V3, V3] {
  const ref = mix(vec3(0, 1, 0), vec3(1, 0, 0), smoothstep(0.85, 0.95, abs(a.y)));
  const e1 = normalize(ref.cross(a));
  const e2 = a.cross(e1);
  return [e1, e2];
}

/**
 * Hot-current structure of the plasma (Eulerian, evaluated where a particle is now): ridged noise gives thin
 * luminous sheets and filaments, a low-frequency envelope opens dark voids. Returns ~[0, 1].
 */
export function currents(p: V3, t: F, scale: F | number, sharp: F | number, voids: F | number): F {
  const q = p.mul(scale).add(vec3(t.mul(0.045), t.mul(-0.03), t.mul(0.038)));
  const n = mx_noise_float(q).add(mx_noise_float(q.mul(2.13).add(vec3(7.3, 1.1, 4.7))).mul(0.4));
  const ridge = float(1).sub(abs(n).mul(1.1)).clamp(0, 1).pow(sharp);
  const env = smoothstep(-0.55, 0.45, mx_noise_float(q.mul(0.37).add(vec3(2.9, 8.1, 5.3))));
  return ridge.mul(mix(float(1), env, voids));
}

// ── Quark slots: one data model for the soup, the hadrons and the survivors ──
//
// A slot is six quark instances: members 0–2 are quarks with colour charge r/g/b, members 3–5 the matching
// antiquarks. In the QGP the six roam loosely around a flowing slot centre; at the asymmetry beat member k
// pairs with k + 3; in hadrons 0–2 become a baryon and 3–5 an antibaryon (or the slot makes three mesons).
// One slot in `1/extraFrac` has no antiquarks: its quarks are the matter excess, the baryon that survives.

export const SLOT = 6;

export function slotOf(i: U): { slot: U; member: U; memberF: F; anti: F; charge: F } {
  const slot = i.div(SLOT) as U;
  const member = i.sub(slot.mul(SLOT)) as U;
  const memberF = member.toFloat();
  const anti = smoothstep(2.4, 2.6, memberF);
  const charge = memberF.sub(anti.mul(3));
  return { slot, member, memberF, anti, charge };
}

/** 1 when the slot is an excess-matter slot (no antiquarks). */
export function slotExtra(slot: U, extraFrac: number): F {
  return smoothstep(0, 1e-4, float(extraFrac).sub(rand(slot, 0)));
}

export interface SlotStrand {
  box: F;
  flow: StrandFlow;
  /** Visual speed of light (world units per clock second) along the strand. */
  c: number;
  /** Arc spacing between neighbouring members (world units). */
  spacing: number;
}

/** Comoving origin of a slot's strand in [0, box)³ (also its primordial-field lookup coordinate). */
export function slotOrigin(slot: U, box: F): V3 {
  return rand3(slot, 1).mul(box);
}

/**
 * A slot rides its own streamline: arc0 is the arc fraction of member 0 at clock τ (members follow at
 * `spacing`), fade hides the wrap from the strand's end back to its start.
 */
export function slotStrand(slot: U, tau: F, o: SlotStrand): { x0: V3; arc0: F; fade: F; du: number; speed: F } {
  const x0 = slotOrigin(slot, o.box);
  const speed = rand(slot, 6).mul(0.5).add(0.75).mul(o.c / o.flow.length);
  const du = o.spacing / o.flow.length;
  const u = fract(rand(slot, 7).add(tau.mul(speed)));
  const arc0 = u.mul(1 - SLOT * du);
  const fade = sin(u.mul(Math.PI)).pow(0.6);
  return { x0, arc0, fade, du, speed: speed.mul(o.flow.length) };
}

/** Point on a tight ring of radius r around a centre, for member phase φ0 + k·2π/n at clock τ. */
export function ringOffset(axis: V3, tau: F, r: F | number, spin: F | number, phase: F): V3 {
  const [e1, e2] = basis(axis);
  const th = tau.mul(spin).add(phase);
  return e1.mul(cos(th)).add(e2.mul(sin(th))).mul(r);
}

/** Colour-charge hue for k ∈ {0,1,2} (float node); antiquarks use the paler `anti` mix. */
export function chargeColour(k: F, palette: readonly (readonly [number, number, number])[]): V3 {
  const c = (j: number) => vec3(palette[j]![0], palette[j]![1], palette[j]![2]);
  return mix(mix(c(0), c(1), smoothstep(0.5, 0.51, k)), c(2), smoothstep(1.5, 1.51, k));
}

// ── The wrapped volume ──────────────────────────────────────────────────────

/** Wrap p into the cube of side `box` centred on `centre` (the particle field is periodic, hence infinite). */
export function wrapBox(p: V3, centre: V3, box: F): V3 {
  return centre.add(fract(p.sub(centre).div(box).add(0.5)).sub(0.5).mul(box));
}

/** Fades particles out near the cube's faces so wrapping never pops. */
export function boxFade(wrapped: V3, centre: V3, box: F): F {
  const q = abs(wrapped.sub(centre)).div(box.mul(0.5));
  return float(1).sub(smoothstep(0.72, 0.98, max(q.x, max(q.y, q.z))));
}

// ── View rig: uniforms every streak layer shares ───────────────────────────

export interface ViewRig {
  /** World size of one target pixel at unit view depth: 2 tan(fov/2) / height. */
  pxScale: FloatU;
  /** Minimum sprite core width in pixels (energy conserving). */
  minPx: FloatU;
  focus: FloatU;
  /** Depth-of-field blur: world blur width per unit of |depth − focus|. */
  aperture: FloatU;
  maxBlur: FloatU;
  near: FloatU;
  /** Distance over which far particles dim (aerial depth). */
  fog: FloatU;
  box: FloatU;
  centre: Vec3U;
  exposure: FloatU;
}

export function createViewRig(box: number): ViewRig {
  return {
    pxScale: uniform(0.0015),
    minPx: uniform(1.3),
    focus: uniform(4),
    aperture: uniform(0.02),
    maxBlur: uniform(0.25),
    near: uniform(0.2),
    fog: uniform(9),
    box: uniform(box),
    centre: uniform(new Vector3()),
    exposure: uniform(1),
  };
}

const _fwd = new Vector3();
/** Per frame: pixel scale and the wrap-box centre a little ahead of the camera. */
export function updateViewRig(view: ViewRig, camera: PerspectiveCamera, height: number, ahead: number): void {
  view.pxScale.value = (2 * Math.tan(((camera.fov * Math.PI) / 180) * 0.5)) / Math.max(1, height);
  camera.getWorldDirection(_fwd);
  view.centre.value.copy(camera.position).addScaledVector(_fwd, view.box.value * ahead);
}

// ── Streak sprites ─────────────────────────────────────────────────────────

export interface StreakSpec {
  /** World position now. */
  head: V3;
  /** World position one trail window ago (= head for a dot). */
  tail: V3;
  /** Intrinsic core width (world units). */
  width: F;
  /** HDR radiance of the core at its intrinsic width (include all intensity factors; 0 hides the sprite). */
  color: V3;
  /** Brightness of the tail relative to the head (0 = comet, 1 = uniform). */
  tailGlow?: F | number;
}

const PAD = 2.6;

export interface StreakLayer {
  object: Sprite;
  material: SpriteNodeMaterial;
}

export function createStreaks(spec: StreakSpec, view: ViewRig, count: number): StreakLayer {
  // Perspective-correct segment: project head and tail onto the view plane through the midpoint's depth, so
  // segments with depth extent keep their true on-screen direction and length (no comb artefacts).
  const vH = cameraViewMatrix.mul(vec4(spec.head, 1)).xyz;
  const vT = cameraViewMatrix.mul(vec4(spec.tail, 1)).xyz;
  const zM = vH.z.add(vT.z).mul(0.5).min(-0.01);
  const hp = vH.xy.mul(zM.div(vH.z.min(-0.01)));
  const tp = vT.xy.mul(zM.div(vT.z.min(-0.01)));
  const depth = zM.negate();
  const dv = hp.sub(tp);
  const len = length(dv);
  const ang = atan(dv.y, dv.x.add(1e-7));
  const mid = cameraWorldMatrix.mul(vec4(hp.add(tp).mul(0.5), zM, 1)).xyz;

  const pxW = max(depth, 0.01).mul(view.pxScale);
  const blur = min(abs(depth.sub(view.focus)).mul(view.aperture), view.maxBlur);
  const w0 = max(spec.width, 1e-5);
  const W = max(max(w0, pxW.mul(view.minPx)), blur);
  // Energy: a dot spreads over W² instead of w0²; a long streak over W·L instead of w0·L.
  const energy = w0.div(W).mul(w0.add(len).div(W.add(len)));
  const nearFade = smoothstep(view.near, view.near.mul(2.5), depth);
  const fog = exp(depth.negate().div(view.fog));
  const col = spec.color.mul(energy.mul(nearFade).mul(fog).mul(view.exposure));
  const lum = col.x.add(col.y).add(col.z);
  // Hidden or behind-camera sprites collapse to zero area: no fragments.
  const live = smoothstep(1e-5, 2e-5, lum).mul(smoothstep(0.0, 0.05, depth.sub(view.near)));

  const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending });
  material.positionNode = mid;
  material.rotationNode = ang;
  material.scaleNode = vec2(len.add(W.mul(PAD)), W.mul(PAD)).mul(live);

  const vLen = varying(len);
  const vW = varying(W);
  const vCol = varying(col);
  const tg = spec.tailGlow ?? 0.15;
  const vTail = varying(typeof tg === 'number' ? float(tg) : tg);
  const sx = vLen.add(vW.mul(PAD));
  const sy = vW.mul(PAD);
  const x = uv().x.sub(0.5).mul(sx);
  const y = uv().y.sub(0.5).mul(sy);
  const h = vLen.mul(0.5);
  const dx = max(abs(x).sub(h), 0);
  const r2 = dx.mul(dx).add(y.mul(y)).div(vW.mul(vW).mul(0.25));
  const prof = exp(r2.negate().mul(1.15));
  const s = clamp(x.add(h).div(max(vLen, 1e-6)), 0, 1);
  const along = mix(vTail, float(1), s.mul(s));
  const shaped = mix(float(1), along, smoothstep(0, vW.mul(1.5), vLen));
  material.colorNode = vCol.mul(prof.mul(shaped));
  material.opacityNode = float(1);

  const object = new Sprite(material);
  object.count = Math.max(1, count);
  object.frustumCulled = false;
  return { object, material };
}

// ── Photon bath: a cheap volumetric glow around the camera ─────────────────

export interface Bath {
  mesh: Mesh;
  uniforms: {
    intensity: FloatU;
    /** Uniform glow under the structured part (0–1). */
    floor: FloatU;
    fog: FloatU;
    tint: ColorU;
  };
  dispose(): void;
}

export interface BathOptions {
  steps: number;
  /** Ray length (world units). */
  length: number;
  /** Emissive density (≈0–1) at world position p; share it with the particles so glow and sparkle agree. */
  density: (p: V3) => F;
  radius?: number;
}

/**
 * Back-side sphere that follows the camera; jittered samples along each view ray through an emissive,
 * optically thin medium give real parallax as the camera moves. Colour = blackbody LUT at the global T.
 */
export function createBath(ctx: RenderContext, o: BathOptions): Bath {
  const u = {
    intensity: uniform(0.1),
    floor: uniform(0.2),
    fog: uniform(6),
    tint: uniform(new Color(1, 1, 1)),
  };
  const dir = normalize(positionWorld.sub(cameraPosition));
  const jitter = hash(screenCoordinate.x.add(screenCoordinate.y.mul(4096)).toUint());
  const ds = o.length / o.steps;
  let acc: F = float(0);
  let norm = 0;
  for (let j = 0; j < o.steps; j++) {
    const s = jitter.mul(0.6).add(j + 0.2).mul(ds).add(0.3);
    const p = cameraPosition.add(dir.mul(s));
    const d = mix(o.density(p), float(1), u.floor);
    acc = acc.add(d.mul(exp(s.negate().div(u.fog))));
    norm += Math.exp(-((j + 0.5) * ds + 0.3) / 6);
  }
  const mat = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, depthTest: false });
  mat.colorNode = blackbodyNode(ctx.globals.lut, ctx.globals.uLogTemp).mul(u.tint).mul(acc.mul(u.intensity.div(norm)));
  const mesh = new Mesh(new SphereGeometry(o.radius ?? 60, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return {
    mesh,
    uniforms: u,
    dispose() {
      mesh.geometry.dispose();
      mat.dispose();
    },
  };
}

// ── CPU helpers ────────────────────────────────────────────────────────────

/** The local (0–1) at which time t falls in a chapter (inverse of timeInChapter for log/linear maps). */
export function localOf(chapterId: string, t: number): number {
  const c = CHAPTERS.find((x) => x.id === chapterId);
  if (!c) throw new Error(`no chapter ${chapterId}`);
  if (c.timeMap === 'log') return (Math.log10(t) - Math.log10(c.tStart)) / (Math.log10(c.tEnd) - Math.log10(c.tStart));
  return (t - c.tStart) / (c.tEnd - c.tStart);
}

/** Exposure normalisation so the image keeps its overall light across tiers (fewer, brighter particles on low). */
export function tierGain(count: number, reference = 250_000, power = 0.65): number {
  return Math.pow(reference / Math.max(1, count), power);
}

/** Motion clock: integrates a speed factor over wall time (see header). */
export class Clock {
  value = 0;
  advance(dt: number, rate: number): number {
    this.value += Math.min(dt, 0.1) * rate;
    if (this.value > 1e4) this.value -= 1e4; // keep float32 phase precision on the GPU (a seam once per ~3 h)
    return this.value;
  }
}

/** Smooth bump: 0 outside [c − w, c + w], 1 at c. */
export function bell(x: number, c: number, w: number): number {
  const d = (x - c) / w;
  return Math.abs(d) >= 1 ? 0 : (1 - d * d) * (1 - d * d);
}

/**
 * Dev-only tuning hook: `?tune={"shape":{"c":0.8}}` deep-merges into a scene's params (numbers/arrays only).
 * Lets the screenshot harness sweep looks without editing files. No-op in production builds.
 */
export function devTune(target: object): void {
  if (!import.meta.env.DEV || typeof location === 'undefined') return;
  const raw = new URLSearchParams(location.search).get('tune');
  if (!raw) return;
  try {
    merge(target as Record<string, unknown>, JSON.parse(raw) as Record<string, unknown>);
  } catch (e) {
    console.warn('[tune] ignored', e);
  }
}

function merge(t: Record<string, unknown>, s: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(s)) {
    const cur = t[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object') merge(cur as Record<string, unknown>, v as Record<string, unknown>);
    else t[k] = v;
  }
}

// ── Flow strands: particles that stream along streamlines of a slowly morphing ABC flow ──

export interface StrandFlow {
  /** Spatial frequency of the flow (ABC period 2π/k). */
  k: number;
  /** Arc length of a strand (world units). */
  length: number;
  /** Euler sub-steps along the streamline (fixed at build time). */
  steps: number;
  /** Slow morph of the field with the clock. */
  morph: F;
}

/** Unit flow direction at p. */
export function flowDir(p: V3, f: StrandFlow): V3 {
  const v = abc(p.mul(f.k).add(vec3(f.morph, f.morph.mul(0.7), f.morph.mul(-0.5))));
  return v.div(length(v).add(1e-3));
}

/** Point at arc fraction s ∈ [0,1] along the streamline that starts at x0. */
export function strandPoint(x0: V3, s: F, f: StrandFlow): V3 {
  const ds = s.mul(f.length / f.steps);
  let p: V3 = x0;
  for (let n = 0; n < f.steps; n++) p = p.add(flowDir(p, f).mul(ds));
  return p;
}

// ── Generic layers shared by hadrons and leptons ───────────────────────────

export interface SilkOptions {
  view: ViewRig;
  flow: StrandFlow;
  beads: number;
  /** Clock and trail window (clock units). */
  tau: F;
  trail: F;
  c: number;
  width: number;
  /** HDR colour × intensity (per strand factors are applied on top). */
  colour: V3;
  /** Extra per-instance brightness factor (e.g. heat), evaluated at the head. */
  shade?: (head: V3, strand: U) => F;
  /** Fraction of strands drawn (0–1, by strand rank). */
  reveal?: F;
}

/** Light streams: beads flowing along streamlines; tails are chords of the strand (smooth curves). */
export function silkLayer(o: SilkOptions): StreakSpec {
  const i = iid();
  const box = o.view.box;
  const strand = i.div(o.beads) as U;
  const x0 = rand3(strand, 0).mul(box);
  const speed = rand(strand, 6).mul(0.4).add(0.8).mul(o.c / o.flow.length);
  const arc = fract(rand(i, 7).add(o.tau.mul(speed)));
  const headU = strandPoint(x0, arc, o.flow);
  const tailU = strandPoint(x0, arc.sub(o.trail.mul(speed)).max(0), o.flow);
  const head = wrapBox(headU, o.view.centre, box);
  const tail = head.sub(headU.sub(tailU));
  const ends = sin(arc.mul(Math.PI)).sqrt();
  const tone = rand(i, 8).mul(0.7).add(0.3);
  let k: F = ends.mul(tone).mul(boxFade(head, o.view.centre, box));
  if (o.reveal) k = k.mul(below(rand(strand, 9), o.reveal));
  if (o.shade) k = k.mul(o.shade(head, strand));
  return { head, tail, width: float(o.width), color: o.colour.mul(k), tailGlow: 0.1 };
}

export interface GlitterOptions {
  view: ViewRig;
  flow: StrandFlow;
  tau: F;
  /** Twinkle clock (wall-ish). */
  twinkleClock: F;
  trail: F;
  c: number;
  drift: number;
  width: number;
  colour: V3;
  shade?: (head: V3) => F;
}

/** Fine thermal glitter: many tiny specks swirling with the flow. */
export function glitterLayer(o: GlitterOptions): StreakSpec {
  const i = iid();
  const box = o.view.box;
  const base = rand3(i, 0).mul(box);
  const pos = (t: F): V3 => {
    const ph = t.mul(0.35);
    return base.add(abc(base.mul(o.flow.k).add(vec3(ph, ph.mul(0.8), ph.mul(-0.6)))).mul(o.drift));
  };
  const headU = pos(o.tau);
  const head = wrapBox(headU, o.view.centre, box);
  const tail = head.sub(flowDir(headU, o.flow).mul(o.trail.mul(o.c)));
  const twinkle = sin(o.twinkleClock.mul(rand(i, 9).mul(3).add(1)).add(rand(i, 10).mul(6.28))).mul(0.35).add(0.65);
  let k: F = twinkle.mul(rand(i, 8).mul(0.8).add(0.2)).mul(boxFade(head, o.view.centre, box));
  if (o.shade) k = k.mul(o.shade(head));
  return { head, tail, width: float(o.width), color: o.colour.mul(k), tailGlow: 0.3 };
}

/**
 * Annihilation events cycling in clock time (keeps the screen alive while the scroll rests). Each event is
 * `EVENT_PARTS` sprites: particle A (matter), particle B (antimatter) converging, the flash, and two photons
 * flying out back to back. `rate` (0–1) is the share of event slots active in each cycle.
 */
export const EVENT_PARTS = 5;

export interface EventOptions {
  view: ViewRig;
  clock: F;
  period: number;
  rate: F;
  /** Start separation of the pair and photon flight distance (world units). */
  approach: number;
  flight: number;
  particleWidth: number;
  flashWidth: number;
  photonWidth: number;
  matter: V3;
  antimatter: V3;
  flash: V3;
  photon: V3;
  /** 0 = annihilation (pair → flash → photons); per-event share of creation (photons → flash → pair). */
  creation?: F;
}

export function eventLayer(o: EventOptions): StreakSpec {
  const i = iid();
  const ev = i.div(EVENT_PARTS) as U;
  const part = i.sub(ev.mul(EVENT_PARTS)).toFloat();
  const box = o.view.box;
  const per = float(o.period).mul(rand(ev, 0).mul(0.6).add(0.7));
  const x = o.clock.div(per).add(rand(ev, 1).mul(31));
  const cyc = floor(x);
  const ph0 = fract(x);
  const isCreation = o.creation ? smoothstep(0, 1e-4, o.creation.sub(randC(ev, 9, cyc))) : float(0);
  const ph = mix(ph0, float(1).sub(ph0), isCreation);
  const active = smoothstep(0, 1e-4, o.rate.sub(randC(ev, 2, cyc)));
  const centreU = rand3C(ev, 3, cyc).mul(box);
  const axis = unitVec(randC(ev, 6, cyc), randC(ev, 7, cyc));
  const [e1] = basis(axis);
  // Pair converges over ph ∈ [0, 0.6] (accelerating), meets, flashes; photons fly out ⟂ to the approach.
  const meet = 0.6;
  const conv = float(1).sub(ph.div(meet).clamp(0, 1)).pow(1.6);
  const sep = conv.mul(o.approach);
  const out = ph.sub(meet).div(1 - meet).clamp(0, 1);
  const isA = smoothstep(-0.5, 0.5, float(0.5).sub(abs(part.sub(0))));
  const isB = smoothstep(-0.5, 0.5, float(0.5).sub(abs(part.sub(1))));
  const isF = smoothstep(-0.5, 0.5, float(0.5).sub(abs(part.sub(2))));
  const isG = smoothstep(2.5, 3.5, part);
  const gSign = smoothstep(3.5, 4.5, part).mul(2).sub(1);
  const pA = centreU.add(axis.mul(sep.mul(0.5)));
  const pB = centreU.sub(axis.mul(sep.mul(0.5)));
  const pG = centreU.add(e1.mul(gSign.mul(out.mul(o.flight))));
  const pGt = centreU.add(e1.mul(gSign.mul(out.sub(0.25).max(0).mul(o.flight))));
  const headU = pA.mul(isA).add(pB.mul(isB)).add(centreU.mul(isF)).add(pG.mul(isG));
  const tailU = mix(headU, pGt, isG);
  const head = wrapBox(headU, o.view.centre, box);
  const tail = head.sub(headU.sub(tailU));
  const alivePair = smoothstep(meet + 0.02, meet - 0.02, ph);
  const flashK = smoothstep(meet - 0.06, meet, ph).mul(exp(ph.sub(meet).max(0).mul(-12)));
  const photonK = smoothstep(meet, meet + 0.05, ph).mul(float(1).sub(out).pow(0.7));
  const col = o.matter
    .mul(isA.mul(alivePair))
    .add(o.antimatter.mul(isB.mul(alivePair)))
    .add(o.flash.mul(isF.mul(flashK)))
    .add(o.photon.mul(isG.mul(photonK)));
  const width = float(o.particleWidth).mul(isA.add(isB)).add(float(o.flashWidth).mul(isF).mul(out.mul(1.5).add(0.6))).add(float(o.photonWidth).mul(isG));
  return { head, tail, width, color: col.mul(active).mul(boxFade(head, o.view.centre, box)), tailGlow: 0.0 };
}
