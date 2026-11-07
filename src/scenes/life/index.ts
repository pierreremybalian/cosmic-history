// life — oceans to humans (HANDOFF §9.14). Spans chapters `life` (linear) and `complexLife` (lookback-log).
// `local` restarts at the chapter boundary, so everything is driven by lookback L = AGE_SECONDS − t (Myr),
// keyed to the dated events in public/data/events.json. Camera pacing uses u ∈ [0,1], scroll progress
// across both chapters, so moves are even in scroll while the planet's state follows real dates.

import {
  AdditiveBlending,
  Color,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Sprite,
  SpriteNodeMaterial,
  Vector3,
  type RenderTarget,
  type WebGPURenderer,
} from 'three/webgpu';
import { float, smoothstep, uniform, uv } from 'three/tsl';
import { AGE_SECONDS, type Globals } from '../../physics/cosmology.ts';
import { MYR_S, YEAR_S } from '../../physics/constants.ts';
import { MonotoneCubic } from '../../physics/interp.ts';
import { CHAPTER_STARTS, chapterIndex, lookbackToProgress } from '../../time/chapters.ts';
import { clamp01, smoothstep as sstep } from '../../shared/math.ts';
import { sceneRange } from '../sceneRange.ts';
import type { CosmicScene, RenderContext } from '../types.ts';
import events from '../../../public/data/events.json';
import {
  blackbodyColour,
  createPlanet,
  createStarfield,
  createSun,
  setAtmosphereUniforms,
  type AtmosphereSpec,
  type Planet,
  type Starfield,
  type SunSprite,
} from './planet.ts';
import { loadGeography, type Geography } from './geography.ts';
import { HANDOFF } from './handoff.ts';
import { PLATE, plateInverseQuats, siteAt, dirFromLatLon } from './plates.ts';
import { ARCHEAN_HAZE, EVENTS, EVENT_IDS, northIceSheet, params as T, sunLuminosity, table, tableRGB, type EventKey } from './timeline.ts';

// ── Tunables ───────────────────────────────────────────────────────────────────
export const params = {
  fov: HANDOFF.camera.fov,
  /** World direction toward the Sun (fixed; the camera orbits). */
  sunDir: HANDOFF.sunDir,
  sunDistance: 900,
  /** Sea-level drop at a glacial maximum, metres (LGM ≈ −120 to −130 m; Clark et al. 2009). */
  glacialDrawdownM: 120,
  /** Sun disc angular radius (rad), ~2× real for legibility. */
  sunAngularRadius: 0.009,
  sunHaloScale: 0.16,
  sunDiscRadiance: 40,
  /** Surface irradiance scale (1 ≈ white surface facing the Sun reads ≈ 1). */
  sunIntensity: 1.0,
  ambient: HANDOFF.ambient,
  /** Modern atmosphere, SI (Rayleigh at 680/550/440 nm; Mie; ozone Chappuis band). */
  atmosphere: {
    rayleigh: [5.802e-6, 13.558e-6, 33.1e-6],
    rayleighScaleHeightM: 8000,
    mie: 3.996e-6,
    mieScaleHeightM: 1200,
    mieG: 0.8,
    haze: [0, 0, 0],
    hazeAlbedo: 0.75,
    hazeScaleHeightM: 26000,
    ozone: [0.65e-6, 1.881e-6, 0.085e-6],
    exaggeration: 3,
  } satisfies AtmosphereSpec as AtmosphereSpec,
  /** Hadean steam/CO₂ atmosphere: extra Mie haze (white). */
  hadeanMie: 2.4e-5,
  /** Impact winter soot as an absorbing haze (1/m at sea level). */
  sootHaze: [1.1e-5, 1.25e-5, 1.4e-5] as const,
  stars: { count: 2600, radius: 2000, brightness: 0.55 },
  /** Idle spin (rad/s) for a 24 h day; scaled by 24 / day length. */
  idleSpin: 0.03,
  /** Scroll-coupled spin: revolutions across both chapters. */
  scrollTurns: 7,
  /** Cloud drift relative to the ground (rad/s). */
  cloudDrift: 0.005,
  /** Weather slides relative to the ground as time passes (radians across both chapters). */
  cloudEraTurn: -HANDOFF.cloudTurnStart,
  /** Camera keys over u (scroll progress across life + complexLife): u, az°, el°, distance, look offset x/y (planet radii, camera space). */
  camera: [
    [0.0, HANDOFF.camera.az, HANDOFF.camera.el, HANDOFF.camera.dist, 0, 0],
    [0.05, -36, 7, 4.8, 0, 0],
    [0.1, -42, 10, 4.4, 0, 0],
    [0.15, -22, 8, 4.6, 0, 0],
    // A brief cinematic moment: sunrise over the limb of the hazy Archean Earth (orange ring).
    [0.19, 84, 4, 3.8, -0.4, 0.08],
    [0.205, 101, 3.5, 3.3, -0.6, 0.16],
    [0.215, 102, 3.5, 3.3, -0.6, 0.16],
    // Back to a lit face for the Great Oxidation (u ≈ 0.23–0.25) and the snowball that follows.
    [0.24, -18, 12, 4.8, 0, 0],
    [0.27, -30, 18, 5.0, 0, 0],
    [0.3, -34, 16, 4.9, 0, 0],
    [0.34, -42, 11, 4.4, 0, 0],
    [0.4, -50, 8, 4.8, 0, 0],
    [0.44, -32, 22, 5.2, 0, 0],
    [0.462, -26, 16, 4.7, 0, 0],
    [0.48, -36, 10, 4.2, 0, 0],
    [0.51, -32, 12, 4.6, 0, 0],
    [0.555, -28, 14, 4.4, 0, 0],
    [0.585, -28, 14, 4.2, 0, 0],
    [0.62, -38, 10, 4.6, 0, 0],
    [0.68, -45, 9, 4.8, 0, 0],
    [0.745, -32, 28, 4.6, 0, 0],
    [0.83, -36, 30, 4.4, 0, 0],
    [0.9, -34, 18, 4.8, 0, 0],
    [0.96, -31, 10, 5.4, 0, 0],
    [1.0, HANDOFF.camera.az, HANDOFF.camera.el, HANDOFF.camera.dist, 0, 0],
  ] as const,
  /** Chicxulub (present-day lat/lon, on the North American plate). */
  chicxulub: [21.3, -89.5] as const,
  /** K–Pg: flash width, bolide lead-in, ring and soot spans (in u). */
  kpg: { flashU: 0.0022, bolideU: 0.006, ringU: 0.02, sootIn: 0.004, sootHold: 0.012, sootOut: 0.045 },
  /** Planet-rotation locks: [u ramp-in start, full from, full until, ramp-out end]. */
  locks: {
    kpg: [0.548, 0.566, 0.59, 0.612] as const,
    end: [0.715, 0.76, 1.0, 1.01] as const,
  },
  /**
   * Present-day longitude facing the camera during the closing lock: North America and the Atlantic while
   * the ice sheets come and go, Africa when Homo sapiens appears (u ≈ 0.855), Africa and Eurasia as people
   * spread out (u ≈ 0.935), Africa again for the calm final frame.
   */
  endLon: [
    [0.76, -78],
    [0.83, -50],
    [0.855, 18],
    [0.935, 38],
    [0.975, 20],
    [1.0, 20],
  ] as const,
};

const D2R = Math.PI / 180;

/** Camera track: monotone cubic per channel. */
function makeTrack(keys: readonly (readonly number[])[]) {
  const us = keys.map((k) => k[0]!);
  const ch = [1, 2, 3, 4, 5].map((c) => new MonotoneCubic(us, keys.map((k) => k[c]!)));
  return (u: number, out: number[]) => {
    const x = clamp01(u);
    for (let c = 0; c < 5; c++) out[c] = ch[c]!.at(x);
    return out;
  };
}

/** Bump 0→1→0 over [a,b,c,d] (smooth). */
function windowW(w: readonly [number, number, number, number], u: number): number {
  return sstep(w[0], w[1], u) * (1 - sstep(w[2], w[3], u));
}

function loadEventDates(): void {
  type Ev = { id: string; lookback_years?: { best: number } };
  for (const key of Object.keys(EVENT_IDS) as EventKey[]) {
    const ev = (events as Ev[]).find((e) => e.id === EVENT_IDS[key]);
    if (ev?.lookback_years) EVENTS[key] = ev.lookback_years.best / 1e6;
  }
}

export default (): CosmicScene => {
  let renderer: WebGPURenderer;
  let scene: Scene;
  let camera: PerspectiveCamera;
  let planet: Planet;
  let sun: SunSprite;
  let stars: Starfield;
  let geo: Geography | null = null;
  let bolide: Sprite;
  let bolideMat: SpriteNodeMaterial;
  const bolideGlow = uniform(0);

  const sunDir = new Vector3(...params.sunDir).normalize();
  const cam = [0, 0, 0, 0, 0];
  const track = makeTrack(params.camera);
  const tmpC = new Color();
  const rgb: [number, number, number] = [0, 0, 0];
  const atmo: AtmosphereSpec = structuredClone(params.atmosphere);
  const v3 = new Vector3();
  const v3b = new Vector3();
  const qTmp = new Quaternion();
  const yAxis = new Vector3(0, 1, 0);
  const impactLocal = new Vector3();
  const endSite = new Vector3();
  const lookAt = new Vector3();

  // u (scroll progress across both chapters) ↔ lookback
  const iLife = chapterIndex('life');
  const iComplex = chapterIndex('complexLife');
  const p0 = CHAPTER_STARTS[iLife]!;
  const p1 = CHAPTER_STARTS[iComplex + 1]!;
  const uAt = (Lsec: number) => clamp01((lookbackToProgress(Lsec) - p0) / (p1 - p0));
  let uKpg = 0.5724;

  // Planet rotation: a free angle integrates idle + scroll spin; locks pull it onto targets (see update).
  let thetaFree = 0;
  let lockK = 0;
  let locked = false;
  let prevU = -1;
  let cloudFree = 0;
  let cloudK = 0;
  let cloudLocked = false;

  const self: CosmicScene = {
    id: 'life',
    range: sceneRange('life'),
    accuracy: 'measured',
    accuracyNote:
      "Dates are measured; the planet's look is illustrative: today's continents drift on simplified paths, and today's terrain is flooded or drained to each era's estimated sea level (±50 m).",
    colourMapped: false,
    async init(ctx: RenderContext) {
      renderer = ctx.renderer;
      loadEventDates();
      uKpg = uAt(EVENTS.dinosaursExtinct * MYR_S);
      scene = new Scene();
      camera = new PerspectiveCamera(params.fov, 1, 0.01, 5000);
      geo = await loadGeography(ctx.assets);
      planet = createPlanet({ quality: ctx.quality, lut: ctx.globals.lut, geography: geo });
      planet.u.ambient.value = params.ambient;
      scene.add(planet.group);

      sun = createSun();
      blackbodyColour(5772, tmpC);
      sun.colour.value.copy(tmpC);
      sun.intensity.value = params.sunDiscRadiance;
      sun.object.position.copy(sunDir).multiplyScalar(params.sunDistance);
      sun.object.scale.setScalar(params.sunDistance * params.sunAngularRadius * 2);
      sun.halo.position.copy(sun.object.position);
      sun.halo.scale.setScalar(params.sunDistance * params.sunHaloScale);
      scene.add(sun.object, sun.halo);

      stars = createStarfield(params.stars.count, params.stars.radius, 11, ctx.globals.lut);
      stars.brightness.value = params.stars.brightness;
      scene.add(stars.object);

      // K–Pg bolide: a small incandescent point with a glow, falling toward Chicxulub.
      bolideMat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
      const r = uv().sub(0.5).length().mul(2);
      const core = float(1).sub(smoothstep(0.0, 0.25, r)).mul(12).add(float(1).sub(smoothstep(0.0, 1.0, r)).pow(3).mul(1.5));
      blackbodyColour(5500, tmpC);
      bolideMat.colorNode = uniform(tmpC.clone()).mul(core).mul(bolideGlow);
      bolideMat.opacityNode = float(1).sub(smoothstep(0.8, 1.0, r));
      bolide = new Sprite(bolideMat);
      bolide.scale.setScalar(0.05);
      bolide.visible = false;
      scene.add(bolide);

      await renderer.compileAsync(scene, camera);
    },

    update(_local: number, g: Globals, dt: number, elapsed: number) {
      // ── time ──
      const Ls = Math.max(0, Math.min(AGE_SECONDS - g.t, 4.6e3 * MYR_S));
      const L = Ls / MYR_S; // Myr ago
      const u = uAt(Math.max(Ls, 1e4 * YEAR_S));
      const pu = planet.u;

      // ── atmosphere ──
      const o2 = table(T.logO2, L);
      const haze = table(T.haze, L);
      const ozone = clamp01((o2 + 3.5) / 3); // the ozone layer forms at ~1 % PAL
      const kpgSoot = sstep(uKpg, uKpg + params.kpg.sootIn, u) * (1 - sstep(uKpg + params.kpg.sootHold, uKpg + params.kpg.sootOut, u));
      const hadean = clamp01((L - 4000) / 400);
      atmo.mie = params.atmosphere.mie + params.hadeanMie * hadean;
      atmo.mieG = 0.8 - 0.15 * hadean;
      for (let c = 0; c < 3; c++) {
        atmo.haze[c] = ARCHEAN_HAZE[c]! * haze + params.sootHaze[c]! * kpgSoot;
        atmo.ozone[c] = params.atmosphere.ozone[c]! * ozone;
      }
      atmo.hazeAlbedo = 0.75 - 0.6 * kpgSoot;
      setAtmosphereUniforms(pu, atmo, 1);
      if (planet.atmosphere) planet.atmosphere.scale.setScalar(1 + pu.atmoTop.value);
      pu.soot.value = kpgSoot * 0.45;

      // ── Sun ──
      const lum = sunLuminosity(L);
      pu.sunIntensity.value = params.sunIntensity * lum;
      blackbodyColour(table(T.sunTeff, L), tmpC);
      pu.sunColour.value.copy(tmpC);
      sun.colour.value.copy(tmpC);
      sun.intensity.value = params.sunDiscRadiance * lum;
      pu.sunDir.value.copy(sunDir);

      // ── surface ──
      pu.crust.value = table(T.crust, L);
      pu.realPlates.value = table(T.realPlates, L);
      // Sea level: the old land-threshold offset shapes the noise continents; real geography floods by elevation.
      pu.seaLevel.value = table(T.seaLevel, L) * (1 - pu.realPlates.value);
      pu.seaRiseM.value = L <= 545 ? table(T.seaLevelM, L) : 0;
      pu.oceanDeep.value.setRGB(...tableRGB(T.oceanDeep, L, rgb));
      pu.oceanShallow.value.setRGB(...tableRGB(T.oceanShallow, L, rgb));
      pu.oceanLife.value = table(T.oceanLife, L);
      pu.bloomColour.value.setRGB(...tableRGB(T.bloomColour, L, rgb));
      pu.shelfTint.value = table(T.shelfTint, L);
      pu.rust.value = table(T.rust, L);
      pu.rockA.value.setRGB(...tableRGB(T.rockA, L, rgb));
      pu.rockB.value.setRGB(...tableRGB(T.rockB, L, rgb));
      pu.landLife.value = table(T.landLife, L) * (1 - 0.6 * kpgSoot);
      pu.hotspots.value = table(T.hotspots, L);
      pu.snowball.value = table(T.snowball, L);
      pu.iceEdge.value = table(T.iceEdge, L);
      const nhEdge = northIceSheet(L);
      const glacial = clamp01((1 - nhEdge) / 0.34); // 0 interglacial → 1 glacial maximum
      pu.iceEdgeNorthLand.value = nhEdge;
      pu.photoIce.value = table(T.antarcticIce, L);
      pu.northIce.value = table(T.northIce, L);
      // Glacials: drier, clearer air, lower seas (shelves exposed), sea ice further south.
      pu.cloudCover.value = table(T.cloudCover, L) - 0.12 * glacial;
      pu.seaRiseM.value -= params.glacialDrawdownM * glacial;
      pu.iceEdge.value -= 0.06 * glacial;
      pu.time.value = elapsed;

      // Plates: real geography (Phanerozoic) and noise plates (deep time), drifting slowly with L.
      if (pu.realPlates.value > 0) plateInverseQuats(Math.min(L, 560), pu.plates.map((p) => p.value));
      const ageGyr = (4400 - Math.min(L, 4400)) / 1000;
      for (let k = 0; k < pu.noisePlates.length; k++) {
        const ax = dirFromLatLon(23 * k - 40, 71 * k + 10, v3);
        qTmp.setFromAxisAngle(ax, (0.35 + 0.17 * k) * ageGyr * (k % 2 ? 1 : -1));
        pu.noisePlates[k]!.value.set(qTmp.x, qTmp.y, qTmp.z, qTmp.w);
      }

      // ── K–Pg impact ──
      const du = u - uKpg;
      siteAt(PLATE.northAmerica, params.chicxulub[0], params.chicxulub[1], Math.min(L, 560), impactLocal);
      pu.impactDir.value.copy(impactLocal);
      pu.impactFlash.value = du > -params.kpg.flashU * 0.3 ? Math.exp(-((du / params.kpg.flashU) ** 2)) : 0;
      pu.impactAge.value = clamp01(du / params.kpg.ringU);

      // ── camera ──
      track(u, cam);
      const az = cam[0]! * D2R;
      const el = cam[1]! * D2R;
      const dist = cam[2]!;
      camera.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist + Math.sin(elapsed * 0.05) * 0.04, Math.cos(az) * Math.cos(el) * dist);
      // Look offset in camera space (e.g. toward the limb for the sunrise shots).
      v3.copy(camera.position).negate().normalize(); // forward
      v3b.crossVectors(v3, yAxis).normalize(); // right
      lookAt.copy(v3b).multiplyScalar(cam[3]!);
      v3b.cross(v3); // up
      lookAt.addScaledVector(v3b, cam[4]!);
      camera.lookAt(lookAt);

      // ── planet rotation ──
      const dayH = table(T.dayHours, L);
      const jump = prevU < 0 || Math.abs(u - prevU) > 0.03;
      const wK = windowW(params.locks.kpg, u);
      const wE = windowW(params.locks.end, u);
      const w = Math.max(wK, wE);
      const spinRate = params.idleSpin * (24 / dayH);
      if (jump) thetaFree = u * params.scrollTurns * Math.PI * 2;
      else thetaFree += (spinRate * dt + (u - prevU) * params.scrollTurns * Math.PI * 2) * (1 - w);
      // Target: the site's longitude in the planet frame faces the view azimuth, biased toward the Sun.
      const sunAz = Math.atan2(sunDir.x, sunDir.z);
      let target: number;
      if (wK >= wE) {
        target = az + 0.3 * (sunAz - az) - Math.atan2(impactLocal.x, impactLocal.z);
      } else {
        siteAt(PLATE.africa, 0, table(params.endLon, u), Math.min(L, 560), endSite);
        target = az + 0.15 * (sunAz - az) - Math.atan2(endSite.x, endSite.z);
      }
      if (w > 0) {
        if (!locked || jump) {
          lockK = Math.round((thetaFree - target) / (Math.PI * 2));
          locked = true;
        }
      } else locked = false;
      const theta = thetaFree + w * (target + lockK * Math.PI * 2 - thetaFree);
      planet.surface.rotation.y = theta;
      prevU = u;

      // Clouds ride with the ground plus a slow drift and an era offset (weather slides as time passes).
      // Near the end they settle back onto the observed map so modern deserts are clear.
      cloudFree += params.cloudDrift * dt * (1 - wE);
      let cloudTurn = cloudFree + (u - 1) * params.cloudEraTurn;
      if (wE > 0) {
        if (!cloudLocked || jump) {
          cloudK = Math.round(cloudTurn / (Math.PI * 2));
          cloudLocked = true;
        }
        cloudTurn += wE * (cloudK * Math.PI * 2 - cloudTurn);
      } else cloudLocked = false;
      if (planet.clouds) planet.clouds.rotation.y = theta + cloudTurn;
      qTmp.setFromAxisAngle(yAxis, -cloudTurn);
      pu.cloudRel.value.set(qTmp.x, qTmp.y, qTmp.z, qTmp.w);

      // ── bolide ──
      const bt = (u - (uKpg - params.kpg.bolideU)) / params.kpg.bolideU; // 0 → 1 at impact
      if (bt > 0 && bt < 1.02) {
        bolide.visible = true;
        v3.copy(impactLocal).applyAxisAngle(yAxis, theta); // impact point, world
        v3b.set(0.6, 0.9, 0.4).normalize().add(v3).normalize(); // incoming from above, oblique
        bolide.position.copy(v3).addScaledVector(v3b, (1 - bt) * 1.6 + 0.004);
        bolideGlow.value = sstep(0, 0.4, bt) * (0.6 + 1.4 * bt * bt);
        bolide.scale.setScalar(0.02 + 0.03 * bt);
      } else bolide.visible = false;
    },

    render(target: RenderTarget) {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    },
    resize(w: number, h: number) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    dispose() {
      planet.dispose();
      sun.dispose();
      stars.dispose();
      bolideMat.dispose();
      geo?.release();
    },
  };
  return self;
};
