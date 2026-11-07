// Earth for the opening of `now`: a small blue planet lit by the Sun. Procedural (illustrative) continents,
// clouds, ocean glint, a Rayleigh-blue limb with a warm terminator, and the Moon. Units: Earth radii.

import { AdditiveBlending, FrontSide, Group, Mesh, MeshBasicNodeMaterial, SphereGeometry, Vector3 } from 'three/webgpu';
import {
  abs,
  asin,
  cameraPosition,
  clamp,
  dot,
  exp,
  float,
  max,
  mix,
  normalize,
  normalWorld,
  positionLocal,
  positionWorld,
  pow,
  smoothstep,
  uniform,
  vec3,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { domainWarp, fbm } from '../../shared/noise.ts';
import type { FloatUniform } from '../../render/globals.ts';

type V3 = Node<'vec3'>;
import type { Vec3Uniform } from '../cosmicNoon/galaxies.ts';

/** Mean radius of the Moon / Earth, and the Moon's distance (computed by ephemeris) are in Earth radii. */
export const MOON_RADIUS_RE = 1737.4 / 6371.0;

export interface Earth {
  group: Group;
  /** Spins about the polar axis (local +Y). Orient `tilt` so +Y is Earth's axis. */
  globe: Mesh;
  tilt: Group;
  moon: Mesh;
  uniforms: {
    /** Unit vector from Earth toward the Sun (world). */
    sunDir: Vec3Uniform;
    /** Cloud drift time. */
    time: FloatUniform;
    /** Overall exposure. */
    exposure: FloatUniform;
    opacity: FloatUniform;
  };
  dispose(): void;
}

export function createEarth(sunColor: Vector3): Earth {
  const u = { sunDir: uniform(new Vector3(1, 0, 0)), time: uniform(0), exposure: uniform(1), opacity: uniform(1) };
  const sun = vec3(sunColor.x, sunColor.y, sunColor.z);

  // ── surface + clouds ──
  const n = normalize(positionLocal);
  const lat = asin(clamp(n.y, -1, 1));
  const alat = abs(lat);
  // Continents: a few large landmasses (low-frequency) with ragged coasts (high-frequency detail).
  const p = domainWarp(n.mul(0.9), 0.5, 3);
  const h = fbm(p.mul(1.05), 3).mul(1.25).add(fbm(p.mul(4.2), 4).mul(0.22)).add(0.05);
  const land = smoothstep(0.035, 0.07, h);
  const coast = smoothstep(-0.05, 0.035, h).mul(float(1).sub(land));
  const detail = fbm(n.mul(9.0), 4);
  // Biomes by latitude and moisture: forests near the equator, deserts in the subtropics, tundra, ice caps.
  const desertBand = smoothstep(0.2, 0.38, alat).mul(float(1).sub(smoothstep(0.55, 0.7, alat)));
  const moist = smoothstep(-0.2, 0.25, fbm(n.mul(3.3).add(7.1), 3));
  const forest = vec3(0.025, 0.065, 0.02);
  const grass = vec3(0.07, 0.09, 0.035);
  const desert = vec3(0.32, 0.22, 0.12);
  const tundra = vec3(0.12, 0.11, 0.09);
  let ground: V3 = mix(grass, forest, moist);
  ground = mix(ground, desert, desertBand.mul(float(1).sub(moist.mul(0.7))));
  ground = mix(ground, tundra, smoothstep(0.85, 1.05, alat));
  ground = ground.mul(detail.mul(0.6).add(1.0));
  const ice = smoothstep(1.12, 1.25, alat.add(detail.mul(0.08)));
  const ocean = mix(vec3(0.004, 0.018, 0.06), vec3(0.01, 0.06, 0.12), coast);
  let surface: V3 = mix(ocean, ground, land);
  surface = mix(surface, vec3(0.75, 0.78, 0.82), ice);

  // Clouds: swirled bands — the ITCZ near the equator, clear subtropics, storm tracks at mid-latitudes.
  const cloudP = n.mul(2.2).add(vec3(u.time.mul(0.004), 0, u.time.mul(0.002)));
  const swirl = domainWarp(cloudP, 0.6, 3);
  const cloudN = fbm(vec3(swirl.x.mul(1.6), swirl.y.mul(3.2), swirl.z.mul(1.6)), 6);
  const belts = smoothstep(0.75, 0.95, alat).mul(0.12).add(float(1).sub(smoothstep(0.0, 0.18, alat)).mul(0.08)).sub(smoothstep(0.22, 0.42, alat).mul(float(1).sub(smoothstep(0.5, 0.7, alat))).mul(0.1));
  const cloud = smoothstep(-0.02, 0.32, cloudN.add(belts)).mul(0.95);

  // Lighting in world space.
  const N = normalize(normalWorld);
  const L = u.sunDir;
  const V = normalize(cameraPosition.sub(positionWorld));
  const ndl = dot(N, L);
  const day = smoothstep(-0.04, 0.25, ndl);
  const diffuse = max(ndl, 0).mul(0.9).add(day.mul(0.06));
  const H = normalize(L.add(V));
  const glint = pow(max(dot(N, H), 0), 400.0)
    .mul(0.9)
    .add(pow(max(dot(N, H), 0), 40.0).mul(0.05))
    .mul(float(1).sub(land))
    .mul(float(1).sub(cloud))
    .mul(smoothstep(0.0, 0.2, ndl));
  const lit = mix(surface, vec3(0.9), cloud).mul(diffuse).mul(sun).mul(1.45).add(sun.mul(glint));
  // Thin blue haze over the day side (the atmosphere seen from above).
  const mu = max(dot(N, V), 0);
  const haze = vec3(0.12, 0.25, 0.6).mul(pow(float(1).sub(mu), 2.0).mul(0.6).add(0.06)).mul(day);
  const globeMat = new MeshBasicNodeMaterial();
  globeMat.colorNode = lit.add(haze).mul(u.exposure).mul(u.opacity);
  const globe = new Mesh(new SphereGeometry(1, 160, 80), globeMat);

  // ── atmosphere limb: Rayleigh blue on the day side, warm at the terminator ──
  const atmoMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: FrontSide });
  const An = normalize(normalWorld);
  const Av = normalize(cameraPosition.sub(positionWorld));
  const amu = max(dot(An, Av), 0);
  const rim = pow(float(1).sub(amu), 3.0);
  const andl = dot(An, L);
  const sunlit = smoothstep(-0.12, 0.4, andl);
  const dusk = exp(andl.mul(andl).div(-0.006)).mul(0.18).mul(rim).mul(rim);
  const outer = smoothstep(0.0, 0.35, amu); // fade the very edge of the shell
  atmoMat.colorNode = vec3(0.22, 0.48, 1.0)
    .mul(sunlit)
    .add(vec3(1.0, 0.42, 0.16).mul(dusk))
    .mul(rim)
    .mul(outer)
    .mul(1.5)
    .mul(u.exposure)
    .mul(u.opacity);
  atmoMat.opacityNode = float(1);
  const atmo = new Mesh(new SphereGeometry(1.035, 96, 48), atmoMat);

  // ── Moon ──
  const mn = normalize(positionLocal);
  const maria = smoothstep(0.05, 0.25, fbm(mn.mul(2.2).add(3.3), 4));
  const craters = fbm(mn.mul(14.0), 3).mul(0.25).add(1);
  const albedo = mix(vec3(0.26, 0.25, 0.24), vec3(0.11, 0.11, 0.115), maria).mul(craters);
  const mN = normalize(normalWorld);
  const moonMat = new MeshBasicNodeMaterial();
  moonMat.colorNode = albedo.mul(max(dot(mN, L), 0)).mul(sun).mul(2.4).mul(u.exposure).mul(u.opacity);
  const moon = new Mesh(new SphereGeometry(MOON_RADIUS_RE, 64, 32), moonMat);

  const tilt = new Group();
  tilt.add(globe);
  const group = new Group();
  group.add(tilt);
  group.add(atmo);
  group.add(moon);
  return {
    group,
    globe,
    tilt,
    moon,
    uniforms: u,
    dispose() {
      globe.geometry.dispose();
      globeMat.dispose();
      atmo.geometry.dispose();
      atmoMat.dispose();
      moon.geometry.dispose();
      moonMat.dispose();
    },
  };
}
