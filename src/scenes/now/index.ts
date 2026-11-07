// now — the observable universe (HANDOFF §9.15) · measured.
//
// One continuous, accelerating logarithmic pull-back over local 0 → 1, from 6 Earth radii to ~4× the radius of
// the CMB sphere (20 decades). Float32 cannot hold that range in one scene, so the universe is drawn as nested
// layers, each in its own natural unit and sharing one camera path computed in metres (doubles) on the CPU:
//   earth (Earth radii) · solar (AU) · stars (pc) · galaxy (kpc) · localGroup (Mpc) · web (box/10) · cosmos (Gpc)
// Layers are drawn largest first with a depth clear between them, each fading in/out over its own range of
// camera distance. All share the Galactic frame of the Planck map (ephemeris.ts), so Earth's axis, the planets'
// orbits, the Milky Way's disk, Andromeda and the CMB sky are mutually correctly oriented.
//
// Beats (src/content/chapters/now.mdx):
//   0.14  Earth, one of eight planets       → Earth and Moon, then today's planets on their orbits
//   0.30  the Milky Way, 100,000 ly          → particle Milky Way seen from outside; the Sun marked
//   0.46  the Local Group                    → Andromeda, M33, the Magellanic Clouds, dwarfs (catalogue positions)
//   0.62  the cosmic web                     → the shared web (A = 1 today), us at its centre
//   0.78  the CMB, 45 billion light-years    → the real Planck map on the sphere of last scattering
//   0.92  5% / 27% / 68%                      → the whole observable universe inside the CMB shell; calm drift

import { PerspectiveCamera, Scene, Vector3, type RenderTarget, type Texture, type WebGPURenderer, NoColorSpace, RepeatWrapping, LinearFilter, LinearMipmapLinearFilter } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { globalsAt } from '../../physics/cosmology.ts';
import { LITTLE_H, MPC_M, Z_LAST_SCATTERING } from '../../physics/constants.ts';
import { madauDickinsonSFR } from '../../physics/recombination.ts';
import { webAmplitude, WORLD_BOX } from '../../shared/gaussianField.ts';
import { smootherstep, smoothstep } from '../../shared/math.ts';
import { createCosmicWeb, type CosmicWeb } from '../../shared/web.ts';
import {
  addNearFade,
  addSphereFade,
  createGalaxyImpostors,
  createGalaxySprites,
  createSpiralGalaxy,
  monotoneTrack,
  MW_ARM_START,
  peakWorld,
  pickMilkyWayPeak,
  stellarPalette,
  tileBox,
  type GalaxyImpostors,
  type GalaxySpriteSpec,
  type GalaxySprites,
  type SpiralGalaxy,
  type Tiles,
} from '../cosmicNoon/galaxies.ts';
import { sceneRange } from '../sceneRange.ts';
import type { CosmicScene, RenderContext } from '../types.ts';
import { createCosmos, type Cosmos } from './cosmos.ts';
import { createEarth, type Earth } from './earth.ts';
import { centuriesSinceJ2000, earthAxis, eclipticPole, eclToWorld, eqToWorld, equatorialRaDec, galacticLB, moonEcliptic } from './ephemeris.ts';
import { LOCAL_GROUP, M31 } from './localGroup.ts';
import { createPoints, type Points } from './points.ts';
import { createNeighbourhood, createSolarSystem, type Neighbourhood, type SolarSystem } from './solar.ts';

const R_EARTH_M = 6.371e6;
const AU_M = 1.495978707e11;
const PC_M = 3.085677581491367e16;
const KPC_M = PC_M * 1e3;
const GPC_M = MPC_M * 1e3;

const params = {
  fov: 40,
  /** log10(camera distance / m) vs local: slow on Earth, then ever faster, settling on the CMB sphere. */
  logDistance: [
    [0.0, 7.62],
    [0.05, 7.95],
    [0.09, 8.95],
    [0.12, 10.4],
    [0.15, 12.1],
    [0.19, 13.05],
    [0.22, 15.0],
    [0.25, 18.2],
    [0.275, 20.2],
    [0.3, 21.15],
    [0.38, 21.75],
    [0.46, 22.62],
    [0.54, 23.45],
    [0.62, 24.9],
    [0.7, 25.95],
    [0.76, 26.7],
    [0.84, 27.08],
    [0.92, 27.17],
    [1.0, 27.21],
  ] as [number, number][],
  /** Distance of the Sun from the Galactic Centre, kpc (GRAVITY Collaboration 2019). */
  sunR0Kpc: 8.18,
  milkyWay: {
    /** Visible stellar-disk radius, kpc. */
    radiusKpc: 15,
    stars: { low: 50_000, medium: 140_000, high: 280_000 },
    /** Rotation of the pattern about the NGP so the Sun sits just inside the Perseus arm, bar toward l ≈ 27°. */
    yawDeg: 180,
    bar: 0.85,
    /** Visual star-formation level of today's Milky Way disk (blue arms, pink HII regions). */
    sf: 0.5,
  },
  m31: { stars: { low: 25_000, medium: 60_000, high: 120_000 }, sf: 0.3 },
  web: { brightness: 0.1, contrast: 1.35, reveal: 0.5, outerFraction: 0.3, sphere: [10, 14.5] as const, galaxyRadius: 0.022 },
  /** Galaxies beyond the Milky Way are enlarged progressively (up to this factor) so they stay visible. */
  galaxyBoost: 2.5,
  /** Extra enlargement as the Local Group recedes, so it stays a legible group until the web takes over. */
  galaxyBoostFar: 3.5,
  cosmos: { haze: { low: 50_000, medium: 140_000, high: 280_000 } },
  stars: { low: 6000, medium: 14000, high: 24000 },
  belts: 9000,
  /** Visibility windows in log10(D/m): [in0, in1, out0, out1]. */
  vis: {
    earth: [-99, -98, 9.3, 10.1],
    solar: [-99, -98, 15.2, 16.2],
    orbits: [9.4, 10.6, 14.2, 15.0],
    stars: [-99, -98, 19.3, 20.1],
    band: [-99, -98, 19.3, 20.2],
    galaxy: [19.7, 20.6, 23.9, 24.5],
    sunMarker: [20.4, 21.0, 22.3, 22.9],
    localGroup: [21.9, 22.7, 24.05, 24.6],
    web: [24.0, 24.6, 25.9, 26.6],
    haze: [25.0, 25.9, 99, 100],
    cmb: [25.95, 26.55, 99, 100],
  } as Record<string, [number, number, number, number]>,
  /** Final idle orbit of the camera around us (rad/s). */
  orbitRate: 0.012,
};

const RANGE = sceneRange('now');

interface Layer {
  scene: Scene;
  camera: PerspectiveCamera;
  /** metres per unit */
  unit: number;
  /** layer origin in global metres (Sun-centred, Galactic world axes) */
  origin: Vector3;
  /** camera near/far in units of the camera distance */
  near: number;
  far: number;
  visible: boolean;
}

const fade = (x: number, w: [number, number, number, number]) => smoothstep(w[0], w[1], x) * (1 - smoothstep(w[2], w[3], x));

export default (): CosmicScene => {
  let renderer: WebGPURenderer;
  const layers: Record<string, Layer> = {};
  const order = ['cosmos', 'web', 'localGroup', 'galaxy', 'stars', 'solar', 'earth'] as const;
  let earth: Earth;
  let solar: SolarSystem;
  let hood: Neighbourhood;
  let mw: SpiralGalaxy;
  let sunMarker: Points;
  let m31: SpiralGalaxy;
  let lgSprites: GalaxySprites;
  let web: CosmicWeb;
  let webTiles: Tiles;
  let gal: GalaxyImpostors;
  let galTiles: Tiles;
  let cosmos: Cosmos;
  let cmbUrl: string | null = null;
  let assets: RenderContext['assets'];
  let viewH = 720;
  let texW = 2048;
  const logD = monotoneTrack(params.logDistance);

  // Global positions (metres) and directions.
  const earthM = new Vector3();
  const gcM = new Vector3();
  const lgM = new Vector3();
  const mwPeakShift = new Vector3();
  const dirEarth = new Vector3();
  const dirSolar = new Vector3();
  const dirGalaxy = new Vector3();
  const dirLG = new Vector3();
  const dirWeb = new Vector3();
  const dirCosmos = new Vector3();
  const sunDirFromEarth = new Vector3();
  const target = new Vector3();
  const dir = new Vector3();
  const camM = new Vector3();
  const tmp = new Vector3();
  const tmp2 = new Vector3();
  const yAxis = new Vector3(0, 1, 0);
  const webNear0 = uniform(0.1);
  const webNear1 = uniform(0.3);
  const sphereC = uniform(new Vector3());
  const sphere0 = uniform(params.web.sphere[0]);
  const sphere1 = uniform(params.web.sphere[1]);
  const mwNear0 = uniform(0.01);
  const mwNear1 = uniform(0.05);

  const makeLayer = (name: string, unit: number, origin: Vector3, near = 1e-3, far = 50) => {
    const scene = new Scene();
    const camera = new PerspectiveCamera(params.fov, 1, 1, 10);
    layers[name] = { scene, camera, unit, origin: origin.clone(), near, far, visible: false };
    return scene;
  };

  /** Direction blend keyed on log10 D: hold a, then turn to b between x0 and x1. */
  const blendDir = (out: Vector3, a: Vector3, b: Vector3, x: number, x0: number, x1: number) => {
    const t = smootherstep(x0, x1, x);
    return out.copy(a).lerp(b, t).normalize();
  };

  return {
    id: 'now',
    range: RANGE,
    accuracy: 'measured',
    accuracyNote:
      "Planets, Earth's axis, Local Group and Planck CMB are placed as measured; Earth's surface, stars and web are illustrative; galaxies enlarged; CMB colour mapped.",
    colourMapped: false,

    async init(ctx: RenderContext) {
      renderer = ctx.renderer;
      assets = ctx.assets;
      await ctx.field.ready;
      const tier = ctx.quality.name;
      const res = ctx.globals.uResolution;
      const date = new Date();
      const T = centuriesSinceJ2000(date);
      const pal = stellarPalette();

      // ── solar system (AU) ──
      const solarScene = makeLayer('solar', AU_M, new Vector3(), 1e-4, 1e5);
      solar = createSolarSystem(T, res, params.fov, pal.sun, params.belts);
      solarScene.add(solar.group);
      earthM.copy(solar.earthPos).multiplyScalar(AU_M);
      sunDirFromEarth.copy(earthM).negate().normalize();

      // ── Earth (Earth radii) ──
      const earthScene = makeLayer('earth', R_EARTH_M, earthM, 1e-3, 400);
      earth = createEarth(pal.sun);
      earthScene.add(earth.group);
      earth.uniforms.sunDir.value.copy(sunDirFromEarth);
      earthAxis(tmp);
      earth.tilt.quaternion.setFromUnitVectors(yAxis, tmp);
      moonEcliptic(date, tmp);
      eclToWorld(tmp.x, tmp.y, tmp.z, tmp);
      earth.moon.position.copy(tmp).multiplyScalar(1000 / R_EARTH_M);

      // ── stellar neighbourhood + Milky Way band (pc) ──
      const starScene = makeLayer('stars', PC_M, new Vector3(), 1e-4, 4e4);
      hood = createNeighbourhood(params.stars[tier], res, params.fov);
      starScene.add(hood.band);
      starScene.add(hood.stars.sprite);

      // ── Milky Way (kpc, origin at the Galactic Centre) ──
      gcM.set(params.sunR0Kpc * KPC_M, 0, 0);
      const galScene = makeLayer('galaxy', KPC_M, gcM, 1e-3, 60);
      mw = createSpiralGalaxy({ stars: params.milkyWay.stars[tier], seed: 2024, armSeed: 0.15, armStart: MW_ARM_START });
      mw.group.scale.setScalar(params.milkyWay.radiusKpc);
      mw.group.rotation.y = (params.milkyWay.yawDeg * Math.PI) / 180;
      mw.uniforms.settle.value = 1;
      mw.uniforms.bar.value = params.milkyWay.bar;
      mw.uniforms.sf.value = params.milkyWay.sf;
      mw.uniforms.glow.value = 1;
      galScene.add(mw.group);
      addNearFade(mw.starsMaterial, mwNear0, mwNear1);
      // "You are here": a thin warm ring around the Sun's position, 8.2 kpc from the centre.
      sunMarker = createPoints({ count: 1, resolution: res, fovDeg: params.fov, shape: 'ring' });
      sunMarker.pos.setXYZW(0, -params.sunR0Kpc, 0.02, 0, 22);
      sunMarker.col.setXYZW(0, 1.0, 0.82, 0.55, 1.1);
      galScene.add(sunMarker.sprite);

      // ── Local Group (Mpc, Sun-centred) ──
      const lgScene = makeLayer('localGroup', MPC_M, new Vector3(), 1e-3, 40);
      m31 = createSpiralGalaxy({ stars: params.m31.stars[tier], seed: 31, armSeed: 0.62, scaleLength: 0.3 });
      const m31Pos = equatorialRaDec(M31.raDeg, M31.decDeg, M31.dKpc / 1000, new Vector3());
      {
        // Disk normal from inclination and position angle (from celestial north through east).
        const ra = (M31.raDeg * Math.PI) / 180;
        const dec = (M31.decDeg * Math.PI) / 180;
        const s = new Vector3(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));
        const n = new Vector3(0, 0, 1).addScaledVector(s, -s.z).normalize();
        const e = new Vector3(-Math.sin(ra), Math.cos(ra), 0);
        const pa = (M31.paDeg * Math.PI) / 180;
        const k = n.clone().multiplyScalar(-Math.sin(pa)).addScaledVector(e, Math.cos(pa));
        const inc = (M31.inclinationDeg * Math.PI) / 180;
        const nq = s.clone().multiplyScalar(-Math.cos(inc)).addScaledVector(k, Math.sin(inc)).normalize();
        m31.group.quaternion.setFromUnitVectors(yAxis, eqToWorld(nq.x, nq.y, nq.z, new Vector3()).normalize());
      }
      m31.group.position.copy(m31Pos);
      m31.group.scale.setScalar(M31.radiusKpc / 1000);
      m31.uniforms.settle.value = 1;
      m31.uniforms.bar.value = 0.25;
      m31.uniforms.sf.value = params.m31.sf;
      m31.uniforms.glow.value = 1.1;
      lgScene.add(m31.group);
      const specs: GalaxySpriteSpec[] = LOCAL_GROUP.map((g, i) => {
        const pos = galacticLB(g.l, g.b, g.d / 1000, new Vector3());
        const r = g.r / 1000;
        const base = { position: pos, radius: r, seed: (i * 0.137) % 1, pa: (i * 2.39) % Math.PI, cosi: 0.45 + ((i * 0.31) % 0.5) };
        switch (g.type) {
          case 'spiral':
            return { ...base, settle: 0.85, ell: 0, sf: 0.6, brightness: 0.9, cosi: Math.cos((55 * Math.PI) / 180) };
          case 'irregular':
            return { ...base, settle: 0.12, ell: 0, sf: 0.7, brightness: 1.0, cosi: 0.75 };
          case 'dE':
            return { ...base, settle: 0, ell: 1, sf: 0, brightness: 0.7 };
          case 'dIrr':
            return { ...base, settle: 0.05, ell: 0, sf: 0.5, brightness: 0.35 };
          default:
            return { ...base, settle: 0, ell: 1, sf: 0, brightness: 0.18 };
        }
      });
      lgSprites = createGalaxySprites(specs, res, params.fov);
      lgSprites.uniforms.minPx.value = 2.5;
      lgScene.add(lgSprites.sprite);
      lgM.copy(gcM).lerp(m31Pos.clone().multiplyScalar(MPC_M), 0.42);

      // ── cosmic web today (web world units, Sun-centred) ──
      const webUnit = ((ctx.field.boxMpcH / LITTLE_H) * MPC_M) / WORLD_BOX;
      const webScene = makeLayer('web', webUnit, new Vector3(), 1e-3, 60);
      web = createCosmicWeb(ctx);
      web.uniforms.amplitude.value = webAmplitude(1);
      web.uniforms.brightness.value = params.web.brightness;
      web.uniforms.contrast.value = params.web.contrast;
      web.uniforms.reveal.value = params.web.reveal;
      addSphereFade(web.material, sphereC, sphere0, sphere1);
      addNearFade(web.material, webNear0, webNear1);
      webTiles = tileBox(web.material, web.count, Math.round(web.count * params.web.outerFraction));
      webScene.add(webTiles.group);
      const mwPeak = pickMilkyWayPeak(ctx.field);
      gal = createGalaxyImpostors(ctx, { fieldGalaxies: 4000, radius: params.web.galaxyRadius, companions: 0, milkyWay: mwPeak, seed: 1104, densityAmplitude: 1 });
      gal.uniforms.amplitude.value = webAmplitude(1);
      gal.uniforms.maturity.value = 1;
      gal.uniforms.mergeClock.value = 2;
      addSphereFade(gal.material, sphereC, sphere0, sphere1);
      galTiles = tileBox(gal.material, gal.count, gal.count);
      webScene.add(galTiles.group);
      // Put our own halo at the centre: shift every tile so the Milky Way peak lands on the origin.
      peakWorld(ctx.field, mwPeak, webAmplitude(1), mwPeakShift);

      // ── observable universe (Gpc, Sun-centred) ──
      const cosScene = makeLayer('cosmos', GPC_M, new Vector3(), 1e-3, 200);
      cosmos = createCosmos(ctx.field, Z_LAST_SCATTERING, params.cosmos.haze[tier], res, params.fov);
      cosScene.add(cosmos.group);
      cmbUrl = tier === 'high' ? '/data/cmb/cmb_dT_4096x2048.png' : '/data/cmb/cmb_dT_2048x1024.png';
      try {
        const tex: Texture = await ctx.assets.texture(cmbUrl, { colorSpace: NoColorSpace, mipmaps: true });
        tex.wrapS = RepeatWrapping;
        tex.minFilter = LinearMipmapLinearFilter;
        tex.magFilter = LinearFilter;
        tex.needsUpdate = true;
        cosmos.setMap(tex);
        texW = (tex.image as { width?: number } | null)?.width ?? texW;
      } catch {
        console.warn('[now] Planck CMB map not found; using the procedural stand-in');
        cmbUrl = null;
      }

      // ── camera directions (from target toward camera) ──
      const eclN = eclipticPole(new Vector3());
      // Earth: a sunlit gibbous Earth (Sun ~55° from the view axis) with today's Moon off to the side, in frame
      // once we pull back. Brute-force search over directions.
      {
        const moonDir = earth.moon.position.clone().normalize();
        const cand = new Vector3();
        let best = -Infinity;
        for (let i = 0; i < 4000; i++) {
          const zc = 1 - (2 * (i + 0.5)) / 4000;
          const ph = i * 2.399963;
          const rr = Math.sqrt(1 - zc * zc);
          cand.set(rr * Math.cos(ph), zc, rr * Math.sin(ph));
          const phase = Math.acos(Math.min(1, Math.max(-1, cand.dot(sunDirFromEarth))));
          const moonAng = Math.acos(Math.min(1, Math.max(-1, cand.dot(moonDir))));
          // view axis = −cand (camera looks back at Earth); Moon should sit ~20–30° off the line of sight beyond Earth.
          const moonOff = Math.abs(Math.PI - moonAng - 0.45);
          const score = -Math.abs(phase - 0.95) * 2 - moonOff - Math.abs(cand.dot(yAxis)) * 0.3;
          if (score > best) {
            best = score;
            dirEarth.copy(cand);
          }
        }
      }
      // Solar system: above the ecliptic, same azimuth.
      tmp.copy(dirEarth).addScaledVector(eclN, -dirEarth.dot(eclN)).normalize();
      dirSolar.copy(tmp).multiplyScalar(Math.cos(0.95)).addScaledVector(eclN, Math.sin(0.95)).normalize();
      // Milky Way: 55° above the disk, from the Sun's side of the Galaxy.
      tmp.set(-Math.cos(0.5), 0, Math.sin(0.5));
      dirGalaxy.copy(tmp).multiplyScalar(Math.cos(0.96)).addScaledVector(yAxis, Math.sin(0.96)).normalize();
      // Local Group: broadside to the Milky Way–Andromeda axis, a little above.
      tmp.copy(m31Pos).normalize();
      tmp2.crossVectors(tmp, yAxis).normalize();
      dirLG.copy(tmp2).multiplyScalar(Math.cos(0.45)).addScaledVector(yAxis, Math.sin(0.45)).normalize();
      dirWeb.copy(dirLG).applyAxisAngle(yAxis, 0.7).normalize();
      dirCosmos.copy(dirWeb).applyAxisAngle(yAxis, 0.5).addScaledVector(yAxis, 0.25).normalize();

      this.update(0.5, globalsAt(RANGE[1]), 0, 0);
      for (const name of order) {
        const L = layers[name]!;
        await renderer.compileAsync(L.scene, L.camera);
      }
    },

    update(local, _g, _dt, elapsed) {
      const x = logD(local);
      const D = Math.pow(10, x);

      // Target: Earth → Sun → Galactic Centre → Local Group → us again, each move timed to the camera distance.
      target.copy(earthM).multiplyScalar(1 - smootherstep(10.6, 11.7, x));
      target.lerp(gcM, smootherstep(20.4, 21.0, x));
      target.lerp(lgM, smootherstep(22.15, 22.8, x));
      target.multiplyScalar(1 - smootherstep(23.6, 24.4, x));

      // Direction: Earth → ecliptic → galaxy → Local Group → web → cosmos, then a slow orbit.
      blendDir(dir, dirEarth, dirSolar, x, 9.6, 12.4);
      blendDir(tmp, dir, dirGalaxy, x, 19.0, 21.0);
      blendDir(dir, tmp, dirLG, x, 22.0, 22.9);
      blendDir(tmp, dir, dirWeb, x, 23.6, 25.0);
      blendDir(dir, tmp, dirCosmos, x, 25.2, 26.9);
      dir.applyAxisAngle(yAxis, elapsed * params.orbitRate * smoothstep(24.5, 26.5, x));
      camM.copy(target).addScaledVector(dir, D);

      // Per-layer cameras.
      for (const name of order) {
        const L = layers[name]!;
        const c = L.camera;
        c.position.copy(camM).sub(L.origin).divideScalar(L.unit);
        tmp.copy(target).sub(L.origin).divideScalar(L.unit);
        c.up.copy(yAxis);
        c.lookAt(tmp);
        const dl = D / L.unit;
        c.near = Math.max(dl * L.near, 1e-6);
        c.far = Math.max(dl * L.far, c.near * 10) + (name === 'cosmos' ? 60 : 0);
        c.updateProjectionMatrix();
      }

      const V = params.vis;
      // Earth and Moon.
      const vEarth = fade(x, V.earth!);
      layers.earth!.visible = vEarth > 1e-3;
      earth.uniforms.opacity.value = vEarth;
      earth.uniforms.time.value = elapsed;
      earth.globe.rotation.y = elapsed * 0.035 + 2.2;

      // Sun, planets, orbits, belts.
      const vSolar = fade(x, V.solar!);
      const vOrb = fade(x, V.orbits!);
      layers.solar!.visible = vSolar > 1e-3;
      solar.uniforms.sun.value = vSolar;
      solar.uniforms.orbits.value = vOrb;
      solar.uniforms.planets.value = vOrb;
      solar.uniforms.belts.value = vOrb * smoothstep(10.8, 12.5, x);
      solar.uniforms.earthDot.value = smoothstep(9.6, 10.4, x);

      // Neighbourhood stars and the Milky Way band (seen from inside the disk).
      const vStars = fade(x, V.stars!);
      const vBand = fade(x, V.band!);
      layers.stars!.visible = vStars > 1e-3 || vBand > 1e-3;
      hood.uniforms.stars.value = vStars;
      hood.uniforms.band.value = vBand;
      const sc = layers.stars!.camera;
      hood.band.position.copy(sc.position);
      hood.band.scale.setScalar(sc.far * 0.8);

      // Milky Way.
      const vGal = fade(x, V.galaxy!);
      layers.galaxy!.visible = vGal > 1e-3;
      mw.uniforms.brightness.value = vGal;
      mw.uniforms.spin.value = elapsed * 0.002;
      // From inside the disk the star sprites must be star-sized, not kiloparsec blobs; dust waits until we are out.
      const dKpc = D / KPC_M;
      mw.uniforms.starSize.value = Math.min(1, Math.max(0.02, dKpc / 40));
      mw.uniforms.dust.value = 0.55 * smoothstep(20.3, 20.9, x);
      // The unresolved-light plane only once we see the disk from outside; until then it is just stars.
      mw.uniforms.glow.value = smoothstep(20.45, 21.05, x);
      mwNear0.value = dKpc * 0.08;
      mwNear1.value = dKpc * 0.25;
      const vMark = fade(x, V.sunMarker!) * (0.75 + 0.25 * Math.sin(elapsed * 1.6));
      sunMarker.uniforms.opacity.value = vMark;

      // Galaxies grow progressively beyond true size as we leave the Milky Way (stated in the note).
      const boost = 1 + (params.galaxyBoost - 1) * smoothstep(21.4, 22.5, x) + params.galaxyBoostFar * smoothstep(22.6, 23.9, x);
      mw.group.scale.setScalar(params.milkyWay.radiusKpc * boost);
      m31.group.scale.setScalar((M31.radiusKpc / 1000) * boost);
      lgSprites.uniforms.size.value = boost;

      // Local Group.
      const vLG = fade(x, V.localGroup!);
      layers.localGroup!.visible = vLG > 1e-3;
      m31.uniforms.brightness.value = vLG;
      lgSprites.uniforms.brightness.value = vLG;

      // Cosmic web, centred on our halo.
      const vWeb = fade(x, V.web!);
      layers.web!.visible = vWeb > 1e-3;
      tmp.set(0, 0, 0);
      webTiles.place(tmp, 1, mwPeakShift, tmp2.set(0, 0, 0), params.web.sphere[1]);
      galTiles.place(tmp, 1, mwPeakShift, tmp2, params.web.sphere[1]);
      web.uniforms.brightness.value = params.web.brightness * vWeb;
      gal.uniforms.brightness.value = vWeb;
      gal.uniforms.milkyWay.value = smoothstep(24.2, 24.8, x);
      gal.uniforms.sf.value = madauDickinsonSFR(0) / 0.133;
      const dWeb = D / layers.web!.unit;
      webNear0.value = dWeb * 0.15;
      webNear1.value = dWeb * 0.4;
      web.uniforms.size.value = Math.min(0.8, Math.max(0.12, dWeb * 0.035));
      gal.uniforms.size.value = 1 + 1.5 * smoothstep(1, 20, dWeb);

      // The observable universe.
      const vHaze = fade(x, V.haze!);
      const vCmb = fade(x, V.cmb!);
      layers.cosmos!.visible = vHaze > 1e-3 || vCmb > 1e-3;
      cosmos.uniforms.haze.value = vHaze;
      // Projected galaxy light once we are outside the sphere (billboard facing the camera, sized to the silhouette).
      const cc = layers.cosmos!.camera;
      const dg = cc.position.length();
      cosmos.uniforms.glow.value = smoothstep(cosmos.radius * 1.15, cosmos.radius * 1.8, dg);
      cosmos.glow.quaternion.copy(cc.quaternion);
      cosmos.glow.scale.setScalar(dg / Math.sqrt(Math.max(dg * dg - cosmos.radius * cosmos.radius, 1e-6)));
      cosmos.uniforms.cmb.value = vCmb;
      cosmos.uniforms.front.value = vCmb;
      // From inside, the CMB is the whole sky; once outside, its far side dims so the interior reads as depth.
      const outside = smoothstep(26.6, 27.05, x);
      cosmos.uniforms.back.value = 0.42 - 0.405 * outside;
      cosmos.uniforms.limbPow.value = 3.6 + 2.4 * outside;
      cosmos.uniforms.faceOn.value = 0.008 * (1 - outside) + 0.003;
      cosmos.uniforms.marker.value = smoothstep(26.0, 26.9, x) * (0.8 + 0.2 * Math.sin(elapsed * 0.9));
      this.colourMapped = vCmb > 0.05;
      // Mip level for the CMB map from its on-screen size (texels per pixel around the equator).
      const Dg = D / GPC_M;
      const rPx = (cosmos.radius / Math.max(Dg, cosmos.radius * 1.0001)) * (viewH / 2) / Math.tan((params.fov * Math.PI) / 360);
      cosmos.uniforms.lod.value = Math.max(0, Math.log2(texW / (2 * Math.PI * Math.max(rPx, 1))) + 0.4);
    },

    render(target: RenderTarget) {
      renderer.setRenderTarget(target);
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.clear();
      for (const name of order) {
        const L = layers[name]!;
        if (!L.visible) continue;
        renderer.clearDepth();
        renderer.render(L.scene, L.camera);
      }
      renderer.autoClear = auto;
    },

    resize(w, h) {
      viewH = h;
      for (const name of order) {
        const L = layers[name];
        if (!L) continue;
        L.camera.aspect = w / h;
        L.camera.updateProjectionMatrix();
      }
    },

    dispose() {
      earth.dispose();
      solar.dispose();
      hood.dispose();
      mw.dispose();
      sunMarker.dispose();
      m31.dispose();
      lgSprites.dispose();
      web.dispose();
      gal.dispose();
      cosmos.dispose();
      if (cmbUrl) assets.release(cmbUrl);
    },
  };
};
