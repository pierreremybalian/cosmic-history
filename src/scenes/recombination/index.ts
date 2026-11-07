// recombination — the photon era and the release of the cosmic microwave background (HANDOFF §9.7). Anchor scene.
//
// Spans two chapters: `photon` (log, 20 min → 250 kyr) and `recombination` (linear, 250 → 380 kyr). `local`
// restarts at the boundary, so everything here is driven by the globals g (t, z, T) and the ionisation
// history: x_e(z) sets the fog's density, the Thomson transparency e^(−τ(z)) sets how much of the
// last-scattering shell shows through it. Beats (see photon.mdx / recombination.mdx):
//   photon 0.00–0.60  white-hot → blue-white opaque glow of nuclei, electrons and light (blackbody LUT of T);
//                     photons random-walk in short zig-zags (beat 0.32), specks of matter drift past
//   photon 0.45–1.00  acoustic shells expand through the fog and sweep the specks into fronts (beat 0.72)
//   photon 0.93       matter–radiation equality (~50 kyr): dark-matter wells deepen as cooler patches
//   rec    0.00–0.40  orange fog (≈3,600 K); Planck's pattern rises in the fog, blurred; Hα glints as atoms form
//   rec    0.45–0.85  fog thins (x_e), the last-scattering shell shows through (e^(−τ)), the pattern sharpens
//   rec    0.80–0.93  the colour map is laid down by a Planck-style ecliptic sweep (HUD colour bar from 0.8)
//   rec    0.68–1.00  the camera pulls back out of the shell (exits ≈ 0.86); ends calm on the full CMB sphere

import {
  InstancedBufferAttribute,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Sprite,
  Vector3,
  type MeshBasicNodeMaterial,
  type RenderTarget,
  type SpriteNodeMaterial,
  type WebGPURenderer,
} from 'three/webgpu';
import { ionizationFraction, transparency } from '../../physics/recombination.ts';
import { KYR_S, X_E_RESIDUAL } from '../../physics/constants.ts';
import { blackbodyRGB } from '../../physics/blackbody.ts';
import { EMISSION_LINES_NM, lineColor } from '../../shared/color.ts';
import { clamp01, easeInOutCubic, lerp, mulberry32, smoothstep } from '../../shared/math.ts';
import { chapterById } from '../../time/chapters.ts';
import { sceneRange } from '../sceneRange.ts';
import type { Globals } from '../../physics/cosmology.ts';
import type { CosmicScene, RenderContext } from '../types.ts';
import { loadCmb, type CmbMap } from './assets.ts';
import {
  createGlintMaterial,
  createGlintUniforms,
  createMoteMaterial,
  createMoteUniforms,
  createPhotonMaterial,
  createPhotonUniforms,
  createSkyMaterial,
  createSkyUniforms,
  type GlintUniforms,
  type MoteUniforms,
  type PhotonUniforms,
  type SkyUniforms,
} from './shaders.ts';

const photon = chapterById('photon')!;
const recomb = chapterById('recombination')!;

export const params = {
  /** Radius of the last-scattering shell, world units. */
  radius: 40,
  sphereSegments: [192, 128] as const,
  /** Fog mean free path at full ionisation, world units (sets how deep you see into the opaque fog). */
  meanFreePath: 2.4,
  /** Near-field density ∝ x_e^p (mean free path grows as electrons are captured). */
  nearPower: 2,
  /** March this many mean free paths (then the remainder is integrated analytically). */
  marchMfp: 3.5,
  /** Raymarch steps = quality.raymarchSteps × this, clamped. */
  stepsScale: 0.75,
  stepsMin: 24,
  stepsMax: 48,
  /** Transparency e^(−τ) → wall visibility: smoothstep(clear0, clear1, e^(−τ)). Completes by z ≈ 1100. */
  clear0: 0.004,
  clear1: 0.3,
  /** Glow brightness: intensity = intensityEnd · (T / tEndK)^intensityPower (∝ T⁴ in reality; compressed). */
  intensityEnd: 0.5,
  intensityPower: 0.2,
  hotBoost: 1.5,
  /** Fluctuation look (exaggerated, see note). Contrast: strong while the structure is fine (early), gentler as it grows and as the map takes over. */
  contrast: [2.6, 1.8] as const,
  saturate: 1.4,
  tempVar: 0.045,
  densVarBase: 0.35,
  densVarThin: 0.95,
  /** Primordial field box size, world units: grows over the photon era (structures grow). */
  boxEarly: 6,
  boxLate: 26,
  boxGrowth: 2,
  boxMid: 13,
  /** Plasma era (fades as the Planck pattern rises): stream speed (world units/s), elongation along the stream,
   *  fine-scale weight, incandescent sheets, warp, contrast, ringing rates (cycles per wave-clock unit). */
  plasmaUntilKyr: [200, 320] as const,
  streamSpeed: [0.12, 0.42] as const,
  stretch: 2.2,
  fineAmp: 0.75,
  ridge: 0.9,
  warp: 0.15,
  plasmaContrast: 2.1,
  /** Extra exposure while the plasma look is on: the fog stays incandescent through the whole era. */
  plasmaExposure: 1.7,
  plasmaVar: 1.15,
  ringMid: 1.4,
  ringFine: 3.1,
  driftSpeed: [0.0021, 0.0013, -0.0017] as const,
  /** Planck pattern in the fog: weight ramps between these times (kyr); blur in the fog (radians). */
  cmbFromKyr: 55,
  cmbToKyr: 300,
  blurFog: 0.09,
  /** Smallest angular blur (radians): keeps the final sphere free of sub-pixel speckle. */
  blurMin: 0.004,
  /** Acoustic shells. */
  shellCount: { low: 5, medium: 8, high: 10 },
  shellSpread: 4.5,
  /** Acoustic sources cluster this far ahead of the camera. */
  shellAhead: 5,
  waveRate: 0.09,
  waveRadius: 7,
  waveWidth: 0.06,
  waveGain: 1.5,
  /** Dark-matter wells: Ω_m range over which they deepen (equality at 0.5), amplitude. */
  dmOmega: [0.44, 0.68] as const,
  dmAmp: 1.6,
  dmScale: 0.35,
  /** Camera. */
  fovFog: 62,
  fovEnd: 48,
  yawStart: 0.5,
  swayAmp: 0.05,
  driftAmp: 0.22,
  pullStart: 0.68,
  pullEnd: 1.0,
  pullExp: 1.6,
  endDistance: 3.0, // × radius
  endElevation: 0.06, // rad
  orbitSpeed: 0.018, // rad/s once calm
  /** Reveal (recombination-chapter progress from t). */
  mapFrom: 0.8,
  mapTo: 0.93,
  /** The sweep starts this far (degrees of ecliptic longitude) before the Galactic Centre, the first view. */
  sweepLead: 150,
  scanGain: 0.35,
  cmbGain: 0.62,
  /** The fog sees the pattern blurred (less variance), so it gets more gain; matches the wall's look as it clears. */
  cmbFogGain: 1.7,
  /** Standard deviation of the blurred ΔT/300 µK seen in the fog (for brightness normalisation). */
  cmbBlurredStd: 0.25,
  mapGain: 0.52,
  redshiftDex: 0.1,
  rimFrom: 0.88,
  rimGain: 0.6,
  /** Hα glints. */
  glintCount: { low: 1200, medium: 2500, high: 5000 },
  glintShell: [1.2, 16] as const,
  glintSize: 0.06,
  /** Plasma motes (nuclei and electrons as faint specks; they ride the same stream): count, ball radius, size, gain. */
  moteCount: { low: 15000, medium: 40000, high: 70000 },
  moteRadius: 5,
  moteSize: 0.022,
  moteGain: 1.1,
  /** Photon random walk: count, shell, speed (world units/s), step = mean free path × this. */
  photonCount: { low: 60, medium: 100, high: 150 },
  photonTrail: 2,
  photonShell: [1.4, 5.5] as const,
  photonSpeed: 1.5,
  photonStep: 0.32,
  photonStepFree: 1.4,
  photonWidth: 0.02,
  photonGain: 2.6,
};

const FOG_NOTE =
  'Fog colour, cooling and clearing follow the computed temperature, free-electron fraction and Thomson optical depth; its structure, sound waves, particles and brightness are illustrative, and its fluctuations are hugely exaggerated (the real ones are a few parts in 100,000).';
const MAP_NOTE =
  'The sphere is the Planck 2018 SMICA map (ESA and the Planck Collaboration), colour mapped ±300 µK; the fog before it is a visual model driven by the computed temperature and free-electron fraction.';
const STANDIN_NOTE =
  'The Planck map could not be loaded, so the sphere shows a procedural stand-in with CMB-like statistics; the fog is a visual model driven by the computed temperature and free-electron fraction.';

/** Points uniform in volume between radii r0 and r1; w = random 0–1. */
function shellSeeds(n: number, [r0, r1]: readonly [number, number], seed: number): InstancedBufferAttribute {
  const rand = mulberry32(seed);
  const arr = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const u = rand() * 2 - 1;
    const ph = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = Math.cbrt(lerp(r0 ** 3, r1 ** 3, rand()));
    arr[i * 4] = s * Math.cos(ph) * r;
    arr[i * 4 + 1] = u * r;
    arr[i * 4 + 2] = s * Math.sin(ph) * r;
    arr[i * 4 + 3] = rand();
  }
  return new InstancedBufferAttribute(arr, 4);
}

// Ecliptic frame in Galactic coordinates (J2000; IAU): north ecliptic pole and the vernal equinox (λ = 0).
const DEG = Math.PI / 180;
const NEP_LB = [96.3843, 29.8114] as const;
const EQUINOX_LB = [96.3373, -60.1886] as const;
/** Galactic (l, b) in degrees → world direction (GC at −Z, NGP at +Y, l = 90° at −X; cmb_meta.json). */
function galToWorld([l, b]: readonly [number, number], out: Vector3): Vector3 {
  const xg = Math.cos(b * DEG) * Math.cos(l * DEG);
  const yg = Math.cos(b * DEG) * Math.sin(l * DEG);
  const zg = Math.sin(b * DEG);
  return out.set(-yg, zg, -xg);
}
const ECL_X = galToWorld(EQUINOX_LB, new Vector3());
const ECL_Z = galToWorld(NEP_LB, new Vector3());
const ECL_Y = new Vector3().crossVectors(ECL_Z, ECL_X).normalize();
const GC_WORLD = galToWorld([0, 0], new Vector3());
const LAMBDA_GC = Math.atan2(GC_WORLD.dot(ECL_Y), GC_WORLD.dot(ECL_X));

const LOG_T0 = Math.log10(photon.tStart);
const LOG_T1 = Math.log10(photon.tEnd);
const LOG_CMB0 = Math.log10(params.cmbFromKyr * KYR_S);
const LOG_CMB1 = Math.log10(params.cmbToKyr * KYR_S);
const LOG_PLASMA0 = Math.log10(params.plasmaUntilKyr[0] * KYR_S);
const LOG_PLASMA1 = Math.log10(params.plasmaUntilKyr[1] * KYR_S);
const T_END_K = 2932; // only a normalisation for brightness (≈ T at the chapter end; brightness ∝ (T/T_END)^p)

export default (): CosmicScene => {
  let renderer: WebGPURenderer;
  let scene: Scene;
  let camera: PerspectiveCamera;
  let sky: Mesh;
  let skyMat: MeshBasicNodeMaterial;
  let glints: Sprite;
  let glintMat: SpriteNodeMaterial;
  let glintSeeds: InstancedBufferAttribute;
  let photons: Mesh;
  let photonMat: MeshBasicNodeMaterial;
  let photonSeeds: InstancedBufferAttribute;
  let cmb: CmbMap | null = null;
  const su: SkyUniforms = createSkyUniforms();
  const gu: GlintUniforms = createGlintUniforms();
  const pu: PhotonUniforms = createPhotonUniforms();
  const mu: MoteUniforms = createMoteUniforms();
  let motes: Sprite;
  let moteMat: SpriteNodeMaterial;
  let moteClock = 0;
  let stream = 0;
  let photonClock = 0;
  const rgb: [number, number, number] = [0, 0, 0];
  let waveClock = 0;
  let glintClock = 0;
  let orbit = 0;
  const drift = [0, 0, 0];

  const self: CosmicScene = {
    id: 'recombination',
    range: sceneRange('recombination'),
    accuracy: 'measured',
    accuracyNote: FOG_NOTE,
    colourMapped: false,

    async init(ctx: RenderContext) {
      renderer = ctx.renderer;
      await ctx.field.ready;
      cmb = await loadCmb(ctx);
      scene = new Scene();
      camera = new PerspectiveCamera(params.fovFog, 1, 0.05, params.radius * 12);

      const steps = Math.round(
        Math.min(params.stepsMax, Math.max(params.stepsMin, ctx.quality.raymarchSteps * params.stepsScale)),
      );
      skyMat = createSkyMaterial(
        {
          lut: ctx.globals.lut,
          field: ctx.field.textures().density,
          disp: ctx.field.textures().displacement,
          cmb: cmb.texture,
          convention: cmb.convention,
          radius: params.radius,
          steps,
          shellCount: params.shellCount[ctx.quality.name],
          shellSpread: params.shellSpread,
          dmScale: params.dmScale,
        },
        su,
      );
      sky = new Mesh(new SphereGeometry(params.radius, params.sphereSegments[0], params.sphereSegments[1]), skyMat);
      sky.frustumCulled = false;
      scene.add(sky);

      // Hα glints and photons in shells around the observer.
      const nG = params.glintCount[ctx.quality.name];
      glintSeeds = shellSeeds(nG, params.glintShell, 1135);
      const ha = lineColor(EMISSION_LINES_NM.hAlpha);
      gu.colour.value.set(ha.x, ha.y, ha.z);
      glintMat = createGlintMaterial(gu, glintSeeds, params.glintSize);
      glints = new Sprite(glintMat);
      glints.count = nG;
      glints.frustumCulled = false;
      glints.renderOrder = 1;
      scene.add(glints);

      const nM = params.moteCount[ctx.quality.name];
      moteMat = createMoteMaterial(mu, shellSeeds(nM, [0, params.moteRadius], 1201), {
        shellCount: params.shellCount[ctx.quality.name],
        shellSpread: params.shellSpread,
        radius: params.moteRadius,
      });
      motes = new Sprite(moteMat);
      motes.count = nM;
      motes.frustumCulled = false;
      motes.renderOrder = 1;
      scene.add(motes);

      const nP = params.photonCount[ctx.quality.name];
      const M = params.photonTrail;
      const homes = shellSeeds(nP, params.photonShell, 1090).array as Float32Array;
      const segs = new Float32Array(nP * M * 4);
      for (let i = 0; i < nP; i++)
        for (let m = 0; m < M; m++) {
          const o = (i * M + m) * 4;
          segs[o] = homes[i * 4]!;
          segs[o + 1] = homes[i * 4 + 1]!;
          segs[o + 2] = homes[i * 4 + 2]!;
          segs[o + 3] = m + Math.min(homes[i * 4 + 3]!, 0.999);
        }
      photonSeeds = new InstancedBufferAttribute(segs, 4);
      photonMat = createPhotonMaterial(pu, photonSeeds, M);
      photons = new Mesh(new PlaneGeometry(1, 1), photonMat);
      photons.count = nP * M;
      photons.frustumCulled = false;
      photons.renderOrder = 2;
      scene.add(photons);

      await renderer.compileAsync(scene, camera);
    },

    update(_local: number, g: Globals, dt: number, elapsed: number) {
      const P = params;
      const R = P.radius;
      // Scene clocks from g (local restarts at the photon → recombination boundary).
      const logt = g.log10t;
      const sPh = clamp01((logt - LOG_T0) / (LOG_T1 - LOG_T0));
      const uRec = clamp01((g.t - recomb.tStart) / (recomb.tEnd - recomb.tStart));
      const xe = ionizationFraction(g.z);
      const tr = transparency(g.z);
      const clear = smoothstep(P.clear0, P.clear1, tr);
      const thin = smoothstep(0, 1, (1 - xe) / (1 - 0.5)); // 0 while fully ionised → 1 at x_e = 0.5

      // Fog extinction: near field from x_e, far field such that the shell's visibility = clear.
      const sigmaNear = Math.pow(Math.max(xe, X_E_RESIDUAL), P.nearPower) / P.meanFreePath;
      const sigmaWall = clear >= 1 ? 0 : -Math.log(Math.max(clear, 1e-9)) / R;
      const sigma = Math.min(sigmaNear, sigmaWall);
      su.sigma.value = sigma;
      su.fogOn.value = sigma * R > 0.002 ? 1 : 0;
      su.marchMax.value = Math.min(2 * R, P.marchMfp / Math.max(sigma, 1e-6));
      su.densVar.value = lerp(P.densVarBase, P.densVarThin, thin);

      // Colour map laid down by a Planck-style sweep over [mapFrom, mapTo]; meanwhile the physical glow (blackbody
      // LUT of T) reddens and dims slightly, as the freed light starts its long redshift toward microwaves.
      const sweepP = clamp01((uRec - P.mapFrom) / (P.mapTo - P.mapFrom));
      const mapMix = uRec >= P.mapFrom ? 1 : 0;
      su.sweep.value = sweepP * Math.PI * 2;
      su.scanGain.value = P.scanGain;
      const redshift = smoothstep(P.mapFrom, P.mapTo + 0.02, uRec);
      su.logT.value = Math.log10(g.T) - P.redshiftDex * redshift;
      // White-hot at the start: an extra exposure boost that fades over the first third of the era.
      const hot = 1 + P.hotBoost * (1 - smoothstep(0, 0.35, sPh));
      su.intensity.value =
        P.intensityEnd * Math.pow(Math.max(g.T, 1) / T_END_K, P.intensityPower) * hot * lerp(1, P.plasmaExposure, 1 - smoothstep(LOG_PLASMA0, LOG_PLASMA1, logt));
      su.physGain.value = 1 - 0.25 * redshift;
      su.mapMix.value = mapMix;
      su.cmbGain.value = P.cmbGain;
      su.cmbFogGain.value = P.cmbFogGain;
      su.mapGain.value = P.mapGain;
      const contrast = lerp(P.contrast[1], P.plasmaContrast, 1 - smoothstep(LOG_PLASMA0, LOG_PLASMA1, logt)); // = plasma
      su.contrast.value = contrast;
      su.tempVar.value = P.tempVar;
      su.saturate.value = P.saturate;

      // Fluctuation sources.
      const cmbW = smoothstep(LOG_CMB0, LOG_CMB1, logt);
      su.cmbW.value = cmbW;
      const noiseW = (1 - 0.8 * cmbW) * (1 - 0.8 * clear);
      su.noiseW.value = noiseW;
      // Log-normal mean of the integrated emission: subtract ½c²·var(δ) so brightness tracks `intensity` as the
      // fluctuation sources change (field noise fading, Planck pattern rising).
      const cmbStd = P.cmbFogGain * P.cmbBlurredStd * cmbW;
      su.norm.value = 0.5 * contrast * contrast * (P.plasmaVar * noiseW * noiseW + cmbStd * cmbStd);
      su.eclX.value.copy(ECL_X);
      su.eclY.value.copy(ECL_Y);
      su.sweepStart.value = LAMBDA_GC - P.sweepLead * DEG;
      // Plasma look: true emission–absorption, streaming, stretched, ringing; hands over to the averaged
      // recombination look across the chapter boundary (200 → 320 kyr) while the Planck pattern rises.
      const plasma = 1 - smoothstep(LOG_PLASMA0, LOG_PLASMA1, logt);
      su.plasma.value = plasma;
      su.stretch.value = lerp(1, P.stretch, plasma);
      su.fineAmp.value = P.fineAmp;
      su.ridge.value = P.ridge * plasma;
      su.warp.value = P.warp;
      stream += dt * lerp(P.streamSpeed[0], P.streamSpeed[1], plasma) * (1 - clear);
      su.flowZ.value = stream;
      su.blur.value = P.blurFog * Math.pow(1 - clear, 1.5) + P.blurMin;
      // Structures stay fine through most of the era and grow toward the recombination look at the end.
      const boxPl = P.boxEarly * Math.pow(P.boxMid / P.boxEarly, Math.pow(sPh, P.boxGrowth));
      const box = lerp(P.boxLate, boxPl, plasma);
      su.freq.value = 1 / box;
      const grow = box / P.boxLate;
      for (let k = 0; k < 3; k++) drift[k]! += dt * P.driftSpeed[k]!;
      su.drift.value.set(drift[0]!, drift[1]!, drift[2]!);
      // Sound speed collapses as photons decouple from baryons: shells slow and freeze.
      waveClock += dt * P.waveRate * xe * xe * (1 - clear);
      su.waveClock.value = waveClock;
      const phM = waveClock * P.ringMid * Math.PI * 2;
      const phF = waveClock * P.ringFine * Math.PI * 2;
      su.osc.value.set(Math.cos(phM), Math.sin(phM), Math.cos(phF), Math.sin(phF));
      su.waveAmp.value = P.waveGain * (0.2 + 0.8 * smoothstep(0.45, 0.7, sPh)) * (1 - 0.6 * smoothstep(0.85, 1, sPh)) * (1 - smoothstep(0.1, 0.5, uRec));
      su.waveR.value = P.waveRadius * (0.55 + 0.45 * grow);
      su.waveW.value = P.waveWidth * (0.6 + 0.4 * grow);
      su.dm.value = P.dmAmp * smoothstep(P.dmOmega[0], P.dmOmega[1], g.omega.matter) * (1 - 0.85 * cmbW);
      su.rim.value = P.rimGain * smoothstep(P.rimFrom, 1, uRec);

      // Hα glints: normalised recombination rate dx_e/dz (tanh model peaks at 1/(2w)).
      const dz = 4;
      const rate = (ionizationFraction(g.z + dz) - ionizationFraction(g.z - dz)) / (2 * dz);
      const rateNorm = clamp01(rate * 2 * 80);
      gu.amount.value = Math.sqrt(rateNorm) * 0.6 * (1 - smoothstep(0.72, 0.86, uRec)) * (uRec > 0 ? 1 : 0);
      gu.sigma.value = sigma;
      glintClock += dt;
      gu.clock.value = glintClock;

      // Photons: step = mean free path (∝ 1/x_e², × the clearing), constant speed; they fade once free.
      const mfp = 1 / Math.max(sigma, 1e-6);
      const step = Math.min(P.photonStepFree, P.photonStep * Math.min(mfp / P.meanFreePath, 1e3));
      photonClock += (dt * P.photonSpeed) / step;
      pu.clock.value = photonClock;
      pu.step.value = step;
      pu.width.value = P.photonWidth;
      pu.sigma.value = sigma;
      const pcol = blackbodyRGB(g.T, rgb);
      // Most visible around the "light can't get far" beat; their steps lengthen as the fog thins, then they fade.
      const pVis = 0.3 + 0.7 * smoothstep(0.08, 0.22, sPh) * (1 - smoothstep(0.5, 0.65, sPh));
      const pI = su.intensity.value * P.photonGain * pVis * (1 - smoothstep(0.5, 0.75, uRec));
      pu.colour.value.set(pcol[0] * pI, pcol[1] * pI, pcol[2] * pI);
      pu.amount.value = 1;

      // Motes: blackbody colour, fade as the fog clears (atoms are neutral) and stream slowly past.
      moteClock += dt;
      mu.clock.value = moteClock;
      mu.flow.value = stream;
      mu.sigma.value = sigma;
      mu.size.value = P.moteSize;
      mu.waveClock.value = waveClock;
      mu.waveAmp.value = clamp01(su.waveAmp.value / P.waveGain) * 1.0;
      mu.waveR.value = su.waveR.value;
      mu.waveW.value = su.waveW.value * 4;
      const mI = su.intensity.value * P.moteGain * (1 - smoothstep(0.45, 0.8, uRec));
      mu.colour.value.set(rgb[0] * mI, rgb[1] * mI, rgb[2] * mI);

      // Camera: at the centre of the shell while the fog lasts, slowly turning; then a pull-back out of it.
      const sceneP = 0.5 * sPh + 0.5 * uRec;
      const calmFog = 1 - smoothstep(0.55, 0.72, uRec);
      const yaw = P.yawStart * (1 - smoothstep(0, 0.78, sceneP)) + P.swayAmp * calmFog * Math.sin(elapsed * 0.07);
      const pitch = 0.08 * (1 - smoothstep(0.2, 0.78, sceneP)) + P.swayAmp * 0.6 * calmFog * Math.sin(elapsed * 0.051 + 1.3);
      // Pull-back: exponential in an eased parameter, so it creeps away from the centre while the map develops,
      // leaves the shell around rec 0.89 and settles (ease-out) on the full sphere at the chapter end.
      const pull = easeInOutCubic(clamp01((uRec - P.pullStart) / (P.pullEnd - P.pullStart)));
      const pullCurve = (Math.exp(P.pullExp * pull) - 1) / (Math.exp(P.pullExp) - 1);
      const dist = pullCurve * P.endDistance * R;
      if (uRec > 0.9) orbit += dt * P.orbitSpeed * smoothstep(0.9, 1, uRec);
      const elev = P.endElevation * pullCurve;
      const ox = P.driftAmp * calmFog * Math.sin(elapsed * 0.043);
      const oy = P.driftAmp * calmFog * Math.sin(elapsed * 0.037 + 2.1);
      // Position: orbit around Y at distance `dist`, looking at the centre (or along yaw/pitch inside).
      const ca = Math.cos(orbit);
      const sa = Math.sin(orbit);
      const px = sa * Math.cos(elev) * dist + ox;
      const py = Math.sin(elev) * dist + oy;
      const pz = ca * Math.cos(elev) * dist;
      camera.position.set(px, py, pz);
      // Forward: −Z rotated by yaw/pitch (inside) and by the orbit (outside); blends naturally as yaw → 0.
      const fx = -Math.sin(yaw + orbit) * Math.cos(pitch - elev);
      const fy = Math.sin(pitch - elev);
      const fz = -Math.cos(yaw + orbit) * Math.cos(pitch - elev);
      camera.lookAt(px + fx, py + fy, pz + fz);
      su.shellOrigin.value.set(px + fx * P.shellAhead, py + fy * P.shellAhead, pz + fz * P.shellAhead);
      mu.shellOrigin.value.copy(su.shellOrigin.value);
      const fov = lerp(P.fovFog, P.fovEnd, pullCurve);
      if (Math.abs(camera.fov - fov) > 1e-4) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }

      // Colour map shown (from the first sweep frame) → label it and credit Planck (§13.4, §13.5).
      const mapped = sweepP > 0;
      if (mapped !== self.colourMapped) {
        self.colourMapped = mapped;
        self.accuracyNote = mapped ? (cmb?.real === false ? STANDIN_NOTE : MAP_NOTE) : FOG_NOTE;
      }
    },

    render(target: RenderTarget) {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    },

    resize(width: number, height: number) {
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    },

    dispose() {
      sky?.geometry.dispose();
      skyMat?.dispose();
      glintMat?.dispose();
      photons?.geometry.dispose();
      photonMat?.dispose();
      moteMat?.dispose();
      cmb?.release();
      cmb = null;
    },
  };
  return self;
};
