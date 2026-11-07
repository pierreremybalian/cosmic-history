import { describe, expect, it } from 'vitest';
import { GYR_S, KYR_S, OMEGA_L, OMEGA_M, OMEGA_R, YEAR_S } from '../constants.ts';
import {
  AGE_SECONDS,
  aAt,
  decelerationAt,
  globalsAt,
  growthFactor,
  inflationScaleFactor,
  omegaAt,
  tAt,
  tAtRedshift,
  temperatureAt,
} from '../cosmology.ts';

function bisect(f: (x: number) => number, lo: number, hi: number): number {
  let flo = f(lo);
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    const fm = f(mid);
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return 0.5 * (lo + hi);
}

describe('cosmology', () => {
  it('age is 13.79 ± 0.03 Gyr', () => {
    expect(Math.abs(AGE_SECONDS / GYR_S - 13.79)).toBeLessThan(0.03);
  });

  it('matter–radiation equality: a ≈ Ω_r/Ω_m, t ≈ 5×10⁴ yr (±20%)', () => {
    const aEq = OMEGA_R / OMEGA_M;
    expect(aEq).toBeGreaterThan(2.7e-4);
    expect(aEq).toBeLessThan(3.1e-4);
    const o = omegaAt(aEq);
    expect(o.radiation).toBeCloseTo(o.matter, 6);
    const tYr = tAt(aEq) / YEAR_S;
    expect(tYr).toBeGreaterThan(4e4);
    expect(tYr).toBeLessThan(6e4);
  });

  it('recombination: z = 1090 → t ≈ 3.7–3.8×10⁵ yr', () => {
    const tYr = tAtRedshift(1090) / YEAR_S;
    expect(tYr).toBeGreaterThan(3.7e5);
    expect(tYr).toBeLessThan(3.8e5);
  });

  it('acceleration onset: q = 0 at a = (Ω_m/2Ω_Λ)^(1/3), z ≈ 0.63', () => {
    const a = bisect(decelerationAt, 0.3, 0.95);
    expect(a).toBeCloseTo(Math.cbrt(OMEGA_M / (2 * OMEGA_L)), 3);
    expect(1 / a - 1).toBeGreaterThan(0.6);
    expect(1 / a - 1).toBeLessThan(0.66);
  });

  it('matter–Λ equality at z ≈ 0.30', () => {
    const a = bisect((x) => {
      const o = omegaAt(x);
      return o.matter - o.darkEnergy;
    }, 0.3, 0.99);
    expect(Math.abs(1 / a - 1 - 0.3)).toBeLessThan(0.02);
  });

  it('a(t) strictly increasing and tAt(aAt(t)) round-trips to 1e-9', () => {
    let prev = 0;
    for (let lt = -43; lt <= Math.log10(AGE_SECONDS); lt += 0.01) {
      const t = Math.pow(10, lt);
      const a = aAt(t);
      expect(a).toBeGreaterThan(prev);
      prev = a;
      expect(Math.abs(tAt(a) / t - 1)).toBeLessThan(1e-9);
    }
    expect(aAt(AGE_SECONDS)).toBeCloseTo(1, 12);
  });

  it('omega sums to 1 ± 1e-12 everywhere', () => {
    for (let la = -35; la <= 0.5; la += 0.05) {
      const o = omegaAt(Math.pow(10, la));
      expect(Math.abs(o.radiation + o.matter + o.darkEnergy - 1)).toBeLessThan(1e-12);
      expect(Math.abs(o.baryon + o.darkMatter - o.matter)).toBeLessThan(1e-12);
    }
  });

  it('temperature: T₀ today, (4/11)^(1/3) T₀/a before e⁺e⁻ annihilation, monotone', () => {
    expect(temperatureAt(1)).toBeCloseTo(2.7255, 10);
    const aEarly = 1e-13;
    expect((temperatureAt(aEarly) * aEarly) / 2.7255).toBeCloseTo(Math.cbrt(4 / 11), 10);
    let prev = Infinity;
    for (let la = -30; la <= 0; la += 0.01) {
      const T = temperatureAt(Math.pow(10, la));
      expect(T).toBeLessThan(prev);
      prev = T;
    }
  });

  it('globals: t=1 s is ~10¹⁰ K; CMB at last scattering ~3000 K', () => {
    expect(globalsAt(1).T).toBeGreaterThan(5e9);
    expect(globalsAt(1).T).toBeLessThan(2e10);
    const g = globalsAt(tAtRedshift(1090));
    expect(g.T).toBeGreaterThan(2900);
    expect(g.T).toBeLessThan(3100);
    expect(globalsAt(380 * KYR_S).z).toBeGreaterThan(1050);
  });

  it('pre-Friedmann times are flagged and clamped (§6.5)', () => {
    const g = globalsAt(1e-40);
    expect(g.preInflation).toBe(true);
    expect(g.epoch).toBe('preInflation');
    expect(g.a).toBe(globalsAt(1e-32).a);
    expect(globalsAt(1e-34).epoch).toBe('inflation');
    expect(inflationScaleFactor(0) / inflationScaleFactor(1)).toBeCloseTo(Math.exp(-60), 30);
  });

  it('growth factor: D(1)=1, D ∝ a in matter era, monotone', () => {
    expect(growthFactor(1)).toBeCloseTo(1, 10);
    const r1 = growthFactor(1e-3) / 1e-3;
    const r2 = growthFactor(1e-2) / 1e-2;
    expect(Math.abs(r1 / r2 - 1)).toBeLessThan(0.01);
    expect(r1).toBeGreaterThan(1.2); // suppression by Λ today: D(1) < a
    let prev = 0;
    for (let la = -4; la <= 0; la += 0.01) {
      const d = growthFactor(Math.pow(10, la));
      expect(d).toBeGreaterThan(prev);
      prev = d;
    }
  });
});
