// Illustrative plate motions for the last ~550 Myr (pure math; no assets, so it runs in Node for the offline
// check in scratch/planet/pangaea.ts).
//
// Each plate's position at lookback L is a finite rotation of its present-day outline. Relative fits are
// composed the way palaeogeographers do it (South America → Africa, Europe → North America → Africa,
// Australia → Antarctica → Africa, …), then everything is carried by an "absolute" rotation for Africa
// (palaeolatitude / true polar wander). Fit poles are hand-tuned to reproduce the familiar textbook maps:
// Pangaea assembled from ~300 to ~200 Myr, the Atlantic opening in the Jurassic–Cretaceous, India racing
// north to hit Asia around 50 Myr, Australia leaving Antarctica around 45 Myr, and Gondwana lying across the
// South Pole in the early Palaeozoic. Not a reconstruction; good enough to show continents drifting.

import { Quaternion, Vector3 } from 'three/webgpu';

export const PLATE = { africa: 0, southAmerica: 1, northAmerica: 2, europe: 3, india: 4, australia: 5, antarctica: 6, asia: 7 } as const;
export const PLATE_COUNT = 8;

/** A finite rotation: Euler pole (lat, lon in degrees) and angle (degrees, right-hand rule about the pole). */
export type EulerRot = readonly [poleLat: number, poleLon: number, angleDeg: number];

/** Keyframes: lookback (Myr) → finite rotation (present-day → then), slerped between keys. */
type Keys = readonly (readonly [number, EulerRot])[];

interface Motion {
  keys: Keys;
}

/** One fit scaled by a piecewise-linear fraction schedule. */
function scaled(fit: EulerRot, schedule: readonly (readonly [number, number])[]): Motion {
  return { keys: schedule.map(([L, f]) => [L, [fit[0], fit[1], fit[2] * f]] as const) };
}

const D2R = Math.PI / 180;

/** Same direction convention as the shader: (cos φ sin λ, sin φ, cos φ cos λ). */
export function dirFromLatLon(latDeg: number, lonDeg: number, out = new Vector3()): Vector3 {
  const la = latDeg * D2R;
  const lo = lonDeg * D2R;
  return out.set(Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo));
}

export function latLonFromDir(v: Vector3): [number, number] {
  return [Math.asin(Math.max(-1, Math.min(1, v.y))) / D2R, Math.atan2(v.x, v.z) / D2R];
}

const _axis = new Vector3();
function rotQuat(r: EulerRot, out: Quaternion): Quaternion {
  dirFromLatLon(r[0], r[1], _axis);
  return out.setFromAxisAngle(_axis, r[2] * D2R);
}

const _k0 = new Quaternion();
const _k1 = new Quaternion();
function motionQuat(m: Motion, L: number, out: Quaternion): Quaternion {
  const k = m.keys;
  if (L <= k[0]![0]) return rotQuat(k[0]![1], out);
  for (let i = 0; i < k.length - 1; i++) {
    const [l0, r0] = k[i]!;
    const [l1, r1] = k[i + 1]!;
    if (L <= l1) return out.slerpQuaternions(rotQuat(r0, _k0), rotQuat(r1, _k1), (L - l0) / (l1 - l0));
  }
  return rotQuat(k.at(-1)![1], out);
}

// ── Motions (present-day → past). Tuned by eye against palaeogeographic maps. ─────────────

export const MOTIONS = {
  /** Africa in the palaeomagnetic frame (absolute). Two parts: latitude shift, then spin. */
  africaLat: scaled([0, 110, 1], [[0, 0], [66, 6], [130, 10], [200, 16], [300, 32], [400, 55], [450, 72], [540, 60]]),
  africaSpin: scaled([6, 20, 1], [[0, 0], [66, -4], [200, -14], [300, -22], [450, -35], [540, -45]]),
  /** South America → Africa (closing the South Atlantic). */
  southAmerica: scaled([44, -30.6, 57], [[0, 0], [66, 0.42], [100, 0.78], [125, 0.97], [135, 1], [540, 1]]),
  /** North America → Africa (closing the Central Atlantic). */
  northAmerica: scaled([67.6, -13.7, 75], [[0, 0], [66, 0.36], [120, 0.66], [175, 0.95], [195, 1], [540, 1]]),
  /** Europe → North America (closing the North Atlantic). */
  europeToNA: scaled([88.5, 27.7, -38], [[0, 0], [40, 0.6], [60, 0.95], [120, 1], [540, 1]]),
  /** Antarctica → Africa. */
  antarctica: scaled([-0.3, -49.1, 43.5], [[0, 0], [66, 0.45], [120, 0.85], [165, 1], [540, 1]]),
  /** Australia → Antarctica. */
  australiaToAN: scaled([-7.2, -144.7, 30.9], [[0, 0], [30, 0.55], [45, 0.92], [60, 1], [540, 1]]),
  /** India → Africa (its Gondwana slot between Madagascar and Antarctica). */
  india: {
    keys: [
      [0, [90, 0, 0]],
      [50, [-24.7, 148.3, 45.1 * 0.45]],
      [66, [-24.7, 148.3, 45.1]],
      [130, [-34, -168.7, 41.6]],
      [540, [-34, -168.7, 41.6]],
    ],
  },
} satisfies Record<string, Motion>;

/**
 * Before Pangaea: blocks drift apart along the great circle from Africa through their own centre (in the
 * assembled, 300-Myr frame), i.e. the ocean between them reopens. Angles in degrees vs lookback (Myr).
 */
const PRE_PANGAEA: Record<number, readonly (readonly [number, number])[]> = {
  [PLATE.northAmerica]: [[0, 0], [320, 0], [400, 14], [470, 28], [540, 34]],
  [PLATE.europe]: [[0, 0], [320, 0], [400, 10], [430, 14], [470, 22], [540, 28]],
  [PLATE.asia]: [[0, 0], [270, 0], [330, 16], [420, 30], [540, 38]],
};
const CENTROIDS: Record<number, [number, number]> = {
  [PLATE.africa]: [5, 20],
  [PLATE.northAmerica]: [45, -100],
  [PLATE.europe]: [52, 25],
  [PLATE.asia]: [52, 100],
};

const _a = new Quaternion();
const _abs = new Quaternion();

/** Absolute rotation for Africa at L (Myr). */
function absoluteAt(L: number, out: Quaternion): Quaternion {
  motionQuat(MOTIONS.africaSpin, L, _a);
  motionQuat(MOTIONS.africaLat, L, out);
  return out.multiply(_a); // spin first, then shift latitude
}

/**
 * Rotation taking plate `i` from its present-day position to its position at L (Myr), in the planet frame.
 * Composition reads right to left: the innermost relative fit is applied first.
 */
export function plateRotation(i: number, L: number, out: Quaternion): Quaternion {
  relativeRotation(i, L, out);
  const pre = PRE_PANGAEA[i];
  if (pre) {
    const deg = interp(pre, L);
    if (deg !== 0) out.premultiply(_pre.setFromAxisAngle(preAxis(i), deg * D2R));
  }
  return out.premultiply(absoluteAt(L, _abs));
}

const _pre = new Quaternion();
const _axes = new Map<number, Vector3>();
/** Axis ⟂ to Africa's and the block's centres in the assembled (300 Myr) relative frame. */
function preAxis(i: number): Vector3 {
  let ax = _axes.get(i);
  if (!ax) {
    const q = new Quaternion();
    const ca = dirFromLatLon(...CENTROIDS[PLATE.africa]!);
    relativeRotation(i, 300, q);
    const ci = dirFromLatLon(...CENTROIDS[i]!).applyQuaternion(q);
    ax = new Vector3().crossVectors(ca, ci).normalize();
    _axes.set(i, ax);
  }
  return ax;
}

function interp(s: readonly (readonly [number, number])[], L: number): number {
  if (L <= s[0]![0]) return s[0]![1];
  for (let k = 0; k < s.length - 1; k++) {
    const [l0, v0] = s[k]!;
    const [l1, v1] = s[k + 1]!;
    if (L <= l1) return v0 + ((v1 - v0) * (L - l0)) / (l1 - l0);
  }
  return s.at(-1)![1];
}

/** Rotation relative to Africa (no absolute motion, no pre-Pangaea drift). */
function relativeRotation(i: number, L: number, out: Quaternion): Quaternion {
  out.identity();
  switch (i) {
    case PLATE.africa:
      break;
    case PLATE.southAmerica:
      motionQuat(MOTIONS.southAmerica, L, out);
      break;
    case PLATE.northAmerica:
      motionQuat(MOTIONS.northAmerica, L, out);
      break;
    case PLATE.europe:
    case PLATE.asia:
      // Europe → NA → Africa, then the pre-Pangaea offsets.
      motionQuat(MOTIONS.europeToNA, L, _a);
      motionQuat(MOTIONS.northAmerica, L, out);
      out.multiply(_a);
      break;
    case PLATE.india:
      motionQuat(MOTIONS.india, L, out);
      break;
    case PLATE.antarctica:
      motionQuat(MOTIONS.antarctica, L, out);
      break;
    case PLATE.australia:
      motionQuat(MOTIONS.australiaToAN, L, _a);
      motionQuat(MOTIONS.antarctica, L, out);
      out.multiply(_a);
      break;
  }
  return out;
}

const _q = new Quaternion();

/** Per plate, xyzw of the inverse rotation (time-L frame → present-day plate frame), for the shader. */
export function plateInverseQuats(L: number, out: { set(x: number, y: number, z: number, w: number): unknown }[]): void {
  for (let i = 0; i < out.length && i < PLATE_COUNT; i++) {
    plateRotation(i, L, _q).invert();
    out[i]!.set(_q.x, _q.y, _q.z, _q.w);
  }
}

/** Where a present-day lat/lon on `plate` sits at lookback L (planet-frame unit vector). */
export function siteAt(plate: number, latDeg: number, lonDeg: number, L: number, out: Vector3): Vector3 {
  plateRotation(plate, L, _q);
  return dirFromLatLon(latDeg, lonDeg, out).applyQuaternion(_q);
}
