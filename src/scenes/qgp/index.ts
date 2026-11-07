// qgp — quark–gluon plasma & the Higgs moment (HANDOFF §9.3) · modelled.
//
// Beats (locals from the chapter's log map, 10⁻³² → 10⁻⁶ s):
//   0 → 0.13   reheating: the soup fills in from dim, imprinted with the primordial ripples inflation left.
//   0.13 → 0.75 hot, massless soup: colour-charged quarks, gluon streaks, swirling collective flow at c.
//   0.769      the Higgs moment (10⁻¹² s): quarks and leptons gain mass — motion damps, trails shorten.
//   0.83       electroweak split: a flash; photons (and gluons) stay massless and keep streaking.
//   0.86 → 1   asymmetry: quarks pair with antiquarks; excess-matter slots (1 in 50) have unpaired quarks (gold).

import { blackbodyRGB } from '../../physics/blackbody.ts';
import { globalsAt, type Globals } from '../../physics/cosmology.ts';
import { smoothstep } from '../../shared/math.ts';
import { PerspectiveCamera, Scene, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
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
  localOf,
  SLOT,
  tierGain,
  updateViewRig,
  type Bath,
  type StreakLayer,
  type ViewRig,
} from './particles.ts';
import { bathLayer, createQgpUniforms, glitterLayer, gluonLayer, quarkLayer, type QgpShape, type QgpUniforms } from './shaders.ts';

export const params = {
  /** Side of the periodic particle volume around the camera (world units). */
  box: 12,
  /** Wrap-box centre ahead of the camera, as a fraction of the box. */
  boxAhead: 0.3,
  fov: 52,
  focus: 2.6,
  aperture: 0.008,
  maxBlur: 0.04,
  minPx: 1.1,
  near: 0.7,
  fog: 3.6,
  /** Share of ctx.quality.particles per layer. */
  share: { quarks: 0.11, bath: 0.3, glitter: 0.55, gluons: 0.04 },
  bathSteps: { low: 8, medium: 14, high: 18 } as Record<string, number>,
  bathLength: 11,
  bathIntensity: 0.22,
  bathFloor: 0.02,
  /** Hot currents shared by the glow and the particles. */
  currents: { scale: 0.35, sharp: 3, voids: 0.95, floor: 0.15 },
  /** Flow morph rate (per massive-clock second). */
  morphRate: 0.03,
  /** Wall-clock length of a motion trail (s): bath strands, quarks. */
  trailWall: 0.3,
  quarkTrailWall: 0.07,
  /** Massive particles' speed after the Higgs moment, as a fraction of c (exaggerated slowdown; see note). */
  massiveBeta: 0.14,
  beats: {
    reheatEnd: 0.13,
    /** Higgs crossover time, s (local computed from the chapter map). */
    higgsT: 1e-12,
    higgsHalfWidth: 0.018,
    split: 0.83,
    splitHalfWidth: 0.035,
    pairStart: 0.855,
    pairEnd: 0.95,
    goldStart: 0.875,
    goldEnd: 0.945,
    calm: 0.95,
  },
  camera: {
    /** Forward travel over the whole chapter (world units). */
    travel: 7,
    /** Idle forward drift per massive-clock second. */
    drift: 0.05,
    sway: 0.3,
  },
  shape: {
    c: 0.6,
    flowK: 1.6,
    flowSteps: 10,
    bathStrandLength: 4,
    bathBeads: 160,
    bathWidth: 0.006,
    bathIntensity: 1.2,
    photonShare: 0.3,
    slotStrandLength: 6,
    slotSpacing: 0.09,
    wobble: 0.025,
    pairRadius: 0.022,
    pairSpin: 2.4,
    /** Excess-matter slots: 1 in 50 (real: ~1 in a billion). */
    extraFrac: 1 / 50,
    quarkWidth: 0.02,
    quarkIntensity: 2.5,
    gluonWidth: 0.008,
    gluonIntensity: 9.0,
    gluonPeriod: 0.9,
    gluonLag: 0.35,
    gold: [1.0, 0.68, 0.26],
    colourCharge: [
      [1.0, 0.16, 0.1],
      [0.2, 1.0, 0.3],
      [0.16, 0.36, 1.0],
    ],
    rippleScale: 0.9,
    glitterWidth: 0.004,
    glitterIntensity: 1.2,
    glitterDrift: 0.5,
  } satisfies QgpShape as QgpShape,
};

const HIGGS_LOCAL = localOf('qgp', params.beats.higgsT);

export default (): CosmicScene => {
  let renderer: WebGPURenderer;
  let scene: Scene;
  let camera: PerspectiveCamera;
  let view: ViewRig;
  let u: QgpUniforms;
  let bath: Bath;
  const layers: StreakLayer[] = [];
  const clockM = new Clock();
  const clockC = new Clock();
  let height = 720;
  const rgb: [number, number, number] = [0, 0, 0];

  return {
    id: 'qgp',
    range: sceneRange('qgp'),
    accuracy: 'modelled',
    accuracyNote:
      'Particles are drawn far larger, fewer and slower than real, the ripples are exaggerated, colour charge is a label rather than a colour, the post-Higgs slowdown is exaggerated (most particles stay near light speed) and the matter excess is shown as about 1 in 50 instead of 1 in a billion.',
    colourMapped: false,
    async init(ctx: RenderContext) {
      renderer = ctx.renderer;
      devTune(params);
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
      u = createQgpUniforms();

      const n = ctx.quality.particles;
      const gain = tierGain(n);
      const density = ctx.field.textures().density;
      const slots = Math.floor((n * params.share.quarks) / SLOT);
      const nq = slots * SLOT;
      const nb = Math.floor(n * params.share.bath);
      const ng = Math.floor(n * params.share.gluons);
      const nl = Math.floor(n * params.share.glitter);
      layers.push(createStreaks(glitterLayer(params.shape, u, view, gain), view, nl));
      layers.push(createStreaks(bathLayer(params.shape, u, view, density, gain), view, nb));
      layers.push(createStreaks(quarkLayer(params.shape, u, view, density, gain), view, nq));
      layers.push(createStreaks(gluonLayer(params.shape, u, view, gain, slots), view, ng));
      bath = createBath(ctx, {
        steps: params.bathSteps[ctx.quality.name] ?? 10,
        length: params.bathLength,
        density: (p) => currents(p, u.clockM, u.curScale, u.curSharp, u.curVoids),
      });
      bath.uniforms.floor.value = params.bathFloor;
      bath.uniforms.fog.value = params.fog * 1.6;
      u.curScale.value = params.currents.scale;
      u.curSharp.value = params.currents.sharp;
      u.curVoids.value = params.currents.voids;
      u.curFloor.value = params.currents.floor;
      scene.add(bath.mesh);
      for (const l of layers) scene.add(l.object);
      this.update(0.5, globalsAt(1e-20), 0, 0);
      await renderer.compileAsync(scene, camera);
    },

    update(local: number, g: Globals, dt: number, elapsed: number) {
      const b = params.beats;
      // Reheating fill-in, then slow cooling.
      const fill = smoothstep(0, b.reheatEnd, local);
      u.reveal.value = 0.02 + 0.98 * fill * fill;
      u.ripple.value = 1 - smoothstep(0.02, 0.22, local);
      u.bright.value = (0.08 + 0.92 * fill * fill) * (1 - 0.22 * smoothstep(0.2, 0.75, local));

      // Higgs: mass switches on (smooth crossover), massive clock slows; massless clock keeps c.
      const higgs = smoothstep(HIGGS_LOCAL - b.higgsHalfWidth, HIGGS_LOCAL + b.higgsHalfWidth, local);
      const beta = 1 + (params.massiveBeta - 1) * higgs;
      u.higgs.value = higgs;
      clockM.advance(dt, beta);
      clockC.advance(dt, 1);
      u.clockM.value = clockM.value;
      u.clockC.value = clockC.value;
      u.trailM.value = params.trailWall * beta;
      u.trailC.value = params.trailWall;
      u.trailQ.value = params.quarkTrailWall * beta;
      u.morph.value = clockM.value * params.morphRate;

      u.flash.value = bell(local, b.split, b.splitHalfWidth) * (0.85 + 0.15 * Math.sin(elapsed * 3.1));
      u.split.value = smoothstep(b.split - 0.02, b.split + 0.03, local);
      u.pair.value = smoothstep(b.pairStart, b.pairEnd, local);
      u.gold.value = smoothstep(b.goldStart, b.goldEnd, local);

      blackbodyRGB(g.T, rgb);
      u.thermal.value.setRGB(rgb[0], rgb[1], rgb[2]);

      bath.uniforms.intensity.value = params.bathIntensity * u.bright.value * (1 + 2.2 * u.flash.value) * (1 - 0.3 * u.gold.value);

      // Camera: slow push through the soup; drift rides the massive clock so it, too, gains inertia.
      const c = params.camera;
      const tC = clockC.value;
      const z = -(c.travel * local + c.drift * clockM.value);
      camera.position.set(c.sway * Math.sin(tC * 0.043), 0.6 * c.sway * Math.sin(tC * 0.031 + 1.3), z);
      const yaw = 0.22 * Math.sin(local * 2.4 + 0.4) + 0.05 * Math.sin(tC * 0.021);
      const pitch = 0.07 * Math.sin(local * 1.7 + 1.1) + 0.03 * Math.sin(tC * 0.027 + 2);
      camera.lookAt(
        camera.position.x + Math.sin(yaw) * 4,
        camera.position.y + Math.sin(pitch) * 4,
        camera.position.z - Math.cos(yaw) * 4,
      );
      camera.rotateZ(0.04 * Math.sin(tC * 0.017 + local));
      camera.updateMatrixWorld();
      updateViewRig(view, camera, height, params.boxAhead);
      bath.mesh.position.copy(camera.position);
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
};
