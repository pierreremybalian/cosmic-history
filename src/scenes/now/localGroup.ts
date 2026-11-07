// Local Group members for `now`: Galactic coordinates and heliocentric distances, rounded from the
// McConnachie (2012, AJ 144, 4) catalogue. Radii are visual (optical extent), in kpc.

export type LGType = 'spiral' | 'irregular' | 'dE' | 'dSph' | 'dIrr';

export interface LGMember {
  name: string;
  l: number; // deg
  b: number; // deg
  d: number; // kpc
  type: LGType;
  r: number; // kpc
}

export const LOCAL_GROUP: readonly LGMember[] = [
  { name: 'LMC', l: 280.47, b: -32.89, d: 50, type: 'irregular', r: 4.5 },
  { name: 'SMC', l: 302.81, b: -44.33, d: 61, type: 'irregular', r: 2.6 },
  { name: 'M33', l: 133.61, b: -31.33, d: 809, type: 'spiral', r: 9 },
  { name: 'M32', l: 121.15, b: -21.98, d: 785, type: 'dE', r: 1.2 },
  { name: 'NGC 205', l: 120.72, b: -21.14, d: 824, type: 'dE', r: 2.5 },
  { name: 'NGC 185', l: 120.79, b: -14.48, d: 617, type: 'dE', r: 1.6 },
  { name: 'NGC 147', l: 119.82, b: -14.25, d: 676, type: 'dE', r: 1.8 },
  { name: 'IC 10', l: 118.97, b: -3.33, d: 794, type: 'dIrr', r: 1.2 },
  { name: 'IC 1613', l: 129.73, b: -60.56, d: 755, type: 'dIrr', r: 1.6 },
  { name: 'NGC 6822', l: 25.34, b: -18.4, d: 459, type: 'dIrr', r: 1.6 },
  { name: 'WLM', l: 75.86, b: -73.62, d: 933, type: 'dIrr', r: 1.4 },
  { name: 'Leo A', l: 196.9, b: 52.42, d: 798, type: 'dIrr', r: 0.8 },
  { name: 'Pegasus dIrr', l: 94.77, b: -43.55, d: 920, type: 'dIrr', r: 0.9 },
  { name: 'Sag DIG', l: 21.06, b: -16.29, d: 1067, type: 'dIrr', r: 0.6 },
  { name: 'Aquarius', l: 34.05, b: -31.35, d: 1072, type: 'dIrr', r: 0.5 },
  { name: 'Phoenix', l: 272.16, b: -68.95, d: 415, type: 'dIrr', r: 0.5 },
  { name: 'Sagittarius dSph', l: 5.57, b: -14.17, d: 26, type: 'dSph', r: 2.0 },
  { name: 'Draco', l: 86.37, b: 34.72, d: 76, type: 'dSph', r: 0.5 },
  { name: 'Ursa Minor', l: 104.97, b: 44.8, d: 76, type: 'dSph', r: 0.5 },
  { name: 'Sculptor', l: 287.53, b: -83.16, d: 86, type: 'dSph', r: 0.6 },
  { name: 'Sextans', l: 243.5, b: 42.27, d: 86, type: 'dSph', r: 0.7 },
  { name: 'Carina', l: 260.11, b: -22.22, d: 105, type: 'dSph', r: 0.5 },
  { name: 'Fornax', l: 237.1, b: -65.65, d: 147, type: 'dSph', r: 1.0 },
  { name: 'Leo I', l: 225.99, b: 49.11, d: 254, type: 'dSph', r: 0.5 },
  { name: 'Leo II', l: 220.17, b: 67.23, d: 233, type: 'dSph', r: 0.3 },
  { name: 'Andromeda I', l: 121.69, b: -24.82, d: 727, type: 'dSph', r: 0.6 },
  { name: 'Andromeda II', l: 128.91, b: -29.15, d: 652, type: 'dSph', r: 0.9 },
  { name: 'Andromeda III', l: 119.31, b: -26.25, d: 748, type: 'dSph', r: 0.5 },
  { name: 'Cetus', l: 101.45, b: -72.85, d: 755, type: 'dSph', r: 0.6 },
  { name: 'Tucana', l: 322.91, b: -47.37, d: 887, type: 'dSph', r: 0.4 },
];

/** Andromeda (M31): J2000 position, distance and disk orientation (inclination, major-axis position angle). */
export const M31 = { raDeg: 10.6847, decDeg: 41.269, dKpc: 765, inclinationDeg: 77, paDeg: 38, radiusKpc: 24 } as const;
