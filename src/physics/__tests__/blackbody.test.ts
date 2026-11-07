import { describe, expect, it } from 'vitest';
import { blackbodyRGB, blackbodyRGBExact, hueDeg, saturation, wavelengthRGB, linearToSrgb, type RGB } from '../blackbody.ts';

const display = (c: RGB): RGB => [linearToSrgb(c[0]), linearToSrgb(c[1]), linearToSrgb(c[2])];

describe('blackbody', () => {
  it('5800 K is white-yellow', () => {
    const c = display(blackbodyRGBExact(5800));
    expect(hueDeg(c)).toBeGreaterThan(10); // warm side of white
    expect(hueDeg(c)).toBeLessThan(60);
    expect(saturation(c)).toBeLessThan(0.15);
    expect(Math.min(...c)).toBeGreaterThan(0.75);
  });
  it('3000 K is orange', () => {
    const c = display(blackbodyRGBExact(3000));
    expect(c[0]).toBeCloseTo(1, 9);
    expect(hueDeg(c)).toBeGreaterThan(20);
    expect(hueDeg(c)).toBeLessThan(45);
    expect(saturation(c)).toBeGreaterThan(0.35);
  });
  it('10000 K is blue-white', () => {
    const c = display(blackbodyRGBExact(10000));
    expect(c[2]).toBeCloseTo(1, 9);
    expect(hueDeg(c)).toBeGreaterThan(200);
    expect(hueDeg(c)).toBeLessThan(240);
    expect(saturation(c)).toBeLessThan(0.35);
  });
  it('LUT matches exact within 1%', () => {
    for (const T of [1500, 3000, 5800, 1e4, 1e5, 1e8]) {
      const a = blackbodyRGB(T);
      const b = blackbodyRGBExact(T);
      for (let i = 0; i < 3; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThan(0.01);
    }
  });
  it('emission lines have the right hues', () => {
    const ha = hueDeg(wavelengthRGB(656.3)); // Hα red
    expect(ha < 15 || ha > 345).toBe(true);
    const oiii = hueDeg(wavelengthRGB(500.7));
    expect(oiii).toBeGreaterThan(140); // [O III] teal-green
    expect(oiii).toBeLessThan(200);
    const hb = hueDeg(wavelengthRGB(486.1));
    expect(hb).toBeGreaterThan(180); // Hβ cyan-blue
    expect(hb).toBeLessThan(240);
  });
});
