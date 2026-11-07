// Blackbody temperature → linear sRGB (HANDOFF §6.8).
// Planck's law integrated against the CIE 1931 2° observer, XYZ → linear sRGB (D65), normalised to max channel = 1.

import { CIE_1931_5NM } from './cie1931.ts';
import { C_M_S, H_PLANCK, K_BOLTZMANN } from './constants.ts';

export type RGB = [number, number, number];

export const BLACKBODY_LUT_LOG10_MIN = 3;
export const BLACKBODY_LUT_LOG10_MAX = 12;
export const BLACKBODY_LUT_SIZE = 256;
/** Below this the eye sees nothing; scenes must use a labelled colour map instead. */
export const VISIBLE_MIN_TEMP_K = 1000;

const C2 = (H_PLANCK * C_M_S) / K_BOLTZMANN; // second radiation constant, m·K

/** Spectral radiance up to a constant: λ⁻⁵ / (exp(c₂/λT) − 1). */
function planck(lambdaM: number, tempK: number): number {
  const x = C2 / (lambdaM * tempK);
  return 1 / (Math.pow(lambdaM, 5) * Math.expm1(x));
}

export function xyzToLinearSRGB(X: number, Y: number, Z: number, out: RGB = [0, 0, 0]): RGB {
  out[0] = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  out[1] = -0.969266 * X + 1.8760108 * Y + 0.041556 * Z;
  out[2] = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  return out;
}

/** CIE XYZ of a blackbody (unnormalised). */
export function blackbodyXYZ(tempK: number): [number, number, number] {
  let X = 0;
  let Y = 0;
  let Z = 0;
  for (const [nm, xb, yb, zb] of CIE_1931_5NM) {
    const b = planck(nm * 1e-9, tempK);
    X += b * xb;
    Y += b * yb;
    Z += b * zb;
  }
  return [X, Y, Z];
}

/** Exact (slow) blackbody colour: linear sRGB, negative channels clipped, max channel = 1. */
export function blackbodyRGBExact(tempK: number, out: RGB = [0, 0, 0]): RGB {
  const [X, Y, Z] = blackbodyXYZ(tempK);
  xyzToLinearSRGB(X, Y, Z, out);
  out[0] = Math.max(0, out[0]);
  out[1] = Math.max(0, out[1]);
  out[2] = Math.max(0, out[2]);
  const m = Math.max(out[0], out[1], out[2]) || 1;
  out[0] /= m;
  out[1] /= m;
  out[2] /= m;
  return out;
}

/** Wavelength (nm) → linear sRGB of a monochromatic line, normalised to max channel = 1. */
export function wavelengthRGB(nm: number, out: RGB = [0, 0, 0]): RGB {
  const i = Math.max(0, Math.min(CIE_1931_5NM.length - 2, Math.floor((nm - 380) / 5)));
  const r0 = CIE_1931_5NM[i]!;
  const r1 = CIE_1931_5NM[i + 1]!;
  const s = Math.max(0, Math.min(1, (nm - r0[0]) / 5));
  const X = r0[1] + (r1[1] - r0[1]) * s;
  const Y = r0[2] + (r1[2] - r0[2]) * s;
  const Z = r0[3] + (r1[3] - r0[3]) * s;
  xyzToLinearSRGB(X, Y, Z, out);
  // Monochromatic colours lie outside sRGB: desaturate toward white just enough to bring them in gamut.
  const minC = Math.min(out[0], out[1], out[2]);
  if (minC < 0) {
    out[0] -= minC;
    out[1] -= minC;
    out[2] -= minC;
  }
  const m = Math.max(out[0], out[1], out[2]) || 1;
  out[0] /= m;
  out[1] /= m;
  out[2] /= m;
  return out;
}

/** RGBA float LUT over log₁₀T ∈ [3, 12]. Alpha holds log₁₀T for debugging. */
export const BLACKBODY_LUT: Float32Array = (() => {
  const lut = new Float32Array(BLACKBODY_LUT_SIZE * 4);
  const rgb: RGB = [0, 0, 0];
  for (let i = 0; i < BLACKBODY_LUT_SIZE; i++) {
    const l = BLACKBODY_LUT_LOG10_MIN + ((BLACKBODY_LUT_LOG10_MAX - BLACKBODY_LUT_LOG10_MIN) * i) / (BLACKBODY_LUT_SIZE - 1);
    blackbodyRGBExact(Math.pow(10, l), rgb);
    lut[i * 4] = rgb[0];
    lut[i * 4 + 1] = rgb[1];
    lut[i * 4 + 2] = rgb[2];
    lut[i * 4 + 3] = l;
  }
  return lut;
})();

/** Fast LUT lookup (clamped to 10³–10¹² K). */
export function blackbodyRGB(tempK: number, out: RGB = [0, 0, 0]): RGB {
  const l = Math.log10(Math.max(tempK, 1e-30));
  const u =
    ((Math.min(Math.max(l, BLACKBODY_LUT_LOG10_MIN), BLACKBODY_LUT_LOG10_MAX) - BLACKBODY_LUT_LOG10_MIN) /
      (BLACKBODY_LUT_LOG10_MAX - BLACKBODY_LUT_LOG10_MIN)) *
    (BLACKBODY_LUT_SIZE - 1);
  const i = Math.min(Math.floor(u), BLACKBODY_LUT_SIZE - 2);
  const s = u - i;
  for (let c = 0; c < 3; c++) {
    out[c] = BLACKBODY_LUT[i * 4 + c]! * (1 - s) + BLACKBODY_LUT[(i + 1) * 4 + c]! * s;
  }
  return out;
}

/** HSV hue (degrees) of an RGB triple; used by tests and debug overlays. */
export function hueDeg([r, g, b]: RGB): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

export function saturation([r, g, b]: RGB): number {
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

/** sRGB transfer function (for tests/UI that want display values). */
export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
