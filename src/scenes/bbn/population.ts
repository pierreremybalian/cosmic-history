// BBN population (CPU, built once): which nucleons are free, which pair into deuterium, which end in helium-4,
// lithium-7 or decay — and when. Every schedule is the inverse of a curve from abundancesAt(t), so the number of
// visible nucleons in each state at time t matches the HUD's mass fractions (to within one nucleon).

import { abundancesAt, type Abundances } from '../../physics/abundances.ts';
import { mulberry32 } from '../../shared/math.ts';

export const Kind = { Proton: 0, Neutron: 1 } as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

export const Role = {
  /** Free proton for the whole chapter. */
  Free: 0,
  /** Member of a helium-4 nucleus (2p + 2n), forms via two deuterons. */
  Helium: 1,
  /** Member of the single lithium-7 token nucleus (3p + 4n). */
  Lithium: 2,
  /** Member of the single leftover-deuterium token (1p + 1n). */
  Deuteron: 3,
  /** Free neutron that β-decays into a proton (n → p + e⁻ + ν̄). */
  Decayer: 4,
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export interface Nucleon {
  kind: Kind;
  role: Role;
  /** Group index (helium / lithium / deuteron), −1 otherwise. */
  group: number;
  /** Index inside the group (0–3 helium: p,n,p,n; 0–6 lithium; 0–1 deuteron). */
  slot: number;
  /** Home position in the free state (world units, before expansion). */
  hx: number;
  hy: number;
  hz: number;
  /** Random phases for thermal motion. */
  ph: [number, number, number];
  /** Random frequencies for thermal motion. */
  fr: [number, number, number];
  /** log10 t of β-decay (decayers only). */
  logDecay: number;
}

export interface Group {
  kind: 'helium' | 'lithium' | 'deuteron';
  /** Centre of the bound nucleus (world units, before expansion). */
  cx: number;
  cy: number;
  cz: number;
  /** log10 t when its deuterons bond (helium) / the nucleus forms (lithium, deuteron). */
  logBond: number;
  /** log10 t when the helium nucleus forms (helium only). */
  logForm: number;
  /** Tumble axis and rate. */
  ax: number;
  ay: number;
  az: number;
  spin: number;
  /** Phase for the transient (bottleneck) bonding of its p–n pairs. */
  flirt: number;
  members: number[];
}

export interface Population {
  nucleons: Nucleon[];
  groups: Group[];
  helium: number;
  decayers: number;
}

export interface PopulationOptions {
  count: number;
  tStart: number;
  tEnd: number;
  /** Radius of the ball the nucleons fill, world units. */
  radius: number;
  /** Groups whose helium forms between these log10 t are placed in front of the camera (hero zone). */
  heroLogT: [number, number];
  heroCentre: [number, number, number];
  heroRadius: number;
  /** At most this many helium groups are placed in the hero zone. */
  heroCount: number;
  /** Lithium forms when its abundance reaches this fraction of the chapter-end value. */
  lithiumAt: number;
  seed: number;
  /** Keep free homes and group centres at least `clear` away from this segment (the camera path). */
  avoid: { a: [number, number, number]; b: [number, number, number]; clear: number };
}

function distToSegment(p: [number, number, number], a: [number, number, number], b: [number, number, number]): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / (abx * abx + aby * aby + abz * abz || 1)));
  return Math.hypot(p[0] - a[0] - abx * t, p[1] - a[1] - aby * t, p[2] - a[2] - abz * t);
}

/** Inverse of a monotone cumulative count c(log t) sampled on [u0, u1]: the log t at which c crosses k + 0.5. */
function crossings(c: (u: number) => number, n: number, u0: number, u1: number, steps = 4000): number[] {
  const out = new Array<number>(n).fill(u1);
  let k = 0;
  let prevU = u0;
  let prevC = c(u0);
  let run = prevC;
  while (k < n && prevC >= k + 0.5) out[k++] = u0;
  for (let i = 1; i <= steps && k < n; i++) {
    const u = u0 + ((u1 - u0) * i) / steps;
    run = Math.max(run, c(u));
    while (k < n && run >= k + 0.5) {
      const f = run > prevC ? (k + 0.5 - prevC) / (run - prevC) : 1;
      out[k++] = prevU + (u - prevU) * Math.min(1, Math.max(0, f));
    }
    prevU = u;
    prevC = run;
  }
  return out;
}

export function buildPopulation(o: PopulationOptions): Population {
  const rand = mulberry32(o.seed);
  const ab: Abundances = abundancesAt(o.tStart);
  const a0 = { ...ab };
  const a1 = { ...abundancesAt(o.tEnd) };
  const N = o.count;
  const u0 = Math.log10(o.tStart);
  const u1 = Math.log10(o.tEnd);

  // Counts from the measured abundances.
  const helium = Math.round((N * a1.helium4) / 4);
  const neutrons0 = Math.round(N * (a0.neutrons + a0.deuterium / 2));
  const boundFinal = 2 * helium + 4 + 1; // helium + lithium token + deuteron token
  const decayers = Math.max(0, neutrons0 - boundFinal);

  // Schedules (log10 t), from the abundance curves.
  const heCount = (u: number) => (N * abundancesAt(10 ** u, ab).helium4) / 4;
  const bondCount = (u: number) => {
    const a = abundancesAt(10 ** u, ab);
    return (N * (a.helium4 + a.deuterium)) / 4;
  };
  const logForm = crossings(heCount, helium, u0, u1);
  const logBond = crossings(bondCount, helium, u0, u1).map((b, j) => Math.min(b, logForm[j]!));
  const decayed = (u: number) => {
    const a = abundancesAt(10 ** u, ab);
    return neutrons0 - N * (a.neutrons + a.deuterium / 2 + a.helium4 / 2 + (a.lithium7 * 4) / 7);
  };
  const logDecay = crossings(decayed, decayers, u0, u1);
  const liTarget = a1.lithium7 * o.lithiumAt;
  let logLi = u1;
  for (let i = 0; i <= 2000; i++) {
    const u = u0 + ((u1 - u0) * i) / 2000;
    if (abundancesAt(10 ** u, ab).lithium7 >= liTarget) {
      logLi = u;
      break;
    }
  }
  // The leftover deuteron bonds when the bottleneck breaks (first deuterium that survives).
  const logD = logBond[0] ?? u0;

  const ball = (r: number): [number, number, number] => {
    for (;;) {
      const x = rand() * 2 - 1;
      const y = rand() * 2 - 1;
      const z = rand() * 2 - 1;
      if (x * x + y * y + z * z <= 1) return [x * r, y * r, z * r];
    }
  };
  /** A point in the ball that keeps clear of the camera path. */
  const place = (r: number): [number, number, number] => {
    for (let k = 0; k < 64; k++) {
      const p = ball(r);
      if (distToSegment(p, o.avoid.a, o.avoid.b) >= o.avoid.clear) return p;
    }
    return ball(r);
  };
  const nucleons: Nucleon[] = [];
  const groups: Group[] = [];
  const mk = (kind: Kind, role: Role, group: number, slot: number, h: [number, number, number]): number => {
    nucleons.push({
      kind,
      role,
      group,
      slot,
      hx: h[0],
      hy: h[1],
      hz: h[2],
      ph: [rand() * 6.283, rand() * 6.283, rand() * 6.283],
      fr: [0.6 + rand() * 0.9, 0.6 + rand() * 0.9, 0.6 + rand() * 0.9],
      logDecay: u1 + 1,
    });
    return nucleons.length - 1;
  };
  const addGroup = (kind: Group['kind'], centre: [number, number, number], lb: number, lf: number, members: Kind[]) => {
    const axv = ball(1);
    const al = Math.hypot(...axv) || 1;
    const g: Group = {
      kind,
      cx: centre[0],
      cy: centre[1],
      cz: centre[2],
      logBond: lb,
      logForm: lf,
      ax: axv[0] / al,
      ay: axv[1] / al,
      az: axv[2] / al,
      spin: 0.25 + rand() * 0.35,
      flirt: rand(),
      members: [],
    };
    const gi = groups.length;
    const role = kind === 'helium' ? Role.Helium : kind === 'lithium' ? Role.Lithium : Role.Deuteron;
    members.forEach((k, slot) => {
      // Free homes scattered around the centre so the members visibly come together.
      const off = ball(1.25);
      g.members.push(mk(k, role, gi, slot, [centre[0] + off[0], centre[1] + off[1], centre[2] + off[2]]));
    });
    groups.push(g);
  };

  const [hu0, hu1] = o.heroLogT;
  const inHero = logForm.filter((f) => f >= hu0 && f <= hu1).length;
  let heroes = 0;
  for (let j = 0; j < helium; j++) {
    const hero = heroes < o.heroCount && logForm[j]! >= hu0 && logForm[j]! <= hu1 && rand() < (o.heroCount * 1.5) / Math.max(1, inHero);
    if (hero) heroes++;
    const c = hero
      ? ((): [number, number, number] => {
          const b = ball(o.heroRadius);
          return [o.heroCentre[0] + b[0], o.heroCentre[1] + b[1], o.heroCentre[2] + b[2]];
        })()
      : place(o.radius * 0.92);
    addGroup('helium', c, logBond[j]!, logForm[j]!, [Kind.Proton, Kind.Neutron, Kind.Proton, Kind.Neutron]);
  }
  // Tokens near the camera so they can be found: lithium-7 (3p + 4n) and one leftover deuteron.
  {
    const b = ball(o.heroRadius * 0.6);
    addGroup('lithium', [o.heroCentre[0] + b[0] + 0.6, o.heroCentre[1] + b[1] - 0.3, o.heroCentre[2] + b[2]], logLi, logLi, [
      Kind.Proton,
      Kind.Neutron,
      Kind.Proton,
      Kind.Neutron,
      Kind.Proton,
      Kind.Neutron,
      Kind.Neutron,
    ]);
    const d = ball(o.heroRadius * 0.6);
    addGroup('deuteron', [o.heroCentre[0] + d[0] - 0.8, o.heroCentre[1] + d[1] + 0.4, o.heroCentre[2] + d[2]], logD, logD, [
      Kind.Proton,
      Kind.Neutron,
    ]);
  }
  for (let k = 0; k < decayers; k++) {
    const i = mk(Kind.Neutron, Role.Decayer, -1, 0, place(o.radius));
    nucleons[i]!.logDecay = logDecay[k]!;
  }
  while (nucleons.length < N) mk(Kind.Proton, Role.Free, -1, 0, place(o.radius));
  return { nucleons, groups, helium, decayers };
}

/** Bound-nucleus member offsets (unit = nucleon radius), in a compact, touching arrangement. */
export const SLOTS: Record<Group['kind'], [number, number, number][]> = {
  // Tetrahedron of touching spheres (edge = 2 r · 0.92).
  helium: [
    [1, 1, 1],
    [-1, -1, 1],
    [-1, 1, -1],
    [1, -1, -1],
  ].map(([x, y, z]) => [(x! * 0.92) / Math.SQRT2, (y! * 0.92) / Math.SQRT2, (z! * 0.92) / Math.SQRT2]) as [
    number,
    number,
    number,
  ][],
  // Lithium-7: a compact cluster (pentagonal bipyramid).
  lithium: [
    [0, 1.25, 0],
    [0, -1.25, 0],
    ...[0, 1, 2, 3, 4].map((i): [number, number, number] => [
      Math.cos((i * 2 * Math.PI) / 5) * 1.35,
      0,
      Math.sin((i * 2 * Math.PI) / 5) * 1.35,
    ]),
  ],
  deuteron: [
    [-0.92, 0, 0],
    [0.92, 0, 0],
  ],
};
