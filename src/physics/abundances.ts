// Big Bang nucleosynthesis, smooth model (HANDOFF §6.6). Not a reaction network.
// n/p follows weak equilibrium, freezes out near 1 s, then decays (τₙ = 879 s). When the deuterium
// bottleneck breaks (~160–320 s) the surviving neutrons are locked into ⁴He. The freeze-out fraction is
// calibrated at load so the final helium mass fraction lands on the measured Yₚ.

import {
  D_TO_H_FINAL,
  HE3_TO_H_FINAL,
  LI7_TO_H_FINAL,
  MEV_K,
  NEUTRON_LIFETIME_S,
  NEUTRON_PROTON_Q_MEV,
  YP_TARGET,
} from './constants.ts';
import { aAt, temperatureAt } from './cosmology.ts';
import { MonotoneCubic, smoothstep } from './interp.ts';

export interface Abundances {
  /** Mass fractions; sum to 1. */
  protons: number;
  neutrons: number;
  deuterium: number;
  helium3: number;
  helium4: number;
  lithium7: number;
  /** Number ratios relative to hydrogen (protons). */
  dToH: number;
  he3ToH: number;
  liToH: number;
  /** Fraction of neutrons bound into nuclei (0–1): drives the bonding animation. */
  bound: number;
}

const FREEZE_SHARPNESS = 8;
const LOG_T_BOTTLENECK_START = Math.log10(160);
const LOG_T_BOTTLENECK_END = Math.log10(320);
const LOG_T_LATE_END = Math.log10(1000);
const D_PEAK_MASS_FRACTION = 5e-3;
const D_PEAK_LOG_T = Math.log10(250);
const D_PEAK_WIDTH = 0.12;

/** Weak-equilibrium neutron fraction n/(n+p) at t. */
export function neutronFractionEquilibrium(tSeconds: number): number {
  const kT = temperatureAt(aAt(tSeconds)) / MEV_K;
  return 1 / (1 + Math.exp(NEUTRON_PROTON_Q_MEV / kT));
}

function neutronFractionNoNuclei(tSeconds: number, xFreeze: number): number {
  const eq = neutronFractionEquilibrium(tSeconds);
  const k = FREEZE_SHARPNESS;
  const frozen = Math.pow(Math.pow(eq, k) + Math.pow(xFreeze, k), 1 / k);
  return Math.min(0.5, frozen) * Math.exp(-tSeconds / NEUTRON_LIFETIME_S);
}

/** Fraction of free neutrons that have been captured into nuclei by t. */
export function boundFraction(tSeconds: number): number {
  return smoothstep(LOG_T_BOTTLENECK_START, LOG_T_BOTTLENECK_END, Math.log10(Math.max(tSeconds, 1e-30)));
}

const GRID_N = 2048;
const U0 = Math.log10(100);
const U1 = Math.log10(2000);

function heliumTable(xFreeze: number): { u: Float64Array; y: Float64Array } {
  const u = new Float64Array(GRID_N + 1);
  const y = new Float64Array(GRID_N + 1);
  const du = (U1 - U0) / GRID_N;
  const span = LOG_T_BOTTLENECK_END - LOG_T_BOTTLENECK_START;
  const integrand = (uu: number) => {
    const s = Math.min(1, Math.max(0, (uu - LOG_T_BOTTLENECK_START) / span));
    const dF = (6 * s * (1 - s)) / span;
    return 2 * neutronFractionNoNuclei(Math.pow(10, uu), xFreeze) * dF;
  };
  let prev = integrand(U0);
  u[0] = U0;
  for (let i = 1; i <= GRID_N; i++) {
    u[i] = U0 + i * du;
    const cur = integrand(u[i]!);
    y[i] = y[i - 1]! + 0.5 * du * (prev + cur);
    prev = cur;
  }
  return { u, y };
}

/** Freeze-out neutron fraction, calibrated so Yₚ = 0.247 (≈0.16; DECISIONS.md). */
export const NEUTRON_FREEZE_FRACTION = (() => {
  let x = 0.15;
  for (let i = 0; i < 6; i++) {
    const { y } = heliumTable(x);
    x *= YP_TARGET / y[GRID_N]!;
  }
  return x;
})();

const he = heliumTable(NEUTRON_FREEZE_FRACTION);
const heInterp = new MonotoneCubic(he.u, he.y);
const Y_FINAL = he.y[GRID_N]!;
const X_H_FINAL = 1 - YP_TARGET;

export function abundancesAt(tSeconds: number, out?: Abundances): Abundances {
  const o: Abundances = out ?? {
    protons: 0,
    neutrons: 0,
    deuterium: 0,
    helium3: 0,
    helium4: 0,
    lithium7: 0,
    dToH: 0,
    he3ToH: 0,
    liToH: 0,
    bound: 0,
  };
  const u = Math.log10(Math.max(tSeconds, 1e-30));
  const bound = boundFraction(tSeconds);
  const late = smoothstep(LOG_T_BOTTLENECK_START, LOG_T_LATE_END, u);
  const he4 = u <= U0 ? 0 : u >= U1 ? Y_FINAL : Math.max(0, heInterp.at(u));
  const n = neutronFractionNoNuclei(tSeconds, NEUTRON_FREEZE_FRACTION) * (1 - bound);
  const dFinal = 2 * D_TO_H_FINAL * X_H_FINAL;
  const dPeak = D_PEAK_MASS_FRACTION * Math.exp(-(((u - D_PEAK_LOG_T) / D_PEAK_WIDTH) ** 2));
  const d = dFinal * late + dPeak;
  const he3 = 3 * HE3_TO_H_FINAL * X_H_FINAL * late;
  const li = 7 * LI7_TO_H_FINAL * X_H_FINAL * smoothstep(LOG_T_BOTTLENECK_END - 0.2, LOG_T_LATE_END, u);
  const p = 1 - n - d - he3 - he4 - li;
  o.protons = p;
  o.neutrons = n;
  o.deuterium = d;
  o.helium3 = he3;
  o.helium4 = he4;
  o.lithium7 = li;
  o.dToH = d / 2 / p;
  o.he3ToH = he3 / 3 / p;
  o.liToH = li / 7 / p;
  o.bound = bound;
  return o;
}
