// Matter power spectrum (HANDOFF §8): primordial P(k) ∝ k^n_s with the BBKS transfer function
// (Bardeen, Bond, Kaiser & Szalay 1986), shape parameter Γ = Ω_m h. Normalised to σ₈.
// k in h/Mpc, P in (Mpc/h)³, linear theory at z = 0.

import { LITTLE_H, N_S, OMEGA_M, SIGMA_8 } from './constants.ts';

export const GAMMA_SHAPE = OMEGA_M * LITTLE_H;

/** Primordial (unnormalised) spectrum k^n_s. */
export function primordialPk(k: number): number {
  return Math.pow(k, N_S);
}

/** BBKS transfer function T(k), → 1 as k → 0. */
export function bbksTransfer(k: number): number {
  const q = k / GAMMA_SHAPE;
  if (q < 1e-8) return 1;
  const x = 2.34 * q;
  const poly = 1 + 3.89 * q + (16.1 * q) ** 2 + (5.46 * q) ** 3 + (6.71 * q) ** 4;
  return (Math.log(1 + x) / x) * Math.pow(poly, -0.25);
}

/** Spherical top-hat window in Fourier space. */
export function tophatWindow(x: number): number {
  if (x < 1e-4) return 1 - (x * x) / 10;
  return (3 * (Math.sin(x) - x * Math.cos(x))) / (x * x * x);
}

/** σ(R)² for an unnormalised spectrum, integrated in ln k. */
function sigmaSquared(R: number, pk: (k: number) => number): number {
  const lnK0 = Math.log(1e-5);
  const lnK1 = Math.log(1e3);
  const n = 8000;
  const h = (lnK1 - lnK0) / n;
  let sum = 0;
  for (let i = 0; i <= n; i++) {
    const k = Math.exp(lnK0 + i * h);
    const w = tophatWindow(k * R);
    const f = (k * k * k * pk(k) * w * w) / (2 * Math.PI * Math.PI);
    sum += (i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2) * f;
  }
  return (sum * h) / 3;
}

const unnormalised = (k: number) => primordialPk(k) * bbksTransfer(k) ** 2;

/** Amplitude A such that P(k) = A k^n_s T²(k) gives σ₈ = 0.811. */
export const PK_AMPLITUDE = (SIGMA_8 * SIGMA_8) / sigmaSquared(8, unnormalised);

/** Linear matter power spectrum today, (Mpc/h)³. */
export function linearPk(k: number): number {
  return PK_AMPLITUDE * unnormalised(k);
}

/** σ(R) of the normalised spectrum (exposed for tests). */
export function sigmaR(R: number): number {
  return Math.sqrt(sigmaSquared(R, linearPk));
}
