// Guided narration behaviour: shows the caption scheduled for the current progress, keeps the clock and the stage
// label current, and announces stage changes politely. All DOM writes are batched to one rAF.

import { $chapterId, $progress, $sceneInfo, $time } from '../state/store.ts';
import type { Accuracy } from '../scenes/types.ts';
import { createGlobals, globalsAt } from '../physics/cosmology.ts';
import { num, plainWhen, sci } from '../time/format.ts';
import { CHAPTERS } from '../time/chapters.ts';
import { ACCURACY_LABEL } from '../data/site.ts';
import { supHtml } from '../lib/sup.ts';
import { HERO_END, captionAt } from './schedule.ts';

/** From the solar system on, the clock counts back from today. */
const FIRST_LOOKBACK_CHAPTER = CHAPTERS.findIndex((c) => c.id === 'solarSystem');

function fmtTemp(T: number): string {
  if (T >= 1e6) return `${sci(T)} K`;
  if (T >= 100) return `${num(T, 3)} K`;
  return `${T.toFixed(1)} K`;
}

export function initNarration(root: HTMLElement): void {
  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const titles = JSON.parse(root.dataset.titles ?? '[]') as string[];
  const caps = [...root.querySelectorAll<HTMLElement>('[data-cap]')];
  const starts = Float64Array.from(caps, (c) => Number(c.dataset.start));
  const bar = q<HTMLElement>('[data-bar]');
  const stageNum = q<HTMLElement>('[data-stage-num]');
  const stageName = q<HTMLElement>('[data-stage-name]');
  const accChip = q<HTMLElement>('[data-acc-chip]');
  const accLabel = q<HTMLElement>('[data-acc-label]');
  const when = q<HTMLElement>('[data-when]');
  const phys = q<HTMLElement>('[data-phys]');
  const live = q<HTMLElement>('[data-live]');
  const total = String(CHAPTERS.length).padStart(2, '0');

  const g = createGlobals();
  let current = -1;
  let lastChapter = -1;
  let lastWhen = '';
  let pending = false;

  const draw = () => {
    pending = false;
    const p = $progress.get();
    const s = $time.get();
    root.classList.toggle('is-hero', p < HERO_END * 0.6);
    bar.style.setProperty('--p', String(p));

    const idx = p < HERO_END * 0.6 ? -1 : captionAt(starts, p);
    if (idx !== current) {
      caps[current]?.classList.remove('is-on');
      caps[idx]?.classList.add('is-on');
      current = idx;
    }

    if (s.chapterIndex !== lastChapter) {
      const first = lastChapter === -1;
      lastChapter = s.chapterIndex;
      stageNum.textContent = `${String(s.chapterIndex + 1).padStart(2, '0')} / ${total}`;
      stageName.textContent = titles[s.chapterIndex] ?? '';
      if (!first) {
        const c = CHAPTERS[s.chapterIndex]!;
        const late = s.chapterIndex >= FIRST_LOOKBACK_CHAPTER;
        const at = plainWhen(c.tStart, { lookback: late, lookbackSeconds: c.lookbackStart });
        live.textContent = `Stage ${s.chapterIndex + 1} of ${CHAPTERS.length}: ${titles[s.chapterIndex] ?? ''}. ${at}.`;
      }
    }

    const late = s.chapterIndex >= FIRST_LOOKBACK_CHAPTER;
    const w = plainWhen(s.t, { lookback: late, lookbackSeconds: s.lookback });
    if (w !== lastWhen) {
      lastWhen = w;
      when.innerHTML = supHtml(w);
      globalsAt(s.t, g);
      phys.innerHTML = supHtml(`Temperature ${fmtTemp(g.T)}`);
    }
  };
  const schedule = () => {
    if (!pending) {
      pending = true;
      requestAnimationFrame(draw);
    }
  };
  $progress.subscribe(schedule);

  // Honesty: the stage chip says how sure we are about the current stage's scene, the intro card what it
  // exaggerates. Scenes publish their info once live; remember it so the chip never shows the outgoing scene.
  const infos = new Map<string, { accuracy: Accuracy; accuracyNote: string }>();
  const showChip = () => {
    const info = infos.get(CHAPTERS[$time.get().chapterIndex]!.sceneId);
    accChip.hidden = !info;
    if (!info) return;
    accChip.dataset.acc = info.accuracy;
    accLabel.textContent = ACCURACY_LABEL[info.accuracy];
  };
  $sceneInfo.subscribe((info) => {
    if (!info) return;
    infos.set(info.sceneId, info);
    showChip();
    root.querySelectorAll<HTMLElement>(`[data-cap-note][data-scene="${info.sceneId}"]`).forEach((n) => {
      n.hidden = false;
      n.dataset.acc = info.accuracy;
      n.innerHTML = `<b>${ACCURACY_LABEL[info.accuracy]}.</b> ${supHtml(info.accuracyNote)}`;
    });
  });
  $chapterId.subscribe(showChip);
}
