// Visualisation colour maps (HANDOFF §6.8, §13.4). Anything shown through these must be labelled "colour mapped".

import { Color, Vector3 } from 'three/webgpu';
import { clamp, float, mix, smoothstep, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { wavelengthRGB } from '../physics/blackbody.ts';

/** Diverging blue–white–red map for CMB ΔT (t ∈ [-1, 1] = ±300 µK). Stops tuned to read like the Planck map. */
export const CMB_STOPS: [number, string][] = [
  [-1.0, '#0a0f3d'],
  [-0.66, '#1b3fa8'],
  [-0.33, '#5aa2e6'],
  [0.0, '#f4f1e6'],
  [0.33, '#f2a35a'],
  [0.66, '#c8432a'],
  [1.0, '#5c0d12'],
];

/** CPU sample of the CMB map (for the HUD colour bar and the conversion script check). */
export function cmbColor(t: number): Color {
  const x = Math.max(-1, Math.min(1, t));
  for (let i = 0; i < CMB_STOPS.length - 1; i++) {
    const [a, ca] = CMB_STOPS[i]!;
    const [b, cb] = CMB_STOPS[i + 1]!;
    if (x <= b) return new Color(ca).lerp(new Color(cb), (x - a) / (b - a));
  }
  return new Color(CMB_STOPS.at(-1)![1]);
}

const lin = (hex: string) => {
  const c = new Color(hex); // three converts hex (sRGB) to linear working space
  return vec3(c.r, c.g, c.b);
};

/** TSL version of the CMB map. t ∈ [-1, 1]. */
export function cmbColorNode(t: Node<'float'>): Node<'vec3'> {
  const x = clamp(t, -1, 1);
  let col: Node<'vec3'> = lin(CMB_STOPS[0]![1]);
  for (let i = 1; i < CMB_STOPS.length; i++) {
    const [a] = CMB_STOPS[i - 1]!;
    const [b, cb] = CMB_STOPS[i]!;
    col = mix(col, lin(cb), smoothstep(a, b, x));
  }
  return col;
}

/** Perceptual "ember" map for invisible matter density (dark ages): black → indigo → teal → pale gold. */
export const DENSITY_STOPS: [number, string][] = [
  [0.0, '#000000'],
  [0.25, '#1a1446'],
  [0.5, '#2a5d8f'],
  [0.75, '#4fb3a9'],
  [1.0, '#f3e6b0'],
];

export function densityColorNode(t: Node<'float'>): Node<'vec3'> {
  const x = clamp(t, 0, 1);
  let col: Node<'vec3'> = lin(DENSITY_STOPS[0]![1]);
  for (let i = 1; i < DENSITY_STOPS.length; i++) {
    const [a] = DENSITY_STOPS[i - 1]!;
    const [b, cb] = DENSITY_STOPS[i]!;
    col = mix(col, lin(cb), smoothstep(a, b, x));
  }
  return col;
}

/** Real emission lines (§9.9), converted from wavelength via the CIE table. */
export const EMISSION_LINES_NM = {
  hAlpha: 656.3,
  hBeta: 486.1,
  oIII: 500.7,
  sII: 671.6,
} as const;

export function lineColor(nm: number): Vector3 {
  const [r, g, b] = wavelengthRGB(nm);
  return new Vector3(r, g, b);
}

export const luminanceWeights = vec3(0.2126, 0.7152, 0.0722);
export const one = float(1);
