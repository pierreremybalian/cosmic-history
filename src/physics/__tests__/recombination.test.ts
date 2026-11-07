import { describe, expect, it } from 'vitest';
import { ionizationFraction, madauDickinsonSFR, neutralFractionIGM, opticalDepth, transparency } from '../recombination.ts';

describe('recombination', () => {
  it('x_e falls from ~1 to residual across z ≈ 1400 → 900', () => {
    expect(ionizationFraction(1600)).toBeGreaterThan(0.99);
    expect(ionizationFraction(800)).toBeLessThan(0.01);
  });
  it('optical depth reaches 1 at last scattering, z ≈ 1090', () => {
    expect(opticalDepth(1090)).toBeGreaterThan(0.85);
    expect(opticalDepth(1090)).toBeLessThan(1.15);
    expect(transparency(1400)).toBeLessThan(1e-6);
    expect(transparency(1000)).toBeGreaterThan(0.85);
  });
  it('optical depth is monotone in z', () => {
    let prev = -1;
    for (let z = 0; z < 2000; z += 5) {
      const t = opticalDepth(z);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });
  it('reionization midpoint z ≈ 7.7; SFR peaks near z ≈ 1.9', () => {
    expect(neutralFractionIGM(7.7)).toBeCloseTo(0.5, 6);
    let best = 0;
    let zBest = 0;
    for (let z = 0; z < 8; z += 0.01) {
      if (madauDickinsonSFR(z) > best) {
        best = madauDickinsonSFR(z);
        zBest = z;
      }
    }
    expect(zBest).toBeGreaterThan(1.7);
    expect(zBest).toBeLessThan(2.1);
  });
});
