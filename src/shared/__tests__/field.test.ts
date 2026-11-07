import { describe, expect, it } from 'vitest';
import { fft3d, generateField, symEig3, zeldovichParticles, DEFAULT_FIELD } from '../fieldCore.ts';

describe('primordial field', () => {
  const params = { ...DEFAULT_FIELD, n: 32, tzaSmoothMpcH: 0 };
  const f = generateField(params);

  it('FFT round-trips', () => {
    const n = 8;
    const re = new Float64Array(n * n * n).map((_, i) => Math.sin(i * 1.3));
    const im = new Float64Array(n * n * n);
    const orig = re.slice();
    fft3d(re, im, n, false);
    fft3d(re, im, n, true);
    for (let i = 0; i < re.length; i++) expect(re[i]! / re.length).toBeCloseTo(orig[i]!, 10);
  });

  it('is deterministic for a fixed seed', () => {
    const g = generateField(params);
    expect(g.delta[123]).toBe(f.delta[123]);
    expect(g.psi[456]).toBe(f.psi[456]);
  });

  it('ζ has unit variance and δ has a sensible variance', () => {
    let s = 0;
    for (const v of f.zeta) s += v * v;
    expect(Math.sqrt(s / f.zeta.length)).toBeCloseTo(1, 6);
    expect(f.sigmaDelta).toBeGreaterThan(0.3);
    expect(f.sigmaDelta).toBeLessThan(5);
  });

  it('δ = −∇·ψ (Zel’dovich consistency, untruncated)', () => {
    const n = f.n;
    const at = (x: number, y: number, z: number, c: number) =>
      f.psi[((((z + n) % n) * n + ((y + n) % n)) * n + ((x + n) % n)) * 3 + c]!;
    let num = 0;
    let den = 0;
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const div =
            ((at(x + 1, y, z, 0) - at(x - 1, y, z, 0)) + (at(x, y + 1, z, 1) - at(x, y - 1, z, 1)) + (at(x, y, z + 1, 2) - at(x, y, z - 1, 2))) *
            (n / 2);
          const d = f.delta[(z * n + y) * n + x]!;
          num += -div * d;
          den += d * d;
        }
    // Central differences damp high-k, so the correlation is strong but not exact.
    expect(num / den).toBeGreaterThan(0.5);
  });

  it('different grid sizes share the same large-scale modes (same universe at every tier)', () => {
    const a = generateField({ ...DEFAULT_FIELD, n: 16, tzaSmoothMpcH: 0, peakSmoothMpcH: 15 });
    const b = generateField({ ...DEFAULT_FIELD, n: 32, tzaSmoothMpcH: 0, peakSmoothMpcH: 15 });
    // Compare the heavily smoothed fields at the 16³ cell centres.
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let z = 0; z < 16; z++)
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          const va = a.deltaSmooth[(z * 16 + y) * 16 + x]!;
          const vb = b.deltaSmooth[((2 * z) * 32 + 2 * y) * 32 + 2 * x]! * 0.125 +
            b.deltaSmooth[((2 * z + 1) * 32 + 2 * y + 1) * 32 + 2 * x + 1]! * 0.875;
          ab += va * vb;
          aa += va * va;
          bb += vb * vb;
        }
    expect(ab / Math.sqrt(aa * bb)).toBeGreaterThan(0.9);
  });

  it('finds peaks sorted by height', () => {
    expect(f.peaks.length).toBeGreaterThan(4 * 10);
    for (let i = 1; i < f.peaks.length / 4; i++) expect(f.peaks[i * 4 + 3]!).toBeLessThanOrEqual(f.peaks[(i - 1) * 4 + 3]!);
  });

  it('symEig3 matches a diagonal and a known matrix', () => {
    expect(symEig3(3, 1, 2, 0, 0, 0)).toEqual([3, 2, 1]);
    const [a, b, c] = symEig3(2, 2, 2, 1, 0, 0); // eigenvalues 3, 2, 1
    expect(a).toBeCloseTo(3, 10);
    expect(b).toBeCloseTo(2, 10);
    expect(c).toBeCloseTo(1, 10);
  });

  it('particle eigenvalues sum to local δ (trace of the deformation tensor)', () => {
    const pd = zeldovichParticles(f, 16);
    let corr = 0;
    let norm = 0;
    for (let i = 0; i < 16 ** 3; i++) {
      const tr = pd.lambda[i * 4]! + pd.lambda[i * 4 + 1]! + pd.lambda[i * 4 + 2]!;
      const d = pd.psi[i * 4 + 3]! * f.sigmaDelta;
      corr += tr * d;
      norm += d * d;
    }
    expect(corr / norm).toBeGreaterThan(0.5);
  });
});
