import { describe, expect, it } from 'vitest';
import { abundancesAt, NEUTRON_FREEZE_FRACTION } from '../abundances.ts';

describe('BBN abundances', () => {
  it('starts with n/p equilibrium ≈ 0.5 neutrons', () => {
    expect(abundancesAt(1e-4).neutrons).toBeGreaterThan(0.48);
  });
  it('neutron fraction falls toward ~0.14–0.2 around freeze-out', () => {
    const n = abundancesAt(1).neutrons;
    expect(n).toBeGreaterThan(0.14);
    expect(n).toBeLessThan(0.2);
    expect(NEUTRON_FREEZE_FRACTION).toBeGreaterThan(0.13);
    expect(NEUTRON_FREEZE_FRACTION).toBeLessThan(0.18);
  });
  it('settles to Yₚ ≈ 0.247, D/H ≈ 2.5e-5, Li/H ≈ 5e-10 by 1200 s', () => {
    const a = abundancesAt(1200);
    expect(Math.abs(a.helium4 - 0.247)).toBeLessThan(0.002);
    expect(a.dToH / 2.5e-5).toBeGreaterThan(0.9);
    expect(a.dToH / 2.5e-5).toBeLessThan(1.1);
    expect(a.liToH / 5e-10).toBeGreaterThan(0.9);
    expect(a.liToH / 5e-10).toBeLessThan(1.1);
    expect(a.neutrons).toBeLessThan(1e-6);
  });
  it('mass fractions sum to 1 and stay in [0,1]', () => {
    for (let lt = -6; lt <= 3.2; lt += 0.01) {
      const a = abundancesAt(Math.pow(10, lt));
      const sum = a.protons + a.neutrons + a.deuterium + a.helium3 + a.helium4 + a.lithium7;
      expect(Math.abs(sum - 1)).toBeLessThan(1e-12);
      for (const v of [a.protons, a.neutrons, a.deuterium, a.helium4]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
  it('helium grows monotonically through the bottleneck', () => {
    let prev = -1;
    for (let t = 100; t <= 1200; t += 5) {
      const y = abundancesAt(t).helium4;
      expect(y).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = y;
    }
  });
});
