import { describe, expect, it } from 'vitest';
import events from '../../../public/data/events.json';
import eras from '../../../public/data/eras.json';
import { AGE_SECONDS } from '../../physics/cosmology.ts';
import { YEAR_S } from '../../physics/constants.ts';
import {
  CHAPTERS,
  CHAPTER_STARTS,
  lookbackToProgress,
  progressToTime,
  timeInChapter,
  timeToProgress,
} from '../chapters.ts';

describe('chapter table', () => {
  it('tiles time contiguously from the Planck time to now', () => {
    expect(CHAPTERS[0]!.tStart).toBeCloseTo(5.39e-44, 46);
    for (let i = 1; i < CHAPTERS.length; i++) {
      expect(CHAPTERS[i]!.tStart).toBe(CHAPTERS[i - 1]!.tEnd);
      expect(CHAPTERS[i]!.tEnd).toBeGreaterThan(CHAPTERS[i]!.tStart);
    }
    expect(CHAPTERS.at(-1)!.tEnd).toBe(AGE_SECONDS);
    expect(CHAPTERS.at(-1)!.lookbackEnd).toBe(0);
    expect(CHAPTER_STARTS[0]).toBe(0);
    expect(CHAPTER_STARTS.at(-1)).toBe(1);
  });

  it('dark energy chapter ends 4.6 Gyr ago', () => {
    const c = CHAPTERS.find((c) => c.id === 'darkEnergy')!;
    expect((AGE_SECONDS - c.tEnd) / YEAR_S / 1e9).toBeCloseTo(4.6, 6);
  });
});

describe('progress ↔ time', () => {
  it('is monotonic over the whole scroll', () => {
    let prevT = 0;
    let prevL = Infinity;
    for (let i = 0; i <= 20000; i++) {
      const tp = progressToTime(i / 20000);
      expect(tp.t).toBeGreaterThanOrEqual(prevT);
      expect(tp.lookback).toBeLessThanOrEqual(prevL);
      prevT = tp.t;
      prevL = tp.lookback;
    }
  });

  it('strictly increasing within every chapter', () => {
    for (const c of CHAPTERS) {
      let prev = -Infinity;
      for (let s = 0; s <= 1; s += 0.001) {
        const { t, lookback } = timeInChapter(c, s);
        const key = c.timeMap === 'lookback' ? -lookback : t;
        expect(key).toBeGreaterThan(prev);
        prev = key;
      }
    }
  });

  it('progressToTime and timeToProgress invert each other', () => {
    for (let i = 0; i <= 5000; i++) {
      const p = i / 5000;
      const { t, lookback, chapter } = progressToTime(p);
      const back = chapter.timeMap === 'lookback' ? lookbackToProgress(lookback) : timeToProgress(t);
      expect(Math.abs(back - p)).toBeLessThan(1e-9);
    }
  });

  it('timeToProgress inverts in the early chapters to 1e-12', () => {
    for (let lt = -43.2; lt < 13; lt += 0.37) {
      const t = Math.pow(10, lt);
      const r = progressToTime(timeToProgress(t)).t;
      expect(Math.abs(r / t - 1)).toBeLessThan(1e-12);
    }
  });

  it('chapter boundaries land on CHAPTER_STARTS', () => {
    CHAPTERS.forEach((c, i) => {
      expect(timeToProgress(c.tStart)).toBeCloseTo(CHAPTER_STARTS[i]!, 12);
      expect(progressToTime(CHAPTER_STARTS[i]!).chapter.id).toBe(c.id);
    });
  });

  it('every event and era maps inside [0,1]', () => {
    for (const e of events) {
      const p = e.lookback_years ? lookbackToProgress(e.lookback_years.best * YEAR_S) : timeToProgress(e.t_seconds.best);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    for (const e of eras) {
      const p0 = timeToProgress(Math.max(e.start_s, 1e-60));
      const p1 = timeToProgress(e.end_s);
      expect(p0).toBeGreaterThanOrEqual(0);
      expect(p1).toBeLessThanOrEqual(1);
      expect(p1).toBeGreaterThanOrEqual(p0);
    }
  });

  it('events land in the chapter whose scene shows them', () => {
    const where = (id: string) => {
      const e = events.find((x) => x.id === id)!;
      const p = e.lookback_years ? lookbackToProgress(e.lookback_years.best * YEAR_S) : timeToProgress(e.t_seconds.best);
      return progressToTime(p).chapter.id;
    };
    expect(where('higgs')).toBe('qgp');
    expect(where('confinement')).toBe('hadrons');
    expect(where('ee-annihilation')).toBe('leptons');
    expect(where('recombination')).toBe('recombination');
    expect(where('matter-domination')).toBe('photon');
    expect(where('first-stars')).toBe('firstStars');
    expect(where('sun-forms')).toBe('solarSystem');
    expect(where('great-oxidation')).toBe('life');
    expect(where('dinosaurs-extinct')).toBe('complexLife');
    expect(where('homo-sapiens')).toBe('complexLife');
  });
});
