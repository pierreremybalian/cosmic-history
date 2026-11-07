import { describe, expect, it } from 'vitest';
import { GYR_S, KYR_S, MYR_S, YEAR_S } from '../../physics/constants.ts';
import { AGE_SECONDS } from '../../physics/cosmology.ts';
import { formatDuration, formatLookback, formatTime, plainDuration, plainWhen, sci } from '../format.ts';

describe('format', () => {
  it.each([
    [1e-36, 'short', '10⁻³⁶ s'],
    [5.39e-44, 'short', '5.4 × 10⁻⁴⁴ s'],
    [1e-6, 'short', '10⁻⁶ s'],
    [2.5e-4, 'short', '2.5 × 10⁻⁴ s'],
    [1e-3, 'short', '1 ms'],
    [0.25, 'short', '250 ms'],
    [1, 'short', '1 s'],
    [1.5, 'short', '1.5 s'],
    [180, 'short', '3 min'],
    [1200, 'short', '20 min'],
    [7200, 'short', '2 h'],
    [40 * 86400, 'short', '40 days'],
    [2500 * YEAR_S, 'short', '2,500 yr'],
    [47000 * YEAR_S, 'short', '47 kyr'],
    [47000 * YEAR_S, 'long', '47,000 yr'],
    [380 * KYR_S, 'short', '380 kyr'],
    [380 * KYR_S, 'long', '380,000 yr'],
    [150 * MYR_S, 'short', '150 Myr'],
    [7.8 * GYR_S, 'short', '7.8 Gyr'],
    [13.79 * GYR_S, 'short', '13.8 Gyr'],
  ] as const)('formatDuration(%s, %s) = %s', (s, style, want) => {
    expect(formatDuration(s, style)).toBe(want);
  });

  it.each([
    [4.6 * GYR_S, '4.6 Gyr ago'],
    [66 * MYR_S, '66 Myr ago'],
    [300e3 * YEAR_S, '300,000 yr ago'],
    [538.8 * MYR_S, '540 Myr ago'],
    [0.1 * YEAR_S, 'now'],
  ] as const)('formatLookback(%s) = %s', (L, want) => {
    expect(formatLookback(L)).toBe(want);
  });

  it('formatTime switches to lookback when asked', () => {
    expect(formatTime(AGE_SECONDS - 66 * MYR_S, { lookback: true })).toBe('66 Myr ago');
    expect(formatTime(1e-12)).toBe('10⁻¹² s');
  });

  it('sci rounds mantissa overflow', () => {
    expect(sci(9.99e-10)).toBe('10⁻⁹');
  });

  it.each([
    [4.2e-39, '4.2 × 10⁻³⁹ seconds'],
    [1, '1 second'],
    [20, '20 seconds'],
    [180, '3 minutes'],
    [380 * KYR_S, '380,000 years'],
    [150 * MYR_S, '150 million years'],
    [3.6 * GYR_S, '3.6 billion years'],
    [13.79 * GYR_S, '13.8 billion years'],
  ] as const)('plainDuration(%s) = %s', (s, want) => {
    expect(plainDuration(s)).toBe(want);
  });

  it('plainWhen switches to lookback', () => {
    expect(plainWhen(20)).toBe('20 seconds after the Big Bang');
    expect(plainWhen(0, { lookback: true, lookbackSeconds: 4.6 * GYR_S })).toBe('4.6 billion years ago');
    expect(plainWhen(AGE_SECONDS, { lookback: true })).toBe('Today');
  });
});

