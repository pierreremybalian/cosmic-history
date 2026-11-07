// Flat ΛCDM background: a(t), H(t), T(t), Ω(t). HANDOFF §6.2–6.5.
// Pure and deterministic; tables are built once at module load (~20k points, a few ms).

import {
  EE_STEP_T_END_K,
  EE_STEP_T_START_K,
  EE_TA_RATIO,
  H0_PER_S,
  INFLATION_EFOLDS,
  OMEGA_B,
  OMEGA_DM,
  OMEGA_L,
  OMEGA_M,
  OMEGA_R,
  T_CMB0,
  T_INFLATION_END_S,
  T_INFLATION_START_S,
  YEAR_S,
} from './constants.ts';
import { MonotoneCubic, clamp, smoothstep } from './interp.ts';

export type Epoch = 'preInflation' | 'inflation' | 'friedmann';

export interface Omega {
  radiation: number;
  matter: number; // dark + baryonic
  baryon: number;
  darkMatter: number;
  darkEnergy: number;
}

export interface Globals {
  t: number; // seconds since Big Bang
  log10t: number; // use this on GPU, not t
  a: number; // scale factor, a(today) = 1
  z: number; // 1/a − 1
  H: number; // Hubble rate, 1/s
  T: number; // photon temperature, K
  omega: Omega; // fractional energy densities (sum = 1)
  lookbackYears: number; // years before present
  /** Contract extension (DECISIONS.md): which physics regime t falls in. */
  epoch: Epoch;
  /** True before inflation, where no physical a exists (§6.5). Quantities are the clamped post-inflation values. */
  preInflation: boolean;
}

/** Dimensionless Hubble rate E(a) = H/H₀. */
export function E(a: number): number {
  return Math.sqrt(OMEGA_R / (a * a * a * a) + OMEGA_M / (a * a * a) + OMEGA_L);
}

export function hubbleAt(a: number): number {
  return H0_PER_S * E(a);
}

// ── t(a) table ─────────────────────────────────────────────────────────────
const LN_A_MIN = -80;
const LN_A_MAX = 1;
const N_INTERVALS = 20480; // even, for Simpson

/** Radiation-era analytic solution t = a² / (2 H₀ √Ω_r). */
function tRadiation(a: number): number {
  return (a * a) / (2 * H0_PER_S * Math.sqrt(OMEGA_R));
}

function buildTimeTable(): { lnA: Float64Array; lnT: Float64Array } {
  const n = N_INTERVALS + 1;
  const h = (LN_A_MAX - LN_A_MIN) / N_INTERVALS;
  const lnA = new Float64Array(n);
  const f = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lnA[i] = LN_A_MIN + i * h;
    f[i] = 1 / hubbleAt(Math.exp(lnA[i]!));
  }
  const t = new Float64Array(n);
  t[0] = tRadiation(Math.exp(LN_A_MIN));
  // Cumulative Simpson: each interval integrated with the quadratic through three neighbouring points.
  for (let i = 1; i < n; i++) {
    const seg =
      i < n - 1
        ? (h / 12) * (5 * f[i - 1]! + 8 * f[i]! - f[i + 1]!)
        : (h / 12) * (-f[i - 2]! + 8 * f[i - 1]! + 5 * f[i]!);
    t[i] = t[i - 1]! + seg;
  }
  const lnT = new Float64Array(n);
  for (let i = 0; i < n; i++) lnT[i] = Math.log(t[i]!);
  return { lnA, lnT };
}

const table = buildTimeTable();
const tOfA = new MonotoneCubic(table.lnA, table.lnT);

/** Seconds since the Big Bang at scale factor a. */
export function tAt(a: number): number {
  if (a <= 0) return 0;
  const lnA = Math.log(a);
  if (lnA < LN_A_MIN) return tRadiation(a);
  return Math.exp(tOfA.at(lnA));
}

const T_TABLE_MIN = Math.exp(table.lnT[0]!);

/** Scale factor at t seconds (Friedmann regime; see globalsAt for t < 10⁻³² s). */
export function aAt(t: number): number {
  if (t <= 0) return 0;
  if (t < T_TABLE_MIN) return Math.sqrt(2 * H0_PER_S * Math.sqrt(OMEGA_R) * t);
  return Math.exp(tOfA.inverse(Math.log(t)));
}

/** Age of the universe, s. Computed from the integration, never typed in. */
export const AGE_SECONDS = tAt(1);
export const AGE_YEARS = AGE_SECONDS / YEAR_S;

export function zAt(t: number): number {
  return 1 / aAt(t) - 1;
}

export function tAtRedshift(z: number): number {
  return tAt(1 / (1 + z));
}

// ── Temperature ────────────────────────────────────────────────────────────
const LOG_A_EE_START = Math.log10(T_CMB0 / EE_STEP_T_START_K);
const LOG_A_EE_END = Math.log10(T_CMB0 / EE_STEP_T_END_K);

/**
 * Photon temperature in K at scale factor a.
 * T·a rises by (11/4)^(1/3) across e⁺e⁻ annihilation (smooth step in log a).
 * Earlier changes in g*s (QCD transition at ~10⁻⁵ s, electroweak) also shift T·a slightly; ignored here.
 */
export function temperatureAt(a: number): number {
  const s = smoothstep(LOG_A_EE_START, LOG_A_EE_END, Math.log10(a));
  const ratio = EE_TA_RATIO + (1 - EE_TA_RATIO) * s;
  return (ratio * T_CMB0) / a;
}

/** Inverse of temperatureAt (monotone decreasing in a). */
export function aAtTemperature(tempK: number): number {
  let lo = Math.log(T_CMB0 / tempK) - 1;
  let hi = lo + 2;
  for (let i = 0; i < 100; i++) {
    const mid = 0.5 * (lo + hi);
    if (temperatureAt(Math.exp(mid)) > tempK) lo = mid;
    else hi = mid;
  }
  return Math.exp(0.5 * (lo + hi));
}

// ── Energy fractions ───────────────────────────────────────────────────────
/** ρ_x ∝ Ω_x a^(−3(1+w_x)), normalised so the components sum to 1. */
export function omegaAt(a: number, out: Omega = emptyOmega()): Omega {
  const a3 = a * a * a;
  const r = OMEGA_R / (a3 * a);
  const b = OMEGA_B / a3;
  const dm = OMEGA_DM / a3;
  const l = OMEGA_L;
  const total = r + b + dm + l;
  out.radiation = r / total;
  out.baryon = b / total;
  out.darkMatter = dm / total;
  out.darkEnergy = l / total;
  out.matter = (b + dm) / total;
  return out;
}

function emptyOmega(): Omega {
  return { radiation: 0, matter: 0, baryon: 0, darkMatter: 0, darkEnergy: 0 };
}

/** Deceleration parameter q = Σ Ω_i (1 + 3w_i)/2. */
export function decelerationAt(a: number): number {
  const o = omegaAt(a);
  return o.radiation + 0.5 * o.matter - o.darkEnergy;
}

// ── Inflation (parametric, §6.5) ────────────────────────────────────────────
/** a at the end of inflation: the radiation-era extrapolation at 10⁻³² s. */
export const A_INFLATION_END = aAt(T_INFLATION_END_S);

/** Illustrative a during inflation; s ∈ [0,1] is normalised progress through the inflation chapter. */
export function inflationScaleFactor(s: number): number {
  return A_INFLATION_END * Math.exp(INFLATION_EFOLDS * (clamp(s, 0, 1) - 1));
}

// ── Linear growth factor ────────────────────────────────────────────────────
// Heath (1977): D(a) ∝ E(a) ∫₀ᵃ da' / (a' E(a'))³ for matter + Λ. Normalised D(1) = 1.
// Radiation is ignored (structure scenes start after recombination, where it is < 30% and falling).
const GROWTH_LN_A_MIN = -20;
const GROWTH_N = 4096;
function buildGrowthTable(): MonotoneCubic {
  const n = GROWTH_N + 1;
  const h = (LN_A_MAX - GROWTH_LN_A_MIN) / GROWTH_N;
  const Em = (a: number) => Math.sqrt(OMEGA_M / (a * a * a) + OMEGA_L);
  const lnA = new Float64Array(n);
  const f = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lnA[i] = GROWTH_LN_A_MIN + i * h;
    const a = Math.exp(lnA[i]!);
    const e = Em(a);
    f[i] = 1 / (a * a * e * e * e);
  }
  const a0 = Math.exp(GROWTH_LN_A_MIN);
  const I = new Float64Array(n);
  I[0] = (0.4 * Math.pow(a0, 2.5)) / Math.pow(OMEGA_M, 1.5); // matter-era analytic start
  for (let i = 1; i < n; i++) {
    const seg =
      i < n - 1
        ? (h / 12) * (5 * f[i - 1]! + 8 * f[i]! - f[i + 1]!)
        : (h / 12) * (-f[i - 2]! + 8 * f[i - 1]! + 5 * f[i]!);
    I[i] = I[i - 1]! + seg;
  }
  const lnD = new Float64Array(n);
  for (let i = 0; i < n; i++) lnD[i] = Math.log(2.5 * OMEGA_M * Em(Math.exp(lnA[i]!)) * I[i]!);
  const lnD1 = new MonotoneCubic(lnA, lnD).at(0);
  for (let i = 0; i < n; i++) lnD[i] = lnD[i]! - lnD1;
  return new MonotoneCubic(lnA, lnD);
}
const growthTable = buildGrowthTable();

/** Linear growth factor D(a), D(1) = 1, D ∝ a deep in matter domination. */
export function growthFactor(a: number): number {
  if (a <= 0) return 0;
  const lnA = Math.log(a);
  if (lnA < GROWTH_LN_A_MIN) return Math.exp(growthTable.at(GROWTH_LN_A_MIN)) * (a / Math.exp(GROWTH_LN_A_MIN));
  return Math.exp(growthTable.at(lnA));
}

// ── Globals ────────────────────────────────────────────────────────────────
export function createGlobals(): Globals {
  return {
    t: 0,
    log10t: 0,
    a: 0,
    z: 0,
    H: 0,
    T: 0,
    omega: emptyOmega(),
    lookbackYears: 0,
    epoch: 'friedmann',
    preInflation: false,
  };
}

/**
 * All background quantities at t (seconds). Pass `out` to avoid allocation in the frame loop.
 * For t < 10⁻³² s the Friedmann model does not apply: physical quantities are clamped to their
 * values at the end of inflation and `epoch`/`preInflation` say so (§6.5). The inflation scene
 * computes its own illustrative a via `inflationScaleFactor`.
 */
export function globalsAt(t: number, out: Globals = createGlobals()): Globals {
  const tPhys = Math.max(t, T_INFLATION_END_S);
  const a = aAt(tPhys);
  out.t = t;
  out.log10t = Math.log10(t);
  out.a = a;
  out.z = 1 / a - 1;
  out.H = hubbleAt(a);
  out.T = temperatureAt(a);
  omegaAt(a, out.omega);
  out.lookbackYears = Math.max(0, (AGE_SECONDS - t) / YEAR_S);
  out.epoch = t < T_INFLATION_START_S ? 'preInflation' : t < T_INFLATION_END_S ? 'inflation' : 'friedmann';
  out.preInflation = t < T_INFLATION_START_S;
  return out;
}
