// solarSystem — solar nebula, Sun, Earth, Moon (HANDOFF §9.13). Lookback map 4.6 → 4.4 Gyr ago.
// Beats are keyed to dated events (events.json): the Sun forms (CAI age, 4.567 Gyr), Earth assembles
// (~4.54 Gyr), the Moon-forming impact (~4.51 Gyr), then the magma ocean cools under a steam atmosphere
// until rain makes the first oceans — which is where `life` picks up (dissolve), with an identical frame.
//
// World units: the young Earth's radius = 1 at the end; 1 AU = params.au (sizes exaggerated ~150×).
// The star sits at the origin; Earth at E, placed so the Sun lies along life's fixed sun direction.

import {
  AdditiveBlending,
  Color,
  CustomBlending,
  Group,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  RenderTarget,
  Quaternion,
  Scene,
  Sprite,
  SpriteNodeMaterial,
  Vector3,
  type WebGPURenderer,
} from 'three/webgpu';
import { float, smoothstep, texture, uniform, uv } from 'three/tsl';
import { AGE_SECONDS, type Globals } from '../../physics/cosmology.ts';
import { GYR_S, YEAR_S } from '../../physics/constants.ts';
import { MonotoneCubic } from '../../physics/interp.ts';
import { chapterById, LOOKBACK_FLOOR_S } from '../../time/chapters.ts';
import { EMISSION_LINES_NM, lineColor } from '../../shared/color.ts';
import { clamp01, smoothstep as sstep, smootherstep } from '../../shared/math.ts';
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
} from '../life/planet.ts';
import { loadCloudMap } from '../life/geography.ts';
import { ARCHEAN_HAZE } from '../life/timeline.ts';
import { HANDOFF } from '../life/handoff.ts';
import {
  createAccretionSwarm,
  createDiskMesh,
  createDiskParticles,
  createImpactDebris,
  createJets,
  createMolecularCloud,
  createSkyNebula,
} from './shaders.ts';

// ── Tunables ───────────────────────────────────────────────────────────────────
export const params = {
  au: 160,
  disk: { innerAU: 0.12, outerAU: 7, gapsAU: [2.9, 4.6] as const },
  cloudRadius: 2600,
  /** Fraction of the tier's particle budget used by the disk. */
  diskParticleShare: 0.22,
  accretionCount: 900,
  debrisShare: 0.1,
  stars: { count: 5200, radius: 9000 },
  /** Star: protostar → T Tauri → young main-sequence Sun (effective temperatures, K). */
  starTeff: [
    [0.1, 3000],
    [0.16, 4000],
    [0.3, 4500],
    [0.5, 5600],
  ] as const,
  /** Star sprite radius (world) and disc radiance. */
  starRadius: 3.5,
  starRadiance: 40,
  /** Faint young Sun irradiance on Earth (relative to today's 1.0, Gough 1981 at ~4.5 Gyr ago). */
  earthSunIntensity: 0.72,
  earthLogTRef: 2600,
  theiaRadius: 0.53,
  moonRadius: 0.27,
  /** Moon orbit radius (Earth radii) after it forms → by the end of the chapter (it recedes by tides). */
  moonOrbit: [3.8, 11] as const,
  /** Fallback event locals if events.json lacks them. */
  fallback: { sun: 0.1605, earth: 0.2954, moon: 0.4445 },
  /** Disk-frame camera keys (target = star): local, az°, el°, distance (world). */
  camDisk: [
    [0.0, 18, 16, 7600],
    [0.08, 24, 18, 5200],
    [0.15, 32, 22, 3000],
    [0.2, 40, 25, 2300],
    [0.25, 48, 27, 2000],
    [0.3, 55, 22, 1700],
  ] as const,
  /** Earth-frame camera keys (target = Earth): local, az°, el°, distance (Earth radii). Ends on life's first frame. */
  camEarth: [
    [0.26, 52, 30, 700],
    [0.3, 44, 27, 170],
    [0.34, 34, 21, 42],
    [0.38, 26, 14, 14],
    [0.42, 8, 9, 9],
    [0.46, 0, 8, 8.2],
    [0.52, -8, 9, 7.6],
    [0.62, -16, 9, 6.6],
    [0.8, -25, 8, 6.0],
    [0.93, HANDOFF.camera.az, HANDOFF.camera.el, HANDOFF.camera.dist],
    [1.0, HANDOFF.camera.az, HANDOFF.camera.el, HANDOFF.camera.dist],
  ] as const,
  /** Blend between the two camera frames (local). */
  camBlend: [0.25, 0.35] as const,
  fov: [36, HANDOFF.camera.fov] as const,
  /** Magma ocean: hottest exposed melt (K) and crust cover vs local. Keys with a 3rd entry = 1 are offsets from the impact. */
  lavaT: [
    [0.2, 1500],
    [0.3, 1800],
    [0, 1900, 1],
    [0.012, 3000, 1],
    [0.05, 2700, 1],
    [0.56, 2200],
    [0.62, 1650],
    [0.7, 1350],
    [0.8, 1120],
    [0.9, 980],
    [1.0, 900],
  ] as const,
  crust: [
    [0.2, 0.3],
    [0.3, 0.45],
    [-0.001, 0.55, 1],
    [0.01, 0.0, 1],
    [0.55, 0.05],
    [0.62, 0.35],
    [0.7, 0.75],
    [0.8, 0.92],
    [1.0, 0.97],
  ] as const,
  /** Rain and the first oceans: sea level (noise-continent threshold) at the end matches life's start. */
  seaLevel: [
    [0.84, -0.8],
    [0.92, -0.25],
    [0.985, 0.02],
  ] as const,
  cloudCover: [
    [0.66, 0.0],
    [0.76, 0.9],
    [0.86, 0.9],
    [1.0, 0.62],
  ] as const,
  /** Steam/CO₂ atmosphere (SI, see planet.ts); Mie haze peaks before the rain. */
  atmosphere: {
    rayleigh: [5.802e-6, 13.558e-6, 33.1e-6],
    rayleighScaleHeightM: 8000,
    mie: 2.8e-5,
    mieScaleHeightM: 1200,
    mieG: 0.65,
    haze: [ARCHEAN_HAZE[0] * 0.15, ARCHEAN_HAZE[1] * 0.15, ARCHEAN_HAZE[2] * 0.15],
    hazeAlbedo: 0.75,
    hazeScaleHeightM: 15000,
    ozone: [0, 0, 0],
    exaggeration: 3,
  } satisfies AtmosphereSpec as AtmosphereSpec,
  steamMie: 7e-5,
  idleSpin: 0.06,
};

const D2R = Math.PI / 180;

function track(keys: readonly (readonly number[])[]) {
  const xs = keys.map((k) => k[0]!);
  const n = keys[0]!.length - 1;
  const ch = Array.from({ length: n }, (_, c) => new MonotoneCubic(xs, keys.map((k) => k[c + 1]!)));
  const lo = xs[0]!;
  const hi = xs.at(-1)!;
  return (x: number, out: number[]) => {
    const c = Math.min(hi, Math.max(lo, x));
    for (let i = 0; i < n; i++) out[i] = ch[i]!.at(c);
    return out;
  };
}

/** Local within the solarSystem chapter for a lookback (s). */
function localAt(Lsec: number): number {
  const c = chapterById('solarSystem')!;
  const a = Math.log(c.lookbackStart + LOOKBACK_FLOOR_S);
  const b = Math.log(c.lookbackEnd + LOOKBACK_FLOOR_S);
  return (Math.log(Lsec + LOOKBACK_FLOOR_S) - a) / (b - a);
}

function eventLocal(id: string, fallback: number): number {
  type Ev = { id: string; lookback_years?: { best: number } };
  const ev = (events as Ev[]).find((e) => e.id === id);
  return ev?.lookback_years ? localAt(ev.lookback_years.best * YEAR_S) : fallback;
}

export default (): CosmicScene => {
  let renderer: WebGPURenderer;
  let scene: Scene; // everything in front of the parent cloud
  let back: Scene; // sky, stars, the star itself (dimmed by the cloud)
  let cloudScene: Scene;
  let compScene: Scene;
  let cloudRT: RenderTarget;
  let compMat: MeshBasicNodeMaterial;
  const orthoCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let camera: PerspectiveCamera;
  let earth: Planet;
  let theia: Planet;
  let moon: Planet;
  let sun: SunSprite;
  let stars: Starfield;
  let cloudMap: { release(): void } | null = null;
  let nebula: ReturnType<typeof createSkyNebula>;
  let cloud: ReturnType<typeof createMolecularCloud>;
  let disk: ReturnType<typeof createDiskMesh>;
  let dust: ReturnType<typeof createDiskParticles>;
  let jets: ReturnType<typeof createJets>;
  let swarm: ReturnType<typeof createAccretionSwarm>;
  let debris: ReturnType<typeof createImpactDebris>;
  let glow: Sprite;
  let glowMat: SpriteNodeMaterial;
  const glowI = uniform(0);
  const diskGroup = new Group();

  let lSun = params.fallback.sun;
  let lEarth = params.fallback.earth;
  let lMoon = params.fallback.moon;

  const sunDirLife = new Vector3(...HANDOFF.sunDir).normalize();
  const E = sunDirLife.clone().multiplyScalar(-params.au); // Earth: the Sun lies along sunDirLife
  const camD = track(params.camDisk);
  const camE = track(params.camEarth);
  /** Resolve impact-relative keys once the event local is known. */
  const resolve = (keys: readonly (readonly number[])[], at: number) => keys.map((k) => (k[2] === 1 ? [k[0]! + at, k[1]!] : [k[0]!, k[1]!]));
  let lavaT = track(resolve(params.lavaT, params.fallback.moon));
  let crust = track(resolve(params.crust, params.fallback.moon));
  const sea = track(params.seaLevel);
  const cover = track(params.cloudCover);
  const teff = track(params.starTeff);
  const tmp = [0, 0, 0];
  const tmp2 = [0, 0, 0];
  const tmpC = new Color();
  const v = new Vector3();
  const v2 = new Vector3();
  const posA = new Vector3();
  const posB = new Vector3();
  const tgt = new Vector3();
  const dirA = new Vector3();
  const dirB = new Vector3();
  const camRight = new Vector3();
  const camFwd = new Vector3();
  const contact = new Vector3();
  const travel = new Vector3();
  const ringN = new Vector3();
  const moonRel = new Vector3();
  const q = new Quaternion();
  const yAxis = new Vector3(0, 1, 0);
  const atmo: AtmosphereSpec = structuredClone(params.atmosphere);
  let spin = 0;
  let endK = 0;
  let endLocked = false;
  let cloudDrift = 0;

  const self: CosmicScene = {
    id: 'solarSystem',
    range: sceneRange('solarSystem'),
    accuracy: 'modelled',
    accuracyNote:
      'Dates are precise (meteorite CAI ages give 4.567 Gyr); the collapse, disk and giant impact are modelled, with sizes exaggerated and time greatly compressed.',
    colourMapped: false,
    async init(ctx: RenderContext) {
      renderer = ctx.renderer;
      const lut = ctx.globals.lut;
      lSun = eventLocal('sun-forms', params.fallback.sun);
      lEarth = eventLocal('earth-forms', params.fallback.earth);
      lMoon = eventLocal('moon-forms', params.fallback.moon);
      lavaT = track(resolve(params.lavaT, lMoon));
      crust = track(resolve(params.crust, lMoon));
      scene = new Scene();
      back = new Scene();
      cloudScene = new Scene();
      compScene = new Scene();
      camera = new PerspectiveCamera(params.fov[0], 1, 1, 30000);

      // Tilt the disk so Earth (at E) lies in its plane.
      // Disk normal: world up made perpendicular to E.
      const eHat = E.clone().normalize();
      const n = yAxis.clone().addScaledVector(eHat, -yAxis.dot(eHat)).normalize();
      diskGroup.quaternion.setFromUnitVectors(yAxis, n);
      scene.add(diskGroup);

      const ha = lineColor(EMISSION_LINES_NM.hAlpha);
      const oiii = lineColor(EMISSION_LINES_NM.oIII);
      const sii = lineColor(EMISSION_LINES_NM.sII);
      // Directions in the disk frame of the opening shot: behind the cloud, and toward its massive neighbour.
      const c0 = params.camDisk[0];
      const camDir0 = new Vector3(Math.sin(c0[1] * D2R) * Math.cos(c0[2] * D2R), Math.sin(c0[2] * D2R), Math.cos(c0[1] * D2R) * Math.cos(c0[2] * D2R)).applyQuaternion(diskGroup.quaternion);
      const behind = camDir0.clone().negate().add(new Vector3(0.25, 0.08, 0)).normalize();
      const right0 = new Vector3().crossVectors(camDir0, yAxis).normalize();
      const rimDir = camDir0.clone().multiplyScalar(-0.55).addScaledVector(right0, -0.8).addScaledVector(yAxis, 0.25).normalize();
      nebula = createSkyNebula(renderer, 9500, ha, oiii, behind);
      back.add(nebula.mesh);
      stars = createStarfield(params.stars.count, params.stars.radius, 23, lut);
      stars.brightness.value = 0.9;
      back.add(stars.object);

      sun = createSun();
      sun.object.scale.setScalar(params.starRadius * 2);
      sun.halo.scale.setScalar(params.starRadius * 40);
      sun.object.renderOrder = 0;
      sun.halo.renderOrder = 0;
      back.add(sun.object, sun.halo);

      const steps = Math.max(12, Math.round(ctx.quality.raymarchSteps * 0.32));
      cloud = createMolecularCloud(params.cloudRadius, steps, ctx.quality.name === 'high' ? 4 : 3, lut, rimDir, ha);
      // The cloud is raymarched at half resolution and composited over the sky (premultiplied).
      cloud.mesh.quaternion.copy(diskGroup.quaternion);
      cloudScene.add(cloud.mesh);
      cloudRT = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter });
      compMat = new MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false });
      compMat.blending = CustomBlending;
      compMat.blendSrc = OneFactor;
      compMat.blendDst = OneMinusSrcAlphaFactor;
      const cs = texture(cloudRT.texture).sample(uv());
      compMat.colorNode = cs.rgb;
      compMat.opacityNode = cs.a;
      const quad = new Mesh(new PlaneGeometry(2, 2), compMat);
      quad.frustumCulled = false;
      compScene.add(quad);

      const dopts = { au: params.au, innerAU: params.disk.innerAU, outerAU: params.disk.outerAU, gapsAU: params.disk.gapsAU, lut };
      disk = createDiskMesh(dopts);
      diskGroup.add(disk.mesh);
      dust = createDiskParticles(Math.round(ctx.quality.particles * params.diskParticleShare), { ...dopts, cloudRadius: params.cloudRadius });
      diskGroup.add(dust.sprite);
      jets = createJets(1400, ha, sii);
      diskGroup.add(jets.sprite);

      // Earth (with Blue Marble cloud map so the hand-off to `life` matches), Theia, the Moon.
      const cm = await loadCloudMap(ctx.assets);
      cloudMap = cm;
      earth = createPlanet({ quality: ctx.quality, lut, geography: { clouds: cm.clouds } });
      earth.group.position.copy(E);
      earth.u.centre.value.copy(E);
      earth.u.lava.value = 1;
      earth.u.lavaRefK.value = params.earthLogTRef;
      earth.u.crust.value = 0.02;
      earth.u.realPlates.value = 0;
      earth.u.ambient.value = HANDOFF.ambient;
      scene.add(earth.group);
      theia = createPlanet({ quality: ctx.quality, lut, atmosphere: false, clouds: false });
      theia.u.lava.value = 1;
      theia.u.lavaRefK.value = params.earthLogTRef;
      theia.u.seaLevel.value = -2;
      theia.u.cloudShadow.value = 0;
      scene.add(theia.group);
      moon = createPlanet({ quality: ctx.quality, lut, atmosphere: false, clouds: false });
      moon.u.lava.value = 1;
      moon.u.lavaRefK.value = params.earthLogTRef;
      moon.u.seaLevel.value = -2;
      moon.u.cloudShadow.value = 0;
      moon.u.rockA.value.setRGB(0.05, 0.05, 0.05);
      moon.u.rockB.value.setRGB(0.12, 0.115, 0.11);
      scene.add(moon.group);

      swarm = createAccretionSwarm(params.accretionCount, lut, lSun + 0.07, lEarth + 0.03);
      earth.group.add(swarm.sprite);
      debris = createImpactDebris(Math.round(ctx.quality.particles * params.debrisShare), lut);
      debris.sprite.position.set(0, 0, 0);
      scene.add(debris.sprite);

      // The growing Earth seen from afar: a warm point of light.
      glowMat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
      const r = uv().sub(0.5).length().mul(2);
      blackbodyColour(1900, tmpC);
      glowMat.colorNode = uniform(tmpC.clone()).mul(float(1).sub(smoothstep(0.0, 1.0, r)).pow(3).mul(glowI));
      glowMat.opacityNode = float(1);
      glow = new Sprite(glowMat);
      glow.position.copy(E);
      glow.scale.setScalar(16);
      scene.add(glow);

      await renderer.compileAsync(scene, camera);
    },

    update(local: number, g: Globals, dt: number, elapsed: number) {
      // Local from lookback (robust to any caller; the chapter map is the source of truth).
      const Ls = AGE_SECONDS - g.t;
      const l = Ls > 3 * GYR_S && Ls < 5 * GYR_S ? clamp01(localAt(Ls)) : clamp01(local);
      const tau = elapsed * 0.08 + l * 40; // orbital clock: idle drift + scroll-driven winding

      // ── star ──
      const ignite = sstep(lSun - 0.05, lSun + 0.005, l);
      const T = teff(l, tmp)[0]!;
      const logT = Math.log10(T);
      blackbodyColour(T, tmpC);
      sun.colour.value.copy(tmpC);
      sun.intensity.value = params.starRadiance * ignite;
      sun.object.visible = ignite > 0.001;
      sun.halo.visible = sun.object.visible;

      // ── parent cloud ──
      const collapse = sstep(0.02, lSun + 0.03, l);
      cloud.u.collapse.value = collapse;
      cloud.u.envelope.value = params.cloudRadius * (0.72 - 0.5 * collapse);
      cloud.u.flatten.value = sstep(lSun - 0.03, lSun + 0.07, l);
      cloud.u.cavity.value = sstep(lSun - 0.02, lSun + 0.04, l);
      cloud.u.starLum.value = ignite * 1.6;
      cloud.u.starLogT.value = logT;
      cloud.u.time.value = elapsed;
      cloud.u.fade.value = 1 - sstep(lSun + 0.01, lSun + 0.08, l);
      cloud.u.opacity.value = 1 + collapse * 0.8;
      cloud.mesh.visible = cloud.u.fade.value > 0.001;
      cloud.mesh.scale.setScalar(Math.min(1, (cloud.u.envelope.value * 1.8) / params.cloudRadius));
      nebula.u.brightness.value = 1 - 0.85 * sstep(0.2, 0.45, l);

      // ── disk ──
      const gas = 1 - sstep(lSun + 0.07, lEarth + 0.02, l);
      const gaps = sstep(lSun + 0.02, lEarth - 0.03, l);
      disk.u.opacity.value = sstep(lSun - 0.01, lSun + 0.05, l) * (0.3 + 0.7 * gas) * (1 - sstep(0.33, 0.42, l));
      disk.u.tau.value = tau;
      disk.u.gapDepth.value = gaps;
      disk.u.starLogT.value = logT;
      disk.u.gas.value = gas;
      disk.u.brightness.value = ignite;
      disk.mesh.visible = disk.u.opacity.value > 0.001;
      dust.u.tau.value = tau;
      dust.u.collapse.value = sstep(lSun - 0.06, lSun + 0.06, l);
      dust.u.gapDepth.value = gaps;
      dust.u.gas.value = gas;
      dust.u.rocks.value = sstep(lSun + 0.05, lEarth, l);
      dust.u.starLum.value = 0.15 + ignite * 0.85;
      dust.u.starLogT.value = logT;
      dust.u.envelope.value = cloud.u.envelope.value;
      dust.u.brightness.value = 1 - sstep(0.4, 0.62, l) * 0.85;
      jets.u.intensity.value = sstep(lSun - 0.02, lSun + 0.01, l) * (1 - sstep(lSun + 0.06, lSun + 0.13, l));
      jets.u.time.value = elapsed + l * 300;
      jets.sprite.visible = jets.u.intensity.value > 0.001;

      // ── camera: disk frame → Earth frame ──
      camD(l, tmp);
      camE(l, tmp2);
      const azA = tmp[0]! * D2R;
      const elA = tmp[1]! * D2R;
      posA.set(Math.sin(azA) * Math.cos(elA), Math.sin(elA), Math.cos(azA) * Math.cos(elA)).applyQuaternion(diskGroup.quaternion);
      dirA.copy(posA);
      const azB = tmp2[0]! * D2R;
      const elB = tmp2[1]! * D2R;
      dirB.set(Math.sin(azB) * Math.cos(elB), Math.sin(elB), Math.cos(azB) * Math.cos(elB));
      const b = smootherstep(params.camBlend[0], params.camBlend[1], l);
      tgt.set(0, 0, 0).lerp(E, b);
      const dist = Math.exp(Math.log(tmp[2]!) * (1 - b) + Math.log(tmp2[2]!) * b);
      v.copy(dirA).lerp(dirB, b).normalize();
      camera.position.copy(tgt).addScaledVector(v, dist);
      camera.position.y += Math.sin(elapsed * 0.05) * dist * 0.007;
      camera.lookAt(tgt);
      camera.fov = params.fov[0] + (params.fov[1] - params.fov[0]) * sstep(0.3, 0.9, l);
      camera.near = Math.max(0.02, dist * 0.004);
      camera.far = dist * 6 + 20000;
      camera.updateProjectionMatrix();
      void posB;

      // ── Earth: accretion, impact, magma ocean, steam, rain ──
      const grow = sstep(lSun + 0.05, lEarth + 0.01, l);
      const R = 0.38 + 0.62 * grow;
      earth.group.scale.setScalar(R);
      earth.u.radius.value = R;
      earth.group.visible = grow > 0.0005;
      const pu = earth.u;
      pu.sunDir.value.copy(sunDirLife);
      blackbodyColour(T, tmpC);
      pu.sunColour.value.copy(tmpC);
      pu.sunIntensity.value = params.earthSunIntensity * ignite;
      pu.time.value = elapsed;
      const lt = lavaT(l, tmp)[0]!;
      pu.lavaLogT.value = Math.log10(lt);
      pu.crustCover.value = crust(l, tmp)[0]!;
      pu.glowGain.value = 0.16;
      pu.displace.value = 0.012 * (1 - sstep(0.85, 1.0, l));
      pu.seaLevel.value = l < 0.84 ? -2 : sea(l, tmp)[0]!;
      pu.hotspots.value = 0.55 * sstep(0.85, 0.98, l);
      pu.crust.value = 0.02;
      pu.oceanDeep.value.setRGB(0.012, 0.02, 0.026);
      pu.oceanShallow.value.setRGB(0.03, 0.045, 0.05);
      pu.rockA.value.setRGB(0.035, 0.034, 0.033);
      pu.rockB.value.setRGB(0.1, 0.095, 0.09);
      pu.iceEdge.value = 1;
      pu.photoIce.value = 0;
      pu.northIce.value = 0;
      const cc = cover(l, tmp)[0]!;
      pu.cloudCover.value = cc;
      pu.cloudOpacity.value = sstep(0.66, 0.74, l);
      pu.cloudShadow.value = 0.5 * pu.cloudOpacity.value;
      if (earth.clouds) earth.clouds.visible = pu.cloudOpacity.value > 0.001;
      // Atmosphere: thin before the impact; a hot steam/CO₂ envelope after; clearing slightly as it rains.
      // The steam envelope builds as the magma ocean cools (no white haze over the glowing melt).
      const steamOn = sstep(0.56, 0.7, l);
      const steam = steamOn * (1 - sstep(0.8, 0.95, l));
      atmo.mie = 4e-6 + (params.atmosphere.mie - 4e-6) * steamOn + params.steamMie * steam;
      for (let c = 0; c < 3; c++) atmo.haze[c] = params.atmosphere.haze[c]! * sstep(0.85, 1, l);
      setAtmosphereUniforms(pu, atmo, R);
      if (earth.atmosphere) earth.atmosphere.scale.setScalar(1 + pu.atmoTop.value);
      pu.atmoGain.value = 0.35 + 0.65 * steamOn;

      // Spin: faster after the impact (it set the day length).
      // The closing frame locks rotation and weather to life's opening frame (they dissolve into each other).
      const wEnd = sstep(0.86, 0.97, l);
      spin += dt * params.idleSpin * (1 + sstep(lMoon, lMoon + 0.02, l)) * (1 - wEnd);
      const free = spin + l * 6;
      if (wEnd > 0) {
        if (!endLocked) {
          endK = Math.round(free / (Math.PI * 2));
          endLocked = true;
        }
      } else endLocked = false;
      const theta = free + wEnd * (endK * Math.PI * 2 - free);
      earth.surface.rotation.y = theta;
      cloudDrift += dt * 0.004 * (1 - wEnd);
      const cloudTurn = HANDOFF.cloudTurnStart + cloudDrift * (1 - wEnd);
      if (earth.clouds) earth.clouds.rotation.y = theta + cloudTurn;
      q.setFromAxisAngle(yAxis, -cloudTurn);
      pu.cloudRel.value.set(q.x, q.y, q.z, q.w);

      // Glow sprite for the distant view.
      const camDist = camera.position.distanceTo(E);
      glowI.value = grow * 2.5 * sstep(25, 140, camDist) * (1 - sstep(lMoon + 0.02, lMoon + 0.06, l));
      glow.visible = glowI.value > 0.001;
      glow.scale.setScalar(camDist * 0.035);
      swarm.u.local.value = l;
      swarm.u.tau.value = tau;
      swarm.u.radius.value = 1;
      swarm.u.brightness.value = 1;
      swarm.sprite.visible = l > lSun + 0.03 && l < lEarth + 0.05;

      // ── Theia and the giant impact ──
      // Geometry is set relative to the camera at impact so the grazing blow reads on the right limb.
      camFwd.copy(E).sub(camera.position).normalize();
      camRight.crossVectors(camFwd, yAxis).normalize();
      contact.copy(camRight).multiplyScalar(0.92).addScaledVector(camFwd, 0.25).addScaledVector(yAxis, 0.18).normalize();
      travel.copy(camRight).multiplyScalar(-0.55).addScaledVector(camFwd, 0.6).addScaledVector(yAxis, -0.55).normalize();
      ringN.crossVectors(contact, travel).normalize();
      const approach = (lMoon - l) / 0.09; // 1 → 0 at contact
      const tR = params.theiaRadius;
      const merge = sstep(lMoon, lMoon + 0.008, l);
      theia.group.visible = approach < 1 && merge < 0.999;
      if (theia.group.visible) {
        const dpath = Math.max(0, approach) * 32;
        v.copy(contact).multiplyScalar(1 + tR * (1 - merge * 1.4));
        v.addScaledVector(travel, -dpath).addScaledVector(contact, dpath * 0.15);
        theia.group.position.copy(E).add(v);
        const s = tR * (1 - merge);
        theia.group.scale.setScalar(Math.max(1e-3, s));
        theia.u.radius.value = Math.max(1e-3, s);
        theia.u.centre.value.copy(theia.group.position);
        v2.copy(E).sub(theia.group.position).normalize(); // its own sunlight ≈ Earth's
        theia.u.sunDir.value.copy(sunDirLife);
        theia.u.sunColour.value.copy(pu.sunColour.value);
        theia.u.sunIntensity.value = pu.sunIntensity.value;
        theia.u.lavaLogT.value = Math.log10(1300 + 1700 * merge);
        theia.u.crustCover.value = 0.96 * (1 - merge);
        theia.u.time.value = elapsed;
        theia.surface.rotation.y = elapsed * 0.1;
      }
      // Impact on Earth's surface (in Earth's rotating frame).
      v.copy(contact).applyAxisAngle(yAxis, -earth.surface.rotation.y);
      pu.impactDir.value.copy(v);
      const dl = l - lMoon;
      pu.impactFlash.value = dl > -0.001 ? Math.exp(-((dl / 0.005) ** 2)) * 0.6 : 0;
      pu.impactAge.value = clamp01(dl / 0.04);

      // Debris: ejecta → ring → Moon.
      debris.sprite.position.copy(E);
      debris.u.age.value = dl / 0.045;
      debris.u.condense.value = sstep(lMoon + 0.035, lMoon + 0.11, l);
      debris.u.impactDir.value.copy(contact);
      debris.u.tangent.value.copy(travel);
      debris.u.ringNormal.value.copy(ringN);
      debris.u.tau.value = tau * 0.5;
      debris.sprite.visible = dl > -0.001 && debris.u.condense.value < 0.999;

      // The Moon: condenses from the ring, then recedes. Kept beside Earth, out of the closing frame's centre.
      const mForm = sstep(lMoon + 0.04, lMoon + 0.11, l);
      moon.group.visible = mForm > 0.001;
      const aM = params.moonOrbit[0] + (params.moonOrbit[1] - params.moonOrbit[0]) * sstep(lMoon + 0.1, 1.0, l);
      const phM = 0.6 + (l - lMoon) * 9 + elapsed * 0.01;
      const e1 = v.copy(contact).addScaledVector(ringN, -contact.dot(ringN)).normalize();
      const e2 = v2.crossVectors(ringN, e1);
      moonRel.copy(e1).multiplyScalar(Math.cos(phM) * aM).addScaledVector(e2, Math.sin(phM) * aM);
      debris.u.moonPos.value.copy(moonRel);
      if (moon.group.visible) {
        const mr = params.moonRadius * mForm;
        moon.group.position.copy(E).add(moonRel);
        moon.group.scale.setScalar(mr);
        moon.u.radius.value = mr;
        moon.u.centre.value.copy(moon.group.position);
        moon.u.sunDir.value.copy(sunDirLife);
        moon.u.sunColour.value.copy(pu.sunColour.value);
        moon.u.sunIntensity.value = pu.sunIntensity.value;
        moon.u.lavaLogT.value = Math.log10(Math.max(700, 2600 - 2400 * sstep(lMoon + 0.08, 0.8, l)));
        moon.u.crustCover.value = sstep(lMoon + 0.08, 0.7, l);
        moon.u.time.value = elapsed;
        moon.surface.rotation.y = phM;
      }
    },

    render(target: RenderTarget) {
      renderer.setRenderTarget(target);
      renderer.render(back, camera);
      const autoClear = renderer.autoClear;
      if (cloud.mesh.visible) {
        const clearAlpha = renderer.getClearAlpha();
        renderer.setClearAlpha(0);
        renderer.setRenderTarget(cloudRT);
        renderer.render(cloudScene, camera);
        renderer.setClearAlpha(clearAlpha);
        renderer.setRenderTarget(target);
        renderer.autoClear = false;
        renderer.render(compScene, orthoCam);
      }
      renderer.autoClear = false;
      renderer.render(scene, camera);
      renderer.autoClear = autoClear;
    },
    resize(w: number, h: number) {
      cloudRT.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    dispose() {
      cloudRT.dispose();
      compMat.dispose();
      compScene.traverse((o) => (o as Mesh).geometry?.dispose());
      earth.dispose();
      theia.dispose();
      moon.dispose();
      sun.dispose();
      stars.dispose();
      nebula.dispose();
      cloud.dispose();
      disk.dispose();
      dust.dispose();
      jets.dispose();
      swarm.dispose();
      debris.dispose();
      glowMat.dispose();
      cloudMap?.release();
    },
  };
  return self;
};
