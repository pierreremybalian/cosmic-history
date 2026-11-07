// darkEnergy — the expansion speeds up (HANDOFF §9.12) · measured.
//
// Beats (src/content/chapters/darkEnergy.mdx):
//   0.14  gravity slowed the expansion; now it speeds up   → pull back from the Milky Way; past billion-year rings
//                                                            crowd together toward the present (deceleration)
//   0.30  the web keeps its shape, spacing grows ~14%       → camera holds; web, galaxies and cluster tethers
//                                                            stretch by the measured a(t)/a(t_start)
//   0.48  dark energy: energy of empty space                → the moving "now" ring crosses the 9 Gyr ring
//   0.64  matter thins, dark energy doesn't                 → (HUD gauge); slow drift
//   0.80  dark energy climbs from ~1/3 to over 40%          → future rings appear, spacing widening (acceleration)
//   0.92  today it makes up 68%                             → camera must pull back faster to keep up; calm end
// Opens on cosmicNoon's last frame (MW_FRAME) for the 'stretch' hand-off; ends wide for the zoom into the Sun.

import { Color, PerspectiveCamera, Quaternion, Scene, Vector3, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { aAt, AGE_SECONDS, globalsAt } from '../../physics/cosmology.ts';
import { GYR_S } from '../../physics/constants.ts';
import { madauDickinsonSFR } from '../../physics/recombination.ts';
import { webAmplitude, WORLD_BOX } from '../../shared/gaussianField.ts';
import { clamp01, smoothstep, smootherstep } from '../../shared/math.ts';
import { createCosmicWeb, type CosmicWeb } from '../../shared/web.ts';
import {
  addNearFade,
  addSphereFade,
  createGalaxyImpostors,
  createSpiralGalaxy,
  monotoneTrack,
  mwSway,
  MW_FRAME,
  peakWorld,
  pickMilkyWayPeak,
  tileBox,
  type GalaxyImpostors,
  type SpiralGalaxy,
  type Tiles,
} from '../cosmicNoon/galaxies.ts';
import { sceneRange } from '../sceneRange.ts';
import type { CosmicScene, RenderContext } from '../types.ts';
import { createExpansionRings, createTrails, type ExpansionRings, type Trails } from './shaders.ts';

const params = {
  fov: 40,
  web: {
    brightness: 0.09,
    contrast: 1.35,
    /** Fraction of web particles shown, densest first (hides the diffuse void population). */
    reveal: 0.55,
    tint: new Color(0.72, 0.8, 1.0),
    /** Outer tiles draw this fraction of the particles. */
    outerFraction: 0.25,
    /** Round patch of universe: visible inside r0, gone by r1 (world, comoving at chapter start). */
    sphere: [5.0, 8.5] as const,
  },
  galaxies: { radius: 0.085, field: { low: 1500, medium: 3500, high: 6000 }, outerFraction: 0.5 },
  milkyWay: { stars: { low: 45_000, medium: 120_000, high: 240_000 }, handover: [1.1, 0.45] as const, glow: 1.0, bar: 0.8 },
  rings: {
    /** Reference comoving radius (world units at the chapter start). */
    rRef: 2.3,
    /** Outermost forecast ring, Gyr. */
    tMaxGyr: 40,
    /** local ranges: past rings fade in; the forecast plays forward (front from now → tMaxGyr). */
    pastIn: [0.1, 0.3] as const,
    forecast: [0.72, 0.96] as const,
    /** Keep the forecast front at this fraction of the half-height while the camera chases it. */
    frontFrame: 0.85,
  },
  trails: {
    /** Tagged galaxies: halo peaks at comoving distances in this range from the Milky Way (world units). */
    distance: [1.4, 3.2] as const,
    count: 30,
  },
  camera: {
    logDistance: [
      [0.0, Math.log10(MW_FRAME.radius * MW_FRAME.distance)],
      [0.06, Math.log10(0.34)],
      [0.14, Math.log10(1.6)],
      [0.22, Math.log10(6.0)],
      [0.3, Math.log10(9.5)],
      [0.5, Math.log10(10.6)],
      [0.72, Math.log10(12.0)],
      [1.0, Math.log10(12.5)],
    ] as [number, number][],
    /** Final view: rotate the closing cosmicNoon view about world Y, then raise it (radians). */
    endYaw: -0.6,
    endPitch: 0.32,
    turn: [0.05, 0.9] as const,
  },
  spinRate: 0.02,
};

const RANGE = sceneRange('darkEnergy');

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
  let webTiles: Tiles;
  let galaxies: GalaxyImpostors;
  let galTiles: Tiles;
  let mw: SpiralGalaxy;
  let rings: ExpansionRings;
  let trails: Trails;
  let ctxRef: RenderContext;
  let mwPeak = 0;
  let a0 = 1;
  const logD = monotoneTrack(params.camera.logDistance);
  const sphereCenter = uniform(new Vector3());
  const sphere0 = uniform(1);
  const sphere1 = uniform(2);
  const near0 = uniform(0.1);
  const near1 = uniform(0.3);
  const mwPos = new Vector3();
  const startDir = new Vector3();
  const endDir = new Vector3();
  const dir = new Vector3();
  const yAxis = new Vector3(0, 1, 0);
  const tmp = new Vector3();
  const q = new Quaternion();

  return {
    id: 'darkEnergy',
    range: RANGE,
    accuracy: 'measured',
    accuracyNote:
      'Distances stretch by the measured expansion a(t) (Planck 2018 ΛCDM); rings mark the size of one sphere of galaxies every billion years, dashed beyond this chapter as the forecast; galaxies are drawn ~40× larger than true scale and bound clusters do not expand.',
    colourMapped: false,

    async init(ctx: RenderContext) {
      renderer = ctx.renderer;
      ctxRef = ctx;
      await ctx.field.ready;
      scene = new Scene();
      camera = new PerspectiveCamera(params.fov, 1, 0.002, 600);
      a0 = aAt(RANGE[0]);
      const tier = ctx.quality.name;

      web = createCosmicWeb(ctx);
      web.uniforms.tint.value.copy(params.web.tint);
      web.uniforms.brightness.value = params.web.brightness;
      web.uniforms.contrast.value = params.web.contrast;
      web.uniforms.reveal.value = params.web.reveal;
      addSphereFade(web.material, sphereCenter, sphere0, sphere1);
      addNearFade(web.material, near0, near1);
      webTiles = tileBox(web.material, web.count, Math.round(web.count * params.web.outerFraction));
      scene.add(webTiles.group);

      mwPeak = pickMilkyWayPeak(ctx.field);
      galaxies = createGalaxyImpostors(ctx, {
        fieldGalaxies: params.galaxies.field[tier],
        radius: params.galaxies.radius,
        companions: 90,
        milkyWay: mwPeak,
        seed: 1104,
      });
      addSphereFade(galaxies.material, sphereCenter, sphere0, sphere1);
      const nPeaksAndComp = galaxies.count - params.galaxies.field[tier];
      galTiles = tileBox(galaxies.material, galaxies.count, nPeaksAndComp + Math.round(params.galaxies.field[tier] * params.galaxies.outerFraction));
      scene.add(galTiles.group);

      mw = createSpiralGalaxy({ stars: params.milkyWay.stars[tier], seed: 2024, armSeed: 0.15 });
      mw.uniforms.glow.value = params.milkyWay.glow;
      mw.uniforms.bar.value = params.milkyWay.bar;
      mw.uniforms.settle.value = 1;
      q.setFromUnitVectors(yAxis, MW_FRAME.normal);
      mw.group.quaternion.copy(q);
      mw.group.scale.setScalar(MW_FRAME.radius);
      scene.add(mw.group);

      // Directions: open exactly on cosmicNoon's closing view; end looking down on the rings.
      endDir.copy(MW_FRAME.view).applyAxisAngle(yAxis, params.camera.endYaw);
      tmp.crossVectors(yAxis, endDir).normalize();
      endDir.applyAxisAngle(tmp, -params.camera.endPitch).normalize();

      rings = createExpansionRings({ rRef: params.rings.rRef, a0, tMaxGyr: params.rings.tMaxGyr });
      rings.uniforms.tToday.value = AGE_SECONDS / GYR_S;
      rings.mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), endDir);
      scene.add(rings.mesh);

      // Tagged galaxies for the stroboscopic trails: the brightest halos at moderate distances, any direction.
      const fd = ctx.field.data!;
      const A0 = webAmplitude(a0);
      peakWorld(ctx.field, mwPeak, A0, mwPos);
      const offsets: Vector3[] = [];
      const nPk = fd.peaks.length / 4;
      for (let i = 0; i < nPk && offsets.length < params.trails.count; i++) {
        if (i === mwPeak) continue;
        const v = peakWorld(ctx.field, i, A0, new Vector3()).sub(mwPos);
        v.x -= Math.round(v.x / WORLD_BOX) * WORLD_BOX;
        v.y -= Math.round(v.y / WORLD_BOX) * WORLD_BOX;
        v.z -= Math.round(v.z / WORLD_BOX) * WORLD_BOX;
        const d = v.length();
        if (d > params.trails.distance[0] && d < params.trails.distance[1]) offsets.push(v);
      }
      trails = createTrails({ offsets, a0, tMaxGyr: params.rings.tMaxGyr, resolution: ctx.globals.uResolution, fovDeg: params.fov });
      scene.add(trails.sprite);

      this.update(0.5, globalsAt((RANGE[0] + RANGE[1]) / 2), 0, 0);
      await renderer.compileAsync(scene, camera);
    },

    update(local, g, _dt, elapsed) {
      const A = webAmplitude(g.a);
      // Physical / comoving stretch since the chapter began (≈ 1.136 at the end). Clamped for odd globals (leak test).
      const s = Math.min(Math.max(g.a / a0, 0.5), 2);
      const sfr = clamp01(madauDickinsonSFR(g.z) / SFR_PEAK);
      const spin = elapsed * params.spinRate;
      const tGyr = g.t / GYR_S;

      peakWorld(ctxRef.field, mwPeak, A, mwPos);
      web.uniforms.amplitude.value = A;
      web.uniforms.scale.value = s;
      webTiles.place(mwPos, s);
      const G = galaxies.uniforms;
      G.amplitude.value = A;
      G.scale.value = s;
      G.sf.value = sfr;
      G.maturity.value = 0.95 + 0.05 * local;
      G.mergeClock.value = 2;
      G.spin.value = spin;
      galTiles.place(mwPos, s);
      sphereCenter.value.copy(mwPos);
      sphere0.value = params.web.sphere[0] * s;
      sphere1.value = params.web.sphere[1] * s;

      // Camera: open on the Milky Way exactly as cosmicNoon left it, pull back, hold while space stretches,
      // then pull back faster to keep the widening forecast rings in frame.
      // Forecast: linear in scroll, so the front's exponential run-away (and the camera chasing it) is the
      // visible acceleration.
      const fc = smoothstep(params.rings.forecast[0], params.rings.forecast[1], local);
      const tNowGyr = Math.max(tGyr, RANGE[0] / GYR_S);
      const tFront = tNowGyr + (params.rings.tMaxGyr - tNowGyr) * fc;
      const rFront = (params.rings.rRef * aAt(tFront * GYR_S)) / a0;
      const halfTan = Math.tan(((params.fov / 2) * Math.PI) / 180);
      const D = Math.max(Math.pow(10, logD(local)), rFront / (halfTan * params.rings.frontFrame));
      startDir.copy(MW_FRAME.view).applyAxisAngle(yAxis, mwSway(elapsed));
      const turn = smootherstep(params.camera.turn[0], params.camera.turn[1], local);
      dir.copy(startDir).lerp(endDir, turn).normalize();
      camera.position.copy(mwPos).addScaledVector(dir, D);
      camera.lookAt(mwPos);
      camera.near = Math.max(0.0015, D * 0.01);
      camera.far = Math.max(80, D * 6);
      camera.updateProjectionMatrix();
      near0.value = D * 0.2;
      near1.value = D * 0.45;
      G.size.value = 1 + 0.9 * smoothstep(3, 20, D);
      web.uniforms.size.value = Math.min(1.1, Math.max(0.12, D * 0.11));
      web.uniforms.brightness.value = params.web.brightness * smoothstep(0.4, 3, D);

      // Particle Milky Way → impostor as we leave it.
      const hand = smoothstep(params.milkyWay.handover[0], params.milkyWay.handover[1], D);
      G.milkyWay.value = 1 - hand;
      mw.group.visible = hand > 1e-3;
      mw.group.position.copy(mwPos);
      mw.uniforms.brightness.value = hand;
      mw.uniforms.sf.value = sfr * 1.35;
      mw.uniforms.spin.value = spin;

      // Rings sit on the Milky Way, in the plane facing the final view.
      rings.mesh.position.copy(mwPos);
      const R = rings.uniforms;
      R.tNow.value = tGyr;
      R.past.value = smoothstep(params.rings.pastIn[0], params.rings.pastIn[1], local);
      R.now.value = R.past.value;
      R.future.value = smoothstep(params.rings.forecast[0], params.rings.forecast[0] + 0.03, local);
      R.tFront.value = tFront;
      trails.sprite.position.copy(mwPos);
      const T = trails.uniforms;
      T.tNow.value = tGyr;
      T.tFront.value = tFront;
      T.past.value = R.past.value;
      T.future.value = R.future.value;
      R.brightness.value = 1;

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
      rings.dispose();
      trails.dispose();
    },
  };
};
