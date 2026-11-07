// cosmicNoon — peak star formation & the Milky Way (HANDOFF §9.11) · simulated.
//
// Beats (src/content/chapters/cosmicNoon.mdx):
//   0.14  galaxies grown along the web, colliding and merging  → impostors on the field's peaks, companions spiral in
//   0.26  bursts of star formation                              → blue young stars + pink Hα knots brighten with SFR(z)
//   0.37  cosmic noon (3.5 Gyr), SFR peak                       → global blaze at its brightest
//   0.52  winding down                                          → knots fade, ellipticals appear in the densest groups
//   0.68  zoom into one young spiral swallowing neighbours      → camera dives in, impostor → particle disk, satellites sink
//   0.86  it becomes the Milky Way; disk settles, arms form     → clumpy thick disk → thin barred grand-design spiral
// Continuity: same web (createCosmicWeb, A = webAmplitude(a)) and the same halos (field peaks) as the structure
// scenes; ends on MW_FRAME, which darkEnergy opens on.

import { Color, PerspectiveCamera, Quaternion, Scene, SpriteNodeMaterial, Vector3, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
import { aAt, globalsAt } from '../../physics/cosmology.ts';
import { madauDickinsonSFR } from '../../physics/recombination.ts';
import { webAmplitude } from '../../shared/gaussianField.ts';
import { clamp01, smoothstep } from '../../shared/math.ts';
import { createCosmicWeb, type CosmicWeb } from '../../shared/web.ts';
import { sceneRange } from '../sceneRange.ts';
import type { CosmicScene, RenderContext } from '../types.ts';
import { uniform } from 'three/tsl';
import {
  addNearFade,
  createGalaxyImpostors,
  createSpiralGalaxy,
  monotoneTrack,
  MW_ARM_START,
  mwSway,
  MW_FRAME,
  peakWorld,
  pickMilkyWayPeak,
  type GalaxyImpostors,
  type SpiralGalaxy,
} from './galaxies.ts';
import { createSatellites, type Satellites } from './shaders.ts';

const params = {
  fov: 40,
  web: {
    brightness: 0.06,
    /** Show the densest fraction of web particles (filaments and knots; voids stay dark). */
    reveal: 0.6,
    tint: new Color(0.5, 0.62, 1.0),
    /** Tint of the gas web at the star-formation peak (Hα-pink glow of star-forming gas), and the brightness gain. */
    sfTint: new Color(0.95, 0.55, 0.85),
    sfGain: 0.9,
    /** View depth over which web particles fade out in front of the camera, as fractions of the camera distance. */
    near: [0.3, 0.75] as const,
    /** Sprite size multiplier: ∝ camera distance (so particles stay fine up close), capped. */
    size: [0.12, 1.0] as const,
    /** Camera distance (world) over which the web fades out as we dive into one galaxy. */
    fade: [0.5, 2.2] as const,
  },
  galaxies: {
    /** World radius of a bright galaxy (true ≈ 0.002: drawn ~40× larger so shapes read at this scale). */
    radius: 0.085,
    field: { low: 2500, medium: 5000, high: 8000 },
    companions: 90,
    brightness: 1.0,
    /** Morphological maturity at local 0 and 1. */
    maturity: [0.05, 0.95] as const,
  },
  milkyWay: {
    stars: { low: 45_000, medium: 120_000, high: 240_000 },
    /** Camera distance (world) over which the impostor hands over to the particle disk. */
    handover: [0.9, 0.42] as const,
    /** local range over which the clumpy disk settles into a grand-design spiral. */
    settle: [0.6, 0.97] as const,
    /** Bar grows over this local range to this strength (the MW bar is ~8 Gyr old). */
    bar: [0.7, 0.92, 0.8] as const,
    /** The young MW forms stars faster than the cosmic average. */
    sfBoost: 1.35,
    glow: 1.0,
  },
  satellites: { count: 4, streamStars: 1600, sink: [0.58, 1.0] as const },
  camera: {
    /** log10 of camera distance (world units) vs local. */
    logDistance: [
      [0.0, Math.log10(16)],
      [0.14, Math.log10(7.5)],
      [0.26, Math.log10(3.6)],
      [0.37, Math.log10(2.2)],
      [0.52, Math.log10(2.0)],
      [0.6, Math.log10(1.4)],
      [0.68, Math.log10(0.6)],
      [0.78, Math.log10(MW_FRAME.radius * 4.6)],
      [0.88, Math.log10(MW_FRAME.radius * 3.6)],
      [1.0, Math.log10(MW_FRAME.radius * MW_FRAME.distance)],
    ] as [number, number][],
    /** Orbit angle (rad about world Y) relative to the closing view, vs local. */
    azimuth: [
      [0, 1.25],
      [0.4, 0.75],
      [0.7, 0.3],
      [1, 0],
    ] as [number, number][],
    /** Elevation offset (rad) relative to the closing view, vs local. */
    elevation: [
      [0, -0.28],
      [0.5, -0.1],
      [1, 0],
    ] as [number, number][],
    /** local ranges: look-at point moves box centre → a massive merging group near us → the Milky Way. */
    toShowcase: [0.03, 0.24] as const,
    toMilkyWay: [0.42, 0.62] as const,
    /** The showcase group: the highest halo peak at this distance range (world units) from the Milky Way. */
    showcaseDistance: [1.4, 3.6] as const,
  },
  /** Idle rotation of galaxy patterns (rad/s). One MW turn takes ~240 Myr; here it takes minutes. */
  spinRate: 0.02,
};

const RANGE = sceneRange('cosmicNoon');

/** Peak of the Madau–Dickinson fit over z ∈ [0, 10] (computed, for normalisation). */
const SFR_PEAK = (() => {
  let m = 0;
  for (let z = 0; z <= 10; z += 0.005) m = Math.max(m, madauDickinsonSFR(z));
  return m;
})();

export default (): CosmicScene => {
  let renderer: WebGPURenderer;
  let scene: Scene;
  let camera: PerspectiveCamera;
  let web: CosmicWeb;
  let galaxies: GalaxyImpostors;
  let mw: SpiralGalaxy;
  let sats: Satellites;
  let ctxRef: RenderContext;
  let mwPeak = 0;
  let showcasePeak = 0;
  const satNear0 = uniform(0.05);
  const satNear1 = uniform(0.12);
  const webNear0 = uniform(1);
  const webNear1 = uniform(2);
  const logD = monotoneTrack(params.camera.logDistance);
  const azim = monotoneTrack(params.camera.azimuth);
  const elev = monotoneTrack(params.camera.elevation);
  const mwPos = new Vector3();
  const showPos = new Vector3();
  const look = new Vector3();
  const dir = new Vector3();
  const yAxis = new Vector3(0, 1, 0);
  const right = new Vector3();
  const q = new Quaternion();

  return {
    id: 'cosmicNoon',
    range: RANGE,
    accuracy: 'simulated',
    accuracyNote:
      'Galaxies sit on the same simulated web, drawn ~40× too large; star-formation glow follows Madau & Dickinson 2014; mergers and spin are hugely sped up.',
    colourMapped: false,

    async init(ctx: RenderContext) {
      renderer = ctx.renderer;
      ctxRef = ctx;
      await ctx.field.ready;
      scene = new Scene();
      camera = new PerspectiveCamera(params.fov, 1, 0.002, 400);

      web = createCosmicWeb(ctx);
      web.uniforms.tint.value.copy(params.web.tint);
      web.uniforms.brightness.value = params.web.brightness;
      web.uniforms.reveal.value = params.web.reveal;
      addNearFade(web.material, webNear0, webNear1);
      scene.add(web.object);

      mwPeak = pickMilkyWayPeak(ctx.field);
      {
        // Peaks are sorted by height: the first one in the distance window is the most massive group near us.
        const A1 = webAmplitude(aAt(RANGE[0] + 0.3 * (RANGE[1] - RANGE[0])));
        peakWorld(ctx.field, mwPeak, A1, mwPos);
        const n = ctx.field.data!.peaks.length / 4;
        for (let i = 0; i < n; i++) {
          if (i === mwPeak) continue;
          const d = peakWorld(ctx.field, i, A1, showPos).distanceTo(mwPos);
          if (d > params.camera.showcaseDistance[0] && d < params.camera.showcaseDistance[1]) {
            showcasePeak = i;
            break;
          }
        }
      }
      const tier = ctx.quality.name;
      galaxies = createGalaxyImpostors(ctx, {
        fieldGalaxies: params.galaxies.field[tier],
        radius: params.galaxies.radius,
        companions: params.galaxies.companions,
        milkyWay: mwPeak,
        seed: 1104,
      });
      galaxies.uniforms.brightness.value = params.galaxies.brightness;
      scene.add(galaxies.object);

      mw = createSpiralGalaxy({ stars: params.milkyWay.stars[tier], seed: 2024, armSeed: 0.15, armStart: MW_ARM_START });
      mw.uniforms.glow.value = params.milkyWay.glow;
      sats = createSatellites({ count: params.satellites.count, streamStars: params.satellites.streamStars });
      mw.group.add(sats.sprites);
      mw.group.add(sats.stream);
      addNearFade(sats.sprites.material as SpriteNodeMaterial, satNear0, satNear1);
      addNearFade(sats.stream.material as SpriteNodeMaterial, satNear0, satNear1);
      q.setFromUnitVectors(yAxis, MW_FRAME.normal);
      mw.group.quaternion.copy(q);
      mw.group.scale.setScalar(MW_FRAME.radius);
      scene.add(mw.group);

      this.update(0.5, globalsAt((RANGE[0] + RANGE[1]) / 2), 0, 0);
      await renderer.compileAsync(scene, camera);
    },

    update(local, g, _dt, elapsed) {
      const A = webAmplitude(g.a);
      const sfr = clamp01(madauDickinsonSFR(g.z) / SFR_PEAK);
      const spin = elapsed * params.spinRate;

      // Web and galaxies share the Zel'dovich amplitude, so halos stay on their filaments.
      web.uniforms.amplitude.value = A;
      const G = galaxies.uniforms;
      G.amplitude.value = A;
      G.sf.value = sfr;
      G.brightness.value = params.galaxies.brightness * (0.75 + 0.5 * sfr);
      G.maturity.value = params.galaxies.maturity[0] + (params.galaxies.maturity[1] - params.galaxies.maturity[0]) * local;
      G.mergeClock.value = local;
      G.spin.value = spin;
      // Distant galaxies are drawn a little larger in wide shots so their shapes stay legible.

      // Camera: log-distance track toward the Milky Way host, orbiting into the closing view.
      peakWorld(ctxRef.field, mwPeak, A, mwPos);
      const D = Math.pow(10, logD(local));
      peakWorld(ctxRef.field, showcasePeak, A, showPos);
      look.set(0, 0, 0).lerp(showPos, smoothstep(params.camera.toShowcase[0], params.camera.toShowcase[1], local));
      look.lerp(mwPos, smoothstep(params.camera.toMilkyWay[0], params.camera.toMilkyWay[1], local));
      dir.copy(MW_FRAME.view);
      right.crossVectors(yAxis, dir).normalize();
      dir.applyAxisAngle(right, -elev(local));
      dir.applyAxisAngle(yAxis, azim(local) + mwSway(elapsed));
      camera.position.copy(look).addScaledVector(dir, D);
      camera.lookAt(look);
      camera.near = Math.max(0.0015, D * 0.01);
      camera.far = Math.max(60, D * 6);
      camera.updateProjectionMatrix();

      // Web fades as we dive into one galaxy.
      // Global star-formation glow: the gas web brightens and warms toward Hα pink with the cosmic SFR.
      web.uniforms.brightness.value =
        params.web.brightness * (1 + params.web.sfGain * sfr) * smoothstep(params.web.fade[0], params.web.fade[1], D);
      web.uniforms.tint.value.copy(params.web.tint).lerp(params.web.sfTint, 0.45 * sfr);
      web.object.visible = web.uniforms.brightness.value > 1e-3;
      webNear0.value = D * params.web.near[0];
      webNear1.value = D * params.web.near[1];
      G.size.value = 1 + 1.5 * smoothstep(3, 14, D);
      satNear0.value = D * 0.35;
      satNear1.value = D * 0.8;
      web.uniforms.size.value = Math.min(params.web.size[1], Math.max(params.web.size[0], D * 0.11));

      // Impostor → particle Milky Way handover.
      const M = params.milkyWay;
      const hand = smoothstep(M.handover[0], M.handover[1], D);
      G.milkyWay.value = 1 - hand;
      // Clear the Milky Way's immediate surroundings of impostors while we look at it up close.
      G.clearCenter.value.copy(mwPos);
      G.clearRadius.value = MW_FRAME.radius * 2.6 * smoothstep(0.7, 0.3, D);
      mw.group.visible = hand > 1e-3;
      mw.group.position.copy(mwPos);
      const U = mw.uniforms;
      U.brightness.value = hand;
      U.settle.value = 0.12 + 0.88 * smoothstep(M.settle[0], M.settle[1], local);
      U.bar.value = M.bar[2] * smoothstep(M.bar[0], M.bar[1], local);
      U.sf.value = sfr * M.sfBoost;
      U.spin.value = spin;
      U.starSize.value = 1;
      const S = sats.uniforms;
      S.sink.value = smoothstep(params.satellites.sink[0], params.satellites.sink[1], local);
      S.spin.value = spin;
      S.sf.value = sfr;
      S.brightness.value = hand;
    },

    render(target: RenderTarget) {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    },

    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },

    dispose() {
      web.dispose();
      galaxies.dispose();
      mw.dispose();
      sats.dispose();
    },
  };
};
