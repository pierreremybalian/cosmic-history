// leptons — neutrino decoupling & e⁺e⁻ annihilation (HANDOFF §9.5) · modelled.
//
// Beats (locals from the chapter's log map, 1 → 180 s):
//   0 → 0.2    ~1–2 s: neutrinos peel off — their streams straighten from the plasma's curved flow into free,
//              straight flight, faint and fast; they never brighten again.
//   0.28       e⁺e⁻ pairs are still made and destroyed: creation and annihilation flashes everywhere.
//   0.44       10 s: too cool to make new pairs; the pair population (thermal Fermi–Dirac abundance at the
//              photon temperature) drains in annihilation flashes.
//   0.6        the photon bath brightens: brightness ∝ (T·a)⁴ from temperatureAt(a) — the §6.3 bump (×(11/4)^(4/3)).
//   0.78       the excess electrons (one per proton) remain, highlighted.
//   0.92 → 1   neutrons slowly decay into protons (share from abundances.ts); calm, ready to zoom into BBN.

import { abundancesAt } from '../../physics/abundances.ts';
import { blackbodyRGB } from '../../physics/blackbody.ts';
import { EE_TA_RATIO, MEV_K, T_CMB0 } from '../../physics/constants.ts';
import { globalsAt, type Globals } from '../../physics/cosmology.ts';
import { smoothstep } from '../../shared/math.ts';
import { CHAPTERS, timeInChapter } from '../../time/chapters.ts';
import { PerspectiveCamera, Scene, Vector3, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
import { mix, uniform, vec3 } from 'three/tsl';
import type { CosmicScene, RenderContext } from '../types.ts';
import { sceneRange } from '../sceneRange.ts';
import {
  Clock,
  createBath,
  createStreaks,
  createViewRig,
  currents,
  devTune,
  EVENT_PARTS,
  eventLayer,
  localOf,
  silkLayer,
  tierGain,
  updateViewRig,
  type Bath,
  type StreakLayer,
  type ViewRig,
} from '../qgp/particles.ts';
import {
  createLeptonUniforms,
  excessLayer,
  flowOf,
  heat,
  neutrinoLayer,
  NUCLEON_PARTS,
  nucleonLayer,
  pairLayer,
  type LeptonShape,
  type LeptonUniforms,
} from './shaders.ts';

/** Electron rest energy, MeV (CODATA 2018). Suggested for physics/constants.ts; kept here (scene-owned files only). */
const ELECTRON_MASS_MEV = 0.51099895;

export const params = {
  box: 12,
  boxAhead: 0.3,
  fov: 50,
  focus: 2.0,
  aperture: 0.02,
  maxBlur: 0.06,
  minPx: 1.1,
  near: 0.6,
  fog: 4.2,
  share: { pairs: 0.35, neutrinos: 0.07, silk: 0.16, events: 0.12 },
  /** Nucleons and excess electrons: 1 per 50 hadron slots, as in the hadrons scene. */
  nucleonPerParticle: 0.14 / 6 / 50,
  bathSteps: { low: 8, medium: 14, high: 18 } as Record<string, number>,
  bathLength: 11,
  bathIntensity: 0.06,
  bathFloor: 0.02,
  currents: { scale: 0.35, sharp: 3, voids: 0.95, floor: 0.25 },
  morphRate: 0.03,
  massiveBeta: 0.16,
  trailWall: 0.3,
  pairTrailWall: 0.05,
  silk: { beads: 160, length: 4, width: 0.006, intensity: 0.45 },
  events: { period: 1.8, approach: 0.1, flight: 0.9, rate: 1.0 },
  beats: {
    /** Neutrino decoupling: ~1–2 s, drawn over these locals. */
    decoupleStart: 0.0,
    decoupleEnd: 0.24,
    /** Pair creation stops (t ≈ 10 s, T ≈ m_e c²/1.6). */
    creationEndT: 10,
    excessStart: 0.68,
    excessEnd: 0.8,
  },
  /**
   * Hero nucleon: a neutron pinned in front of the camera that β-decays on the 0.92 beat (its rank is set from the
   * computed neutron share there), then sits at frame centre for the zoom into nucleosynthesis.
   */
  hero: { from: 0.5, to: 0.62, decayAt: 0.92, decayLength: 0.05, start: [0.32, 0.08, -2.2] as const, end: [0, 0, -1.5] as const },
  camera: { travel: 3.5, drift: 0.1, sway: 0.25 },
  shape: {
    c: 0.6,
    flowK: 1.6,
    flowSteps: 10,
    neutrinoBeads: 10,
    neutrinoLength: 6,
    neutrinoWidth: 0.005,
    neutrinoIntensity: 2.4,
    neutrinoTint: [0.62, 0.45, 1.0],
    neutrinoSpeed: 3.0,
    pairWidth: 0.006,
    pairIntensity: 1.0,
    pairJitter: 0.05,
    electronTint: [1.0, 0.7, 0.4],
    positronTint: [0.38, 0.72, 1.0],
    excessWidth: 0.011,
    excessIntensity: 1.8,
    nucleonWidth: 0.12,
    nucleonIntensity: 0.9,
    nucleonCore: 5,
    gold: [1.0, 0.68, 0.26],
    /** Neutral cool, the hue of the bbn scene's neutrons (#b3bcc8), brightened. */
    neutronTint: [0.62, 0.69, 0.8],
    /** Toward the bbn scene's proton colour (#e35b3a). */
    protonHandoff: [0.95, 0.34, 0.14],
    nucleonQuarkRadius: 0.03,
    nucleonQuarkWidth: 0.008,
    nucleonQuarkIntensity: 1.2,
    decayFlight: 0.9,
    colourCharge: [
      [1.0, 0.16, 0.1],
      [0.2, 1.0, 0.3],
      [0.16, 0.36, 1.0],
    ],
  } satisfies LeptonShape as LeptonShape,
};

const CHAPTER = CHAPTERS.find((c) => c.id === 'leptons')!;
const CREATION_END_LOCAL = localOf('leptons', params.beats.creationEndT);

/** e± number density relative to the massless limit at x = m_e c² / kT (Fermi–Dirac, μ = 0). */
function pairAbundance(x: number): number {
  const integral = (m: number) => {
    let s = 0;
    const dy = 0.02;
    for (let y = dy / 2; y < 30; y += dy) s += (y * y * dy) / (Math.exp(Math.sqrt(y * y + m * m)) + 1);
    return s;
  };
  return integral(x) / integral(0);
}

/** Lookup of the pair abundance over the chapter's locals (computed once; the scene samples it per frame). */
const PAIR_TABLE = (() => {
  const n = 129;
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const { t } = timeInChapter(CHAPTER, k / (n - 1));
    const g = globalsAt(t);
    out[k] = pairAbundance((ELECTRON_MASS_MEV * MEV_K) / g.T);
  }
  return out;
})();

function pairAt(local: number): number {
  const x = Math.min(1, Math.max(0, local)) * (PAIR_TABLE.length - 1);
  const k = Math.min(PAIR_TABLE.length - 2, Math.floor(x));
  return PAIR_TABLE[k]! + (PAIR_TABLE[k + 1]! - PAIR_TABLE[k]!) * (x - k);
}

export default (): CosmicScene => {
  let renderer: WebGPURenderer;
  let scene: Scene;
  let camera: PerspectiveCamera;
  let view: ViewRig;
  let u: LeptonUniforms;
  let bath: Bath;
  const layers: StreakLayer[] = [];
  const clockM = new Clock();
  const clockC = new Clock();
  let height = 720;
  const rgb: [number, number, number] = [0, 0, 0];
  const target = new Vector3();
  const uEventRate = uniform(0);
  const uCreation = uniform(0);
  const neutron0 = abundancesAt(CHAPTER.tStart).neutrons;
  const heroOffset = new Vector3();
  // Rank just below the neutron share at the decay beat: the hero is a neutron until then, a proton after.
  const heroRank = (() => {
    const at = (l: number) => abundancesAt(timeInChapter(CHAPTER, l).t).neutrons;
    return 0.5 * (at(params.hero.decayAt - 0.004) + at(params.hero.decayAt + 0.004));
  })();

  const self: CosmicScene = {
    id: 'leptons',
    range: sceneRange('leptons'),
    accuracy: 'modelled',
    accuracyNote:
      'Neutrinos are drawn as faint streaks, particles are enlarged and slowed, the electron excess is ~1 in 50 not 1 in a billion, and photon brightness follows the computed (T·a)⁴.',
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
      u = createLeptonUniforms();
      u.curScale.value = params.currents.scale;
      u.curSharp.value = params.currents.sharp;
      u.curVoids.value = params.currents.voids;
      u.curFloor.value = params.currents.floor;
      u.neutron0.value = neutron0;
      u.heroRank.value = heroRank;

      const n = ctx.quality.particles;
      const gain = tierGain(n);
      const s = params.shape;
      const nNucleons = Math.max(8, Math.round(n * params.nucleonPerParticle));
      const nEvents = Math.floor((n * params.share.events) / EVENT_PARTS);
      const thermalWhite = mix(u.thermal, vec3(1), 0.35);

      layers.push(createStreaks(pairLayer(s, u, view, gain), view, Math.floor(n * params.share.pairs) & ~1));
      layers.push(
        createStreaks(
          silkLayer({
            view,
            flow: flowOf(s, u, params.silk.length),
            beads: params.silk.beads,
            tau: u.clockC,
            trail: u.trailC,
            c: s.c,
            width: params.silk.width,
            colour: thermalWhite.mul(u.photon).mul(params.silk.intensity * gain),
            shade: (h) => heat(h, u),
          }),
          view,
          Math.floor(n * params.share.silk),
        ),
      );
      layers.push(createStreaks(neutrinoLayer(s, u, view, gain), view, Math.floor(n * params.share.neutrinos)));
      layers.push(
        createStreaks(
          eventLayer({
            view,
            clock: u.clockC,
            period: params.events.period,
            rate: uEventRate,
            approach: params.events.approach,
            flight: params.events.flight,
            particleWidth: s.pairWidth * 1.4,
            flashWidth: 0.08,
            photonWidth: 0.005,
            matter: vec3(s.electronTint[0], s.electronTint[1], s.electronTint[2]).mul(2.2 * gain),
            antimatter: vec3(s.positronTint[0], s.positronTint[1], s.positronTint[2]).mul(2.2 * gain),
            flash: vec3(1, 0.97, 0.92).mul(8 * gain),
            photon: thermalWhite.mul(5 * gain),
            creation: uCreation,
          }),
          view,
          nEvents * EVENT_PARTS,
        ),
      );
      // One surviving electron per proton (charge balance): nucleons less the neutrons left at the chapter's end.
      const nElectrons = Math.max(1, Math.round(nNucleons * (1 - abundancesAt(CHAPTER.tEnd).neutrons)));
      layers.push(createStreaks(excessLayer(s, u, view, gain), view, nElectrons));
      layers.push(createStreaks(nucleonLayer(s, u, view, gain), view, nNucleons * NUCLEON_PARTS));

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

    update(local: number, g: Globals, dt: number) {
      const b = params.beats;
      u.local.value = local;
      clockM.advance(dt, params.massiveBeta);
      clockC.advance(dt, 1);
      u.clockM.value = clockM.value;
      u.clockC.value = clockC.value;
      u.morph.value = clockM.value * params.morphRate;
      u.trailQ.value = params.pairTrailWall * params.massiveBeta;
      u.trailC.value = params.trailWall;

      u.decouple.value = smoothstep(b.decoupleStart, b.decoupleEnd, local);
      const pairs = pairAt(local);
      u.pairs.value = pairs;
      // Pair events: annihilation ∝ n², creation only while kT is high enough (stops near 10 s).
      uEventRate.value = params.events.rate * pairs * pairs;
      uCreation.value = 0.5 * (1 - smoothstep(CREATION_END_LOCAL - 0.12, CREATION_END_LOCAL, local));
      u.excess.value = smoothstep(b.excessStart, b.excessEnd, local);
      u.neutron.value = abundancesAt(g.t).neutrons;
      // §6.3: T·a rises by (11/4)^(1/3) across e⁺e⁻ annihilation; photon energy density per comoving volume ∝ (T·a)⁴.
      const ta = (g.T * g.a) / T_CMB0;
      u.photon.value = Math.pow(ta / EE_TA_RATIO, 4);

      blackbodyRGB(g.T, rgb);
      u.thermal.value.setRGB(rgb[0], rgb[1], rgb[2]);
      bath.uniforms.intensity.value = params.bathIntensity * u.photon.value;

      const c = params.camera;
      const tC = clockC.value;
      const z = -(c.travel * local + c.drift * clockM.value);
      camera.position.set(c.sway * Math.sin(tC * 0.033 + 1.6), 0.6 * c.sway * Math.sin(tC * 0.027 + 0.4), z);
      const yaw = 0.16 * Math.sin(local * 1.9 + 2.2) + 0.04 * Math.sin(tC * 0.017);
      const pitch = 0.05 * Math.sin(local * 1.3 + 0.9) + 0.02 * Math.sin(tC * 0.021 + 1.5);
      target.set(camera.position.x + Math.sin(yaw) * 4, camera.position.y + Math.sin(pitch) * 4, camera.position.z - Math.cos(yaw) * 4);
      camera.lookAt(target);
      camera.rotateZ(0.03 * Math.sin(tC * 0.013 + local));
      camera.updateMatrixWorld();
      // Hero nucleon: drifts from the side to frame centre as the chapter ends (the zoom into BBN lands on it).
      const h = params.hero;
      const e = smoothstep(h.from, 1, local);
      heroOffset.set(
        h.start[0] + (h.end[0] - h.start[0]) * e + 0.03 * Math.sin(tC * 0.29),
        h.start[1] + (h.end[1] - h.start[1]) * e + 0.02 * Math.sin(tC * 0.23 + 1),
        h.start[2] + (h.end[2] - h.start[2]) * e,
      );
      heroOffset.applyQuaternion(camera.quaternion);
      u.heroPos.value.copy(camera.position).add(heroOffset);
      u.heroVis.value = smoothstep(h.from, h.to, local);
      u.decay.value = smoothstep(h.decayAt - 0.005, h.decayAt + h.decayLength, local);
      u.handoff.value = smoothstep(0.72, 1, local);
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
  return self;
};
