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

/**
 * The Local Volume beyond the Local Group: bright members of the nearby groups (Galactic l, b in degrees,
 * distance in Mpc, rounded from the Updated Nearby Galaxy Catalog, Karachentsev et al. 2013) and the two nearest
 * clusters, drawn as a scatter of members around their centres.
 */
export interface LVMember {
  name: string;
  l: number;
  b: number;
  d: number; // Mpc
  type: 'spiral' | 'elliptical' | 'irregular';
  r: number; // kpc, visual
}

export const LOCAL_VOLUME: readonly LVMember[] = [
  { name: 'M81', l: 142.09, b: 40.9, d: 3.6, type: 'spiral', r: 18 },
  { name: 'M82', l: 141.41, b: 40.57, d: 3.6, type: 'irregular', r: 7 },
  { name: 'NGC 2403', l: 150.57, b: 29.19, d: 3.2, type: 'spiral', r: 10 },
  { name: 'IC 342', l: 138.17, b: 10.58, d: 3.3, type: 'spiral', r: 16 },
  { name: 'Maffei 1', l: 135.86, b: -0.55, d: 3.0, type: 'elliptical', r: 10 },
  { name: 'Maffei 2', l: 136.5, b: -0.33, d: 3.4, type: 'spiral', r: 10 },
  { name: 'Centaurus A', l: 309.52, b: 19.42, d: 3.8, type: 'elliptical', r: 16 },
  { name: 'M83', l: 314.58, b: 31.97, d: 4.7, type: 'spiral', r: 14 },
  { name: 'NGC 4945', l: 305.27, b: 13.34, d: 3.7, type: 'spiral', r: 12 },
  { name: 'NGC 253', l: 97.37, b: -87.96, d: 3.5, type: 'spiral', r: 14 },
  { name: 'NGC 300', l: 299.21, b: -79.42, d: 2.0, type: 'spiral', r: 8 },
  { name: 'NGC 55', l: 332.67, b: -75.74, d: 2.1, type: 'irregular', r: 8 },
  { name: 'NGC 247', l: 113.95, b: -83.56, d: 3.7, type: 'spiral', r: 9 },
  { name: 'M94', l: 123.36, b: 76.01, d: 4.7, type: 'spiral', r: 10 },
  { name: 'M101', l: 102.04, b: 59.77, d: 6.9, type: 'spiral', r: 25 },
  { name: 'M51', l: 104.85, b: 68.56, d: 8.6, type: 'spiral', r: 14 },
  { name: 'M64', l: 315.68, b: 84.42, d: 5.3, type: 'spiral', r: 9 },
  { name: 'M104', l: 298.46, b: 51.15, d: 9.6, type: 'spiral', r: 15 },
  { name: 'NGC 6946', l: 95.72, b: 11.67, d: 7.7, type: 'spiral', r: 12 },
];

export interface LVCluster {
  name: string;
  l: number;
  b: number;
  d: number; // Mpc
  members: number;
  radiusMpc: number;
}

/** Virgo (centred on M87) and Fornax (on NGC 1399). */
export const NEARBY_CLUSTERS: readonly LVCluster[] = [
  { name: 'Virgo', l: 283.78, b: 74.49, d: 16.5, members: 260, radiusMpc: 1.6 },
  { name: 'Fornax', l: 236.72, b: -53.64, d: 19.0, members: 70, radiusMpc: 0.7 },
];
