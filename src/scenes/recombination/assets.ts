// The Planck CMB map (HANDOFF §9.7, scripts/DATA_NOTES.md §1). Loads the tier's equirectangular ΔT texture and
// the orientation convention from cmb_meta.json. If the data cannot be loaded the scene falls back to a
// procedural stand-in with the same encoding (8-bit, 0.5 = 0 µK) so it still runs; `real` says which one is live.

import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  type Texture,
} from 'three/webgpu';
import { gaussian, mulberry32 } from '../../shared/math.ts';
import type { RenderContext } from '../types.ts';

export const CMB_DIR = '/data/cmb';
export const CMB_URL_HIGH = `${CMB_DIR}/cmb_dT_4096x2048.png`;
export const CMB_URL_MEDIUM = `${CMB_DIR}/cmb_dT_2048x1024.png`;
export const CMB_META_URL = `${CMB_DIR}/cmb_meta.json`;

/** Equirectangular orientation: u = fract(uAtLon0 − sign · l / 360°), v = 0.5 + b / 180° (three flipY). */
export interface CmbConvention {
  /** Texture u at Galactic longitude 0 (the Galactic Centre). */
  uAtLon0: number;
  /** +1 when longitude increases to the left (Planck's inside-the-sphere view), −1 when to the right. */
  lonSign: number;
  /** ΔT range of the 8-bit encoding, µK (0 → min, 255 → max). */
  minMicroK: number;
  maxMicroK: number;
}

interface CmbMeta {
  minMicroK?: number;
  maxMicroK?: number;
  lonAtCenterDeg?: number;
  lonIncreases?: 'left' | 'right';
  credit?: string;
}

/** Documented default (DATA_NOTES.md §1): l = 0 at u = 0.5, longitude increasing to the left. */
const DEFAULT_CONVENTION: CmbConvention = { uAtLon0: 0.5, lonSign: 1, minMicroK: -300, maxMicroK: 300 };

export interface CmbMap {
  texture: Texture;
  convention: CmbConvention;
  /** True when the real Planck map is loaded (false = procedural stand-in). */
  real: boolean;
  release(): void;
}

export async function loadCmb(ctx: RenderContext): Promise<CmbMap> {
  const url = ctx.quality.name === 'high' ? CMB_URL_HIGH : CMB_URL_MEDIUM;
  const convention = { ...DEFAULT_CONVENTION };
  try {
    const meta = await ctx.assets.json<CmbMeta>(CMB_META_URL);
    // Pixel centre convention in the meta: u = 0.5 at lonAtCenterDeg; u grows opposite to l when "left".
    const lc = meta.lonAtCenterDeg ?? 0;
    convention.lonSign = meta.lonIncreases === 'right' ? -1 : 1;
    convention.uAtLon0 = 0.5 + (convention.lonSign * lc) / 360;
    convention.minMicroK = meta.minMicroK ?? convention.minMicroK;
    convention.maxMicroK = meta.maxMicroK ?? convention.maxMicroK;
  } catch (err) {
    console.warn('[scene recombination] cmb_meta.json unavailable, using the documented convention', err);
  }
  try {
    const tex = await ctx.assets.texture(url, { colorSpace: NoColorSpace, mipmaps: true });
    tex.wrapS = RepeatWrapping; // longitude wraps
    tex.wrapT = ClampToEdgeWrapping;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.magFilter = LinearFilter;
    tex.anisotropy = 8;
    return { texture: tex, convention, real: true, release: () => ctx.assets.release(url) };
  } catch (err) {
    console.warn('[scene recombination] Planck map unavailable, using a procedural stand-in', err);
    const tex = standInTexture();
    return { texture: tex, convention: { ...DEFAULT_CONVENTION }, real: false, release: () => tex.dispose() };
  }
}

/**
 * Procedural stand-in: an isotropic Gaussian field on the sphere from random plane waves with a CMB-like
 * fall-off (most power at a few degrees). Same encoding as the real map. Only used when the data is missing.
 */
function standInTexture(w = 512, h = 256, waves = 160): DataTexture {
  const rand = mulberry32(1090);
  const kx = new Float32Array(waves);
  const ky = new Float32Array(waves);
  const kz = new Float32Array(waves);
  const ph = new Float32Array(waves);
  const amp = new Float32Array(waves);
  for (let i = 0; i < waves; i++) {
    const x = gaussian(rand);
    const y = gaussian(rand);
    const z = gaussian(rand);
    const n = Math.hypot(x, y, z) || 1;
    const ell = 4 + Math.pow(rand(), 1.6) * 60; // wavenumber in units of the sphere radius
    kx[i] = (x / n) * ell;
    ky[i] = (y / n) * ell;
    kz[i] = (z / n) * ell;
    ph[i] = rand() * Math.PI * 2;
    amp[i] = 1 / Math.sqrt(ell);
  }
  const data = new Uint8Array(w * h * 4);
  const vals = new Float32Array(w * h);
  let sum2 = 0;
  for (let j = 0; j < h; j++) {
    const b = Math.PI * (0.5 - (j + 0.5) / h);
    for (let i = 0; i < w; i++) {
      const l = Math.PI * (1 - (2 * (i + 0.5)) / w);
      const dx = Math.cos(b) * Math.cos(l);
      const dy = Math.cos(b) * Math.sin(l);
      const dz = Math.sin(b);
      let s = 0;
      for (let k = 0; k < waves; k++) s += amp[k]! * Math.cos(kx[k]! * dx + ky[k]! * dy + kz[k]! * dz + ph[k]!);
      vals[j * w + i] = s;
      sum2 += s * s;
    }
  }
  const rms = Math.sqrt(sum2 / (w * h)) || 1;
  for (let j = 0; j < h; j++) {
    // DataTexture rows are bottom-up (no flipY), so write row j of the image at h − 1 − j.
    const row = h - 1 - j;
    for (let i = 0; i < w; i++) {
      const t = Math.max(-1, Math.min(1, (vals[j * w + i]! / rms) * (104 / 300)));
      const v = Math.round((t * 0.5 + 0.5) * 255);
      const o = (row * w + i) * 4;
      data[o] = data[o + 1] = data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  const tex = new DataTexture(data, w, h, RGBAFormat);
  tex.colorSpace = NoColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
