// The one primordial Gaussian random field (HANDOFF §8), pure TypeScript so it runs in a Worker and in tests.
// Same white noise feeds: the primordial curvature ζ (inflation), the BBKS-processed linear density δ
// (structure), and the truncated Zel'dovich displacement ψ. Large-scale modes are therefore identical in
// every scene: the ripples of inflation are the seeds of the web.

import { N_S } from '../physics/constants.ts';
import { linearPk } from '../physics/powerSpectrum.ts';
import { gaussian, mulberry32 } from './math.ts';

export interface FieldParams {
  n: number; // grid side, power of two
  boxMpcH: number; // comoving box, Mpc/h
  seed: number;
  /** Gaussian smoothing of ψ (truncated Zel'dovich, Coles, Melott & Shandarin 1993), Mpc/h. */
  tzaSmoothMpcH: number;
  /** Smoothing for halo-peak finding, Mpc/h. */
  peakSmoothMpcH: number;
  maxPeaks: number;
}

export const DEFAULT_FIELD: Omit<FieldParams, 'n'> = {
  boxMpcH: 100,
  seed: 1977,
  tzaSmoothMpcH: 1.2,
  peakSmoothMpcH: 2.0,
  maxPeaks: 2048,
};

export interface FieldData {
  n: number;
  boxMpcH: number;
  /** Linear δ at a = 1 (D = 1), BBKS spectrum normalised to σ₈. */
  delta: Float32Array;
  /** Primordial curvature ζ (P ∝ k^(n_s−4)), unit variance. */
  zeta: Float32Array;
  /** δ smoothed on peakSmoothMpcH. */
  deltaSmooth: Float32Array;
  /** TZA displacement at D = 1 in box units, interleaved xyz. */
  psi: Float32Array;
  sigmaDelta: number;
  sigmaSmooth: number;
  sigmaPsi: number;
  /** Peaks of deltaSmooth: [qx, qy, qz, ν] in box units [0,1) and σ units, highest first. */
  peaks: Float32Array;
}

export interface ParticleData {
  side: number;
  /** Lagrangian lattice positions in box units [0,1), xyz + random. */
  q: Float32Array;
  /** ψ at q, xyz + local δ/σ. */
  psi: Float32Array;
  /** Eigenvalues of the deformation tensor −∂ψ/∂q (λ₁ ≥ λ₂ ≥ λ₃), + peak-proximity. */
  lambda: Float32Array;
}

// ── FFT ────────────────────────────────────────────────────────────────────
function fft1d(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]!;
      re[i] = re[j]!;
      re[j] = t;
      t = im[i]!;
      im[i] = im[j]!;
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const xr = re[b]! * cr - im[b]! * ci;
        const xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** In-place 3D FFT of an n³ complex grid (index = (z·n + y)·n + x). Inverse is unnormalised. */
export function fft3d(re: Float64Array, im: Float64Array, n: number, inverse: boolean): void {
  const lr = new Float64Array(n);
  const li = new Float64Array(n);
  const n2 = n * n;
  // x lines
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++) {
      const base = z * n2 + y * n;
      for (let x = 0; x < n; x++) {
        lr[x] = re[base + x]!;
        li[x] = im[base + x]!;
      }
      fft1d(lr, li, inverse);
      for (let x = 0; x < n; x++) {
        re[base + x] = lr[x]!;
        im[base + x] = li[x]!;
      }
    }
  // y lines
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++) {
      const base = z * n2 + x;
      for (let y = 0; y < n; y++) {
        lr[y] = re[base + y * n]!;
        li[y] = im[base + y * n]!;
      }
      fft1d(lr, li, inverse);
      for (let y = 0; y < n; y++) {
        re[base + y * n] = lr[y]!;
        im[base + y * n] = li[y]!;
      }
    }
  // z lines
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const base = y * n + x;
      for (let z = 0; z < n; z++) {
        lr[z] = re[base + z * n2]!;
        li[z] = im[base + z * n2]!;
      }
      fft1d(lr, li, inverse);
      for (let z = 0; z < n; z++) {
        re[base + z * n2] = lr[z]!;
        im[base + z * n2] = li[z]!;
      }
    }
}

const freq = (i: number, n: number) => (i < n / 2 ? i : i - n);

/** 32-bit hash of (seed, integer mode) for per-mode deterministic noise. */
function modeSeed(seed: number, i: number, j: number, l: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (const v of [i, j, l]) {
    h = Math.imul(h ^ (v + 0x7f4a7c15), 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
  }
  return h;
}

function rms(a: Float32Array, stride = 1): number {
  let s = 0;
  for (let i = 0; i < a.length; i += stride) s += a[i]! * a[i]!;
  return Math.sqrt(s / (a.length / stride));
}

/** Generate the field. Deterministic for a given seed. */
export function generateField(p: FieldParams): FieldData {
  const { n, boxMpcH: L } = p;
  if ((n & (n - 1)) !== 0) throw new Error('field grid must be a power of two');
  const N3 = n * n * n;
  const rand = mulberry32(p.seed);

  // White noise drawn directly in Fourier space, one hashed complex Gaussian per integer mode (i, j, l).
  // Every grid size therefore shares the same large-scale modes: the 64³ low tier is a low-pass of the same
  // universe as 128³. Hermitian symmetry W(−k) = W(k)* is imposed explicitly. Scaled by √N³ to match the
  // FFT of unit-variance real white noise, so the amplitudes below are unchanged.
  const wr = new Float64Array(N3);
  const wi = new Float64Array(N3);
  const sqrtN3 = Math.sqrt(N3);
  const half = n / 2;
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const fx = freq(x, n);
        const fy = freq(y, n);
        const fz = freq(z, n);
        // Nyquist planes are their own conjugates; treat ±n/2 as +n/2.
        const sx = fx === -half ? half : fx;
        const sy = fy === -half ? half : fy;
        const sz = fz === -half ? half : fz;
        const nx = -sx === -half ? half : -sx;
        const ny = -sy === -half ? half : -sy;
        const nz = -sz === -half ? half : -sz;
        const selfConj = sx === nx && sy === ny && sz === nz;
        // Canonical member of the ±k pair: lexicographically larger (sz, sy, sx).
        const positive = sz > nz || (sz === nz && (sy > ny || (sy === ny && sx >= nx)));
        const [cx, cy, cz] = positive ? [sx, sy, sz] : [nx, ny, nz];
        const r = mulberry32(modeSeed(p.seed, cx, cy, cz));
        const i = (z * n + y) * n + x;
        if (selfConj) {
          wr[i] = gaussian(r) * sqrtN3;
          wi[i] = 0;
        } else {
          const re = (gaussian(r) * sqrtN3) / Math.SQRT2;
          const im = (gaussian(r) * sqrtN3) / Math.SQRT2;
          wr[i] = re;
          wi[i] = positive ? im : -im;
        }
      }
  void rand;

  const kf = (2 * Math.PI) / L; // fundamental mode, h/Mpc
  const cellVol = Math.pow(L / n, 3);
  const re = new Float64Array(N3);
  const im = new Float64Array(N3);
  const out = (scale: number) => {
    fft3d(re, im, n, true);
    const a = new Float32Array(N3);
    for (let i = 0; i < N3; i++) a[i] = (re[i]! * scale) / N3;
    return a;
  };

  type Filler = (kx: number, ky: number, kz: number, k: number) => [number, number]; // multiplies (wr, wi): (real factor, imag factor)
  const fill = (f: Filler) => {
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const i = (z * n + y) * n + x;
          const kx = freq(x, n) * kf;
          const ky = freq(y, n) * kf;
          const kz = freq(z, n) * kf;
          const k = Math.sqrt(kx * kx + ky * ky + kz * kz);
          if (k === 0) {
            re[i] = 0;
            im[i] = 0;
            continue;
          }
          const [fr, fi] = f(kx, ky, kz, k);
          // (wr + i wi)(fr + i fi)
          re[i] = wr[i]! * fr - wi[i]! * fi;
          im[i] = wr[i]! * fi + wi[i]! * fr;
        }
  };

  const amp = (k: number) => Math.sqrt(linearPk(k) / cellVol);
  const gauss = (k: number, R: number) => Math.exp(-0.5 * k * k * R * R);

  // δ (BBKS, σ₈-normalised; variance = Σ P(k)/V)
  fill((_x, _y, _z, k) => [amp(k), 0]);
  const delta = out(1);

  // ζ: nearly scale-invariant primordial curvature; normalised to unit variance after.
  fill((_x, _y, _z, k) => [Math.pow(k, (N_S - 4) / 2), 0]);
  const zeta = out(1);
  const sz = rms(zeta);
  for (let i = 0; i < N3; i++) zeta[i] = zeta[i]! / sz;

  // Smoothed δ for peaks.
  fill((_x, _y, _z, k) => [amp(k) * gauss(k, p.peakSmoothMpcH), 0]);
  const deltaSmooth = out(1);

  // ψ̂_j = i k_j δ̂ / k² (so that δ = −∇·ψ), TZA-smoothed, converted to box units (÷L).
  const psi = new Float32Array(N3 * 3);
  for (let axis = 0; axis < 3; axis++) {
    fill((kx, ky, kz, k) => {
      const kj = axis === 0 ? kx : axis === 1 ? ky : kz;
      const s = (amp(k) * gauss(k, p.tzaSmoothMpcH) * kj) / (k * k) / L;
      return [0, s];
    });
    const comp = out(1);
    for (let i = 0; i < N3; i++) psi[i * 3 + axis] = comp[i]!;
  }

  const sigmaDelta = rms(delta);
  const sigmaSmooth = rms(deltaSmooth);
  let ps = 0;
  for (let i = 0; i < psi.length; i++) ps += psi[i]! * psi[i]!;
  const sigmaPsi = Math.sqrt(ps / N3);

  const peaks = findPeaks(deltaSmooth, n, sigmaSmooth, p.maxPeaks);
  return { n, boxMpcH: L, delta, zeta, deltaSmooth, psi, sigmaDelta, sigmaSmooth, sigmaPsi, peaks };
}

function findPeaks(d: Float32Array, n: number, sigma: number, max: number): Float32Array {
  const idx = (x: number, y: number, z: number) => (((z + n) % n) * n + ((y + n) % n)) * n + ((x + n) % n);
  const found: [number, number, number, number][] = [];
  const thresh = 1.5 * sigma;
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const v = d[idx(x, y, z)]!;
        if (v < thresh) continue;
        let isMax = true;
        for (let dz = -1; dz <= 1 && isMax; dz++)
          for (let dy = -1; dy <= 1 && isMax; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy && !dz) continue;
              if (d[idx(x + dx, y + dy, z + dz)]! > v) {
                isMax = false;
                break;
              }
            }
        if (isMax) found.push([(x + 0.5) / n, (y + 0.5) / n, (z + 0.5) / n, v / sigma]);
      }
  found.sort((a, b) => b[3] - a[3]);
  const k = Math.min(max, found.length);
  const out = new Float32Array(k * 4);
  for (let i = 0; i < k; i++) out.set(found[i]!, i * 4);
  return out;
}

/** Trilinear periodic sample of an interleaved grid (stride components). */
export function sampleGrid(
  a: Float32Array,
  n: number,
  stride: number,
  comp: number,
  qx: number,
  qy: number,
  qz: number,
): number {
  const fx = qx * n - 0.5;
  const fy = qy * n - 0.5;
  const fz = qz * n - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const z0 = Math.floor(fz);
  const tx = fx - x0;
  const ty = fy - y0;
  const tz = fz - z0;
  let s = 0;
  for (let dz = 0; dz < 2; dz++)
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const x = (((x0 + dx) % n) + n) % n;
        const y = (((y0 + dy) % n) + n) % n;
        const z = (((z0 + dz) % n) + n) % n;
        const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
        s += w * a[((z * n + y) * n + x) * stride + comp]!;
      }
  return s;
}

/** Eigenvalues of a symmetric 3×3 matrix, sorted descending (analytic, Smith 1961). */
export function symEig3(a11: number, a22: number, a33: number, a12: number, a13: number, a23: number): [number, number, number] {
  const p1 = a12 * a12 + a13 * a13 + a23 * a23;
  if (p1 < 1e-30) {
    const e = [a11, a22, a33].sort((x, y) => y - x);
    return [e[0]!, e[1]!, e[2]!];
  }
  const q = (a11 + a22 + a33) / 3;
  const p2 = (a11 - q) ** 2 + (a22 - q) ** 2 + (a33 - q) ** 2 + 2 * p1;
  const p = Math.sqrt(p2 / 6);
  const b11 = (a11 - q) / p;
  const b22 = (a22 - q) / p;
  const b33 = (a33 - q) / p;
  const b12 = a12 / p;
  const b13 = a13 / p;
  const b23 = a23 / p;
  const r = (b11 * (b22 * b33 - b23 * b23) - b12 * (b12 * b33 - b23 * b13) + b13 * (b12 * b23 - b22 * b13)) / 2;
  const phi = r <= -1 ? Math.PI / 3 : r >= 1 ? 0 : Math.acos(r) / 3;
  const e1 = q + 2 * p * Math.cos(phi);
  const e3 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
  const e2 = 3 * q - e1 - e3;
  return [e1, e2, e3];
}

/**
 * Zel'dovich particles on a side³ lattice: q, ψ(q), and deformation eigenvalues so the GPU can compute
 * x = q + A ψ and ρ/ρ̄ = 1 / Π(1 − A λᵢ) without any further CPU work.
 */
export function zeldovichParticles(f: FieldData, side: number, seed = 7): ParticleData {
  const n = f.n;
  const count = side * side * side;
  const q = new Float32Array(count * 4);
  const psi = new Float32Array(count * 4);
  const lambda = new Float32Array(count * 4);
  const rand = mulberry32(seed);

  // Deformation tensor on the grid by central differences: T_ij = −∂ψ_i/∂q_j (box units, h = 1/n).
  const N3 = n * n * n;
  const T = new Float32Array(N3 * 6); // xx yy zz xy xz yz
  const at = (x: number, y: number, z: number, c: number) =>
    f.psi[((((z + n) % n) * n + ((y + n) % n)) * n + ((x + n) % n)) * 3 + c]!;
  const h2 = 2 / n;
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = ((z * n + y) * n + x) * 6;
        const dxdx = (at(x + 1, y, z, 0) - at(x - 1, y, z, 0)) / h2;
        const dydy = (at(x, y + 1, z, 1) - at(x, y - 1, z, 1)) / h2;
        const dzdz = (at(x, y, z + 1, 2) - at(x, y, z - 1, 2)) / h2;
        const dxdy = 0.5 * ((at(x, y + 1, z, 0) - at(x, y - 1, z, 0)) / h2 + (at(x + 1, y, z, 1) - at(x - 1, y, z, 1)) / h2);
        const dxdz = 0.5 * ((at(x, y, z + 1, 0) - at(x, y, z - 1, 0)) / h2 + (at(x + 1, y, z, 2) - at(x - 1, y, z, 2)) / h2);
        const dydz = 0.5 * ((at(x, y, z + 1, 1) - at(x, y, z - 1, 1)) / h2 + (at(x, y + 1, z, 2) - at(x, y - 1, z, 2)) / h2);
        T[i] = -dxdx;
        T[i + 1] = -dydy;
        T[i + 2] = -dzdz;
        T[i + 3] = -dxdy;
        T[i + 4] = -dxdz;
        T[i + 5] = -dydz;
      }

  // Peak proximity: distance to nearest of the top peaks (cheap grid lookup via a coarse hash).
  const topPeaks = Math.min(128, f.peaks.length / 4);
  let p = 0;
  for (let z = 0; z < side; z++)
    for (let y = 0; y < side; y++)
      for (let x = 0; x < side; x++, p++) {
        // Jitter inside the lattice cell hides the grid in early frames.
        const qx = (x + 0.5 + (rand() - 0.5) * 0.6) / side;
        const qy = (y + 0.5 + (rand() - 0.5) * 0.6) / side;
        const qz = (z + 0.5 + (rand() - 0.5) * 0.6) / side;
        q[p * 4] = qx;
        q[p * 4 + 1] = qy;
        q[p * 4 + 2] = qz;
        q[p * 4 + 3] = rand();
        psi[p * 4] = sampleGrid(f.psi, n, 3, 0, qx, qy, qz);
        psi[p * 4 + 1] = sampleGrid(f.psi, n, 3, 1, qx, qy, qz);
        psi[p * 4 + 2] = sampleGrid(f.psi, n, 3, 2, qx, qy, qz);
        psi[p * 4 + 3] = sampleGrid(f.delta, n, 1, 0, qx, qy, qz) / f.sigmaDelta;
        const t = [0, 1, 2, 3, 4, 5].map((c) => sampleGrid(T, n, 6, c, qx, qy, qz));
        const [l1, l2, l3] = symEig3(t[0]!, t[1]!, t[2]!, t[3]!, t[4]!, t[5]!);
        lambda[p * 4] = l1;
        lambda[p * 4 + 1] = l2;
        lambda[p * 4 + 2] = l3;
        let best = 1;
        for (let k = 0; k < topPeaks; k++) {
          let dx = Math.abs(qx - f.peaks[k * 4]!);
          let dy = Math.abs(qy - f.peaks[k * 4 + 1]!);
          let dz = Math.abs(qz - f.peaks[k * 4 + 2]!);
          dx = Math.min(dx, 1 - dx);
          dy = Math.min(dy, 1 - dy);
          dz = Math.min(dz, 1 - dz);
          const d = dx * dx + dy * dy + dz * dz;
          if (d < best) best = d;
        }
        lambda[p * 4 + 3] = Math.sqrt(best);
      }
  // Shuffle so any prefix is a uniform random subset (scenes draw quality.particles of them).
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    for (const arr of [q, psi, lambda]) {
      for (let c = 0; c < 4; c++) {
        const t = arr[i * 4 + c]!;
        arr[i * 4 + c] = arr[j * 4 + c]!;
        arr[j * 4 + c] = t;
      }
    }
  }
  return { side, q, psi, lambda };
}
