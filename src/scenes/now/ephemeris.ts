// Positions for the `now` scene: planets (JPL approximate Keplerian elements, Standish, valid 1800–2050),
// the Moon (low-precision series), and frame conversions ecliptic → equatorial (J2000) → Galactic → world.
//
// World frame = Galactic, exactly as the CMB texture expects (public/data/cmb/cmb_meta.json):
//   world = (x_G, z_G, −y_G): +X → Galactic Centre (l = 0°, b = 0°), +Y → North Galactic Pole, −Z → l = 90°.
// three's equirectUV(direction) then samples the Planck map correctly, and the Milky Way disk lies in XZ.

import { Vector3 } from 'three/webgpu';

const D2R = Math.PI / 180;

/** J2000 obliquity of the ecliptic (IAU 2006), degrees. */
export const OBLIQUITY_DEG = 23.4392811;

/** ICRS/J2000 equatorial → Galactic rotation (Hipparcos, ESA 1997 vol. 1 §1.5.3). Rows map onto x_G, y_G, z_G. */
const EQ_TO_GAL = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.44482963, 0.7469822445],
  [-0.867666149, -0.1980763734, 0.4559837762],
] as const;

/** Galactic Cartesian (x_G, y_G, z_G) → world. */
export function galToWorld(x: number, y: number, z: number, out: Vector3): Vector3 {
  return out.set(x, z, -y);
}

/** Equatorial (J2000) unit/any vector → world. */
export function eqToWorld(x: number, y: number, z: number, out: Vector3): Vector3 {
  const m = EQ_TO_GAL;
  return galToWorld(m[0][0] * x + m[0][1] * y + m[0][2] * z, m[1][0] * x + m[1][1] * y + m[1][2] * z, m[2][0] * x + m[2][1] * y + m[2][2] * z, out);
}

/** Ecliptic (J2000) → world. */
export function eclToWorld(x: number, y: number, z: number, out: Vector3): Vector3 {
  const e = OBLIQUITY_DEG * D2R;
  return eqToWorld(x, y * Math.cos(e) - z * Math.sin(e), y * Math.sin(e) + z * Math.cos(e), out);
}

/** Galactic longitude/latitude (deg) and distance → world. */
export function galacticLB(lDeg: number, bDeg: number, d: number, out: Vector3): Vector3 {
  const l = lDeg * D2R;
  const b = bDeg * D2R;
  return galToWorld(d * Math.cos(b) * Math.cos(l), d * Math.cos(b) * Math.sin(l), d * Math.sin(b), out);
}

/** Right ascension / declination (deg) and distance → world. */
export function equatorialRaDec(raDeg: number, decDeg: number, d: number, out: Vector3): Vector3 {
  const a = raDeg * D2R;
  const dd = decDeg * D2R;
  return eqToWorld(d * Math.cos(dd) * Math.cos(a), d * Math.cos(dd) * Math.sin(a), d * Math.sin(dd), out);
}

/** Celestial north pole (Earth's spin axis) in world coordinates. */
export function earthAxis(out: Vector3): Vector3 {
  return eqToWorld(0, 0, 1, out).normalize();
}

/** North ecliptic pole in world coordinates (normal of the planets' orbital plane). */
export function eclipticPole(out: Vector3): Vector3 {
  return eclToWorld(0, 0, 1, out).normalize();
}

// a [AU], e, I [deg], L [deg], ϖ [deg], Ω [deg]; then rates per Julian century.
type Elements = readonly [number, number, number, number, number, number];
export interface Planet {
  name: string;
  el: Elements;
  rate: Elements;
  /** Display colour (linear RGB), approximate true colour. */
  color: [number, number, number];
}

export const PLANETS: readonly Planet[] = [
  { name: 'Mercury', el: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], rate: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081], color: [0.55, 0.5, 0.46] },
  { name: 'Venus', el: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], rate: [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418], color: [0.95, 0.85, 0.62] },
  { name: 'Earth', el: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0], rate: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0], color: [0.35, 0.55, 1.0] },
  { name: 'Mars', el: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], rate: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343], color: [0.95, 0.45, 0.25] },
  { name: 'Jupiter', el: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], rate: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106], color: [0.9, 0.78, 0.6] },
  { name: 'Saturn', el: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], rate: [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794], color: [0.92, 0.82, 0.58] },
  { name: 'Uranus', el: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503], rate: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589], color: [0.6, 0.85, 0.92] },
  { name: 'Neptune', el: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], rate: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664], color: [0.4, 0.55, 1.0] },
];

/** Julian centuries since J2000.0 for a JS Date. */
export function centuriesSinceJ2000(date: Date): number {
  const jd = date.getTime() / 86400000 + 2440587.5;
  return (jd - 2451545.0) / 36525;
}

/** Heliocentric ecliptic position (AU) of a planet at T centuries; `meanAnomalyShift` (rad) walks the orbit. */
export function planetEcliptic(p: Planet, T: number, out: Vector3, meanAnomalyShift = 0): Vector3 {
  const a = p.el[0] + p.rate[0] * T;
  const e = p.el[1] + p.rate[1] * T;
  const I = (p.el[2] + p.rate[2] * T) * D2R;
  const L = (p.el[3] + p.rate[3] * T) * D2R;
  const w = (p.el[4] + p.rate[4] * T) * D2R;
  const O = (p.el[5] + p.rate[5] * T) * D2R;
  const om = w - O;
  let M = L - w + meanAnomalyShift;
  M = Math.atan2(Math.sin(M), Math.cos(M));
  let E = M + e * Math.sin(M);
  for (let k = 0; k < 8; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const co = Math.cos(om);
  const so = Math.sin(om);
  const cO = Math.cos(O);
  const sO = Math.sin(O);
  const cI = Math.cos(I);
  const sI = Math.sin(I);
  return out.set(
    (co * cO - so * sO * cI) * xp + (-so * cO - co * sO * cI) * yp,
    (co * sO + so * cO * cI) * xp + (-so * sO + co * cO * cI) * yp,
    so * sI * xp + co * sI * yp,
  );
}

/** Geocentric ecliptic position of the Moon (km), low-precision (≈ 0.3°). */
export function moonEcliptic(date: Date, out: Vector3): Vector3 {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const Lp = (218.316 + 13.176396 * d) * D2R;
  const Mp = (134.963 + 13.064993 * d) * D2R;
  const F = (93.272 + 13.22935 * d) * D2R;
  const lon = Lp + 6.289 * D2R * Math.sin(Mp);
  const lat = 5.128 * D2R * Math.sin(F);
  const r = 385001 - 20905 * Math.cos(Mp);
  return out.set(r * Math.cos(lat) * Math.cos(lon), r * Math.cos(lat) * Math.sin(lon), r * Math.sin(lat));
}
