// Ionisation history (HANDOFF §6.7). Smooth tanh model, good enough for visuals; not RECFAST.

import { X_E_RESIDUAL, Z_RECOMBINATION_MID, Z_RECOMBINATION_WIDTH } from './constants.ts';

/** Free-electron fraction x_e(z): ≈1 before recombination, → residual 2×10⁻⁴ after. Hydrogen only. */
export function ionizationFraction(z: number): number {
  const s = 0.5 * (1 + Math.tanh((z - Z_RECOMBINATION_MID) / Z_RECOMBINATION_WIDTH));
  return X_E_RESIDUAL + (1 - X_E_RESIDUAL) * s;
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
