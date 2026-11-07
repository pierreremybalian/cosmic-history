import { describe, expect, it } from 'vitest';
import { bbksTransfer, linearPk, sigmaR } from '../powerSpectrum.ts';

describe('power spectrum', () => {
  it('BBKS transfer → 1 at large scales and falls monotonically', () => {
    expect(bbksTransfer(1e-6)).toBeCloseTo(1, 4);
    let prev = 2;
    for (let lk = -4; lk <= 2; lk += 0.05) {
      const T = bbksTransfer(Math.pow(10, lk));
      expect(T).toBeLessThan(prev);
      prev = T;
    }
  });
  it('P(k) ∝ k^n_s on large scales', () => {
    const slope = Math.log(linearPk(2e-5) / linearPk(1e-5)) / Math.log(2);
    expect(slope).toBeCloseTo(0.965, 2);
  });
  it('normalised to σ₈ = 0.811', () => {
    expect(sigmaR(8)).toBeCloseTo(0.811, 3);
  });
  it('turns over near k_eq ~ 0.01–0.03 h/Mpc', () => {
    let kPeak = 0;
    let best = 0;
    for (let lk = -4; lk <= 0; lk += 0.01) {
      const k = Math.pow(10, lk);
      if (linearPk(k) > best) {
        best = linearPk(k);
        kPeak = k;
      }
    }
    expect(kPeak).toBeGreaterThan(0.008);
    expect(kPeak).toBeLessThan(0.03);
  });
});
