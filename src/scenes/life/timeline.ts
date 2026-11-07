// Earth's state through time for the life scene: pure functions of lookback L (Myr) — atmosphere, oceans,
// ice, crust, life — plus the dated events that anchor them. Shapes are illustrative; dates are measured.

import type { AtmosphereSpec } from './planet.ts';

/** Dated events (Myr ago). Defaults match public/data/events.json; init overrides them from the file. */
export const EVENTS = {
  oceans: 4400,
  earliestLife: 3800,
  greatOxidation: 2400,
  eukaryotes: 1800,
  cambrian: 538.8,
  dinosaursExtinct: 66.043,
  homoSapiens: 0.3,
};
export type EventKey = keyof typeof EVENTS;
export const EVENT_IDS: Record<EventKey, string> = {
  oceans: 'oceans',
  earliestLife: 'earliest-life',
  greatOxidation: 'great-oxidation',
  eukaryotes: 'eukaryotes',
  cambrian: 'cambrian',
  dinosaursExtinct: 'dinosaurs-extinct',
  homoSapiens: 'homo-sapiens',
};

/** Piecewise-linear table lookup with smoothstep easing between keys (keys sorted by L descending or ascending). */
export function table(keys: readonly (readonly [number, number])[], L: number): number {
  const asc = keys[0]![0] < keys.at(-1)![0];
  const n = keys.length;
  const first = keys[0]!;
  const last = keys[n - 1]!;
  if (asc ? L <= first[0] : L >= first[0]) return first[1];
  if (asc ? L >= last[0] : L <= last[0]) return last[1];
  for (let i = 0; i < n - 1; i++) {
    const [l0, v0] = keys[i]!;
    const [l1, v1] = keys[i + 1]!;
    if (asc ? L <= l1 : L >= l1) {
      const t = (L - l0) / (l1 - l0);
      const e = t * t * (3 - 2 * t);
      return v0 + (v1 - v0) * e;
    }
  }
  return last[1];
}

// ── Tables (L in Myr ago, descending) ──────────────────────────────────────────

export const params = {
  /** log10 of O₂ relative to the present atmospheric level (Lyons et al. 2014 style, smoothed). */
  logO2: [
    [4400, -6],
    [2500, -5.5],
    [2430, -4.5],
    [2330, -1.6],
    [2200, -0.8], // Lomagundi excursion overshoot
    [2050, -1.6],
    [1800, -2.2],
    [800, -2],
    [650, -1.2],
    [540, -0.6],
    [420, -0.15],
    [300, 0.17], // Carboniferous peak (~35 % O₂)
    [250, -0.25],
    [100, 0],
    [0, 0],
  ] as const,
  /** Organic (methane) haze, 0..1: the "pale orange dot" Archean. Cleared by the oxygen rise. */
  haze: [
    [4400, 0.15],
    [3300, 0.25],
    [2900, 0.7],
    [2650, 1],
    [2470, 0.95],
    [2400, 0.15],
    [2330, 0],
    [0, 0],
  ] as const,
  /** Continental crust above sea level (noise plates): islands → continents. */
  crust: [
    [4400, 0.02],
    [3800, 0.18],
    [3000, 0.45],
    [2500, 0.72],
    [1800, 0.86],
    [700, 0.95],
  ] as const,
  /** Fraction of the real (present-day) geography; swapped under the Cryogenian ice. */
  realPlates: [
    [705, 0],
    [652, 1],
  ] as const,
  /** Global ice (snowball episodes). */
  snowball: [
    [2440, 0],
    [2380, 0.25],
    [2300, 0.95],
    [2240, 1],
    [2190, 0.3],
    [2150, 0],
    [735, 0],
    [712, 1],
    [665, 1],
    [658, 0.55],
    [652, 1],
    [638, 1],
    [628, 0],
  ] as const,
  /** Permanent polar ice edge, |sin(latitude)| (1 = none). */
  iceEdge: [
    [2500, 1],
    [2000, 0.97],
    [800, 0.96],
    [600, 1],
    [460, 1],
    [445, 0.82], // Hirnantian
    [430, 1],
    [370, 1],
    [330, 0.78], // Late Palaeozoic Ice Age
    [280, 0.8],
    [255, 1],
    [40, 1],
    [33, 0.97], // Antarctic sea ice
    [3, 0.95],
    [0, 0.94],
  ] as const,
  /** Present-day photo ice: Antarctica from 34 Myr, Greenland from ~3 Myr (one knob each). */
  antarcticIce: [
    [36, 0],
    [32, 1],
  ] as const,
  northIce: [
    [7, 0],
    [2.7, 1],
  ] as const,
  /** Ocean colour (linear RGB) through time. */
  oceanDeep: [
    [4400, [0.012, 0.02, 0.026]],
    [3800, [0.01, 0.03, 0.026]],
    [2700, [0.012, 0.04, 0.022]], // iron-rich "green" Archean ocean
    [2300, [0.008, 0.03, 0.04]],
    [800, [0.006, 0.026, 0.05]],
    [540, [0.004, 0.017, 0.056]],
    [0, [0.004, 0.016, 0.055]],
  ] as const,
  oceanShallow: [
    [4400, [0.03, 0.045, 0.05]],
    [2700, [0.03, 0.08, 0.05]],
    [2300, [0.02, 0.07, 0.08]],
    [540, [0.02, 0.09, 0.12]],
    [0, [0.02, 0.09, 0.12]],
  ] as const,
  /** Microbial / plankton tint in the water. */
  oceanLife: [
    [3850, 0],
    [3700, 0.35],
    [2700, 0.55],
    [1800, 0.6],
    [800, 0.7],
    [540, 0.6],
    [0, 0.45],
  ] as const,
  bloomColour: [
    [3800, [0.03, 0.09, 0.05]],
    [2400, [0.02, 0.11, 0.06]],
    [1800, [0.02, 0.1, 0.08]],
    [0, [0.02, 0.11, 0.09]],
  ] as const,
  /** Turquoise carbonate shelves and reefs. */
  shelfTint: [
    [3000, 0],
    [2500, 0.25],
    [540, 0.45],
    [100, 0.7],
    [0, 0.55],
  ] as const,
  /** Red beds after oxygenation. */
  rust: [
    [2350, 0],
    [2100, 0.7],
    [540, 0.6],
    [0, 0.45],
  ] as const,
  rockA: [
    [4400, [0.035, 0.034, 0.033]],
    [2500, [0.06, 0.055, 0.05]],
    [0, [0.09, 0.08, 0.07]],
  ] as const,
  rockB: [
    [4400, [0.1, 0.095, 0.09]],
    [2500, [0.18, 0.16, 0.14]],
    [0, [0.26, 0.21, 0.16]],
  ] as const,
  /** Vegetation on land (0 barren → 1 present-day biomes). */
  landLife: [
    [475, 0],
    [430, 0.2], // mosses, liverworts
    [385, 0.55], // first forests
    [340, 0.92],
    [300, 1],
    [0, 1],
  ] as const,
  /** Cloud cover. */
  cloudCover: [
    [4400, 0.85],
    [3800, 0.62],
    [2440, 0.6],
    [2300, 0.35],
    [2150, 0.55],
    [735, 0.55],
    [700, 0.35],
    [640, 0.35],
    [610, 0.55],
    [0, 0.56],
  ] as const,
  /** Sea level offset (positive floods the shelves). */
  seaLevel: [
    [540, 0.02],
    [460, 0.05],
    [300, 0.0],
    [90, 0.06], // Cretaceous high stand
    [40, 0.02],
    [0, 0],
  ] as const,
  /** Length of day (hours), from tidal rhythmites and growth bands; illustrative before ~2.5 Gyr. */
  dayHours: [
    [4400, 8],
    [2500, 17],
    [1400, 18.7],
    [620, 21.9],
    [400, 22],
    [0, 24],
  ] as const,
  /** Hadean volcanic glows (continuity with the cooling magma ocean). */
  hotspots: [
    [4400, 0.55],
    [4250, 0.15],
    [4000, 0],
  ] as const,
  /** Sun's effective temperature (K): slightly cooler when young. */
  sunTeff: [
    [4570, 5600],
    [0, 5772],
  ] as const,
} as const;

type RGBKeys = readonly (readonly [number, readonly [number, number, number]])[];
export function tableRGB(keys: RGBKeys, L: number, out: [number, number, number]): [number, number, number] {
  for (let c = 0; c < 3; c++) {
    // Small allocation-free loop: interpolate channel c.
    const n = keys.length;
    let v = keys[n - 1]![1][c]!;
    if (L >= keys[0]![0]) v = keys[0]![1][c]!;
    else
      for (let i = 0; i < n - 1; i++) {
        const [l0, a] = keys[i]!;
        const [l1, b] = keys[i + 1]!;
        if (L >= l1) {
          const t = (L - l0) / (l1 - l0);
          const e = t * t * (3 - 2 * t);
          v = a[c]! + (b[c]! - a[c]!) * e;
          break;
        }
      }
    out[c] = v;
  }
  return out;
}

/** Faint young Sun: L(t)/L₀ = 1 / (1 + 0.4 (1 − t/t☉)) (Gough 1981), t☉ = 4.57 Gyr. */
export function sunLuminosity(Lmyr: number): number {
  const tSun = 4570;
  const age = Math.max(0, tSun - Lmyr);
  return 1 / (1 + 0.4 * (1 - age / tSun));
}

/**
 * Northern ice sheets during the Pleistocene: |sin(lat)| of the southern edge of land ice (1 = none).
 * Glacial terminations are dated (LR04 stack, approx.); between them ice builds slowly and collapses fast.
 * Older, faster 41-kyr cycles are averaged so they do not flicker when scrolling.
 */
const TERMINATIONS_KYR = [11.5, 130, 243, 337, 424, 533, 621, 712, 790];
export function northIceSheet(Lmyr: number): number {
  const Lk = Lmyr * 1000;
  if (Lk > 3000) return 1;
  // Average glacial state for the early Pleistocene (41-kyr world): modest sheets.
  const early = 0.86;
  if (Lk > 900) return 1 - (1 - early) * Math.min(1, (3000 - Lk) / 600);
  // Late Pleistocene: sawtooth between terminations. Ice volume v: 0 interglacial → 1 glacial maximum.
  let v = 0.5;
  for (let i = 0; i < TERMINATIONS_KYR.length - 1; i++) {
    const t0 = TERMINATIONS_KYR[i]!; // younger termination
    const t1 = TERMINATIONS_KYR[i + 1]!; // older termination
    if (Lk >= t0 && Lk <= t1) {
      // Slow growth from the older termination to a maximum, then collapse over the ~8 kyr before t0.
      v = Math.min(1, ((t1 - Lk) / (t1 - t0 - 8)) ** 1.4);
      if (Lk - t0 < 8) v *= (Lk - t0) / 8;
      break;
    }
  }
  if (Lk < TERMINATIONS_KYR[0]!) v = 0;
  const lgm = 0.66; // ≈ 41°N at the glacial maximum
  const edge = 1 - (1 - lgm) * v;
  // blend from the early-Pleistocene average
  const w = Math.min(1, Math.max(0, (900 - Lk) / 100));
  return early + (edge - early) * w;
}

export const ARCHEAN_HAZE: AtmosphereSpec['haze'] = [2.0e-5, 4.0e-5, 8.6e-5];
