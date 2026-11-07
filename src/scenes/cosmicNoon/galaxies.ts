// Late-universe galaxy toolkit shared by cosmicNoon, darkEnergy and now (HANDOFF §9.11, §9.12, §9.15).
//
// • galaxyLight(): procedural surface brightness of a galaxy in its own disk plane (TSL): exponential disk,
//   Sérsic bulge, logarithmic spiral arms (density waves), dust lanes on the arms' inner edges, giant clumps
//   (young, unsettled disks), blue young stars and pink Hα/Hβ knots scaled by a star-formation intensity,
//   and a de Vaucouleurs elliptical component. One function drives the distant impostors and the smooth
//   unresolved light of the close-up disks, so a galaxy looks the same at every distance.
// • createGalaxyImpostors(): instanced galaxy sprites riding the shared Zel'dovich web: halo peaks of the
//   primordial field (ctx.field.peaks) plus field galaxies on dense web particles. Positions are computed on
//   the GPU with exactly the web's formula, so galaxies sit on the same filaments in every scene.
// • createSpiralGalaxy(): a particle disk (old disk, bulge/bar, young arm stars, HII regions) with a smooth
//   light plane underneath; `settle` morphs a thick clumpy disk into a thin grand-design spiral.
//
// Colours come from physics on the CPU (blackbody LUT, emission-line wavelengths), never hand-typed in shaders.

import {
  AdditiveBlending,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  MultiplyBlending,
  PlaneGeometry,
  Sprite,
  SpriteNodeMaterial,
  Vector3,
  type Node,
} from 'three/webgpu';
import {
  abs,
  atan,
  clamp,
  cos,
  cross,
  exp,
  float,
  fract,
  instancedBufferAttribute,
  length,
  log,
  max,
  min,
  mix,
  modelViewMatrix,
  modelWorldMatrix,
  mx_noise_float,
  normalize,
  positionLocal,
  pow,
  sin,
  smoothstep,
  step,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { blackbodyRGB, wavelengthRGB } from '../../physics/blackbody.ts';
import { EMISSION_LINES_NM } from '../../shared/color.ts';
import { WORLD_BOX, type PrimordialField } from '../../shared/gaussianField.ts';
import { gaussian, mulberry32 } from '../../shared/math.ts';
import type { RenderContext } from '../types.ts';
import type { FloatUniform, Vec2Uniform as Vec2Uniform2 } from '../../render/globals.ts';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;
// Type helper only (never called).
const _mkVec3 = () => uniform(new Vector3());
export type Vec3Uniform = ReturnType<typeof _mkVec3>;

/** Stellar populations and line physics used for galaxy colours (all converted to RGB on the CPU). */
export const STELLAR = {
  /** Effective temperature of the integrated old disk light, K. */
  oldDiskK: 4700,
  /** Integrated bulge / elliptical light (old, metal-rich), K. */
  bulgeK: 3900,
  /** Young OB-star light along the arms, K. */
  youngK: 25000,
  /** Hα/Hβ energy ratio of ionised gas (case-B Balmer decrement). */
  balmerDecrement: 2.86,
  /** Fraction of white continuum mixed into HII regions (stars embedded in the nebula). */
  hiiContinuum: 0.15,
  /** Sun's effective temperature, K. */
  sunK: 5772,
} as const;

/** Linear-sRGB palette (max channel 1) derived from STELLAR. */
export function stellarPalette() {
  const v = (c: [number, number, number]) => new Vector3(c[0], c[1], c[2]);
  const old = v(blackbodyRGB(STELLAR.oldDiskK));
  const bulge = v(blackbodyRGB(STELLAR.bulgeK));
  const young = v(blackbodyRGB(STELLAR.youngK));
  const sun = v(blackbodyRGB(STELLAR.sunK));
  const ha = wavelengthRGB(EMISSION_LINES_NM.hAlpha);
  const hb = wavelengthRGB(EMISSION_LINES_NM.hBeta);
  const hii = new Vector3(ha[0] * STELLAR.balmerDecrement + hb[0], ha[1] * STELLAR.balmerDecrement + hb[1], ha[2] * STELLAR.balmerDecrement + hb[2]);
  hii.multiplyScalar(1 / Math.max(hii.x, hii.y, hii.z));
  hii.lerp(new Vector3(1, 1, 1), STELLAR.hiiContinuum);
  hii.multiplyScalar(1 / Math.max(hii.x, hii.y, hii.z));
  return { old, bulge, young, hii, sun };
}
export type StellarPalette = ReturnType<typeof stellarPalette>;
const v3 = (v: Vector3) => vec3(v.x, v.y, v.z);

/** Arm geometry of the Milky Way disks (particles and light plane agree on it). */
export const ARMS = {
  count: 2,
  /** tan of the arm pitch angle (≈ 12°, the Milky Way's measured range is ~10–14°). */
  tanPitch: 0.21,
  /** Relative strength of the two minor arms between the major ones (MW: Sagittarius, Norma). */
  minor: 0.55,
  /** Phase offset of the dust lane from the arm ridge (radians; inner, trailing edge). */
  dustOffset: 0.8,
};

export interface GalaxyLightIn {
  /** Disk-plane coordinates; the stellar disk fades out at |p| ≈ 1. */
  p: V2;
  seed: F;
  /** Pattern angle (radians), rotates the arms. */
  spin: F;
  /** 0 = thick, clumpy, unsettled disk → 1 = settled spiral. */
  settle: F;
  /** Star-formation intensity (≈ 0 quiescent, 1 cosmic-noon peak, > 1 starburst). */
  sf: F;
  /** Elliptical weight 0–1. */
  ell: F;
  /** Bar strength 0–1. */
  bar?: F;
  /** Tidal disturbance 0–1 (warps arms during mergers). */
  disturb?: F;
  /** Integer arm count (as float). Default ARMS.count. */
  arms?: F;
  /** tan(pitch). Default ARMS.tanPitch. */
  tanPitch?: F;
  /** 0 = grand design → 1 = flocculent (arms broken by noise). */
  floc?: F;
  /** Strength of interleaved minor arms (meaningful for 2-armed disks). */
  minor?: F;
  /** Stellar-population age 0 (young galaxy: blue, small bulge) → 1 (mature). Default 1. */
  age?: F;
  /** Radius where the arms begin (the bar's ends in barred spirals). Default 0.12. */
  armStart?: F | number;
}

/** Arm phase at disk-plane polar coords (shared with particles): a ridge where cos(phase) = 1. */
export function armPhase(r: F, th: F, spin: F, seed: F | number, arms: F | number = ARMS.count, tanPitch: F | number = ARMS.tanPitch): F {
  const m = typeof arms === 'number' ? float(arms) : arms;
  const tp = typeof tanPitch === 'number' ? float(tanPitch) : tanPitch;
  // Trailing arms: the ridge angle decreases outward while the pattern turns toward +θ (clockwise seen from +Y,
  // the Milky Way's sense of rotation seen from the North Galactic Pole).
  return th
    .sub(spin)
    .mul(m)
    .add(log(max(r, 0.012)).mul(m).div(tp))
    .add(typeof seed === 'number' ? float(seed * 6.2832) : seed.mul(6.2832));
}

/** Linear HDR surface brightness of a galaxy at disk point p. */
export function galaxyLight(i: GalaxyLightIn, pal: StellarPalette): V3 {
  const disturb = i.disturb ?? float(0);
  const floc = i.floc ?? float(0.25);
  const minor = i.minor ?? float(0);
  // Tidal warp: a smooth, seed-dependent shear that grows with disturbance.
  const pw = i.p.add(
    vec2(sin(i.p.y.mul(2.3).add(i.seed.mul(17))), cos(i.p.x.mul(2.1).add(i.seed.mul(29)))).mul(disturb.mul(0.25)),
  );
  const r = length(pw);
  const th = atan(pw.y, pw.x);
  const edge = float(1).sub(smoothstep(0.62, 1.0, r));

  // Bulge, optionally barred: elongated along a direction that turns with the pattern.
  const bar = i.bar ?? float(0);
  const ba = i.spin.add(i.seed.mul(3.1));
  const pb = vec2(pw.x.mul(cos(ba)).add(pw.y.mul(sin(ba))), pw.y.mul(cos(ba)).sub(pw.x.mul(sin(ba))));
  const rb = length(vec2(pb.x.div(bar.mul(3.2).add(1)), pb.y.mul(bar.mul(0.6).add(1))));
  const bulge = exp(rb.div(-0.035)).mul(0.8).add(exp(rb.div(-0.11)).mul(0.28)).mul(float(1).sub(smoothstep(0.55, 1.0, r)));

  // Disk with density-wave arms, broken up by large-scale noise (flocculence) and segment brightness.
  const nA = mx_noise_float(vec3(pw.mul(2.4), i.seed.mul(11.3)));
  const nB = mx_noise_float(vec3(pw.mul(5.2), i.seed.mul(5.1).add(7.0)));
  const phase = armPhase(r, th, i.spin, i.seed, i.arms ?? ARMS.count, i.tanPitch ?? ARMS.tanPitch).add(nA.mul(floc).mul(2.6));
  const ridge = pow(cos(phase).mul(0.5).add(0.5), 2.6).add(pow(cos(phase.add(Math.PI)).mul(0.5).add(0.5), 3.0).mul(minor));
  const segments = smoothstep(-0.45, 0.55, nB.add(float(0.35).sub(floc.mul(0.3))));
  const a0 = typeof i.armStart === 'number' ? float(i.armStart) : (i.armStart ?? float(0.12));
  const armOn = i.settle.mul(smoothstep(a0.mul(0.45), a0.mul(1.6), r)).mul(float(1).sub(smoothstep(0.55, 1.0, r).mul(0.6)));
  const arm = ridge.mul(segments).mul(armOn);
  const disk = exp(r.div(-0.24)).mul(edge);
  const oldDisk = disk.mul(mix(float(1), arm.mul(0.85).add(0.55), armOn.mul(0.8)));
  const youngDisk = exp(r.div(-0.4)).mul(edge).mul(smoothstep(a0.mul(0.35), a0.mul(1.5), r));

  // Giant star-forming clumps of unsettled disks (cosmic-noon "clump clusters").
  const n1 = mx_noise_float(vec3(pw.mul(3.0), i.seed.mul(13.7)));
  const clump = pow(smoothstep(0.1, 0.6, n1), 2.0).mul(float(1).sub(i.settle)).mul(exp(r.div(-0.42)));
  // HII knots strung along the arms (and inside clumps).
  const n2 = mx_noise_float(vec3(pw.mul(13.0), i.seed.mul(7.3).add(3.0)));
  const knots = smoothstep(0.3, 0.75, n2).mul(arm.add(clump.mul(2.0)));

  // Dust lanes hug the inner edge of each arm.
  const lane = pow(cos(phase.add(ARMS.dustOffset)).mul(0.5).add(0.5), 8.0)
    .mul(armOn)
    .mul(segments.mul(0.5).add(0.5))
    .mul(float(1).sub(smoothstep(0.55, 0.95, r)));

  const age = i.age ?? float(1);
  const old = v3(pal.old)
    .mul(oldDisk.mul(0.75))
    .add(v3(pal.bulge).mul(bulge.mul(float(1).sub(bar.mul(0.2))).mul(mix(float(0.3), float(1), age))))
    .mul(mix(float(0.45), float(1), age));
  const young = v3(pal.young).mul(youngDisk.mul(arm.mul(1.5).add(clump.mul(3.4))).mul(i.sf.mul(1.4).add(0.12)));
  const hii = v3(pal.hii).mul(knots.mul(youngDisk).mul(i.sf).mul(4.2));
  const spiral = old.add(young).add(hii).mul(float(1).sub(lane.mul(0.75)));

  // de Vaucouleurs (Sérsic n = 4) elliptical, r_e ≈ 0.2 in disk units, capped core.
  const sersic = min(exp(pow(r.div(0.2).add(0.002), 0.25).sub(1).mul(-7.67)), 30.0).mul(0.07).mul(edge);
  const ellip = v3(pal.bulge).mul(sersic);
  return mix(spiral, ellip, i.ell);
}

// ───────────────────────────────── Milky Way host ─────────────────────────────────

/**
 * Deterministic choice of the halo that hosts "our" galaxy: a moderate peak (a Milky-Way-mass group, not a
 * cluster) as close as possible to the box centre. Same field → same choice in every scene and tier.
 */
export function pickMilkyWayPeak(field: PrimordialField): number {
  const d = field.data;
  if (!d) throw new Error('field not ready');
  const k = d.peaks.length / 4;
  let best = 0;
  let bestScore = Infinity;
  for (let i = 0; i < k; i++) {
    const nu = d.peaks[i * 4 + 3]!;
    const dx = d.peaks[i * 4]! - 0.5;
    const dy = d.peaks[i * 4 + 1]! - 0.5;
    const dz = d.peaks[i * 4 + 2]! - 0.5;
    const dist = Math.hypot(dx, dy, dz);
    const score = dist + (nu < 2.0 || nu > 3.3 ? 1 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** World position (wrapped into the box like the web) of peak i at Zel'dovich amplitude A. */
export function peakWorld(field: PrimordialField, i: number, A: number, out: Vector3): Vector3 {
  const d = field.data!;
  field.positionAt(d.peaks[i * 4]!, d.peaks[i * 4 + 1]!, d.peaks[i * 4 + 2]!, A, out);
  const w = (x: number) => {
    const u = x / WORLD_BOX + 0.5;
    return (u - Math.floor(u) - 0.5) * WORLD_BOX;
  };
  return out.set(w(out.x), w(out.y), w(out.z));
}

// ───────────────────────────────── Impostors ─────────────────────────────────

export interface GalaxyImpostorOptions {
  /** Field galaxies picked on dense web particles (in addition to every halo peak). */
  fieldGalaxies: number;
  /** World radius of a typical bright galaxy (exaggerated vs. true scale; state it). */
  radius: number;
  /** Merging companions attached to the most massive peaks (cosmicNoon). */
  companions?: number;
  /** Peak index of the Milky Way host (flagged so a scene can fade it out). */
  milkyWay?: number;
  /** Zel'dovich amplitude used to weight field galaxies by density (default 0.85). */
  densityAmplitude?: number;
  seed?: number;
}

export interface GalaxyImpostors {
  object: Sprite;
  material: SpriteNodeMaterial;
  count: number;
  uniforms: {
    /** Zel'dovich amplitude, same as the web. */
    amplitude: FloatUniform;
    /** Comoving → physical position scale (darkEnergy). Galaxy sizes are not scaled: bound objects don't expand. */
    scale: FloatUniform;
    brightness: FloatUniform;
    /** Global star-formation intensity (Madau–Dickinson, normalised to the peak). */
    sf: FloatUniform;
    /** Morphological maturity 0 (clumpy, young) → 1 (settled spirals, ellipticals in groups). */
    maturity: FloatUniform;
    /** Merger clock (cosmicNoon local); companions merge at their own time. ≥ 1 = all merged. */
    mergeClock: FloatUniform;
    /** Size multiplier. */
    size: FloatUniform;
    /** 1 = Milky Way impostor visible, 0 = hidden (replaced by the particle disk). */
    milkyWay: FloatUniform;
    /** Pattern rotation (radians), slow idle motion. */
    spin: FloatUniform;
    /** Fade sprites closer than this many radii to the camera. */
    nearFade: FloatUniform;
    /** Hide impostors within `clearRadius` of `clearCenter` (world), e.g. around the particle Milky Way. */
    clearCenter: Vec3Uniform;
    clearRadius: FloatUniform;
  };
  dispose(): void;
}

export function createGalaxyImpostors(ctx: RenderContext, opts: GalaxyImpostorOptions): GalaxyImpostors {
  const field = ctx.field;
  const fd = field.data!;
  const parts = field.particles!;
  const rand = mulberry32(opts.seed ?? 4242);
  const nPeaks = fd.peaks.length / 4;
  const nComp = Math.min(opts.companions ?? 0, nPeaks);
  const side = parts.side;
  const nParts = side * side * side;
  const nField = Math.min(opts.fieldGalaxies, nParts);
  const total = nPeaks + nComp + nField;

  const aQ = new Float32Array(total * 4); // q.xyz, radius
  const aPsi = new Float32Array(total * 4); // ψ.xyz (box units at A = 1), ν
  const aShape = new Float32Array(total * 4); // seed, position angle, cos i, flags (1 = Milky Way)
  const aMorph = new Float32Array(total * 4); // settle onset, elliptical onset (> 1 = never), sf bias, irregular
  const aOrbit = new Float32Array(total * 4); // r0 (world, 0 = not a companion), phase, merge time, spin rate
  const aAxis = new Float32Array(total * 4); // orbit axis xyz, host flag (merge burst)

  const psiAt = (qx: number, qy: number, qz: number, c: number) => {
    // trilinear periodic sample of ψ (box units) at q
    const n = fd.n;
    const fx = qx * n - 0.5;
    const fy = qy * n - 0.5;
    const fz = qz * n - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const z0 = Math.floor(fz);
    let s = 0;
    for (let dz = 0; dz < 2; dz++)
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const x = (((x0 + dx) % n) + n) % n;
          const y = (((y0 + dy) % n) + n) % n;
          const z = (((z0 + dz) % n) + n) % n;
          const w = (dx ? fx - x0 : 1 - (fx - x0)) * (dy ? fy - y0 : 1 - (fy - y0)) * (dz ? fz - z0 : 1 - (fz - z0));
          s += w * fd.psi[((z * n + y) * n + x) * 3 + c]!;
        }
    return s;
  };

  const setCommon = (i: number, kind: 'peak' | 'comp' | 'field', nu: number) => {
    aShape[i * 4] = rand();
    aShape[i * 4 + 1] = rand() * Math.PI * 2;
    aShape[i * 4 + 2] = 0.12 + 0.88 * rand(); // cos i uniform → isotropic orientations
    aShape[i * 4 + 3] = 0;
    const irregular = kind === 'field' ? (rand() < 0.3 ? 1 : 0) : 0;
    aMorph[i * 4] = rand() * 0.55; // settle onset (maturity at which arms start to form)
    // Morphology–density relation: the highest peaks turn elliptical as they mature.
    aMorph[i * 4 + 1] = kind === 'peak' && nu > 3.0 ? 0.35 + rand() * 0.35 : kind === 'peak' && nu > 2.6 && rand() < 0.35 ? 0.5 + rand() * 0.4 : 9;
    aMorph[i * 4 + 2] = 0.55 + rand() * 0.9;
    aMorph[i * 4 + 3] = irregular;
  };

  let i = 0;
  for (let k = 0; k < nPeaks; k++, i++) {
    const qx = fd.peaks[k * 4]!;
    const qy = fd.peaks[k * 4 + 1]!;
    const qz = fd.peaks[k * 4 + 2]!;
    const nu = fd.peaks[k * 4 + 3]!;
    aQ.set([qx, qy, qz, opts.radius * (0.55 + 0.32 * (nu - 1.5))], i * 4);
    aPsi.set([psiAt(qx, qy, qz, 0), psiAt(qx, qy, qz, 1), psiAt(qx, qy, qz, 2), nu], i * 4);
    setCommon(i, 'peak', nu);
    if (k === opts.milkyWay) {
      aShape[i * 4 + 3] = 1;
      aShape[i * 4 + 2] = 1; // seen face-on at first; the particle disk takes over up close
      aMorph[i * 4] = 0.56;
      aMorph[i * 4 + 1] = 9;
      aQ[i * 4 + 3] = opts.radius * 1.1;
    }
  }
  // Companions: satellites of the biggest peaks that spiral in and merge, each at its own time.
  for (let c = 0, host = 0; c < nComp; c++, i++, host++) {
    if (host === opts.milkyWay) host++; // the Milky Way's own satellites are drawn up close by the scene
    aQ.set([aQ[host * 4]!, aQ[host * 4 + 1]!, aQ[host * 4 + 2]!, aQ[host * 4 + 3]! * (0.4 + 0.35 * rand())], i * 4);
    aPsi.set([aPsi[host * 4]!, aPsi[host * 4 + 1]!, aPsi[host * 4 + 2]!, 1.5], i * 4);
    setCommon(i, 'comp', 1.5);
    const r0 = aQ[host * 4 + 3]! * (2.2 + 2.5 * rand());
    const tMerge = 0.12 + 0.5 * rand();
    aOrbit.set([r0, rand() * Math.PI * 2, tMerge, (rand() < 0.5 ? -1 : 1) * (2.5 + 2 * rand())], i * 4);
    const ax = new Vector3(gaussian(rand), gaussian(rand), gaussian(rand)).normalize();
    aAxis.set([ax.x, ax.y, ax.z, 0], i * 4);
    // The host remembers its (last) merger for the starburst and tidal disturbance.
    aOrbit[host * 4 + 2] = tMerge;
    aAxis[host * 4 + 3] = 1;
  }
  // Field galaxies: biased tracers of the web. Each web particle is kept with probability ∝ ρ^bias, using the
  // Zel'dovich density at a mid-late amplitude, so galaxies line the filaments and crowd into the knots.
  {
    const Aref = opts.densityAmplitude ?? 0.85;
    const w = new Float32Array(nParts);
    let sum = 0;
    for (let k = 0; k < nParts; k++) {
      const l1 = parts.lambda[k * 4]!;
      const l2 = parts.lambda[k * 4 + 1]!;
      const l3 = parts.lambda[k * 4 + 2]!;
      const j = Math.abs((1 - Aref * l1) * (1 - Aref * l2) * (1 - Aref * l3));
      const rho = 1 / Math.max(j, 0.04);
      w[k] = Math.pow(Math.min(rho, 25), 1.15);
      sum += w[k]!;
    }
    for (let f = 0; f < nField; f++, i++) {
      // inverse-CDF draw would need a sorted table; rejection against the max weight is cheap enough here
      let k = 0;
      for (let tries = 0; tries < 64; tries++) {
        k = Math.floor(rand() * nParts);
        if (rand() * Math.pow(25, 1.15) < w[k]!) break;
      }
      aQ.set([parts.q[k * 4]!, parts.q[k * 4 + 1]!, parts.q[k * 4 + 2]!, opts.radius * (0.16 + 0.24 * Math.pow(rand(), 2))], i * 4);
      aPsi.set([parts.psi[k * 4]!, parts.psi[k * 4 + 1]!, parts.psi[k * 4 + 2]!, 1], i * 4);
      setCommon(i, 'field', 1);
    }
    void sum;
  }

  const attr = (a: Float32Array) => instancedBufferAttribute<'vec4'>(new InstancedBufferAttribute(a, 4), 'vec4');
  const q = attr(aQ);
  const psi = attr(aPsi);
  const shape = attr(aShape);
  const morph = attr(aMorph);
  const orbit = attr(aOrbit);
  const axis = attr(aAxis);

  const u = {
    amplitude: uniform(0),
    scale: uniform(1),
    brightness: uniform(1),
    sf: uniform(0.5),
    maturity: uniform(0.5),
    mergeClock: uniform(1),
    size: uniform(1),
    milkyWay: uniform(1),
    spin: uniform(0),
    nearFade: uniform(2.5),
    clearCenter: uniform(new Vector3()),
    clearRadius: uniform(0),
  };
  const pal = stellarPalette();

  // Position: exactly the web's x = fract(q + Aψ), plus a companion's decaying orbit.
  const box = fract(q.xyz.add(psi.xyz.mul(u.amplitude)));
  const host = box.sub(0.5).mul(WORLD_BOX).mul(u.scale);
  const r0 = orbit.x;
  const tMerge = orbit.z;
  const toGo = clamp(tMerge.sub(u.mergeClock).div(0.3), 0, 1);
  const rr = r0.mul(pow(toGo, 0.75));
  const ang = orbit.y.add(float(1).sub(toGo).mul(orbit.w).mul(2.2));
  const ax = normalize(axis.xyz.add(vec3(0.0001, 0, 0)));
  const e1 = normalize(cross(ax, vec3(0.31, 0.95, 0.07)));
  const e2 = cross(ax, e1);
  const offset = e1.mul(cos(ang)).add(e2.mul(sin(ang))).mul(rr);
  const center = host.add(offset);
  const isComp = smoothstep(0.0, 0.0001, r0);
  const alive = float(1).sub(isComp.mul(float(1).sub(smoothstep(0.0, 0.08, toGo))));
  // Host starburst + tidal disturbance around its merger time.
  const dtm = u.mergeClock.sub(tMerge);
  const burst = axis.w.mul(exp(dtm.mul(dtm).div(-0.006)));
  const disturb = axis.w.mul(exp(dtm.mul(dtm).div(-0.02))).add(isComp.mul(float(1).sub(toGo)).mul(0.8));

  const nu = psi.w;
  const settleOn = morph.x;
  const growth = mix(float(0.6), float(1.0), u.maturity);
  const radius = q.w.mul(u.size).mul(growth);
  const settle = smoothstep(settleOn, settleOn.add(0.4), u.maturity).mul(float(1).sub(morph.w.mul(0.85)));
  const ell = smoothstep(morph.y, morph.y.add(0.3), u.maturity);
  const sf = u.sf.mul(morph.z).mul(float(1).sub(ell.mul(0.9))).add(burst.mul(1.8)).add(morph.w.mul(u.sf).mul(0.5));
  const isMW = shape.w;

  // Fade sprites the camera is about to fly through.
  const viewZ = varying(modelViewMatrix.mul(vec4(center, 1)).z.negate(), 'vGalViewZ');
  const near = smoothstep(u.nearFade.mul(0.5), u.nearFade, viewZ.div(radius));

  const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  material.positionNode = center;
  // Quad spans 2.4 disk radii so the star-formation halo has room.
  material.scaleNode = radius.mul(2.4);

  const s = uv().sub(0.5).mul(2.4); // disk units: |s| = 1 at the disk edge
  const pa = shape.y;
  const cosi = shape.z;
  const sr = vec2(s.x.mul(cos(pa)).sub(s.y.mul(sin(pa))), s.x.mul(sin(pa)).add(s.y.mul(cos(pa))));
  const p = vec2(sr.x, sr.y.div(cosi));
  // Per-galaxy arm count (2–4), pitch and flocculence, all from the galaxy's seed.
  const fa = fract(shape.x.mul(13.7));
  const arms = float(2).add(step(0.62, fa)).add(step(0.86, fa));
  const tanP = fract(shape.x.mul(29.3)).mul(0.28).add(0.24);
  const floc = fract(shape.x.mul(47.1)).mul(0.65).add(0.3);
  const light = galaxyLight(
    {
      p,
      seed: shape.x,
      spin: u.spin.mul(fract(shape.x.mul(7.0)).add(0.5)),
      settle,
      sf,
      ell: max(ell, nu.sub(4.5).max(0)),
      disturb,
      arms,
      tanPitch: tanP,
      floc,
      minor: float(1).sub(floc).mul(step(arms, 2.5)).mul(0.5),
      age: u.maturity,
    },
    pal,
  );
  // Inclined disks are optically thin in starlight: surface brightness rises as 1/cos i (capped).
  const incl = min(float(1).div(cosi), 2.5);
  // Soft halo of light around star-forming galaxies: the "blaze" of cosmic noon.
  const sl = length(s);
  const halo = mix(v3(pal.hii), v3(pal.young), 0.55).mul(exp(sl.mul(sl).mul(-3.2)).mul(sf).mul(0.07));
  const outer = float(1).sub(smoothstep(0.85, 1.2, sl));
  const clear = smoothstep(u.clearRadius.mul(0.6), u.clearRadius.add(1e-6), length(center.sub(u.clearCenter)));
  const visible = alive.mul(near).mul(mix(float(1), u.milkyWay, isMW)).mul(mix(clear, float(1), isMW));
  material.colorNode = light.mul(incl).add(halo).mul(outer).mul(u.brightness).mul(visible);
  material.opacityNode = visible;

  const object = new Sprite(material);
  object.count = total;
  object.frustumCulled = false;

  return {
    object,
    material,
    count: total,
    uniforms: u,
    dispose() {
      material.dispose();
    },
  };
}

// ───────────────────────────────── Particle spiral ─────────────────────────────────

export interface SpiralGalaxyOptions {
  stars: number;
  seed?: number;
  /** Arm-pattern seed (0–1), shared with the light plane. */
  armSeed?: number;
  /** Number of giant clumps in the unsettled phase. */
  clumps?: number;
  /** Disk scale length in units of the visible radius. */
  scaleLength?: number;
  /** Radius where the arms begin (bar ends). */
  armStart?: number;
}

export interface SpiralGalaxy {
  /** Disk in the local XZ plane (normal +Y), visible radius 1. Position/rotate/scale this group. */
  group: Group;
  uniforms: {
    settle: FloatUniform;
    sf: FloatUniform;
    brightness: FloatUniform;
    /** Pattern angle (radians). */
    spin: FloatUniform;
    bar: FloatUniform;
    /** Star sprite size multiplier. */
    starSize: FloatUniform;
    /** Smooth-light plane gain. */
    glow: FloatUniform;
    /** Dust optical depth multiplier. */
    dust: FloatUniform;
  };
  armSeed: number;
  /** Star and dust sprite materials (e.g. for near-camera fades). */
  starsMaterial: SpriteNodeMaterial;
  dustMaterial: SpriteNodeMaterial;
  dispose(): void;
}

const POP = { old: 0, young: 1, hii: 2, bulge: 3 } as const;

/** Reference star count: per-star light scales as N_REF / N so the galaxy's total light is tier-independent. */
const N_REF = 120_000;

export function createSpiralGalaxy(opts: SpiralGalaxyOptions): SpiralGalaxy {
  const rand = mulberry32(opts.seed ?? 99);
  const N = Math.max(1000, Math.floor(opts.stars));
  const armSeed = opts.armSeed ?? 0.15;
  const hR = opts.scaleLength ?? 0.25;
  const nClumps = opts.clumps ?? 9;
  const armStart = opts.armStart ?? 0.12;
  const m = ARMS.count;

  const clumps: [number, number, number][] = [];
  for (let c = 0; c < nClumps; c++) clumps.push([0.1 + 0.55 * Math.sqrt(rand()), rand() * Math.PI * 2, 0.6 + 0.8 * rand()]);
  const expR = (h: number, max: number) => {
    // radius from an exponential surface density (gamma(2) in r), truncated
    for (;;) {
      const r = -h * Math.log(Math.max(1e-9, rand() * rand()));
      if (r < max) return r;
    }
  };
  const wrapPi = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
  // Angle of an arm ridge at radius r: phase = m(θ − spin) + (m/tanψ) ln r + 2π·seed = 2πj (+π for minor arms).
  const ridgeTheta = (r: number, j: number, minorArm: boolean) =>
    -Math.log(Math.max(r, 0.012)) / ARMS.tanPitch - (armSeed * 2 * Math.PI) / m + (2 * Math.PI * j + (minorArm ? Math.PI : 0)) / m;

  // OB associations along the arms: young stars and HII regions are born in groups, not uniformly.
  const nAssoc = Math.max(60, Math.round(N / 140));
  const assoc: [number, number, number][] = [];
  for (let a = 0; a < nAssoc; a++) {
    const minorArm = rand() < ARMS.minor / (1 + ARMS.minor);
    const r = armStart * 0.85 + expR(hR * 1.4, 0.95);
    const th = ridgeTheta(r, Math.floor(rand() * m), minorArm) + gaussian(rand) * 0.32;
    assoc.push([r, th, 0.006 + 0.022 * Math.pow(rand(), 2)]);
  }

  const aA = new Float32Array(N * 4); // r, θ (settled), z, population
  const aB = new Float32Array(N * 4); // r, θ (clumpy phase), seed, luminosity
  for (let k = 0; k < N; k++) {
    const u = rand();
    let pop: number;
    let r: number;
    let th: number;
    let z: number;
    const lum = Math.exp(gaussian(rand) * 0.55);
    if (u < 0.13) {
      pop = POP.bulge;
      r = Math.abs(gaussian(rand)) * 0.075 + Math.abs(gaussian(rand)) * 0.03;
      th = rand() * Math.PI * 2;
      z = gaussian(rand) * 0.03;
    } else if (u < 0.68) {
      pop = POP.old;
      r = expR(hR, 1.15);
      th = rand() * Math.PI * 2;
      z = gaussian(rand) * 0.016 * (1 + r);
    } else {
      pop = u < 0.955 ? POP.young : POP.hii;
      if (pop === POP.young && rand() < 0.45) {
        // diffuse young disk hugging the arms
        r = armStart * 0.85 + expR(hR * 1.4, 0.98);
        th = ridgeTheta(r, Math.floor(rand() * m), rand() < ARMS.minor / (1 + ARMS.minor)) + gaussian(rand) * 0.45;
      } else {
        const a = assoc[Math.floor(rand() * nAssoc)]!;
        const spread = pop === POP.hii ? a[2] * 0.5 : a[2];
        const cx = a[0] * Math.cos(a[1]) + gaussian(rand) * spread;
        const cz = a[0] * Math.sin(a[1]) + gaussian(rand) * spread;
        r = Math.hypot(cx, cz);
        th = a[1] + wrapPi(Math.atan2(cz, cx) - a[1]);
      }
      z = gaussian(rand) * 0.006;
    }
    // Clumpy-phase position: young stars and a third of the old disk sit in giant clumps.
    let re = r;
    let te = th;
    if (pop === POP.young || pop === POP.hii || (pop === POP.old && rand() < 0.3)) {
      const c = clumps[Math.floor(rand() * nClumps)]!;
      const sc = (pop === POP.old ? 0.085 : 0.04) * c[2];
      const cx = c[0] * Math.cos(c[1]) + gaussian(rand) * sc;
      const cz = c[0] * Math.sin(c[1]) + gaussian(rand) * sc;
      re = Math.hypot(cx, cz);
      te = th + wrapPi(Math.atan2(cz, cx) - th);
    }
    aA.set([r, th, z, pop], k * 4);
    aB.set([re, te, rand(), lum], k * 4);
  }

  const u = {
    settle: uniform(1),
    sf: uniform(0.3),
    brightness: uniform(1),
    spin: uniform(0),
    bar: uniform(0),
    starSize: uniform(1),
    glow: uniform(1),
    dust: uniform(1),
  };
  const pal = stellarPalette();
  const A = instancedBufferAttribute<'vec4'>(new InstancedBufferAttribute(aA, 4), 'vec4');
  const B = instancedBufferAttribute<'vec4'>(new InstancedBufferAttribute(aB, 4), 'vec4');
  const pop = A.w;
  const isOld = float(1).sub(smoothstep(0.0, 0.5, abs(pop.sub(POP.old))));
  const isYoung = float(1).sub(smoothstep(0.0, 0.5, abs(pop.sub(POP.young))));
  const isHii = float(1).sub(smoothstep(0.0, 0.5, abs(pop.sub(POP.hii))));
  const isBulge = float(1).sub(smoothstep(0.0, 0.5, abs(pop.sub(POP.bulge))));

  const s = u.settle;
  const r = mix(B.x, A.x, s);
  // Old stars orbit faster than the pattern inside corotation (flat rotation curve, Ω ∝ 1/r); young stars and
  // HII regions co-rotate with the arms they were born in. Old stars carry the density wave in brightness.
  const omega = mix(float(1), clamp(float(0.5).div(max(r, 0.08)), 0.5, 3.0), isOld);
  const th = mix(B.y, A.y, s).add(u.spin.mul(omega));
  // Bulge stars are stretched into a bar that turns with the pattern.
  const barStretch = isBulge.mul(u.bar);
  const bx = r.mul(cos(A.y)).mul(barStretch.mul(2.6).add(1));
  const bz = r.mul(sin(A.y)).mul(float(1).sub(barStretch.mul(0.45)));
  const barAng = u.spin.add(armSeed * 3.1);
  const bulgePos = vec3(bx.mul(cos(barAng)).sub(bz.mul(sin(barAng))), A.z, bx.mul(sin(barAng)).add(bz.mul(cos(barAng))));
  const thickness = mix(float(4.0), float(1.0), s);
  const diskPos = vec3(r.mul(cos(th)), A.z.mul(thickness), r.mul(sin(th)));
  const pos = mix(diskPos, bulgePos, isBulge);

  // Density wave seen in brightness: where is this star relative to the arm ridges right now?
  const ph = armPhase(r, th, u.spin, armSeed);
  const ridge = pow(cos(ph).mul(0.5).add(0.5), 2.6).add(pow(cos(ph.add(Math.PI)).mul(0.5).add(0.5), 3.0).mul(ARMS.minor));
  const lane = pow(cos(ph.add(ARMS.dustOffset)).mul(0.5).add(0.5), 8.0)
    .mul(s)
    .mul(smoothstep(0.07, 0.2, r))
    .mul(float(1).sub(smoothstep(0.6, 0.95, r)));
  const midplane = exp(abs(A.z).div(-0.02));
  const dust = float(1).sub(lane.mul(midplane).mul(0.85));
  const armBoost = mix(float(1), ridge.mul(1.0).add(0.6), s.mul(isOld).mul(0.8));
  // Young stars and HII regions brighten and fade slowly (birth and death of clusters).
  const life = sin(B.z.mul(91.0).add(u.spin.mul(7.0))).mul(0.5).add(0.5);
  const sfGain = u.sf.add(0.06);
  const k = N_REF / N;

  const colOld = v3(pal.old).mul(isOld).mul(armBoost).mul(0.13 * k);
  const colBulge = v3(pal.bulge).mul(isBulge).mul(0.1 * k);
  const colYoung = v3(pal.young).mul(isYoung).mul(sfGain).mul(life.mul(0.5).add(0.5)).mul(0.2 * k);
  const colHii = v3(pal.hii).mul(isHii).mul(sfGain).mul(life).mul(0.3 * k).mul(float(1).sub(smoothstep(0.6, 1.0, r).mul(0.75)));
  const col = colOld.add(colBulge).add(colYoung).add(colHii).mul(B.w).mul(dust).mul(u.brightness);

  const size = isOld.mul(0.0075).add(isBulge.mul(0.0085)).add(isYoung.mul(0.0075)).add(isHii.mul(0.016));
  const stars = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  stars.positionNode = pos;
  stars.scaleNode = size.mul(u.starSize).mul(B.w.sqrt().mul(0.5).add(0.6));
  const d = uv().sub(0.5).length().mul(2);
  const disc = exp(d.mul(d).mul(-5.0)).mul(float(1).sub(smoothstep(0.8, 1.0, d)));
  stars.colorNode = col;
  stars.opacityNode = disc;
  const sprite = new Sprite(stars);
  sprite.count = N;
  sprite.frustumCulled = false;

  // Unresolved light: the same galaxyLight() on a plane in the disk.
  const planeGeo = new PlaneGeometry(2.4, 2.4, 1, 1);
  planeGeo.rotateX(-Math.PI / 2);
  const planeMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
  const pp = vec2(positionLocal.x, positionLocal.z);
  const glowLight = galaxyLight(
    { p: pp, seed: float(armSeed), spin: u.spin, settle: u.settle, sf: u.sf, ell: float(0), bar: u.bar, floc: float(0.18), minor: float(ARMS.minor), armStart },
    pal,
  );
  planeMat.colorNode = glowLight.mul(u.glow).mul(u.brightness);
  planeMat.opacityNode = float(1);
  const plane = new Mesh(planeGeo, planeMat);
  plane.frustumCulled = false;
  plane.renderOrder = -1;

  // Dust lanes: absorbing clouds along the inner edges of the arms (in giant clumps while unsettled),
  // multiplied over everything drawn before them; blue light is absorbed more than red (reddening).
  const nDust = Math.max(600, Math.round(N * 0.08));
  const dA = new Float32Array(nDust * 4); // r, θ (settled), z, size
  const dB = new Float32Array(nDust * 4); // r, θ (clumpy), opacity, seed
  for (let k = 0; k < nDust; k++) {
    const r = armStart * 0.85 + expR(hR * 1.3, 0.9);
    const minorArm = rand() < ARMS.minor / (1 + ARMS.minor);
    const th = ridgeTheta(r, Math.floor(rand() * m), minorArm) - ARMS.dustOffset / m + gaussian(rand) * 0.16;
    const c = clumps[Math.floor(rand() * nClumps)]!;
    const cx = c[0] * Math.cos(c[1]) + gaussian(rand) * 0.06 * c[2];
    const cz = c[0] * Math.sin(c[1]) + gaussian(rand) * 0.06 * c[2];
    dA.set([r * (1 + gaussian(rand) * 0.04), th, gaussian(rand) * 0.004, 0.018 + 0.03 * rand()], k * 4);
    // Most clouds are thin; a few are opaque cores (patchy, filamentary lanes).
    dB.set([Math.hypot(cx, cz), th + wrapPi(Math.atan2(cz, cx) - th), (minorArm ? 0.5 : 1) * Math.pow(rand(), 2.2), rand()], k * 4);
  }
  const DA = instancedBufferAttribute<'vec4'>(new InstancedBufferAttribute(dA, 4), 'vec4');
  const DB = instancedBufferAttribute<'vec4'>(new InstancedBufferAttribute(dB, 4), 'vec4');
  const dr = mix(DB.x, DA.x, s);
  const dth = mix(DB.y, DA.y, s).add(u.spin);
  const dustMat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: MultiplyBlending, premultipliedAlpha: true });
  dustMat.positionNode = vec3(dr.mul(cos(dth)), DA.z.mul(thickness), dr.mul(sin(dth)));
  dustMat.scaleNode = DA.w.mul(mix(float(1.6), float(1), s));
  const dd = uv().sub(0.5).length().mul(2);
  const tau = exp(dd.mul(dd).mul(-3.5))
    .mul(float(1).sub(smoothstep(0.75, 1.0, dd)))
    .mul(DB.z)
    .mul(u.dust)
    .mul(u.brightness.mul(u.brightness))
    .mul(s.mul(0.75).add(0.25))
    .mul(float(1).sub(smoothstep(0.75, 1.0, dr)));
  // Transmission e^(−τ·k_λ) with k rising toward the blue.
  dustMat.colorNode = vec3(exp(tau.mul(-0.6)), exp(tau.mul(-0.72)), exp(tau.mul(-0.9)));
  dustMat.opacityNode = float(1);
  const dustSprite = new Sprite(dustMat);
  dustSprite.count = nDust;
  dustSprite.frustumCulled = false;
  dustSprite.renderOrder = 2;

  const group = new Group();
  group.add(plane);
  group.add(sprite);
  group.add(dustSprite);

  return {
    group,
    uniforms: u,
    armSeed,
    starsMaterial: stars,
    dustMaterial: dustMat,
    dispose() {
      stars.dispose();
      dustMat.dispose();
      planeMat.dispose();
      planeGeo.dispose();
    },
  };
}

// ───────────────────────────────── Milky Way framing ─────────────────────────────────

/**
 * Where our galaxy sits and how cosmicNoon leaves it: darkEnergy opens on exactly this framing so the
 * 'stretch' hand-off reads as one continuous shot. World units of the shared web (WORLD_BOX per box).
 */
export const MW_FRAME = (() => {
  const view = new Vector3(0.42, 0.5, 0.76).normalize(); // galaxy → camera at cosmicNoon's last frame
  const worldUp = new Vector3(0, 1, 0);
  const right = new Vector3().crossVectors(worldUp, view).normalize();
  const screenUp = new Vector3().crossVectors(view, right).normalize();
  const inclination = (58 * Math.PI) / 180; // disk normal vs line of sight
  const normal = view.clone().multiplyScalar(Math.cos(inclination)).addScaledVector(screenUp, Math.sin(inclination)).normalize();
  return {
    /** Visible disk radius in world units (true size ≈ 0.0015: drawn ~40× larger, like every galaxy here). */
    radius: 0.07,
    normal,
    view,
    /** Camera distance of the closing frame, in disk radii. */
    distance: 3.3,
  };
})();

/** The Milky Way's arms begin at the ends of its bar, ~3.3 kpc out (in units of its 15 kpc disk radius). */
export const MW_ARM_START = 0.22;

/** Gentle idle sway of the camera around the Milky Way, shared so cosmicNoon → darkEnergy match exactly. */
export function mwSway(elapsed: number): number {
  return Math.sin(elapsed * 0.045) * 0.06;
}

// ───────────────────────────────── Camera tracks ─────────────────────────────────

/**
 * Monotone cubic (Fritsch–Carlson) through [x, y] keys: smooth, never overshoots, never stops at a key.
 * Returns a function; evaluation allocates nothing.
 */
export function monotoneTrack(keys: readonly (readonly [number, number])[]): (x: number) => number {
  const n = keys.length;
  const xs = keys.map((k) => k[0]);
  const ys = keys.map((k) => k[1]);
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]!));
  const m: number[] = new Array<number>(n).fill(0);
  m[0] = d[0]!;
  m[n - 1] = d[n - 2]!;
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / d[i]!;
    const b = m[i + 1]! / d[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i]!;
      m[i + 1] = t * b * d[i]!;
    }
  }
  return (x: number) => {
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[n - 1]!) return ys[n - 1]!;
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]!) i++;
    const h = xs[i + 1]! - xs[i]!;
    const t = (x - xs[i]!) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i]! + (t3 - 2 * t2 + t) * h * m[i]! + (-2 * t3 + 3 * t2) * ys[i + 1]! + (t3 - t2) * h * m[i + 1]!
    );
  };
}

/**
 * Fade a sprite material's instances as they come close to the camera (view depth near0 → near1), so the
 * camera can fly through a point cloud without blurry blobs. Call before the first compile.
 */
export function addNearFade(material: SpriteNodeMaterial, near0: FloatUniform, near1: FloatUniform): void {
  const pos = material.positionNode as V3;
  const z = varying(modelViewMatrix.mul(vec4(pos, 1)).z.negate(), 'vNearFadeZ');
  const f = smoothstep(near0, near1, z);
  material.colorNode = (material.colorNode as V3).mul(f);
  material.opacityNode = (material.opacityNode as F).mul(f);
}

/**
 * Fade a sprite material's instances outside a sphere (world space): fully visible inside r0, gone by r1.
 * Lets a periodic box be tiled into a round patch of universe instead of a cube.
 */
export function addSphereFade(material: SpriteNodeMaterial, center: Vec3Uniform, r0: FloatUniform, r1: FloatUniform): void {
  const pos = material.positionNode as V3;
  const world = varying(modelWorldMatrix.mul(vec4(pos, 1)).xyz, 'vSphereFadeWorld');
  const f = float(1).sub(smoothstep(r0, r1, length(world.sub(center))));
  material.colorNode = (material.colorNode as V3).mul(f);
  material.opacityNode = (material.opacityNode as F).mul(f);
}

export interface Tiles {
  /** Parent of the 27 tile sprites (centre first). */
  group: Group;
  sprites: Sprite[];
  /**
   * Place tiles: the periodic box is scaled by `scale` about `anchor` (world), which stays fixed; then shifted by
   * −`shift`. Tiles entirely farther than `cullRadius` from `cullCenter` are hidden.
   */
  place(anchor: Vector3, scale: number, shift?: Vector3, cullCenter?: Vector3, cullRadius?: number): void;
}

/**
 * 3×3×3 periodic copies of a box-filling sprite cloud (web or galaxies) sharing one material. `boxScaleIsUniform`
 * means the material already multiplies positions by the scale uniform, so tile offsets scale with it too.
 */
export function tileBox(material: SpriteNodeMaterial, centreCount: number, outerCount: number): Tiles {
  const group = new Group();
  const sprites: Sprite[] = [];
  const offsets: Vector3[] = [];
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++)
      for (let k = -1; k <= 1; k++) {
        const s = new Sprite(material);
        const centre = i === 0 && j === 0 && k === 0;
        s.count = centre ? centreCount : outerCount;
        s.frustumCulled = false;
        if (centre) {
          sprites.unshift(s);
          offsets.unshift(new Vector3(0, 0, 0));
        } else {
          sprites.push(s);
          offsets.push(new Vector3(i, j, k).multiplyScalar(WORLD_BOX));
        }
        group.add(s);
      }
  return {
    group,
    sprites,
    place(anchor, scale, shift, cullCenter, cullRadius) {
      const half = (WORLD_BOX / 2) * scale;
      for (let n = 0; n < sprites.length; n++) {
        const sp = sprites[n]!;
        // world = objectPos + boxPos·scale; keep the anchor fixed: objectPos = anchor·(1 − scale) + offset·scale
        sp.position.copy(anchor).multiplyScalar(1 - scale).addScaledVector(offsets[n]!, scale);
        if (shift) sp.position.sub(shift);
        if (cullCenter && cullRadius !== undefined) {
          // distance from the cull centre to this tile's box (centred on its object position)
          const dx = Math.max(0, Math.abs(cullCenter.x - sp.position.x) - half);
          const dy = Math.max(0, Math.abs(cullCenter.y - sp.position.y) - half);
          const dz = Math.max(0, Math.abs(cullCenter.z - sp.position.z) - half);
          sp.visible = dx * dx + dy * dy + dz * dz < cullRadius * cullRadius;
        }
      }
    },
  };
}

// ───────────────────────────────── Free-standing galaxy sprites ─────────────────────────────────

export interface GalaxySpriteSpec {
  position: Vector3;
  /** Visible radius (world units). */
  radius: number;
  seed: number;
  /** Position angle of the major axis on screen (radians) and axis ratio (cos i). */
  pa: number;
  cosi: number;
  settle: number;
  ell: number;
  sf: number;
  brightness: number;
}

export interface GalaxySprites {
  sprite: Sprite;
  uniforms: { brightness: FloatUniform; spin: FloatUniform; minPx: FloatUniform; size: FloatUniform };
  dispose(): void;
}

/** Camera-facing galaxies at fixed positions (Local Group members), never smaller than `minPx` pixels. */
export function createGalaxySprites(list: GalaxySpriteSpec[], resolution: Vec2Uniform2, fovDeg: number): GalaxySprites {
  const n = Math.max(1, list.length);
  const A = new Float32Array(n * 4); // xyz, radius
  const B = new Float32Array(n * 4); // seed, pa, cosi, brightness
  const Cc = new Float32Array(n * 4); // settle, ell, sf, -
  list.forEach((g, i) => {
    A.set([g.position.x, g.position.y, g.position.z, g.radius], i * 4);
    B.set([g.seed, g.pa, g.cosi, g.brightness], i * 4);
    Cc.set([g.settle, g.ell, g.sf, 0], i * 4);
  });
  const a = instancedBufferAttribute<'vec4'>(new InstancedBufferAttribute(A, 4), 'vec4');
  const b = instancedBufferAttribute<'vec4'>(new InstancedBufferAttribute(B, 4), 'vec4');
  const c = instancedBufferAttribute<'vec4'>(new InstancedBufferAttribute(Cc, 4), 'vec4');
  const u = { brightness: uniform(1), spin: uniform(0), minPx: uniform(3), size: uniform(1) };
  const pal = stellarPalette();
  const mat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  mat.positionNode = a.xyz;
  const viewZ = modelViewMatrix.mul(vec4(a.xyz, 1)).z.negate();
  const pxWorld = viewZ.mul(2 * Math.tan(((fovDeg / 2) * Math.PI) / 180)).div(resolution.y);
  const natural = a.w.mul(2.4).mul(u.size);
  const quad = max(natural, pxWorld.mul(u.minPx));
  mat.scaleNode = quad;
  // When the sprite is clamped to minPx, keep its total light roughly constant (dimmer per pixel).
  const shrink = natural.div(quad);
  const s = uv().sub(0.5).mul(2.4);
  const sr = vec2(s.x.mul(cos(b.y)).sub(s.y.mul(sin(b.y))), s.x.mul(sin(b.y)).add(s.y.mul(cos(b.y))));
  const p = vec2(sr.x, sr.y.div(b.z));
  const light = galaxyLight(
    { p, seed: b.x, spin: u.spin, settle: c.x, sf: c.z, ell: c.y, floc: float(0.6), arms: float(2), tanPitch: float(0.3), minor: float(0.3), age: float(1) },
    pal,
  );
  const edge = float(1).sub(smoothstep(0.85, 1.2, length(s)));
  const incl = min(float(1).div(b.z), 2.5);
  mat.colorNode = light.mul(incl).mul(edge).mul(b.w).mul(u.brightness).mul(shrink.mul(shrink).max(0.04));
  mat.opacityNode = edge;
  const sprite = new Sprite(mat);
  sprite.count = list.length;
  sprite.frustumCulled = false;
  return {
    sprite,
    uniforms: u,
    dispose() {
      mat.dispose();
    },
  };
}
