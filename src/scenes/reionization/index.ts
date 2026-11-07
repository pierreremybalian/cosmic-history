// Reionization, first galaxies, black holes (HANDOFF §9.10) · simulated (observed history + simulation look).
// The camera pulls back out of the first-stars cluster. Galaxies light up at the field's peaks as their halos
// collapse; around them, ionised bubbles (Strömgren-scaled spheres, smooth-unioned, ragged fronts) grow and merge
// through a raymarched neutral-hydrogen fog whose ionised volume fraction is calibrated every frame to the
// observed neutral fraction x_HI(z). A quasar ignites in the densest halo with a pair of jets and carves the biggest
// bubble. By the end the fog is gone and the web glows with starlight: a calm frame for cosmic noon.

import {
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Sprite,
  Vector3,
  Vector4,
  type MeshBasicNodeMaterial,
  type RenderTarget,
  type SpriteNodeMaterial,
  type WebGPURenderer,
} from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';
import type { CosmicScene, RenderContext } from '../types.ts';
import { globalsAt, type Globals } from '../../physics/cosmology.ts';
import { neutralFractionIGM } from '../../physics/recombination.ts';
import { EMISSION_LINES_NM, lineColor } from '../../shared/color.ts';
import { webAmplitude } from '../../shared/gaussianField.ts';
import { clamp01, mulberry32, smoothstep } from '../../shared/math.ts';
import { sceneRange } from '../sceneRange.ts';
import {
  HaloSeeds,
  ORDINAL,
  STRUCTURE,
  applyStructureCamera,
  collapseNu,
  createStructureWeb,
  fieldNodes,
  focusShift,
  ramp,
  hazeMaterial,
  type StructureWeb,
} from '../darkAges/structure.ts';
import { fogMaterial, galaxyMaterial, jetMaterial, quasarMaterial, type BubbleNodes } from './shaders.ts';

const params = {
  galaxies: {
    max: 240,
    radius: 4.4,
    /** A galaxy fades in from ν_c − onset to ν_c (spherical collapse at the current amplitude). */
    onset: 1.1,
    size: 0.24,
    peak: 3.2,
    /** Young, hot stars dominate the light of the first galaxies (≈ 25 000 K); older stars ≈ 6 000 K. */
    youngTempK: 25000,
    oldTempK: 6000,
  },
  bubbles: {
    count: 28,
    /** Ionising output ∝ (ν − floor)²; Strömgren radius ∝ output^(1/3) (Strömgren 1939). */
    nuFloor: 1.2,
    smooth: 0.45,
    rough: 0.13,
    minSeparation: 1.1,
    /** Calibration: Monte-Carlo points in the ball and table size over the radius scale s ∈ [0, sMax]. */
    samples: 4096,
    table: 128,
    sMax: 8,
  },
  fog: {
    /** Extinction per world unit at x_HI = 1 (≈ 70% veiled across the ball). */
    sigmaMax: 0.15,
    glow: 0.42,
    /** Neutral hydrogen haze, colour mapped (it emits nothing visible). */
    colour: [0.05, 0.11, 0.3] as [number, number, number],
    /** Front emission per perpendicular crossing, and the shell width (world units). */
    front: 0.0035,
    /** Front colour = Hα + Hβ / (Case B Balmer decrement 2.86, Osterbrock & Ferland 2006). */
    balmerDecrement: 2.86,
    frontWidth: 0.12,
    densityExponent: 0.35,
    stepFraction: 0.75,
    /** Cap: the fog is smooth apart from the fronts; 28 bubbles per step make steps expensive. */
    maxSteps: 52,
    /** The haze fades in during the transition from the first stars (beat 0.14 needs it). */
    fadeIn: 0.12,
  },
  quasar: {
    /** Beat 0.48. */
    ignite: 0.44,
    jetGrow: 0.09,
    fadeStart: 0.78,
    fadeEnd: 0.95,
    /** Accretion-disc temperature for a ~10⁹ M☉ black hole near Eddington: ≈ 5×10⁴ K (Shakura & Sunyaev 1973). */
    tempK: 5.0e4,
    size: 1.1,
    peak: 9,
    afterglow: 0.25,
    /** Extra bubble radius from the quasar's own UV (world units). */
    bubbleBoost: 1.1,
    /** Jets: ≈ 2.8 Mpc proper at z ≈ 7 — giant-radio-galaxy scale (most jets reach 0.1–1 Mpc, the largest ~5 Mpc). */
    jetLength: 1.5,
    jetWidth: 0.075,
    jetPeak: 1.0,
    /** Optical synchrotron jets look blue-white (e.g. M87 with HST); illustrative, not thermal. */
    jetColour: [0.45, 0.66, 1.0] as [number, number, number],
    axis: [0.28, 0.93, 0.22] as [number, number, number],
  },
  web: {
    /** Colour map → starlight tint (galaxies now light the web). */
    colourMapFade: [0.3, 0.85] as [number, number],
    brightness: [
      [0, 0.26],
      [0.4, 0.28],
      [1, 0.3],
    ] as [number, number][],
    /** Starlight tint once the colour map has faded. */
    tint: [0.98, 0.9, 0.8] as [number, number, number],
    contrast: [
      [0, 0.72],
      [1, 1.05],
    ] as [number, number][],
    size: [
      [0, 0.55],
      [1, 0.62],
    ] as [number, number][],
  },
  haze: {
    brightness: [
      [0, 0.024],
      [0.25, 0.004],
      [0.5, 0],
    ] as [number, number][],
    stepFraction: 0.5,
  },
};

export default (): CosmicScene => {
  let renderer: WebGPURenderer;
  let scene: Scene;
  let camera: PerspectiveCamera;
  let web: StructureWeb;
  let haze: Mesh;
  let fog: Mesh;
  let jets: Mesh;
  let galaxySprite: Sprite;
  let quasar: Sprite;
  let seeds: HaloSeeds;
  let field: RenderContext['field'];
  const gp = params.galaxies;
  const bp = params.bubbles;
  const galaxies: Vector4[] = Array.from({ length: gp.max }, () => new Vector4());
  const bubbles: Vector4[] = Array.from({ length: bp.count }, () => new Vector4());
  const strom = new Float32Array(bp.count);
  const bubbleIdx = new Int32Array(bp.count);
  const fracTable = new Float32Array(bp.table);
  let nBubbles = 0;

  const uA = uniform(0.5);
  const uHaze = uniform(0);
  const uSigma = uniform(0);
  const uFront = uniform(0);
  const uRef = uniform(3);
  const qPos = uniform(new Vector3());
  const qAxis = uniform(new Vector3(...params.quasar.axis).normalize());
  const uQPeak = uniform(0);
  const uJetPeak = uniform(0);
  const uJetLength = uniform(0);
  let xHI = 1;

  const self: CosmicScene = {
    id: 'reionization',
    range: sceneRange('reionization'),
    accuracy: 'simulated',
    accuracyNote:
      'Neutral fraction follows Planck 2018 (widened); bubbles are calibrated to it, galaxies are fewer and larger, the quasar is illustrative and the haze colour mapped.',
    colourMapped: true,

    async init(ctx: RenderContext) {
      renderer = ctx.renderer;
      field = ctx.field;
      await ctx.field.ready;
      scene = new Scene();
      camera = new PerspectiveCamera(STRUCTURE.fov, 1, 0.03, 300);

      const shift = focusShift(ctx.field, new Vector3());
      web = createStructureWeb(ctx, shift, {});
      web.uniforms.tint.value.setRGB(...params.web.tint);
      scene.add(web.object);

      const fn = fieldNodes(ctx.field, shift);
      const steps = Math.max(12, Math.round(ctx.quality.raymarchSteps * params.haze.stepFraction));
      haze = new Mesh(new SphereGeometry(STRUCTURE.ballRadius, 48, 24), hazeMaterial(fn, uA, uHaze, steps));
      haze.renderOrder = -5;
      haze.frustumCulled = false;
      scene.add(haze);

      // Galaxies at the field's peaks; the brightest host bubbles.
      seeds = new HaloSeeds(ctx.field, shift, gp.max, gp.radius);
      seeds.update(webAmplitude(globalsAt(0.5 * (self.range[0] + self.range[1])).a));
      // Bubble hosts: the highest peaks, greedily kept at least minSeparation apart so bubbles open all over the
      // volume (the top peaks cluster); host 0 is the highest peak, which also hosts the quasar.
      nBubbles = 0;
      for (let i = 0; i < seeds.count && nBubbles < bp.count; i++) {
        let ok = true;
        for (let j = 0; j < nBubbles && ok; j++) {
          const k = bubbleIdx[j]!;
          const d = Math.hypot(seeds.pos[i * 4]! - seeds.pos[k * 4]!, seeds.pos[i * 4 + 1]! - seeds.pos[k * 4 + 1]!, seeds.pos[i * 4 + 2]! - seeds.pos[k * 4 + 2]!);
          if (d < bp.minSeparation) ok = false;
        }
        if (ok) bubbleIdx[nBubbles++] = i;
      }
      let lMax = 1e-6;
      for (let i = 0; i < nBubbles; i++) {
        strom[i] = Math.pow(Math.max(seeds.pos[bubbleIdx[i]! * 4 + 3]! - bp.nuFloor, 0.05), 2);
        lMax = Math.max(lMax, strom[i]!);
      }
      for (let i = 0; i < nBubbles; i++) strom[i] = Math.cbrt(strom[i]! / lMax);

      // Calibration table: ionised volume fraction of the ball vs the radius scale s (union of spheres).
      const rand = mulberry32(31);
      const pts = new Float32Array(bp.samples * 3);
      const rIn = STRUCTURE.ballRadius - 0.6;
      for (let k = 0; k < bp.samples; ) {
        const x = (rand() * 2 - 1) * rIn;
        const y = (rand() * 2 - 1) * rIn;
        const z = (rand() * 2 - 1) * rIn;
        if (x * x + y * y + z * z > rIn * rIn) continue;
        pts.set([x, y, z], k * 3);
        k++;
      }
      // Minimum over bubbles of |p − c| / r (inside when < s).
      const ratio = new Float32Array(bp.samples);
      for (let k = 0; k < bp.samples; k++) {
        let best = Infinity;
        for (let i = 0; i < nBubbles; i++) {
          const h = bubbleIdx[i]! * 4;
          const dx = pts[k * 3]! - seeds.pos[h]!;
          const dy = pts[k * 3 + 1]! - seeds.pos[h + 1]!;
          const dz = pts[k * 3 + 2]! - seeds.pos[h + 2]!;
          best = Math.min(best, Math.sqrt(dx * dx + dy * dy + dz * dz) / Math.max(strom[i]!, 1e-3));
        }
        ratio[k] = best;
      }
      ratio.sort();
      for (let j = 0; j < bp.table; j++) {
        const s = (bp.sMax * j) / (bp.table - 1);
        let lo = 0;
        let hi = bp.samples;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (ratio[mid]! < s) lo = mid + 1;
          else hi = mid;
        }
        fracTable[j] = lo / bp.samples;
      }

      const bn: BubbleNodes = {
        bubbles: uniformArray(bubbles, 'vec4'),
        count: bp.count,
        uSigma,
        uSmooth: uniform(bp.smooth),
        uRough: uniform(bp.rough),
        uTime: ctx.globals.uElapsed,
      };

      const fp = params.fog;
      const ha = lineColor(EMISSION_LINES_NM.hAlpha);
      const hb = lineColor(EMISSION_LINES_NM.hBeta).multiplyScalar(1 / fp.balmerDecrement);
      const frontColour = uniform(ha.clone().add(hb));
      fog = new Mesh(
        new SphereGeometry(STRUCTURE.ballRadius, 48, 24),
        fogMaterial(bn, fn, Math.min(fp.maxSteps, Math.max(16, Math.round(ctx.quality.raymarchSteps * fp.stepFraction))), {
          uA,
          uFogGlow: uniform(fp.glow),
          uFront,
          uFrontWidth: uniform(fp.frontWidth),
          fogColour: uniform(new Vector3(...fp.colour)),
          frontColour,
        }),
      );
      fog.renderOrder = 1;
      fog.frustumCulled = false;
      scene.add(fog);

      galaxySprite = new Sprite(
        galaxyMaterial(uniformArray(galaxies, 'vec4'), bn, ctx.globals.lut, {
          uSize: uniform(gp.size),
          uPeak: uniform(gp.peak),
          uLogTYoung: uniform(Math.log10(gp.youngTempK)),
          uLogTOld: uniform(Math.log10(gp.oldTempK)),
          hAlpha: uniform(ha.clone()),
          uRef,
        }),
      );
      galaxySprite.count = Math.max(1, seeds.count);
      galaxySprite.frustumCulled = false;
      galaxySprite.renderOrder = 3;
      scene.add(galaxySprite);

      const qp = params.quasar;
      quasar = new Sprite(quasarMaterial(qPos, bn, ctx.globals.lut, { uLogT: uniform(Math.log10(qp.tempK)), uSize: uniform(qp.size), uPeak: uQPeak }));
      quasar.frustumCulled = false;
      quasar.renderOrder = 5;
      scene.add(quasar);

      jets = new Mesh(
        new PlaneGeometry(1, 2, 1, 64),
        jetMaterial(qPos, qAxis, { uLength: uJetLength, uWidth: uniform(qp.jetWidth), uPeak: uJetPeak, uTime: ctx.globals.uElapsed, colour: uniform(new Vector3(...qp.jetColour)) }),
      );
      jets.frustumCulled = false;
      jets.renderOrder = 4;
      scene.add(jets);

      self.update(0, globalsAt(self.range[0]), 0, 0);
      await renderer.compileAsync(scene, camera);
    },

    update(local: number, g: Globals, _dt: number, elapsed: number) {
      const l = clamp01(local);
      const A = webAmplitude(g.a);
      uA.value = A;
      xHI = neutralFractionIGM(g.z);

      const u = web.uniforms;
      u.amplitude.value = A;
      const cm = 1 - smoothstep(params.web.colourMapFade[0], params.web.colourMapFade[1], l);
      u.colourMap.value = cm;
      u.brightness.value = ramp(params.web.brightness, l);
      u.contrast.value = ramp(params.web.contrast, l);
      u.size.value = ramp(params.web.size, l);
      uHaze.value = ramp(params.haze.brightness, l);
      haze.visible = uHaze.value > 1e-4;

      // Galaxies: halos past (or approaching) spherical collapse at this amplitude.
      seeds.update(A);
      const nuC = collapseNu(field, A);
      const span = Math.max(1e-3, seeds.nuMax - seeds.nuMin);
      for (let i = 0; i < gp.max; i++) {
        if (i >= seeds.count) {
          galaxies[i]!.set(0, 0, 0, 0);
          continue;
        }
        const nu = seeds.pos[i * 4 + 3]!;
        const w = smoothstep(nuC - gp.onset, nuC, nu) * (0.3 + 0.7 * Math.pow((nu - seeds.nuMin) / span, 1.5));
        seeds.write(i, galaxies[i]!, w);
      }

      // Quasar lifecycle (beat 0.48), jets fade for a calm exit.
      const qp = params.quasar;
      const on = smoothstep(qp.ignite, qp.ignite + 0.02, l);
      const flare = 1 + 2.5 * Math.exp(-Math.max(0, l - qp.ignite) / 0.02) * on;
      const calm = 1 - smoothstep(qp.fadeStart, qp.fadeEnd, l);
      uQPeak.value = qp.peak * on * flare * (qp.afterglow + (1 - qp.afterglow) * calm);
      uJetPeak.value = qp.jetPeak * on * calm;
      uJetLength.value = qp.jetLength * Math.pow(smoothstep(qp.ignite, qp.ignite + qp.jetGrow, l), 0.7);
      jets.visible = uJetPeak.value > 1e-3;
      quasar.visible = uQPeak.value > 1e-3;
      if (seeds.count) qPos.value.set(seeds.pos[0]!, seeds.pos[1]!, seeds.pos[2]!);

      // Bubbles: radius scale s from the calibration table so the ionised fraction = 1 − x_HI(z).
      const target = 1 - xHI;
      let j = 0;
      while (j < bp.table - 1 && fracTable[j + 1]! < target) j++;
      const f0 = fracTable[j]!;
      const f1 = fracTable[Math.min(j + 1, bp.table - 1)]!;
      const sScale = (bp.sMax / (bp.table - 1)) * (j + (f1 > f0 ? clamp01((target - f0) / (f1 - f0)) : 0));
      for (let i = 0; i < bp.count; i++) {
        if (i >= nBubbles) {
          bubbles[i]!.set(1e3, 1e3, 1e3, 0);
          continue;
        }
        let r = sScale * strom[i]!;
        if (i === 0) r += qp.bubbleBoost * smoothstep(qp.ignite, qp.ignite + 0.18, l);
        seeds.write(bubbleIdx[i]!, bubbles[i]!, r);
      }
      const fp = params.fog;
      const fogIn = smoothstep(0, fp.fadeIn, l);
      // Neutral islands stay neutral (local x_HI ≈ 1) while the bubbles take the volume, so the haze density
      // falls more gently than x_HI itself; the volume-averaged neutral column still follows x_HI.
      uSigma.value = fp.sigmaMax * Math.pow(xHI, fp.densityExponent) * fogIn;
      uFront.value = fp.front * smoothstep(0.015, 0.25, xHI) * fogIn;
      fog.visible = xHI > 0.01;
      self.colourMapped = xHI > 0.05 || cm > 0.5;

      const dist = applyStructureCamera(camera, ORDINAL.reionization + l, elapsed);
      web.refDist.value = 0.8 * dist;
      uRef.value = 0.8 * dist;
    },

    render(target: RenderTarget) {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    },

    resize(w: number, h: number) {
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    },

    dispose() {
      web.dispose();
      for (const m of [haze, fog, jets]) {
        m.geometry.dispose();
        (m.material as MeshBasicNodeMaterial).dispose();
      }
      (galaxySprite.material as SpriteNodeMaterial).dispose();
      (quasar.material as SpriteNodeMaterial).dispose();
    },
  };
  return self;
};
