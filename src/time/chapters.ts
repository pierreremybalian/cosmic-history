// Chapter table and the piecewise scroll ↔ time mapping (HANDOFF §7).

import { GYR_S, KYR_S, MYR_S, T_PLANCK_S, YEAR_S } from '../physics/constants.ts';
import { AGE_SECONDS } from '../physics/cosmology.ts';
import { clamp } from '../physics/interp.ts';

export type TimeMap = 'log' | 'linear' | 'lookback';
export type TransitionKind = 'dissolve' | 'zoom' | 'stretch';

export interface Chapter {
  id: string;
  sceneId: string;
  tStart: number; // seconds
  tEnd: number; // seconds
  timeMap: TimeMap;
  scrollWeight: number;
  transitionIn: TransitionKind;
  transitionSpan: number; // 0–1 fraction of this chapter used to blend in
  /** Lookback (s) at the chapter edges; set for every chapter, authoritative for 'lookback' maps. */
  lookbackStart: number;
  lookbackEnd: number;
}

/**
 * The lookback map is log-uniform in (L + LOOKBACK_FLOOR) so the final chapter can end at L = 0.
 * For L ≫ 10 kyr it is the plain log map of §7 (DECISIONS.md).
 */
export const LOOKBACK_FLOOR_S = 1e4 * YEAR_S;

const DEFAULT_SPAN = 0.12;

type Row = [
  id: string,
  sceneId: string,
  start: number | { ago: number },
  end: number | { ago: number },
  map: TimeMap,
  weight: number,
  transition: TransitionKind,
];

const ago = (seconds: number) => ({ ago: seconds });

// §7.1. "ago" values convert with the computed AGE_SECONDS so the chapters tile time exactly.
const ROWS: Row[] = [
  ['planck', 'planck', T_PLANCK_S, 1e-36, 'log', 6, 'dissolve'],
  ['inflation', 'inflation', 1e-36, 1e-32, 'log', 8, 'stretch'],
  ['qgp', 'qgp', 1e-32, 1e-6, 'log', 8, 'dissolve'],
  ['hadrons', 'hadrons', 1e-6, 1, 'log', 6, 'zoom'],
  ['leptons', 'leptons', 1, 180, 'log', 4, 'dissolve'],
  ['bbn', 'bbn', 180, 1200, 'log', 5, 'zoom'],
  // The photon era is split so recombination (z ≈ 1400 → 1000) gets real scroll; both show one scene.
  ['photon', 'recombination', 1200, 250 * KYR_S, 'log', 6, 'dissolve'],
  ['recombination', 'recombination', 250 * KYR_S, 380 * KYR_S, 'linear', 6, 'dissolve'],
  ['darkAges', 'darkAges', 380 * KYR_S, 150 * MYR_S, 'log', 7, 'dissolve'],
  ['firstStars', 'firstStars', 150 * MYR_S, 500 * MYR_S, 'linear', 7, 'zoom'],
  ['reionization', 'reionization', 500 * MYR_S, 1 * GYR_S, 'linear', 5, 'dissolve'],
  ['cosmicNoon', 'cosmicNoon', 1 * GYR_S, 7.8 * GYR_S, 'linear', 7, 'dissolve'],
  ['darkEnergy', 'darkEnergy', 7.8 * GYR_S, ago(4.6 * GYR_S), 'linear', 4, 'stretch'],
  ['solarSystem', 'solarSystem', ago(4.6 * GYR_S), ago(4.4 * GYR_S), 'lookback', 6, 'zoom'],
  // Life is split so the first 3.9 Gyr (oceans → eukaryotes) are not squeezed by the log lookback map.
  ['life', 'life', ago(4.4 * GYR_S), ago(540 * MYR_S), 'linear', 6, 'dissolve'],
  ['complexLife', 'life', ago(540 * MYR_S), ago(10 * KYR_S), 'lookback', 7, 'dissolve'],
  ['now', 'now', ago(10 * KYR_S), ago(0), 'lookback', 3, 'zoom'],
];

const toT = (v: number | { ago: number }) => (typeof v === 'number' ? v : AGE_SECONDS - v.ago);
const toL = (v: number | { ago: number }) => (typeof v === 'number' ? AGE_SECONDS - v : v.ago);

export const CHAPTERS: readonly Chapter[] = ROWS.map(([id, sceneId, s, e, timeMap, scrollWeight, transitionIn]) => ({
  id,
  sceneId,
  tStart: toT(s),
  tEnd: toT(e),
  timeMap,
  scrollWeight,
  transitionIn,
  transitionSpan: DEFAULT_SPAN,
  lookbackStart: toL(s),
  lookbackEnd: toL(e),
}));

export const TOTAL_WEIGHT = CHAPTERS.reduce((s, c) => s + c.scrollWeight, 0);

/** Progress at which each chapter starts; length = CHAPTERS.length + 1 (last entry = 1). */
export const CHAPTER_STARTS: readonly number[] = (() => {
  const out = [0];
  let acc = 0;
  for (const c of CHAPTERS) {
    acc += c.scrollWeight;
    out.push(acc / TOTAL_WEIGHT);
  }
  out[out.length - 1] = 1;
  return out;
})();

export function chapterById(id: string): Chapter | undefined {
  return CHAPTERS.find((c) => c.id === id);
}

export function chapterIndex(id: string): number {
  return CHAPTERS.findIndex((c) => c.id === id);
}

/** Lookback (s) at `local` ∈ [0,1] within a lookback chapter. */
function lookbackAtLocal(c: Chapter, local: number): number {
  const a = Math.log(c.lookbackStart + LOOKBACK_FLOOR_S);
  const b = Math.log(c.lookbackEnd + LOOKBACK_FLOOR_S);
  return Math.exp(a + (b - a) * local) - LOOKBACK_FLOOR_S;
}

function localAtLookback(c: Chapter, L: number): number {
  const a = Math.log(c.lookbackStart + LOOKBACK_FLOOR_S);
  const b = Math.log(c.lookbackEnd + LOOKBACK_FLOOR_S);
  return (Math.log(L + LOOKBACK_FLOOR_S) - a) / (b - a);
}

export interface TimePoint {
  t: number;
  /** Seconds before the present; computed directly in lookback chapters (no cancellation). */
  lookback: number;
  chapter: Chapter;
  chapterIndex: number;
  local: number;
}

/** t and lookback at `local` within chapter `c`. */
export function timeInChapter(c: Chapter, local: number): { t: number; lookback: number } {
  const s = clamp(local, 0, 1);
  if (c.timeMap === 'lookback') {
    const L = lookbackAtLocal(c, s);
    return { t: AGE_SECONDS - L, lookback: L };
  }
  const t =
    c.timeMap === 'log'
      ? Math.pow(10, Math.log10(c.tStart) + (Math.log10(c.tEnd) - Math.log10(c.tStart)) * s)
      : c.tStart + (c.tEnd - c.tStart) * s;
  return { t, lookback: AGE_SECONDS - t };
}

export function progressToTime(p: number, out?: TimePoint): TimePoint {
  const pc = clamp(p, 0, 1);
  let i = 0;
  while (i < CHAPTERS.length - 1 && pc >= CHAPTER_STARTS[i + 1]!) i++;
  const chapter = CHAPTERS[i]!;
  const p0 = CHAPTER_STARTS[i]!;
  const p1 = CHAPTER_STARTS[i + 1]!;
  const local = clamp((pc - p0) / (p1 - p0), 0, 1);
  const { t, lookback } = timeInChapter(chapter, local);
  if (out) {
    out.t = t;
    out.lookback = lookback;
    out.chapter = chapter;
    out.chapterIndex = i;
    out.local = local;
    return out;
  }
  return { t, lookback, chapter, chapterIndex: i, local };
}

function localInChapter(c: Chapter, t: number): number {
  if (c.timeMap === 'lookback') return localAtLookback(c, AGE_SECONDS - t);
  if (c.timeMap === 'log')
    return (Math.log10(t) - Math.log10(c.tStart)) / (Math.log10(c.tEnd) - Math.log10(c.tStart));
  return (t - c.tStart) / (c.tEnd - c.tStart);
}

function progressAt(i: number, local: number): number {
  const p0 = CHAPTER_STARTS[i]!;
  const p1 = CHAPTER_STARTS[i + 1]!;
  return p0 + (p1 - p0) * clamp(local, 0, 1);
}

export function timeToProgress(t: number): number {
  if (!(t > CHAPTERS[0]!.tStart)) return 0;
  if (t >= AGE_SECONDS) return 1;
  for (let i = 0; i < CHAPTERS.length; i++) {
    const c = CHAPTERS[i]!;
    if (t <= c.tEnd || i === CHAPTERS.length - 1) return progressAt(i, localInChapter(c, t));
  }
  return 1;
}

/** Precise inverse for late times: progress at a lookback (seconds before now). */
export function lookbackToProgress(L: number): number {
  if (L <= 0) return 1;
  const t = AGE_SECONDS - L;
  for (let i = 0; i < CHAPTERS.length; i++) {
    const c = CHAPTERS[i]!;
    if (c.timeMap === 'lookback' && L <= c.lookbackStart && L >= c.lookbackEnd) {
      return progressAt(i, localAtLookback(c, L));
    }
  }
  return timeToProgress(t);
}
