// Ionisation history (HANDOFF §6.7). Smooth tanh model, good enough for visuals; not RECFAST.

import {
  C_M_S,
  G_NEWTON,
  H0_PER_S,
  OMEGA_B,
  PROTON_MASS_KG,
  SIGMA_THOMSON_M2,
  X_E_RESIDUAL,
  YP_TARGET,
  Z_RECOMBINATION_MID,
  Z_RECOMBINATION_WIDTH,
} from './constants.ts';
import { E } from './cosmology.ts';
import { MonotoneCubic } from './interp.ts';

/** Free-electron fraction x_e(z): ≈1 before recombination, → residual 2×10⁻⁴ after. Hydrogen only. */
export function ionizationFraction(z: number): number {
  const s = 0.5 * (1 + Math.tanh((z - Z_RECOMBINATION_MID) / Z_RECOMBINATION_WIDTH));
  return X_E_RESIDUAL + (1 - X_E_RESIDUAL) * s;
}

/** Hydrogen number density today, m⁻³. */
export const N_H0 = ((1 - YP_TARGET) * OMEGA_B * ((3 * H0_PER_S * H0_PER_S) / (8 * Math.PI * G_NEWTON))) / PROTON_MASS_KG;

// τ(z) = ∫₀ᶻ x_e n_H(z') σ_T c / ((1+z') H(z')) dz', tabulated once (reionization ignored: it adds ~0.05).
const TAU_Z_MAX = 3000;
const tauTable = (() => {
  const n = 6000;
  const h = TAU_Z_MAX / n;
  const zs = new Float64Array(n + 1);
  const ts = new Float64Array(n + 1);
  const f = (z: number) =>
    (ionizationFraction(z) * N_H0 * (1 + z) * (1 + z) * SIGMA_THOMSON_M2 * C_M_S) / (H0_PER_S * E(1 / (1 + z)));
  let prev = f(0);
  for (let i = 1; i <= n; i++) {
    zs[i] = i * h;
    const cur = f(zs[i]!);
    ts[i] = ts[i - 1]! + 0.5 * h * (prev + cur);
    prev = cur;
  }
  // Strictly increasing for the interpolant (τ grows by ≥ residual ionisation everywhere).
  return new MonotoneCubic(zs, ts);
})();

/** Thomson optical depth from today back to redshift z. τ = 1 at z ≈ 1090 (last scattering). */
export function opticalDepth(z: number): number {
  if (z <= 0) return 0;
  return tauTable.at(Math.min(z, TAU_Z_MAX));
}

/** Fraction of light from redshift z that reaches us unscattered: e^(−τ). Drives the fog clearing. */
export function transparency(z: number): number {
  return Math.exp(-opticalDepth(z));
}

/**
 * Neutral fraction of the intergalactic medium during reionization (tanh in z, as in Planck 2018
 * with z_re ≈ 7.7, Δz ≈ 0.5 widened for visibility; HANDOFF §9.10).
 */
export const Z_REIONIZATION_MID = 7.7;
export const Z_REIONIZATION_WIDTH = 1.0;
export function neutralFractionIGM(z: number): number {
  return 0.5 * (1 + Math.tanh((z - Z_REIONIZATION_MID) / Z_REIONIZATION_WIDTH));
}

/** Cosmic star-formation-rate density (Madau & Dickinson 2014, eq. 15), M☉ yr⁻¹ Mpc⁻³. */
export function madauDickinsonSFR(z: number): number {
  return (0.015 * Math.pow(1 + z, 2.7)) / (1 + Math.pow((1 + z) / 2.9, 5.6));
}
