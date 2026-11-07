// hadrons — confinement & annihilation (HANDOFF §9.4) · modelled.
//
// Beats (locals from the chapter's log map, 10⁻⁶ → 1 s):
//   0 → 0.12   zoom in from the quark soup (the qgp's gold excess fades back to colour charge).
//   0.17       10⁻⁵ s: quarks snap (with overshoot) into triplets — baryons and antibaryons — and pairs (mesons);
//              flux tubes light up between them (Y-shaped for baryons).
//   0.28 →     mesons decay into flashes of light.
//   0.5        1 ms: baryon–antibaryon pairs drift together and annihilate in photon flashes.
//   0.68 → 1   about 1 slot in 50 had no antiquarks: its baryon survives as a gold proton or neutron; calm.

import { abundancesAt } from '../../physics/abundances.ts';
import { blackbodyRGB } from '../../physics/blackbody.ts';
import { globalsAt, type Globals } from '../../physics/cosmology.ts';
import { smoothstep } from '../../shared/math.ts';
import { timeInChapter, CHAPTERS } from '../../time/chapters.ts';
import { PerspectiveCamera, Scene, Vector3, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
import { float, mix, uniform, vec3 } from 'three/tsl';
import type { CosmicScene, RenderContext } from '../types.ts';
import { sceneRange } from '../sceneRange.ts';
import {
  bell,
  Clock,
  createBath,
  createStreaks,
  createViewRig,
  currents,
  devTune,
  findSlot,
  pinHero,
  randCPU,
  EVENT_PARTS,
  eventLayer,
  glitterLayer,
  localOf,
  silkLayer,
  SLOT,
  tierGain,
  updateViewRig,
  type Bath,
  type StreakLayer,
  type ViewRig,
} from '../qgp/particles.ts';
import {
  BAGS_PER_SLOT,
  bagLayer,
  createHadronUniforms,
  flowOf,
  heat,
  quarkLayer,
  stringLayer,
  type HadronShape,
  type HadronUniforms,
} from './shaders.ts';

export const params = {
  box: 12,
  boxAhead: 0.3,
  fov: 50,
  focus: 1.9,
  aperture: 0.02,
  maxBlur: 0.06,
  minPx: 1.1,
  near: 0.6,
  fog: 3.8,
  share: { quarks: 0.14, glitter: 0.5, silk: 0.24, events: 0.03 },
  bathSteps: { low: 8, medium: 14, high: 18 } as Record<string, number>,
  bathLength: 11,
  bathIntensity: 0.12,
  bathFloor: 0.02,
  currents: { scale: 0.5, sharp: 4, voids: 0.95, floor: 0.12 },
  morphRate: 0.03,
  /** Everything here is massive except photons: the massive clock runs at this fraction of c. */
  massiveBeta: 0.16,
  trailWall: 0.3,
  quarkTrailWall: 0.06,
  silk: { beads: 160, length: 4, width: 0.006, intensity: 1.0, afterAnnihilation: 0.9 },
  glitter: { width: 0.004, intensity: 1.0, drift: 0.5 },
  events: { period: 2.6, peak: 0.55, approach: 0.15, flight: 0.9, mesonEra: 0.25 },
  beats: {
    /** Confinement (QCD crossover) time, s. */
    confineT: 1e-5,
    /** Nucleon–antinucleon annihilation, s. */
    annihilateT: 1e-3,
    survivorStart: 0.6,
    survivorEnd: 0.72,
    goldFade: 0.12,
    calm: 0.86,
  },
  /** Foreground slots pinned near the camera (offset in the camera frame). */
  heroes: [
    { offset: [0.22, -0.04, -1.7] as const },
    { offset: [-0.55, 0.16, -2.0] as const },
    { offset: [0.62, 0.32, -2.4] as const },
  ],
  camera: { travel: 4.5, drift: 0.12, sway: 0.25 },
  shape: {
    c: 0.6,
    flowK: 1.6,
    flowSteps: 10,
    slotStrandLength: 6,
    slotSpacing: 0.09,
    wobble: 0.03,
    extraFrac: 1 / 50,
    mesonShare: 0.3,
    confineAt: 0.17,
    confineSpread: 0.05,
    confineDur: 0.03,
    baryonRadius: 0.045,
    mesonRadius: 0.035,
    hadronSpin: 1.8,
    mesonDecayStart: 0.27,
    mesonDecayEnd: 0.46,
    annCentre: 0.5,
    annSpread: 0.05,
    annApproach: 0.07,
    quarkWidth: 0.018,
    quarkIntensity: 2.6,
    stringWidth: 0.005,
    stringIntensity: 3,
    bagWidth: 0.05,
    bagIntensity: 0.3,
    survivorWidth: 0.13,
    flashWidth: 0.1,
    flashIntensity: 5,
    gold: [1.0, 0.68, 0.26],
    neutronTint: [0.62, 0.69, 0.8],
    matterTint: [1.0, 0.9, 0.78],
    antiTint: [0.72, 0.84, 1.0],
    colourCharge: [
      [1.0, 0.16, 0.1],
      [0.2, 1.0, 0.3],
      [0.16, 0.36, 1.0],
    ],
  } satisfies HadronShape as HadronShape,
};

const CONFINE_LOCAL = localOf('hadrons', params.beats.confineT);
const ANNIHILATE_LOCAL = localOf('hadrons', params.beats.annihilateT);
const CHAPTER = CHAPTERS.find((c) => c.id === 'hadrons')!;

export default (): CosmicScene => {
  let renderer: WebGPURenderer;
  let scene: Scene;
  let camera: PerspectiveCamera;
  let view: ViewRig;
  let u: HadronUniforms;
  let bath: Bath;
  const layers: StreakLayer[] = [];
  const clockM = new Clock();
  const clockC = new Clock();
  let height = 720;
  const rgb: [number, number, number] = [0, 0, 0];
  const target = new Vector3();
  const uSilk = uniform(1);
  const uEventRate = uniform(0);
  const base = new Vector3();

  const self: CosmicScene = {
    id: 'hadrons',
    range: sceneRange('hadrons'),
    accuracy: 'modelled',
    accuracyNote:
      'Real survival ratio is ~1 in a billion; shown at ~1 in 50 for visibility. Particles are drawn far larger, fewer and slower than real, colour charge is a label rather than a colour, and flux tubes are drawn as glowing strings.',
    colourMapped: false,

    async init(ctx: RenderContext) {
      renderer = ctx.renderer;
      devTune(params);
      params.shape.confineAt = CONFINE_LOCAL;
      params.shape.annCentre = ANNIHILATE_LOCAL;
      await ctx.field.ready;
      scene = new Scene();
      camera = new PerspectiveCamera(params.fov, 16 / 9, 0.02, 200);
      view = createViewRig(params.box);
      view.focus.value = params.focus;
      view.aperture.value = params.aperture;
      view.maxBlur.value = params.maxBlur;
      view.minPx.value = params.minPx;
      view.near.value = params.near;
      view.fog.value = params.fog;
      u = createHadronUniforms();
      // Hero slots via the CPU twin of the GPU seeds: a pair slot that confines and annihilates right on the
      // beats, a survivor (excess-matter) slot, and a meson slot.
      {
        const s = params.shape;
        const g = (k: number) => randCPU(k, 42) + randCPU(k, 43) + randCPU(k, 44) - 1.5;
        const onBeat = (k: number) => Math.abs(randCPU(k, 41) - 0.5) < 0.08;
        const extra = (k: number) => randCPU(k, 0) < s.extraFrac;
        const meson = (k: number) => !extra(k) && randCPU(k, 40) < s.mesonShare;
        u.heroes[0]!.id.value = findSlot((k) => !extra(k) && !meson(k) && onBeat(k) && Math.abs(g(k)) < 0.02, 11);
        u.heroes[1]!.id.value = findSlot((k) => extra(k) && onBeat(k), 11);
        u.heroes[2]!.id.value = findSlot((k) => meson(k) && onBeat(k) && randCPU(k, 45) > 0.2 && randCPU(k, 45) < 0.3, 11);
      }
      u.curScale.value = params.currents.scale;
      u.curSharp.value = params.currents.sharp;
      u.curVoids.value = params.currents.voids;
      u.curFloor.value = params.currents.floor;

      const n = ctx.quality.particles;
      const gain = tierGain(n);
      const s = params.shape;
      const slots = Math.floor((n * params.share.quarks) / SLOT);
      const nEvents = Math.floor((n * params.share.events) / EVENT_PARTS);
      const thermalWhite = mix(u.thermal, vec3(1), 0.35);

      const glitterFlow = flowOf(s, u, 1);
      layers.push(
        createStreaks(
          glitterLayer({
            view,
            flow: glitterFlow,
            tau: u.clockM,
            twinkleClock: u.clockC,
            trail: u.trailQ,
            c: s.c,
            drift: params.glitter.drift,
            width: params.glitter.width,
            colour: thermalWhite.mul(u.bright).mul(params.glitter.intensity * gain),
            shade: (h) => heat(h, u),
          }),
          view,
          Math.floor(n * params.share.glitter),
        ),
      );
      layers.push(
        createStreaks(
          silkLayer({
            view,
            flow: flowOf(s, u, params.silk.length),
            beads: params.silk.beads,
            tau: u.clockC,
            trail: float(params.trailWall),
            c: s.c,
            width: params.silk.width,
            colour: thermalWhite.mul(u.bright).mul(uSilk).mul(params.silk.intensity * gain),
            shade: (h) => heat(h, u),
          }),
          view,
          Math.floor(n * params.share.silk),
        ),
      );
      layers.push(createStreaks(quarkLayer(s, u, view, gain), view, slots * SLOT));
      layers.push(createStreaks(stringLayer(s, u, view, gain), view, slots * SLOT));
      layers.push(createStreaks(bagLayer(s, u, view, gain), view, slots * BAGS_PER_SLOT));
      layers.push(
        createStreaks(
          eventLayer({
            view,
            clock: u.clockC,
            period: params.events.period,
            rate: uEventRate,
            approach: params.events.approach,
            flight: params.events.flight,
            particleWidth: s.quarkWidth * 2.2,
            flashWidth: 0.06,
            photonWidth: 0.006,
            matter: vec3(s.matterTint[0], s.matterTint[1], s.matterTint[2]).mul(1.6 * gain),
            antimatter: vec3(s.antiTint[0], s.antiTint[1], s.antiTint[2]).mul(1.6 * gain),
            flash: vec3(1, 0.97, 0.92).mul(s.flashIntensity * gain),
            photon: thermalWhite.mul(3 * gain),
          }),
          view,
          nEvents * EVENT_PARTS,
        ),
      );
      bath = createBath(ctx, {
        steps: params.bathSteps[ctx.quality.name] ?? 14,
        length: params.bathLength,
        density: (p) => currents(p, u.clockM, u.curScale, u.curSharp, u.curVoids),
      });
      bath.uniforms.floor.value = params.bathFloor;
      bath.uniforms.fog.value = params.fog * 1.6;
      scene.add(bath.mesh);
      for (const l of layers) scene.add(l.object);
      self.update(0.5, globalsAt(timeInChapter(CHAPTER, 0.5).t), 0, 0);
      await renderer.compileAsync(scene, camera);
    },

    update(local: number, g: Globals, dt: number, elapsed: number) {
      const b = params.beats;
      u.local.value = local;
      clockM.advance(dt, params.massiveBeta);
      clockC.advance(dt, 1);
      u.clockM.value = clockM.value;
      u.clockC.value = clockC.value;
      u.morph.value = clockM.value * params.morphRate;
      u.trailQ.value = params.quarkTrailWall * params.massiveBeta;
      u.survivor.value = smoothstep(b.survivorStart, b.survivorEnd, local);
      u.goldHint.value = 1 - smoothstep(0, b.goldFade, local);
      u.neutron.value = abundancesAt(g.t).neutrons;
      u.bright.value = 1;
      const annihilated = smoothstep(ANNIHILATE_LOCAL - 0.12, ANNIHILATE_LOCAL + 0.12, local);
      uSilk.value = 1 + params.silk.afterAnnihilation * annihilated;
      uEventRate.value =
        params.events.peak * bell(local, ANNIHILATE_LOCAL, 0.15) + params.events.mesonEra * bell(local, 0.37, 0.1);

      blackbodyRGB(g.T, rgb);
      u.thermal.value.setRGB(rgb[0], rgb[1], rgb[2]);
      bath.uniforms.intensity.value = params.bathIntensity * (1 + 0.6 * annihilated) * (1 - 0.3 * smoothstep(b.calm, 1, local));

      // Camera: an unhurried drift that settles as the survivors appear.
      const c = params.camera;
      const tC = clockC.value;
      const z = -(c.travel * local + c.drift * clockM.value);
      camera.position.set(c.sway * Math.sin(tC * 0.037 + 0.6), 0.6 * c.sway * Math.sin(tC * 0.029 + 2.1), z);
      const yaw = 0.18 * Math.sin(local * 2.1 + 1.2) + 0.04 * Math.sin(tC * 0.019);
      const pitch = 0.06 * Math.sin(local * 1.5 + 0.3) + 0.025 * Math.sin(tC * 0.023 + 1);
      target.set(camera.position.x + Math.sin(yaw) * 4, camera.position.y + Math.sin(pitch) * 4, camera.position.z - Math.cos(yaw) * 4);
      camera.lookAt(target);
      camera.rotateZ(0.035 * Math.sin(tC * 0.015 + local));
      camera.updateMatrixWorld();
      base.set(0, 0, z);
      params.heroes.forEach((h, k) => pinHero(u.heroes[k]!, camera, base, h.offset, tC, k * 1.7 + 0.4, 1));
      updateViewRig(view, camera, height, params.boxAhead);
      bath.mesh.position.copy(camera.position);
      void elapsed;
    },

    render(target: RenderTarget) {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    },

    resize(width: number, h: number) {
      height = h;
      camera.aspect = width / Math.max(1, h);
      camera.updateProjectionMatrix();
    },

    dispose() {
      for (const l of layers) l.material.dispose();
      layers.length = 0;
      bath?.dispose();
    },
  };
  return self;
};
