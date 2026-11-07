// Quantum-foam volume shared by `planck` (whole chapter) and `inflation` (its opening patch).
//
// The foam is a 4D (space + time) froth: an analytic Voronoi / power diagram whose cells breathe in time,
// seen through a domain warp driven by time-advected fBm (a small precomputed tileable 3D noise texture,
// two fetches per step instead of ~10 procedural noise evaluations). The raymarch detects every crossing of a
// cell wall exactly (the nearest cell changes between samples), so the films stay crisp at any step count:
// each film adds light boosted where it is seen edge-on (bright rims, like soap films), Plateau borders
// (where three bubbles meet) flare, and a soft fBm haze fills the space between.
//
// The volume is raymarched at reduced resolution into its own target (see FoamVolume.target) and
// up-sampled by a full-screen quad drawn first in the scene's main pass.

import {
  BackSide,
  Color,
  Data3DTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  RenderTarget,
  RepeatWrapping,
  RGFormat,
  SphereGeometry,
  Vector3,
} from 'three/webgpu';
import {
  Break,
  Fn,
  If,
  Loop,
  cameraPosition,
  clamp,
  dot,
  exp,
  float,
  fract,
  interleavedGradientNoise,
  length,
  luminance,
  max,
  min,
  mix,
  positionGeometry,
  positionWorld,
  screenCoordinate,
  select,
  sin,
  smoothstep,
  sqrt,
  texture,
  texture3D,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { mulberry32 } from '../../shared/math.ts';

// ── Noise texture (CPU, cached per size) ────────────────────────────────────

export const FOAM_NOISE = {
  seed: 4242,
  /** Gradient-noise lattice period (cells per tile) of the first fBm octave. */
  gradPeriod: 4,
  gradOctaves: 3,
} as const;

const noiseCache = new Map<number, Uint16Array>();

/** Periodic gradient-noise fBm, normalised to unit RMS. */
function gradientFbm(n: number, period: number, octaves: number, rand: () => number): Float32Array {
  const out = new Float32Array(n * n * n);
  let amp = 1;
  const fade = new Float32Array(n);
  const base = new Int32Array(n);
  for (let oct = 0; oct < octaves; oct++) {
    const P = period << oct;
    const g = new Float32Array(P * P * P * 3);
    for (let i = 0; i < P * P * P; i++) {
      const u = rand() * 2 - 1;
      const phi = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      g[i * 3] = s * Math.cos(phi);
      g[i * 3 + 1] = s * Math.sin(phi);
      g[i * 3 + 2] = u;
    }
    const frac = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = ((i + 0.5) / n) * P;
      base[i] = Math.floor(p);
      frac[i] = p - base[i]!;
      const t = frac[i]!;
      fade[i] = t * t * t * (t * (t * 6 - 15) + 10);
    }
    let o = 0;
    for (let z = 0; z < n; z++) {
      const iz0 = base[z]! % P;
      const iz1 = (iz0 + 1) % P;
      const fz = frac[z]!;
      const wz = fade[z]!;
      for (let y = 0; y < n; y++) {
        const iy0 = base[y]! % P;
        const iy1 = (iy0 + 1) % P;
        const fy = frac[y]!;
        const wy = fade[y]!;
        for (let x = 0; x < n; x++) {
          const ix0 = base[x]! % P;
          const ix1 = (ix0 + 1) % P;
          const fx = frac[x]!;
          const wx = fade[x]!;
          let k = ((iz0 * P + iy0) * P + ix0) * 3;
          const c000 = g[k]! * fx + g[k + 1]! * fy + g[k + 2]! * fz;
          k = ((iz0 * P + iy0) * P + ix1) * 3;
          const c100 = g[k]! * (fx - 1) + g[k + 1]! * fy + g[k + 2]! * fz;
          k = ((iz0 * P + iy1) * P + ix0) * 3;
          const c010 = g[k]! * fx + g[k + 1]! * (fy - 1) + g[k + 2]! * fz;
          k = ((iz0 * P + iy1) * P + ix1) * 3;
          const c110 = g[k]! * (fx - 1) + g[k + 1]! * (fy - 1) + g[k + 2]! * fz;
          k = ((iz1 * P + iy0) * P + ix0) * 3;
          const c001 = g[k]! * fx + g[k + 1]! * fy + g[k + 2]! * (fz - 1);
          k = ((iz1 * P + iy0) * P + ix1) * 3;
          const c101 = g[k]! * (fx - 1) + g[k + 1]! * fy + g[k + 2]! * (fz - 1);
          k = ((iz1 * P + iy1) * P + ix0) * 3;
          const c011 = g[k]! * fx + g[k + 1]! * (fy - 1) + g[k + 2]! * (fz - 1);
          k = ((iz1 * P + iy1) * P + ix1) * 3;
          const c111 = g[k]! * (fx - 1) + g[k + 1]! * (fy - 1) + g[k + 2]! * (fz - 1);
          const x00 = c000 + (c100 - c000) * wx;
          const x10 = c010 + (c110 - c010) * wx;
          const x01 = c001 + (c101 - c001) * wx;
          const x11 = c011 + (c111 - c011) * wx;
          const y0 = x00 + (x10 - x00) * wy;
          const y1 = x01 + (x11 - x01) * wy;
          out[o] = out[o]! + (y0 + (y1 - y0) * wz) * amp;
          o++;
        }
      }
    }
    amp *= 0.5;
  }
  let ss = 0;
  for (let i = 0; i < out.length; i++) ss += out[i]! * out[i]!;
  const rms = Math.sqrt(ss / out.length) || 1;
  for (let i = 0; i < out.length; i++) out[i] = out[i]! / rms;
  return out;
}

/**
 * RG16F tileable 3D noise: two decorrelated gradient-noise fBm channels (unit RMS) used for the domain
 * warp, the haze and the gravity veil's lace. CPU data is cached per size; each call returns a new
 * texture that the caller owns and must dispose.
 */
export function createFoamNoiseTexture(n: number): Data3DTexture {
  let data = noiseCache.get(n);
  if (!data) {
    const rand = mulberry32(FOAM_NOISE.seed);
    const N3 = n * n * n;
    const g1 = gradientFbm(n, FOAM_NOISE.gradPeriod, FOAM_NOISE.gradOctaves, rand);
    const g2 = gradientFbm(n, FOAM_NOISE.gradPeriod, FOAM_NOISE.gradOctaves, rand);
    data = new Uint16Array(N3 * 2);
    for (let i = 0; i < N3; i++) {
      data[i * 2] = DataUtils.toHalfFloat(g1[i]!);
      data[i * 2 + 1] = DataUtils.toHalfFloat(g2[i]!);
    }
    noiseCache.set(n, data);
  }
  const t = new Data3DTexture(data, n, n, n);
  t.format = RGFormat;
  t.type = HalfFloatType;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = RepeatWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

// ── Raymarched volume ───────────────────────────────────────────────────────

const _mkF = () => uniform(0);
const _mkV3 = () => uniform(new Vector3());
const _mkC = () => uniform(new Color());
type F = ReturnType<typeof _mkF>;
type V3 = ReturnType<typeof _mkV3>;
type C = ReturnType<typeof _mkC>;

export interface FoamUniforms {
  /** World centre and bounding radius of the volume. Density lives in local units p = (x − centre)/radius. */
  centre: V3;
  radius: F;
  /** Integrated churn phase (advance by dt × speed on the CPU so speed changes never jump). */
  phase: F;
  /** Foam cells per local unit. */
  scale: F;
  /** Divides cell coordinates: > 1 stretches every bubble (inflation). */
  stretch: F;
  /** Domain-warp amplitude (cell units) and frequency (warp-noise tiles per cell). */
  warp: F;
  warpScale: F;
  /** Seed jitter within its lattice cell (0 = cubic lattice, 1 = fully random). */
  seedJitter: F;
  /** Power-diagram weight amplitude: bubbles swell and shrink. */
  breathe: F;
  /** Bubble skins (soft membranes): gain and width in √F2 − √F1 units (≈ 2 × distance to the wall, cells). */
  skinGain: F;
  skinWidth: F;
  edgeGain: F;
  edgeWidth: F;
  /** White-hot vertices where four bubbles meet. */
  nodeGain: F;
  hazeGain: F;
  /** Local radius of the foam ball (≤ 1) and the fraction of it used for the soft edge. */
  foamExtent: F;
  edgeSoft: F;
  /** Slow large-scale brightness modulation ("bubbling"). */
  bubbling: F;
  coreGain: F;
  coreRadius: F;
  /** Absorption of haze and core (depth cue). */
  absorb: F;
  /** Envelope squash along world z (> 1 = thinner along the view axis). */
  zSquash: F;
  /** Single luminous bubble (planck): radius and width in local units, gain, surface wobble. */
  shellRadius: F;
  shellWidth: F;
  shellGain: F;
  shellWobble: F;
  /** Noise frequency on the analytic layers (relative to the cell frequency). */
  layerNoiseScale: F;
  /** Corona outside the bubble: gain and e-folding length (local units). */
  coronaGain: F;
  coronaLength: F;
  /** Centre offset of the gravity veil (local units): it lifts off one side first. */
  gravityOffset: V3;
  /** How fast films seen through other films sink from hot to deep (exponent on transmittance). */
  depthTint: F;
  /** Longest step as a multiple of chord / steps (> 1 lets sphere tracing skip empty space faster). */
  maxStepMul: F;
  /** Brightness focus: local centre, radius, and how much it dominates (0 = uniform). */
  focus: V3;
  focusRadius: F;
  focusGain: F;
  hot: C;
  deep: C;
  /** Colour of films seen through others (depth). */
  far: C;
  core: C;
  exposure: F;
  // Planck-only features (present but inert unless enabled in options).
  gravityRadius: F;
  gravityWidth: F;
  gravityStrength: F;
  gravityGlow: C;
  gravityAbsorb: F;
  flicker: F;
  flickerPhase: F;
  colourR: C;
  colourG: C;
  colourB: C;
}

export interface FoamVolumeOptions {
  steps: number;
  noise: Data3DTexture;
  /** Fraction of the scene target's resolution used for the raymarch. */
  resolutionScale: number;
  /** Include the absorbing "gravity" veil (planck). */
  gravity?: boolean;
  /** Include the colour-charge flicker (planck). */
  flicker?: boolean;
  /** Include the single luminous bubble (planck's unified field). */
  bubble?: boolean;
}

export interface FoamVolume {
  /** Bounding sphere (BackSide), render with the scene camera into `target`. */
  mesh: Mesh;
  /** Full-screen quad that draws `target` up-sampled; add it to the main scene (renderOrder −10). */
  quad: Mesh;
  target: RenderTarget;
  uniforms: FoamUniforms;
  setSize(w: number, h: number): void;
  /** Keep the bounding mesh on the uniforms (call after changing centre/radius). */
  sync(): void;
  dispose(): void;
}

export function createFoamVolume(o: FoamVolumeOptions): FoamVolume {
  const u: FoamUniforms = {
    centre: uniform(new Vector3()),
    radius: uniform(1),
    phase: uniform(0),
    scale: uniform(4),
    stretch: uniform(1),
    warp: uniform(0.3),
    warpScale: uniform(0.07),
    seedJitter: uniform(0.8),
    breathe: uniform(0.1),
    skinGain: uniform(0.3),
    skinWidth: uniform(0.15),
    edgeGain: uniform(0.5),
    edgeWidth: uniform(0.08),
    nodeGain: uniform(0),
    hazeGain: uniform(0.2),
    foamExtent: uniform(0.9),
    edgeSoft: uniform(0.5),
    bubbling: uniform(0.6),
    coreGain: uniform(0),
    coreRadius: uniform(0.3),
    absorb: uniform(0.4),
    zSquash: uniform(1),
    shellRadius: uniform(0.4),
    shellWidth: uniform(0.02),
    shellGain: uniform(0),
    shellWobble: uniform(0.02),
    layerNoiseScale: uniform(0.25),
    coronaGain: uniform(0),
    coronaLength: uniform(0.08),
    gravityOffset: uniform(new Vector3()),
    depthTint: uniform(1.5),
    maxStepMul: uniform(2),
    focus: uniform(new Vector3()),
    focusRadius: uniform(0.6),
    focusGain: uniform(0),
    hot: uniform(new Color(0.3, 0.44, 1)),
    deep: uniform(new Color(0.18, 0.08, 0.5)),
    far: uniform(new Color(0.2, 0.06, 0.5)),
    core: uniform(new Color(1, 1, 1)),
    exposure: uniform(1),
    gravityRadius: uniform(0.5),
    gravityWidth: uniform(0.1),
    gravityStrength: uniform(0),
    gravityGlow: uniform(new Color(0.05, 0.02, 0.12)),
    gravityAbsorb: uniform(9),
    flicker: uniform(0),
    flickerPhase: uniform(0),
    colourR: uniform(new Color(1, 0.12, 0.08)),
    colourG: uniform(new Color(0.1, 1, 0.25)),
    colourB: uniform(new Color(0.15, 0.3, 1)),
  };
  const tex = o.noise;
  const steps = Math.max(8, Math.round(o.steps));

  // Seeds of the foam cells: a jittered lattice; each cell "breathes" (power-diagram weight), so bubbles
  // swell and shrink independently while the domain warp makes the whole froth churn.
  const hash3 = (c: Node<'vec3'>): Node<'vec3'> =>
    fract(sin(vec3(dot(c, vec3(127.1, 311.7, 74.7)), dot(c, vec3(269.5, 183.3, 246.1)), dot(c, vec3(113.5, 271.9, 124.6)))).mul(43758.5453));
  const neighbours = { start: 0, end: 27, type: 'int' as const, name: 'nb' };
  /** exp(−(x/w)²) without pow(): pow of a negative base is undefined in WGSL/GLSL. */
  const gauss = (x: Node<'float'>, w: Node<'float'>): Node<'float'> => {
    const q = x.div(w);
    return exp(q.mul(q).negate());
  };
  /** Sphere-trace safety for the domain warp's stretching (Lipschitz factor ≈ 1 + |∇warp|). */
  const TRACE_SAFETY = 0.55;

  const march = Fn(() => {
    // Ray in local units with the envelope squashed along z (an ellipsoid): fewer overlapping films
    // along the view axis, so the front-most foam reads as structure rather than fog.
    const ro = cameraPosition;
    const rdW = positionWorld.sub(cameraPosition).normalize();
    const sq = vec3(1, 1, u.zSquash);
    const roE = ro.sub(u.centre).div(u.radius).mul(sq);
    const rdE = rdW.div(u.radius).mul(sq);
    const a = dot(rdE, rdE);
    const b = dot(roE, rdE);
    const c = dot(roE, roE).sub(1);
    const h = sqrt(max(b.mul(b).sub(a.mul(c)), 0));
    const t0 = max(b.negate().sub(h).div(a), 0);
    const t1 = b.negate().add(h).div(a);
    // Sphere tracing towards the Plateau borders: (√F3 − √F1)/2 is a lower bound on the distance to any
    // edge of the foam, so the thin glowing edges are never skipped; the step is capped so the haze stays
    // sampled.
    const chord = max(t1.sub(t0), 1e-4);
    const cellW = u.radius.mul(u.stretch).div(u.scale); // world size of one cell
    const maxW = chord.div(steps).mul(u.maxStepMul);
    const minW = cellW.mul(u.edgeWidth).mul(0.6);
    const jitter = interleavedGradientNoise(screenCoordinate.xy);
    const t = t0.add(maxW.mul(jitter).mul(0.5)).toVar();
    const dtW = float(0).toVar();
    const nearCount = float(0).toVar();
    const col = vec3(0).toVar();
    const trans = float(1).toVar();
    const charge = vec3(0).toVar();
    const ph = u.phase;

    // Thin spherical layers around the foam (planck's bubble and gravity veil) are integrated analytically
    // where the ray crosses them: a Gaussian shell of width w seen at angle θ to its normal contributes
    // w√π / cos θ, capped at grazing incidence (limb brightening without any sampling).
    const ocL = ro.sub(u.centre).div(u.radius);
    const crossing = (R: Node<'float'>, w: Node<'float'>, offset: Node<'vec3'> | V3) => {
      const oc = ocL.sub(offset);
      const bL = dot(oc, rdW);
      const b2 = max(dot(oc, oc).sub(bL.mul(bL)), 0); // squared miss distance (local)
      const hh = R.mul(R).sub(b2);
      const cosT = sqrt(max(hh, 0)).div(R);
      const graze = sqrt(w.mul(2).div(R));
      const outside = gauss(max(sqrt(b2).sub(R), 0), w);
      const amount = w.mul(1.7725).div(max(cosT, graze)).mul(outside);
      const half = sqrt(max(hh, 0));
      return { amount, tFront: bL.negate().sub(half), tBack: bL.negate().add(half), oc };
    };
    const hueOf = (x: Node<'float'>) => {
      const k = fract(x).mul(3);
      const wr = clamp(float(1).sub(k.sub(0.5).abs().mul(1.4)), 0, 1).add(clamp(float(1).sub(k.sub(3.5).abs().mul(1.4)), 0, 1));
      const wg = clamp(float(1).sub(k.sub(1.5).abs().mul(1.4)), 0, 1);
      const wb = clamp(float(1).sub(k.sub(2.5).abs().mul(1.4)), 0, 1);
      return u.colourR.mul(wr).add(u.colourG.mul(wg)).add(u.colourB.mul(wb));
    };
    // One layer crossing: emission (with optional colour charge) and absorption with a lacy noise mask.
    const layer = (
      oc: Node<'vec3'>,
      tL: Node<'float'>,
      amount: Node<'float'>,
      gain: Node<'float'>,
      colour: Node<'vec3'> | C,
      absorb: Node<'float'>,
      lacy: boolean,
    ) => {
      const pl = oc.add(rdW.mul(tL));
      const n = texture3D(tex, pl.mul(u.scale).mul(u.layerNoiseScale).add(vec3(ph.mul(0.012), 0.3, ph.mul(-0.009)))).rg;
      // Lace: a torn veil, mostly thin dark strands (ridged noise) over a few broader patches.
      const ridge = float(1).sub(n.x.abs());
      const mask = lacy
        ? smoothstep(0.45, 0.9, ridge).mul(0.75).add(smoothstep(0.2, 0.9, n.y).mul(0.45))
        : float(1).add(n.x.mul(0.3));
      let emit: Node<'vec3'> = colour.mul(amount.mul(gain).mul(mask));
      if (o.flicker) emit = mix(emit, hueOf(n.y.mul(0.6).add(u.flickerPhase)).mul(luminance(emit).mul(1.8)), u.flicker);
      col.addAssign(emit.mul(trans));
      trans.mulAssign(exp(amount.mul(absorb).mul(mask).negate()));
    };
    const veilX = crossing(u.gravityRadius, u.gravityWidth, u.gravityOffset);
    const shellX = crossing(u.shellRadius, u.shellWidth, vec3(0));
    const veilOn = o.gravity ? u.gravityStrength : float(0);
    const shellOn = o.bubble ? u.shellGain : float(0);
    if (o.gravity) layer(veilX.oc, veilX.tFront, veilX.amount, veilOn, u.gravityGlow, veilOn.mul(u.gravityAbsorb), true);
    if (o.bubble) layer(shellX.oc, shellX.tFront, shellX.amount, shellOn, mix(u.hot, u.core, 0.5), shellOn.mul(0.25), false);

    Loop(steps, () => {
      const pw = ro.add(rdW.mul(t));
      const p = pw.sub(u.centre).div(u.radius); // isotropic local position
      const r = length(p.mul(sq));
      const env = float(1).sub(smoothstep(u.foamExtent.mul(float(1).sub(u.edgeSoft)), u.foamExtent, r));
      const fd = p.sub(u.focus);
      const focus = exp(dot(fd, fd).div(u.focusRadius.mul(u.focusRadius)).negate()).mul(u.focusGain).add(float(1).sub(u.focusGain));
      const shapeBase = env.mul(focus);

      // Domain warp from the time-advected fBm texture (two fetches: three warp components + one haze channel).
      const tp = p.mul(u.scale).div(u.stretch).mul(u.warpScale).add(vec3(0.31, 0.17, 0.53));
      const w1 = texture3D(tex, tp.add(vec3(ph.mul(0.021), ph.mul(0.013), ph.mul(-0.017)))).rg;
      const w2 = texture3D(tex, tp.yzx.mul(0.93).add(vec3(ph.mul(-0.015), ph.mul(0.019), ph.mul(0.011)))).rg;
      const cp = p.mul(u.scale).div(u.stretch).add(vec3(w1.x, w1.y, w2.x).mul(u.warp)).add(vec3(17.3, 5.1, 9.7));

      // Analytic Worley / power diagram: nearest three cells.
      const base = cp.floor();
      const f1 = float(1e4).toVar();
      const f2 = float(1e4).toVar();
      const f3 = float(1e4).toVar();
      const f4 = float(1e4).toVar();
      const s1 = vec3(0).toVar();
      const id1 = float(0).toVar();
      Loop(neighbours, (inputs) => {
        // The loop variable is named 'nb' (not shadowing the outer 'i'); @types/three only knows 'i'.
        const nf = float((inputs as unknown as { nb: Node<'int'> }).nb);
        const ox = nf.div(9).floor();
        const oy = nf.sub(ox.mul(9)).div(3).floor();
        const oz = nf.sub(ox.mul(9)).sub(oy.mul(3));
        const cell = base.add(vec3(ox, oy, oz).sub(1));
        const hc = hash3(cell);
        const seed = cell.add(0.5).add(hc.sub(0.5).mul(u.seedJitter));
        const wgt = sin(ph.mul(hc.x.mul(0.7).add(0.35)).add(hc.y.mul(6.283))).mul(u.breathe);
        const dv = cp.sub(seed);
        const d = dot(dv, dv).sub(wgt);
        If(d.lessThan(f1), () => {
          f4.assign(f3);
          f3.assign(f2);
          f2.assign(f1);
          f1.assign(d);
          s1.assign(seed);
          id1.assign(hc.z);
        })
          .ElseIf(d.lessThan(f2), () => {
            f4.assign(f3);
            f3.assign(f2);
            f2.assign(d);
          })
          .ElseIf(d.lessThan(f3), () => {
            f4.assign(f3);
            f3.assign(d);
          })
          .ElseIf(d.lessThan(f4), () => {
            f4.assign(d);
          });
      });

      const bub = max(float(1).add(w2.y.mul(u.bubbling)), 0);
      const shape = shapeBase.mul(bub);

      // Soft volumetric haze between the films (atmosphere + depth) and Plateau borders (where three
      // bubbles meet, F1 ≈ F2 ≈ F3) as thin glowing lines.
      const hazeE = smoothstep(-0.6, 1.6, w2.y.add(w1.y.mul(0.5))).mul(shape).mul(u.hazeGain);
      const e3 = sqrt(max(f3, 0)).sub(sqrt(max(f1, 0)));
      const edgeE = gauss(e3, u.edgeWidth).mul(shape).mul(u.edgeGain);
      // Vertices (four bubbles meet, F1 ≈ F4): white-hot nodes that bloom.
      const e4 = sqrt(max(f4, 0)).sub(sqrt(max(f1, 0)));
      const nodeE = gauss(e4, u.edgeWidth.mul(1.6)).mul(shape).mul(u.nodeGain);
      // Bubble skins: soft, wide membranes (well sampled at any step count) that give the cells volume.
      const d21 = sqrt(max(f2, 0)).sub(sqrt(max(f1, 0)));
      const skinE = gauss(d21, u.skinWidth).mul(shape).mul(u.skinGain);
      const coreE = gauss(r, u.coreRadius).mul(u.coreGain).mul(float(1).add(w1.x.mul(0.25)));
      // Corona: soft light just outside the bubble, something for the gravity veil to darken as it lifts.
      const rsph = length(p);
      const coronaE = o.bubble
        ? exp(max(rsph.sub(u.shellRadius), 0).div(u.coronaLength).negate())
            .mul(smoothstep(u.shellRadius.sub(u.shellWidth.mul(2)), u.shellRadius.add(u.shellWidth.mul(2)), rsph))
            .mul(u.coronaGain)
            .mul(float(1).add(w2.y.mul(0.3)))
        : float(0);
      // Depth tint: the first films the ray meets are blue-white, those seen through others sink to violet.
      const front = max(trans, 1e-4).pow(u.depthTint);
      const lit = mix(u.far, u.hot, front);
      const stepE = mix(u.deep, u.hot, 0.35).mul(hazeE).add(lit.mul(skinE)).add(mix(lit, u.core, 0.35).mul(edgeE)).add(u.core.mul(coreE.add(nodeE))).add(u.hot.mul(coronaE)).toVar();
      const stepSigma = hazeE.mul(0.5).add(skinE.mul(0.6)).add(coreE.mul(0.2)).mul(u.absorb).toVar();
      if (o.flicker) {
        // Colour charge: each cell carries red, green or blue, cycling as the charge is exchanged.
        const hue = fract(id1.mul(3).add(u.flickerPhase));
        const k = hue.mul(3);
        const wr = clamp(float(1).sub(k.sub(0.5).abs().mul(1.4)), 0, 1).add(clamp(float(1).sub(k.sub(3.5).abs().mul(1.4)), 0, 1));
        const wg = clamp(float(1).sub(k.sub(1.5).abs().mul(1.4)), 0, 1);
        const wb = clamp(float(1).sub(k.sub(2.5).abs().mul(1.4)), 0, 1);
        charge.assign(u.colourR.mul(wr).add(u.colourG.mul(wg)).add(u.colourB.mul(wb)));
        // Strongest on the foam's edges and nodes, faint on the haze and corona.
        const structural = clamp(edgeE.add(nodeE).add(skinE).mul(3), 0, 1);
        stepE.assign(mix(stepE, charge.mul(luminance(stepE).mul(1.6)), u.flicker.mul(mix(float(0.25), float(1), structural))));
      }

      // Never skip an edge; if a ray runs along one, let the minimum step grow a little so it cannot stall
      // (stalled rays would show as dark cracks).
      const minEff = minW.mul(float(1).add(min(nearCount, 8).mul(0.5)));
      dtW.assign(clamp(e3.mul(0.5 * TRACE_SAFETY).mul(cellW), minEff, maxW));
      nearCount.assign(select(dtW.lessThanEqual(minEff.mul(1.001)), nearCount.add(1), float(0)));
      const dtL = dtW.div(u.radius); // local path length: brightness independent of world size
      col.addAssign(stepE.mul(trans).mul(dtL));
      trans.mulAssign(exp(stepSigma.mul(dtL).negate()));
      t.addAssign(dtW);
      If(trans.lessThan(0.015).or(t.greaterThan(t1)), () => {
        Break();
      });
    });
    if (o.bubble) layer(shellX.oc, shellX.tBack, shellX.amount, shellOn, mix(u.hot, u.core, 0.5), shellOn.mul(0.25), false);
    if (o.gravity) layer(veilX.oc, veilX.tBack, veilX.amount, veilOn, u.gravityGlow, veilOn.mul(u.gravityAbsorb), true);
    return vec4(col.mul(u.exposure), float(1).sub(trans));
  })();

  const mat = new MeshBasicNodeMaterial({ side: BackSide, depthTest: false, depthWrite: false });
  mat.colorNode = march;
  const mesh = new Mesh(new SphereGeometry(1, 48, 32), mat);
  mesh.frustumCulled = false;

  const target = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter });
  const qmat = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  qmat.vertexNode = vec4(positionGeometry.xy, 0, 1);
  qmat.colorNode = texture(target.texture, uv()).rgb;
  const quad = new Mesh(new PlaneGeometry(2, 2), qmat);
  quad.frustumCulled = false;
  quad.renderOrder = -10;

  return {
    mesh,
    quad,
    target,
    uniforms: u,
    setSize(w, h) {
      target.setSize(Math.max(1, Math.ceil(w * o.resolutionScale)), Math.max(1, Math.ceil(h * o.resolutionScale)));
    },
    sync() {
      mesh.position.copy(u.centre.value);
      mesh.scale.set(u.radius.value * 1.01, u.radius.value * 1.01, (u.radius.value * 1.01) / Math.max(u.zSquash.value, 1e-3));
    },
    dispose() {
      mesh.geometry.dispose();
      mat.dispose();
      quad.geometry.dispose();
      qmat.dispose();
      target.dispose();
    },
  };
}

/** Every art-directable foam setting, in world units where it matters, so looks can be blended. */
export interface FoamLook {
  /** World radius of the foam ball, and of the bounding ellipsoid (≥ foam; leaves room for the veil). */
  radius: number;
  bound: number;
  zSquash: number;
  /** Foam cells per world unit (1 / bubble size). */
  cellsWorld: number;
  warp: number;
  seedJitter: number;
  breathe: number;
  skin: number;
  skinWidth: number;
  edge: number;
  edgeWidth: number;
  node: number;
  haze: number;
  bubbling: number;
  edgeSoft: number;
  core: number;
  coreRadiusWorld: number;
  focusGain: number;
  focusRadius: number;
  absorb: number;
  /** Churn rate (phase units per second). */
  churn: number;
  exposure: number;
}

export function lerpLook(a: FoamLook, b: FoamLook, t: number, out: FoamLook): FoamLook {
  for (const k of Object.keys(a) as (keyof FoamLook)[]) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

/** Write a look into the volume's uniforms (centre in world units). */
export function applyLook(u: FoamUniforms, look: FoamLook, centre: Vector3): void {
  u.centre.value.copy(centre);
  u.radius.value = look.bound;
  u.zSquash.value = look.zSquash;
  u.foamExtent.value = Math.min(1, look.radius / look.bound);
  u.scale.value = look.cellsWorld * look.bound;
  u.warp.value = look.warp;
  u.seedJitter.value = look.seedJitter;
  u.breathe.value = look.breathe;
  u.skinGain.value = look.skin;
  u.skinWidth.value = look.skinWidth;
  u.edgeGain.value = look.edge;
  u.edgeWidth.value = look.edgeWidth;
  u.nodeGain.value = look.node;
  u.hazeGain.value = look.haze;
  u.bubbling.value = look.bubbling;
  u.edgeSoft.value = look.edgeSoft;
  u.coreGain.value = look.core;
  u.coreRadius.value = look.coreRadiusWorld / look.bound;
  u.focusGain.value = look.focusGain;
  u.focusRadius.value = look.focusRadius;
  u.absorb.value = look.absorb;
  u.exposure.value = look.exposure;
}

/**
 * Planck's final frame is inflation's first: a calm, centred, bright foam patch seen by the same camera.
 * Both scenes read these so the 'stretch' transition hands one over to the other seamlessly.
 */
export const FOAM_HANDOFF = {
  cameraDistance: 6.6,
  fov: 35,
  look: {
    radius: 1.3,
    bound: 1.4,
    zSquash: 1,
    cellsWorld: 1.9,
    warp: 0.25,
    seedJitter: 0.85,
    breathe: 0.08,
    skin: 0.5,
    skinWidth: 0.15,
    edge: 5,
    edgeWidth: 0.03,
    node: 20,
    haze: 0.5,
    bubbling: 0.4,
    edgeSoft: 0.6,
    core: 0.6,
    coreRadiusWorld: 0.55,
    focusGain: 0.4,
    focusRadius: 0.6,
    absorb: 1.0,
    churn: 0.25,
    exposure: 1,
  } satisfies FoamLook,
} as const;
