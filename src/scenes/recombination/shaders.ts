// TSL for the recombination scene: one raymarched material on the inside of the sky sphere.
//
// The camera sits in an emissive, scattering fog (thermal equilibrium: in the opaque limit you see the source
// function S, so brightness does not depend on how thick the fog is, only on S). S is the blackbody colour of
// the local temperature; its fluctuations come from (a) the shared primordial field (inflation's ζ, same
// universe as every structure scene), (b) expanding acoustic shells, (c) dark-matter wells after equality
// (cooler, Sachs–Wolfe) and (d) the Planck map itself, sampled by direction from the sphere centre. As the
// fog clears, (d) takes over and the sphere wall at radius R — the last-scattering surface — carries exactly
// the same pattern, so the reveal is continuous by construction.

import {
  AdditiveBlending,
  BackSide,
  MeshBasicNodeMaterial,
  SpriteNodeMaterial,
  Vector3,
  Vector4,
  type Data3DTexture,
  type DataTexture,
  type InstancedBufferAttribute,
  type Texture,
} from 'three/webgpu';
import {
  Fn,
  If,
  Loop,
  abs,
  asin,
  atan,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  dFdx,
  dFdy,
  dot,
  exp,
  float,
  floor,
  fract,
  hash,
  instancedBufferAttribute,
  length,
  max,
  min,
  mix,
  normalize,
  positionGeometry,
  positionWorld,
  pow,
  round,
  screenCoordinate,
  sin,
  smoothstep,
  sqrt,
  step,
  texture,
  texture3D,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { blackbodyNode } from '../../render/globals.ts';
import { cmbColorNode } from '../../shared/color.ts';
import type { CmbConvention } from './assets.ts';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

const _mkF = () => uniform(0);
const _mkV3 = () => uniform(new Vector3());
const _mkV4 = () => uniform(new Vector4());
type FU = ReturnType<typeof _mkF>;
type V3U = ReturnType<typeof _mkV3>;
type V4U = ReturnType<typeof _mkV4>;

/** Everything the CPU drives each frame. Values come from src/physics via index.ts (§13.2). */
export interface SkyUniforms {
  /** Mean fog extinction, 1/world unit. */
  sigma: FU;
  /** 1 while there is any fog to march (uniform branch), else 0. */
  fogOn: FU;
  /** Distance over which the fog is marched (≈ several mean free paths, capped at the sphere). */
  marchMax: FU;
  /** Density contrast of the fog (wisps as it thins). */
  densVar: FU;
  /** log10 of the colour temperature (photon T, minus the reveal's redshift). */
  logT: FU;
  /** HDR brightness of the glow. */
  intensity: FU;
  /** Brightness contrast of fluctuations (exaggerated, stated in the note). */
  contrast: FU;
  /** Colour-temperature swing of fluctuations, dex per unit fluctuation. */
  tempVar: FU;
  /** Extra saturation of the dim parts of the glow. */
  saturate: FU;
  /** Weight of the primordial-field churn. */
  noiseW: FU;
  /** Weight of the Planck pattern in the fog. */
  cmbW: FU;
  /** Angular blur of the Planck pattern, radians (diffusion-damped look in the fog → sharp when clear). */
  blur: FU;
  /** Plasma-era look (1) → recombination-era look (0): integration mode, stream, stretch. */
  plasma: FU;
  /** Stream offset along +Z (world units) and elongation of the structure along the stream. */
  flowZ: FU;
  stretch: FU;
  /** Acoustic ringing phases: (cos φ_mid, sin φ_mid, cos φ_fine, sin φ_fine). */
  osc: V4U;
  fineAmp: FU;
  ridge: FU;
  warp: FU;
  /** Log-normalisation of the integrated emission (keeps the mean ≈ intensity). */
  norm: FU;
  /** Primordial field sampling frequency (field boxes per world unit) and drift. */
  freq: FU;
  drift: V3U;
  /** Acoustic shells: clock, amplitude, max radius, shell width. */
  waveClock: FU;
  waveAmp: FU;
  waveR: FU;
  waveW: FU;
  /** Where the acoustic sources cluster (ahead of the camera). */
  shellOrigin: V3U;
  /** Dark-matter wells (Sachs–Wolfe cooling) amount. */
  dm: FU;
  /** 0 = physical blackbody glow, 1 = colour-mapped ΔT (Planck). */
  mapMix: FU;
  /** ΔT (±300 µK units) → fluctuation units for the physical glow on the sharp wall, and in the blurred fog. */
  cmbGain: FU;
  cmbFogGain: FU;
  /** Planck-style sweep: ecliptic x/y axes in world space, start longitude and swept angle (radians). */
  eclX: V3U;
  eclY: V3U;
  sweepStart: FU;
  sweep: FU;
  scanGain: FU;
  /** Brightness of the colour-mapped sphere. */
  mapGain: FU;
  /** Brightness multiplier of the physical (blackbody) wall as it redshifts away. */
  physGain: FU;
  /** Limb glow of the sphere seen from outside. */
  rim: FU;
}

export function createSkyUniforms(): SkyUniforms {
  return {
    sigma: uniform(0.4),
    fogOn: uniform(1),
    marchMax: uniform(15),
    densVar: uniform(0.35),
    logT: uniform(4),
    intensity: uniform(1),
    contrast: uniform(0.3),
    tempVar: uniform(0.03),
    saturate: uniform(0.5),
    noiseW: uniform(1),
    cmbW: uniform(0),
    blur: uniform(0.05),
    plasma: uniform(1),
    flowZ: uniform(0),
    stretch: uniform(1.8),
    osc: uniform(new Vector4(1, 0, 1, 0)),
    fineAmp: uniform(0.6),
    ridge: uniform(0.8),
    warp: uniform(0.08),
    norm: uniform(0.5),
    freq: uniform(1 / 24),
    drift: uniform(new Vector3()),
    waveClock: uniform(0),
    waveAmp: uniform(0),
    waveR: uniform(10),
    waveW: uniform(0.6),
    shellOrigin: uniform(new Vector3(0, 0, -5)),
    dm: uniform(0),
    mapMix: uniform(0),
    cmbGain: uniform(0.62),
    cmbFogGain: uniform(1.6),
    eclX: uniform(new Vector3(1, 0, 0)),
    eclY: uniform(new Vector3(0, 0, -1)),
    sweepStart: uniform(0),
    sweep: uniform(0),
    scanGain: uniform(0.6),
    mapGain: uniform(0.6),
    physGain: uniform(1),
    rim: uniform(0),
  };
}

export interface SkyOptions {
  lut: DataTexture;
  field: Data3DTexture;
  /** Shared field displacement ψ (RGBA16F, xyz = ψ/σψ): a smooth vector field for warping and ringing. */
  disp: Data3DTexture;
  cmb: Texture;
  convention: CmbConvention;
  radius: number;
  steps: number;
  /** Number of acoustic shells alive at once, and the half-size of the cube their centres are drawn from. */
  shellCount: number;
  shellSpread: number;
  /** Fraction of the field channel used for DM wells (B = smoothed δ). */
  dmScale: number;
}

/** World direction → Galactic equirect UV (cmb_meta.json): GC at world −Z, NGP at +Y, l = 90° at −X. */
function dirToUvRaw(d: V3, conv: CmbConvention): Node<'vec2'> {
  const xg = d.z.negate();
  const yg = d.x.negate();
  const zg = d.y;
  const l = atan(yg, xg); // radians, (−π, π]
  const b = asin(clamp(zg, -1, 1));
  const u = float(conv.uAtLon0).sub(l.mul(conv.lonSign / (2 * Math.PI)));
  return vec2(u, b.div(Math.PI).add(0.5));
}

export function createSkyMaterial(o: SkyOptions, u: SkyUniforms): MeshBasicNodeMaterial {
  const R = o.radius;
  const lutCol = (lt: F): V3 => blackbodyNode(o.lut, lt) as unknown as V3;
  const cmbTex = o.cmb;
  const decodeScale = 2; // s ∈ [0,1] → t = 2s − 1 = ΔT / 300 µK (symmetric range; cmb_meta.json)

  const shade = Fn(() => {
    const ro = cameraPosition;
    const rd = normalize(positionWorld.sub(ro));

    // Ray vs sphere at the origin: we are on its back face, so the exit is always valid.
    const bq = dot(ro, rd);
    const cq = dot(ro, ro).sub(R * R);
    const h = sqrt(max(bq.mul(bq).sub(cq), 0));
    const tEnterRaw = bq.negate().sub(h);
    const tEnter = max(tEnterRaw, 0);
    const tExit = bq.negate().add(h);
    const pExit = ro.add(rd.mul(tExit));
    const dirW = pExit.div(R);

    // ── Planck ΔT on the last-scattering sphere, with a controllable angular blur. Explicit gradients with the
    // longitude seam unwrapped, so no mip seam at l = 180° and derivatives stay in uniform control flow.
    const uvRaw = dirToUvRaw(dirW, o.convention);
    const gx0 = dFdx(uvRaw);
    const gy0 = dFdy(uvRaw);
    const gx = vec2(gx0.x.sub(round(gx0.x)), gx0.y);
    const gy = vec2(gy0.x.sub(round(gy0.x)), gy0.y);
    // Footprint in radians on the sphere (texels are square in angle: 2π per u, π per v).
    const fx = length(vec2(gx.x.mul(2 * Math.PI), gx.y.mul(Math.PI)));
    const fy = length(vec2(gy.x.mul(2 * Math.PI), gy.y.mul(Math.PI)));
    const blurScale = max(float(1), u.blur.div(max(max(fx, fy), 1e-6)));
    const uvW = vec2(fract(uvRaw.x), uvRaw.y);
    const s = texture(cmbTex, uvW).grad(gx.mul(blurScale), gy.mul(blurScale)).r;
    const dT = s.mul(decodeScale).sub(1); // ΔT / 300 µK

    // ── Colour of the glow: blackbody at the mean temperature, linearised around it for local fluctuations.
    const col0 = lutCol(u.logT);
    const col1 = lutCol(u.logT.add(0.1));
    const dCol = col1.sub(col0).mul(10); // per dex
    // Brightness is exponential in the fluctuation so the glow keeps deep, luminous structure; dim regions are
    // more saturated (cooler, deeper light), bright cores bleach toward white — the Rayleigh-ish look of a glow.
    const glow = (delta: F): V3 => {
      const c = max(col0.add(dCol.mul(delta.mul(u.tempVar))), vec3(0));
      const e = exp(delta.mul(u.contrast).sub(u.contrast.mul(u.contrast).mul(0.05)));
      const lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      const dim = float(1).sub(smoothstep(0.2, 1.4, e));
      const sat = mix(vec3(lum), c, float(1.15).add(u.saturate.mul(dim)));
      return max(sat, vec3(0)).mul(e);
    };

    const T = float(1).toVar();
    const wSum = float(0).toVar(); // opacity seen (Σ a)
    const dSum = float(0).toVar(); // Σ a·δ   (averaged look, recombination era)
    const eSum = float(0).toVar(); // Σ a·e   (integrated look, plasma era)
    const edSum = float(0).toVar(); // Σ a·e·δ (colour-temperature shift of the integrated look)
    const segLen = tExit.sub(tEnter);
    const cmbTerm = dT.mul(u.cmbW).mul(u.cmbFogGain);

    If(u.fogOn.greaterThan(0.5), () => {
      const marchLen = min(segLen, u.marchMax);
      const dt = marchLen.div(o.steps);
      const jitter = hash(screenCoordinate.x.add(screenCoordinate.y.mul(4093.17)));
      Loop(o.steps, ({ i }) => {
        const ts = tEnter.add(float(i).add(jitter).mul(dt));
        const p = ro.add(rd.mul(ts));
        // The plasma streams toward the camera (+Z) and is drawn out along the stream, so near layers slide past
        // with parallax and the structure converges on a vanishing point: radial depth, never a backdrop.
        const pf = p.sub(vec3(0, 0, u.flowZ));
        const qa = vec3(pf.x, pf.y, pf.z.div(u.stretch)).mul(u.freq).add(u.drift);
        // Shared primordial field: ψ (smooth displacement, each component σ ≈ 0.58) gives the broad variation and
        // warps the finer lookups, so the structure curls like turbulence; smoothed δ (B) at two scales gives the body.
        const psiA = texture3D(o.disp, qa.mul(0.45)).level(float(0)).xyz;
        const bm = texture3D(o.field, qa.add(psiA.mul(u.warp))).level(float(0)).b;
        const bf = texture3D(o.field, qa.mul(2.1).add(psiA.mul(u.warp.mul(2))).add(vec3(0.31, 0.17, 0.59))).level(float(0)).b;
        // Acoustic ringing: the body oscillates between the two scales' patterns (cos/sin of a phase that runs with
        // the sound speed and freezes at decoupling), so the texture keeps re-forming like a ringing medium.
        const nRing = bm.mul(u.osc.x).add(bf.mul(u.osc.y));
        const n = psiA.x.mul(1.7 * 0.35).add(nRing.mul(0.8)).add(bf.mul(u.fineAmp).mul(0.35));
        // Thin incandescent sheets where the ringing field crosses zero.
        const sheet = pow(clamp(float(1).sub(abs(nRing).mul(0.9)), 0, 1), 4);
        // Dark-matter wells: smoothed δ (B), only where it is overdense; photons climbing out look cooler.
        const dmf = texture3D(o.field, qa.mul(o.dmScale).add(vec3(0.5, 0.21, 0.73))).level(float(0)).b;
        const well = smoothstep(0.4, 2.0, dmf);
        const delta = n.add(sheet.mul(u.ridge)).mul(u.noiseW).sub(well.mul(u.dm)).add(cmbTerm);
        const dens = u.sigma.mul(max(n.add(sheet.mul(u.ridge).mul(1.5)).mul(u.densVar).add(1), 0.04));
        const a = float(1).sub(exp(dens.mul(dt).negate())).mul(T);
        const e = exp(delta.mul(u.contrast).sub(u.norm));
        wSum.addAssign(a);
        dSum.addAssign(a.mul(delta));
        eSum.addAssign(a.mul(e));
        edSum.addAssign(a.mul(e).mul(delta));
        T.subAssign(a);
      });
      // Fog beyond the marched span (only when it is thick): mean density, mean emission.
      const rest = max(segLen.sub(marchLen), 0);
      const aRest = float(1).sub(exp(u.sigma.mul(rest).negate())).mul(T);
      const eRest = exp(cmbTerm.mul(u.contrast).sub(u.norm));
      wSum.addAssign(aRest);
      dSum.addAssign(aRest.mul(cmbTerm));
      eSum.addAssign(aRest.mul(eRest));
      edSum.addAssign(aRest.mul(eRest).mul(cmbTerm));
      T.subAssign(aRest);
    });

    const fogDelta = dSum.div(max(wSum, 1e-4));
    // Plasma era: true emission–absorption along the ray (layers at every depth); recombination era: one glow of
    // the emission-weighted fluctuation (keeps the anisotropy contrast as the fog thins). Blended by `plasma`.
    const eMean = eSum.div(max(wSum, 1e-4));
    const cInt = max(col0.mul(eSum).add(dCol.mul(u.tempVar).mul(edSum)), vec3(0));
    const lumInt = dot(cInt, vec3(0.2126, 0.7152, 0.0722));
    const dimInt = float(1).sub(smoothstep(0.2, 1.4, eMean));
    const integrated = mix(vec3(lumInt), cInt, float(1.15).add(u.saturate.mul(dimInt)));
    const averaged = glow(fogDelta).mul(wSum);
    const L = max(mix(averaged, integrated, u.plasma), vec3(0)).mul(u.intensity).toVar();

    // ── Acoustic shells, integrated analytically along the ray (no sampling noise). Each overdensity launches a
    // spherical sound wave in the photon–baryon fluid; a thin luminous shell seen through the fog is brightest
    // where the ray grazes it (limb brightening). Shells respawn at hashed centres: stateless in the clock.
    let shells: F = float(0);
    for (let j = 0; j < o.shellCount; j++) {
      const hj = (j * 0.6180339887) % 1;
      const cyc = u.waveClock.mul(0.75 + 0.5 * hj).add((j * 0.37) % 1);
      const cy = floor(cyc);
      const ph = fract(cyc);
      const hs = cy.mul(17.31).add(j * 7.13);
      const centre = vec3(hash(hs), hash(hs.add(3.7)), hash(hs.add(8.1))).mul(2).sub(1).mul(o.shellSpread).add(u.shellOrigin);
      const r = ph.mul(u.waveR).mul(0.7 + 0.6 * ((j * 0.414) % 1));
      const w = u.waveW.mul(ph.mul(0.6).add(0.5));
      const env = smoothstep(0, 0.1, ph).mul(pow(float(1).sub(ph), 1.5));
      const oc = centre.sub(ro);
      const s0 = dot(oc, rd);
      const b2 = max(dot(oc, oc).sub(s0.mul(s0)), 0);
      const bb = sqrt(b2);
      // A short wave train: the front plus two weaker trailing ripples, all limb-brightened.
      let train: F = float(0);
      [1, 0.55, 0.3].forEach((amp, m) => {
        const rm = max(r.sub(u.waveR.mul(0.16 * m)), 0);
        const disc = rm.mul(rm).sub(b2);
        const sq = sqrt(max(disc, 0));
        const base = w.mul(rm).div(sqrt(max(disc, 0).add(rm.mul(w).mul(1.5)).add(1e-6)));
        const outer = max(bb.sub(rm), 0).div(w);
        const fall = exp(outer.mul(outer).negate());
        const sN = s0.sub(sq);
        const sF = s0.add(sq);
        const att = step(0, sN)
          .mul(exp(u.sigma.mul(max(sN, 0)).negate()))
          .add(step(0, sF).mul(exp(u.sigma.mul(max(sF, 0)).negate())));
        train = train.add(base.mul(fall).mul(att).mul(amp));
      });
      shells = shells.add(env.mul(train));
    }
    // Patchy: the fronts are brighter where the fog is denser, so they never read as clean geometric circles.
    L.addAssign(col0.mul(u.intensity).mul(shells).mul(u.waveAmp).mul(exp(fogDelta.mul(0.5)).mul(wSum)));

    // ── The wall: last-scattering surface. Physical glow → colour-mapped Planck ΔT.
    const phys = glow(dT.mul(u.cmbGain)).mul(u.intensity).mul(u.physGain);
    const mapped = cmbColorNode(dT).mul(u.mapGain);
    // "As Planck mapped it": the colour map is laid down by a great circle through the ecliptic poles sweeping
    // in ecliptic longitude, the way Planck's spin axis followed the Sun and scanned the sky ring by ring.
    const lam = atan(dot(dirW, u.eclY), dot(dirW, u.eclX)); // (−π, π]
    const swept = fract(lam.sub(u.sweepStart).div(2 * Math.PI)).mul(2 * Math.PI); // [0, 2π) from the start
    const edge = u.sweep.sub(swept);
    const mask = max(smoothstep(-0.05, 0.12, edge).mul(step(0.001, u.sweep)), step(6.28, u.sweep));
    const scan = exp(edge.mul(edge).mul(-900)).mul(step(0.001, u.sweep)).mul(float(1).sub(step(6.28, u.sweep)));
    const wall = mix(phys, mapped, mask.mul(u.mapMix)).add(vec3(0.9, 0.95, 1.0).mul(scan).mul(u.scanGain));
    L.addAssign(wall.mul(T));

    // ── Seen from outside: a soft limb so the shell reads as a sphere (the near half is see-through).
    const outside = smoothstep(R * 0.995, R * 1.02, length(ro));
    const nIn = normalize(ro.add(rd.mul(tEnterRaw)));
    const graze = clamp(float(1).sub(abs(dot(nIn, rd))), 0, 1);
    const limb = pow(graze, 6).mul(0.9).add(pow(graze, 2).mul(0.05));
    L.addAssign(vec3(0.85, 0.88, 1.0).mul(limb).mul(u.rim).mul(outside));
    return L;
  });

  const mat = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false });
  mat.colorNode = shade();
  return mat;
}

// ── Recombination glints ───────────────────────────────────────────────────────────────────────────────────
// Each new hydrogen atom cascades down its energy levels; the Balmer-α step emits a visible 656 nm photon.
// Glints twinkle at a rate set by the computed recombination rate and are dimmed by the fog in front of them.

export interface GlintUniforms {
  /** 0–1: normalised recombination rate × visibility. */
  amount: FU;
  /** Fog extinction (same as the sky) for attenuation. */
  sigma: FU;
  clock: FU;
  colour: V3U;
}

export function createGlintUniforms(): GlintUniforms {
  return { amount: uniform(0), sigma: uniform(0.4), clock: uniform(0), colour: uniform(new Vector3(1, 0.1, 0.05)) };
}

export function createGlintMaterial(u: GlintUniforms, seeds: InstancedBufferAttribute, size: number): SpriteNodeMaterial {
  const a = instancedBufferAttribute<'vec4'>(seeds, 'vec4'); // xyz = position, w = random 0–1
  const ph = fract(u.clock.mul(float(0.35).add(a.w.mul(0.5))).add(a.w.mul(17.13)));
  // A short flash once per cycle; only a fraction of seeds (set by the rate) flash at all.
  const on = step(a.w, u.amount);
  const flash = exp(ph.mul(ph).mul(-900)).add(exp(ph.mul(-38)).mul(0.25));
  const d = length(a.xyz.sub(cameraPosition));
  const atten = exp(u.sigma.mul(d).negate());
  const r = uv().sub(0.5).length().mul(2);
  const core = exp(r.mul(r).mul(-14)).add(exp(r.mul(-5)).mul(0.25));
  const mat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending });
  mat.positionNode = a.xyz;
  mat.scaleNode = float(size).mul(float(0.6).add(a.w.mul(0.8)));
  mat.colorNode = u.colour.mul(flash.mul(on).mul(atten).mul(core).mul(6));
  mat.opacityNode = float(1);
  return mat;
}

// ── Photons ──────────────────────────────────────────────────────────────────────────────────────────────
// Thomson scattering as a random walk: each photon flies a straight segment, scatters off an electron and
// leaves in a new random direction. Stateless: walk node n is a hashed point around the photon's home, so the
// path is a function of (seed, clock) only. Each photon is drawn as its last `trail` segments (one instance per
// segment, fading with age), so the zig-zag of repeated scattering is visible. Segment length = the mean free
// path (grows as x_e drops); when the fog clears the segments become long, straight flights: light streams free.

export interface PhotonUniforms {
  clock: FU;
  /** Step size (mean free path), world units. */
  step: FU;
  width: FU;
  amount: FU;
  sigma: FU;
  colour: V3U;
}

export function createPhotonUniforms(): PhotonUniforms {
  return {
    clock: uniform(0),
    step: uniform(0.4),
    width: uniform(0.02),
    amount: uniform(1),
    sigma: uniform(0.4),
    colour: uniform(new Vector3(1, 1, 1)),
  };
}

/** seeds: vec4 per instance — xyz home, w = segment index m (integer part) + random (fraction, shared by a photon). */
export function createPhotonMaterial(u: PhotonUniforms, seeds: InstancedBufferAttribute, trail: number): MeshBasicNodeMaterial {
  const sd = instancedBufferAttribute<'vec4'>(seeds, 'vec4');
  const m = floor(sd.w);
  const rnd = fract(sd.w);
  const clk = u.clock.mul(float(0.75).add(rnd.mul(0.5))).add(rnd.mul(97.0));
  const k = floor(clk);
  const f = fract(clk);
  const node = (nn: F): V3 =>
    sd.xyz.add(
      vec3(
        hash(nn.mul(1.37).add(rnd.mul(311.7))),
        hash(nn.mul(2.11).add(rnd.mul(173.3)).add(5.1)),
        hash(nn.mul(3.07).add(rnd.mul(97.1)).add(9.7)),
      )
        .mul(2)
        .sub(1)
        .mul(u.step),
    );
  const n0 = k.sub(m);
  const A = node(n0);
  const B = node(n0.add(1));
  const isHead = float(1).sub(step(0.5, m));
  const span = mix(float(1), f, isHead); // the newest segment is only partly flown
  const along = positionGeometry.x.add(0.5);
  const x = along.mul(span);
  const P = mix(A, B, x);
  const age = m.add(f).sub(x); // in segments
  const hv = cameraViewMatrix.mul(vec4(B, 1)).xyz;
  const av = cameraViewMatrix.mul(vec4(A, 1)).xyz;
  const pv0 = cameraViewMatrix.mul(vec4(P, 1)).xyz;
  const dir2 = hv.xy.sub(av.xy);
  const perp = normalize(vec2(dir2.y.negate(), dir2.x).add(vec2(1e-5, 0)));
  const depth = max(pv0.z.negate(), 0.05);
  const fade = clamp(float(1).sub(age.div(trail * 0.22)), 0, 1);
  const w = u.width.mul(float(1).add(depth.mul(0.25))).mul(fade.mul(0.6).add(0.4));
  const pv = pv0.add(vec3(perp.mul(positionGeometry.y.mul(w)), 0));

  const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending });
  mat.vertexNode = cameraProjectionMatrix.mul(vec4(pv, 1));
  // Fog in front dims it; the very near are faded so they never smear across the lens.
  const att = varying(exp(u.sigma.mul(depth).negate()).mul(smoothstep(0.6, 1.8, depth)).mul(pow(fade, 2.5)));
  // Soft glowing profile: a thin hot core inside a wide faint halo.
  const yy = uv().y.sub(0.5).mul(2);
  const prof = exp(yy.mul(yy).mul(-12)).add(exp(yy.mul(yy).mul(-3)).mul(0.25));
  mat.colorNode = u.colour.mul(prof.mul(att).mul(u.amount));
  mat.opacityNode = float(1);
  return mat;
}

// ── Plasma motes ─────────────────────────────────────────────────────────────────────────────────────────
// The fog's matter — nuclei and electrons — as countless faint glowing specks around the observer. They give the
// glow depth and parallax, and they carry the sound waves: each acoustic front sweeps the specks into a denser,
// brighter shell (stateless: displacement = f(seed, wave clock)). They fade as atoms form and the fog clears.

export interface MoteUniforms {
  amount: FU;
  sigma: FU;
  colour: V3U;
  size: FU;
  clock: FU;
  waveClock: FU;
  waveAmp: FU;
  waveR: FU;
  waveW: FU;
  /** Slow inflow toward the observer (world units) — the fog streaming past. */
  flow: FU;
  shellOrigin: V3U;
}

export function createMoteUniforms(): MoteUniforms {
  return {
    amount: uniform(1),
    sigma: uniform(0.4),
    colour: uniform(new Vector3(1, 1, 1)),
    size: uniform(0.03),
    clock: uniform(0),
    waveClock: uniform(0),
    waveAmp: uniform(0),
    waveR: uniform(7),
    waveW: uniform(0.4),
    flow: uniform(0),
    shellOrigin: uniform(new Vector3(0, 0, -5)),
  };
}

export function createMoteMaterial(
  u: MoteUniforms,
  seeds: InstancedBufferAttribute,
  o: { shellCount: number; shellSpread: number; radius: number },
): SpriteNodeMaterial {
  const sd = instancedBufferAttribute<'vec4'>(seeds, 'vec4'); // xyz in a ball of `radius`, w random
  const w = sd.w;
  // Thermal jitter + a slow drift through the observer (wrapped in the ball so the density stays uniform).
  const jit = vec3(
    sin(u.clock.mul(w.mul(3.1).add(1.3)).add(w.mul(40.1))),
    sin(u.clock.mul(w.mul(2.7).add(1.1)).add(w.mul(73.7))),
    sin(u.clock.mul(w.mul(3.7).add(0.9)).add(w.mul(19.3))),
  ).mul(0.06);
  const span = o.radius * 2;
  const z = fract(sd.z.add(u.flow).div(span).add(0.5)).sub(0.5).mul(span);
  const base = vec3(sd.x, sd.y, z).add(jit);
  // Acoustic fronts (same hashed centres and clock as the sky's shells): pull specks into the front.
  let disp: V3 = vec3(0);
  let dens: F = float(0);
  for (let j = 0; j < o.shellCount; j++) {
    const hj = (j * 0.6180339887) % 1;
    const cyc = u.waveClock.mul(0.75 + 0.5 * hj).add((j * 0.37) % 1);
    const cy = floor(cyc);
    const ph = fract(cyc);
    const hs = cy.mul(17.31).add(j * 7.13);
    const centre = vec3(hash(hs), hash(hs.add(3.7)), hash(hs.add(8.1))).mul(2).sub(1).mul(o.shellSpread).add(u.shellOrigin);
    const r = ph.mul(u.waveR).mul(0.7 + 0.6 * ((j * 0.414) % 1));
    const ww = u.waveW.mul(ph.mul(0.6).add(0.7));
    const env = smoothstep(0, 0.1, ph).mul(float(1).sub(ph));
    const dv = base.sub(centre);
    const d = length(dv).add(1e-4);
    const x = d.sub(r).div(ww);
    const g = exp(x.mul(x).negate()).mul(env);
    disp = disp.add(dv.div(d).mul(x.mul(g).mul(ww).mul(-0.9)));
    dens = dens.add(g);
  }
  const pos = base.add(disp.mul(u.waveAmp));
  const dCam = length(pos.sub(cameraPosition));
  const atten = exp(u.sigma.mul(dCam).negate()).mul(smoothstep(0.5, 1.3, dCam));
  const r2 = uv().sub(0.5).length().mul(2);
  const core = exp(r2.mul(r2).mul(-16));
  const mat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending });
  mat.positionNode = pos;
  mat.scaleNode = u.size.mul(float(0.5).add(w.mul(w).mul(1.2)));
  const bright = float(0.35).add(w.mul(0.65)).mul(float(1).add(dens.mul(u.waveAmp).mul(1.6)));
  mat.colorNode = u.colour.mul(core.mul(atten).mul(bright).mul(u.amount));
  mat.opacityNode = float(1);
  return mat;
}
