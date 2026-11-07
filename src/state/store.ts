// Shared state (nanostores). The single source of truth is $progress → t (HANDOFF §3, §5).

import { atom, computed, map, onMount, type ReadableAtom } from 'nanostores';
import { progressToTime } from '../time/chapters.ts';
import type { QualityTier, TierName } from '../render/quality.ts';
import type { Accuracy } from '../scenes/types.ts';

/** 0–1 page scroll through the chapters. */
export const $progress = atom(0);

export interface TimeState {
  t: number;
  /** Seconds before the present (precise near now). */
  lookback: number;
  chapterId: string;
  chapterIndex: number;
  sceneId: string;
  local: number;
}

export const $time: ReadableAtom<TimeState> = computed($progress, (p) => {
  const tp = progressToTime(p);
  return {
    t: tp.t,
    lookback: tp.lookback,
    chapterId: tp.chapter.id,
    chapterIndex: tp.chapterIndex,
    sceneId: tp.chapter.sceneId,
    local: tp.local,
  };
});

/** Chapter id only; changes rarely (use for announcements and HUD switching). */
export const $chapterId: ReadableAtom<string> = computed($time, (s) => s.chapterId);

export const $quality = atom<QualityTier | null>(null);
/** User override from the nav ('auto' lets the renderer choose and drop under load). */
export const $qualityOverride = atom<'auto' | TierName>('auto');

function mediaAtom(query: string): ReadableAtom<boolean> {
  const a = atom(false);
  onMount(a, () => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia(query);
    a.set(mq.matches);
    const on = (e: MediaQueryListEvent) => a.set(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });
  return a;
}

export const $reducedMotion: ReadableAtom<boolean> = mediaAtom('(prefers-reduced-motion: reduce)');

export type RendererStatus = 'booting' | 'ready' | 'fallback' | 'error';
export const $rendererStatus = atom<RendererStatus>('booting');

/** Accuracy badge of the scene on screen, published by the scene manager. */
export const $sceneInfo = atom<{ sceneId: string; accuracy: Accuracy; accuracyNote: string; colourMapped: boolean } | null>(
  null,
);

/** Per-scene load status (dev overlay and fallbacks). */
export const $sceneStatus = map<Record<string, 'loading' | 'ready' | 'failed'>>({});

/** Frame statistics (dev only). */
export const $stats = atom({ fps: 0, frameMs: 0, geometries: 0, textures: 0, programs: 0 });
