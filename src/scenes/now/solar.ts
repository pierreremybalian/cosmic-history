// Solar system (AU), the Sun's stellar neighbourhood (pc) and the Milky Way band on the sky for `now`.
// Planet positions are today's (JPL elements); belts and the neighbourhood are representative samples.

import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicNodeMaterial,
  LineSegments,
  Mesh,
  MeshBasicNodeMaterial,
  SphereGeometry,
  Vector3,
} from 'three/webgpu';
import { abs, asin, atan, attribute, cameraPosition, clamp, exp, float, max, min, mix, modelViewMatrix, normalize, positionWorld, pow, smoothstep, sqrt, uniform, vec3, vec4 } from 'three/tsl';
import type { Vec2Uniform, FloatUniform } from '../../render/globals.ts';
import { blackbodyRGB } from '../../physics/blackbody.ts';
import { fbm } from '../../shared/noise.ts';
import { gaussian, mulberry32 } from '../../shared/math.ts';
import { createPoints, type Points } from './points.ts';
import { eclToWorld, PLANETS, planetEcliptic } from './ephemeris.ts';

const AU_KM = 1.495978707e8;
const SUN_RADIUS_AU = 695700 / AU_KM;

export interface SolarSystem {
  group: Group;
  planets: Points;
  sun: Points;
  orbits: LineSegments;
  belts: Points;
  /** Index of Earth in PLANETS. */
  earthIndex: number;
  earthPos: Vector3;
  uniforms: { orbits: FloatUniform; planets: FloatUniform; belts: FloatUniform; sun: FloatUniform; earthDot: FloatUniform };
  dispose(): void;
}

export function createSolarSystem(T: number, resolution: Vec2Uniform, fovDeg: number, sunColor: Vector3, beltCount: number): SolarSystem {
  const group = new Group();
  const u = { orbits: uniform(1), planets: uniform(1), belts: uniform(1), sun: uniform(1), earthDot: uniform(1) };
  const tmp = new Vector3();
  const earthIndex = PLANETS.findIndex((p) => p.name === 'Earth');
  const earthPos = new Vector3();

  // Sun: a disc at its true angular size plus a glow that keeps it a star from afar.
  const sun = createPoints({
    count: 2,
    resolution,
    fovDeg,
    sharpness: 3.5,
    shade: (P, C) => {
      // P.w > 0: fixed pixel size; P.w < 0: true size in AU (projected).
      const viewZ = modelViewMatrix.mul(vec4(P.xyz, 1)).z.negate();
      const truePx = abs(P.w).div(viewZ).mul(resolution.y.div(2 * Math.tan(((fovDeg / 2) * Math.PI) / 180)));
      const size = P.w.greaterThan(0).select(P.w, max(truePx.mul(2.0), 2.5));
      return { color: C.rgb.mul(C.w).mul(u.sun), size };
    },
  });
  sun.pos.setXYZW(0, 0, 0, 0, 70);
  sun.col.setXYZW(0, sunColor.x, sunColor.y, sunColor.z, 0.35);
  sun.pos.setXYZW(1, 0, 0, 0, -SUN_RADIUS_AU);
  sun.col.setXYZW(1, sunColor.x, sunColor.y, sunColor.z, 6.0);
  group.add(sun.sprite);

  // Planets: dots at today's positions.
  const planets = createPoints({
    count: PLANETS.length,
    resolution,
    fovDeg,
    sharpness: 5,
    shade: (P, C) => ({ color: C.rgb.mul(u.planets).mul(mix(float(1), u.earthDot, C.w)), size: P.w }),
  });
  PLANETS.forEach((p, i) => {
    planetEcliptic(p, T, tmp);
    eclToWorld(tmp.x, tmp.y, tmp.z, tmp);
    if (i === earthIndex) earthPos.copy(tmp);
    const big = p.name === 'Jupiter' || p.name === 'Saturn';
    planets.pos.setXYZW(i, tmp.x, tmp.y, tmp.z, big ? 4.2 : 3.2);
    planets.col.setXYZW(i, p.color[0] * 1.6, p.color[1] * 1.6, p.color[2] * 1.6, i === earthIndex ? 1 : 0);
  });
  group.add(planets.sprite);

  // Orbits: one line strip per planet, sampled in mean anomaly.
  const SEG = 360;
  const verts: number[] = [];
  const shade: number[] = [];
  PLANETS.forEach((p, i) => {
    const pts: Vector3[] = [];
    for (let k = 0; k < SEG; k++) {
      planetEcliptic(p, T, tmp, (k / SEG) * Math.PI * 2);
      pts.push(eclToWorld(tmp.x, tmp.y, tmp.z, new Vector3()));
    }
    for (let k = 0; k < SEG; k++) {
      const a = pts[k]!;
      const b = pts[(k + 1) % SEG]!;
      verts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      const w = i === earthIndex ? 1.0 : 0.55;
      shade.push(w, w);
    }
  });
  const og = new BufferGeometry();
  og.setAttribute('position', new Float32BufferAttribute(verts, 3));
  og.setAttribute('shade', new Float32BufferAttribute(shade, 1));
  const om = new LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  om.colorNode = vec3(0.55, 0.68, 1.0).mul(attribute<'float'>('shade', 'float')).mul(0.22).mul(u.orbits);
  om.opacityNode = float(1);
  const orbits = new LineSegments(og, om);
  orbits.frustumCulled = false;
  group.add(orbits);

  // Asteroid belt (2.1–3.3 AU), Kuiper belt (30–50 AU) and a hint of the Oort cloud (2,000–50,000 AU).
  const rand = mulberry32(77);
  const nA = Math.round(beltCount * 0.35);
  const nK = Math.round(beltCount * 0.4);
  const nO = beltCount - nA - nK;
  const belts = createPoints({ count: beltCount, resolution, fovDeg, sharpness: 4 });
  for (let k = 0; k < beltCount; k++) {
    let x: number;
    let y: number;
    let z: number;
    let br: number;
    if (k < nA + nK) {
      const ast = k < nA;
      const a = ast ? 2.1 + 1.2 * rand() : 30 + 20 * Math.pow(rand(), 0.7);
      const th = rand() * Math.PI * 2;
      const inc = gaussian(rand) * (ast ? 0.1 : 0.16);
      x = a * Math.cos(th);
      y = a * Math.sin(th) * Math.cos(inc);
      z = a * Math.sin(th) * Math.sin(inc);
      br = ast ? 0.32 : 0.22;
    } else {
      const r = 2000 * Math.pow(25, rand());
      const v = new Vector3(gaussian(rand), gaussian(rand), gaussian(rand)).normalize().multiplyScalar(r);
      x = v.x;
      y = v.y;
      z = v.z;
      br = 0.25;
    }
    eclToWorld(x, y, z, tmp);
    belts.pos.setXYZW(k, tmp.x, tmp.y, tmp.z, 1.6);
    belts.col.setXYZW(k, 0.75 * br, 0.72 * br, 0.68 * br, 1);
  }
  group.add(belts.sprite);
  belts.uniforms.opacity.value = 1;
  belts.material.colorNode = belts.material.colorNode!.mul(u.belts);

  return {
    group,
    planets,
    sun,
    orbits,
    belts,
    earthIndex,
    earthPos,
    uniforms: u,
    dispose() {
      sun.dispose();
      planets.dispose();
      belts.dispose();
      og.dispose();
      om.dispose();
    },
  };
}

// ───────────────────────────── stellar neighbourhood (parsecs) ─────────────────────────────

/** Star classes for a "what you would see" sample: luminous stars are over-represented like on the real sky. */
const CLASSES = [
  { f: 0.08, T: 18000, L: [200, 4000], R: 900 },
  { f: 0.18, T: 9200, L: [12, 60], R: 350 },
  { f: 0.14, T: 6700, L: [2, 6], R: 160 },
  { f: 0.14, T: 5700, L: [0.6, 1.6], R: 90 },
  { f: 0.2, T: 4300, L: [40, 400], R: 600 },
  { f: 0.13, T: 4600, L: [0.12, 0.5], R: 45 },
  { f: 0.13, T: 3300, L: [0.004, 0.05], R: 18 },
] as const;

export interface Neighbourhood {
  stars: Points;
  band: Mesh;
  uniforms: { stars: FloatUniform; band: FloatUniform };
  dispose(): void;
}

export function createNeighbourhood(count: number, resolution: Vec2Uniform, fovDeg: number): Neighbourhood {
  const u = { stars: uniform(1), band: uniform(1) };
  const rand = mulberry32(1609);
  // Flux → pixel brightness: a compressive response like the eye, so 10 magnitudes stay visible.
  const stars = createPoints({
    count,
    resolution,
    fovDeg,
    sharpness: 7,
    shade: (P, C) => {
      const d2 = max(cameraPosition.sub(P.xyz).dot(cameraPosition.sub(P.xyz)), 1e-6);
      const flux = C.w.div(d2); // L☉ / pc²
      const b = min(pow(flux.mul(40.0), 0.42), 4.0);
      const fade = smoothstep(0.004, 0.03, b);
      return { color: C.rgb.mul(b).mul(fade).mul(u.stars), size: float(1.4).add(sqrt(b).mul(1.3)) };
    },
  });
  const cdf: number[] = [];
  let acc = 0;
  for (const c of CLASSES) cdf.push((acc += c.f));
  const tmp = new Vector3();
  for (let k = 0; k < count; k++) {
    const x = rand() * acc;
    const c = CLASSES[cdf.findIndex((v) => x <= v)]!;
    const r = c.R * Math.cbrt(rand());
    tmp.set(gaussian(rand), gaussian(rand) * 0.35, gaussian(rand)).normalize().multiplyScalar(r);
    const L = c.L[0] * Math.pow(c.L[1] / c.L[0], rand());
    const T = c.T * (0.9 + 0.2 * rand());
    const [cr, cg, cb] = blackbodyRGB(T);
    stars.pos.setXYZW(k, tmp.x, tmp.y, tmp.z, 2);
    stars.col.setXYZW(k, cr, cg, cb, L);
  }

  // The Milky Way on the sky: integrated starlight of the disk, in true Galactic orientation.
  const geo = new SphereGeometry(1, 96, 48);
  const mat = new MeshBasicNodeMaterial({ side: BackSide, transparent: true, depthWrite: false, blending: AdditiveBlending });
  const dir = normalize(positionWorld.sub(cameraPosition));
  const b = asin(clamp(dir.y, -1, 1));
  const l = atan(dir.z.negate(), dir.x);
  const sigma = float(0.085).add(exp(l.mul(l).div(-0.35)).mul(0.1));
  const bandI = exp(b.mul(b).div(sigma.mul(sigma)).negate());
  const bulge = float(0.35).add(exp(l.mul(l).div(-0.45)).mul(1.1));
  const mott = fbm(dir.mul(7.0), 4).mul(0.5).add(0.75);
  const rift = smoothstep(0.0, 0.35, fbm(dir.mul(4.0).add(11.0), 4).add(abs(b).mul(4.0)).sub(0.05)).mul(0.75).add(0.25);
  const riftOn = mix(float(1), rift, exp(l.mul(l).div(-1.4)));
  const warm = vec3(...(blackbodyRGB(4600) as [number, number, number]));
  const cool = vec3(...(blackbodyRGB(7000) as [number, number, number]));
  const col = mix(cool, warm, exp(l.mul(l).div(-0.8)));
  mat.colorNode = col.mul(bandI.mul(bulge).mul(mott).mul(riftOn).mul(0.16)).mul(u.band);
  mat.opacityNode = float(1);
  const band = new Mesh(geo, mat);
  band.frustumCulled = false;
  band.renderOrder = -10;

  return {
    stars,
    band,
    uniforms: u,
    dispose() {
      stars.dispose();
      geo.dispose();
      mat.dispose();
    },
  };
}
