// Timeline rail behaviour: marker, readout, jumps, announcements, quality control (HANDOFF §11.2).

import { $progress, $quality, $qualityOverride, $sceneInfo, $time } from '../state/store.ts';
import { getDriver } from '../scroll/driver.ts';
import { createGlobals, globalsAt } from '../physics/cosmology.ts';
import { formatDuration, formatLookback, num, sci } from '../time/format.ts';
import { CHAPTERS } from '../time/chapters.ts';
import { ACCURACY_LABEL } from '../data/site.ts';
/** From the solar system on, the readout counts back from today. */
const FIRST_LOOKBACK_CHAPTER = CHAPTERS.findIndex((c) => c.id === 'solarSystem');

function fmtTemp(T: number): string {
  if (T >= 1e6) return `${sci(T)} K`;
  if (T >= 100) return `${num(T, 3)} K`;
  return `${T.toFixed(2)} K`;
}
function fmtZ(z: number): string {
  if (z > 1e5) return sci(z);
  if (z >= 10) return num(z, 3);
  return z.toFixed(2);
}

export function initTimelineNav(root: HTMLElement): void {
  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel);
  const strip = q<HTMLElement>('[data-strip]')!;
  const marker = q<HTMLElement>('[data-marker]')!;
  const when = q<HTMLElement>('[data-when]')!;
  const chapterTitle = q<HTMLElement>('[data-chapter-title]')!;
  const phys = q<HTMLElement>('[data-phys]')!;
  const badge = q<HTMLElement>('[data-badge]')!;
  const badgeLabel = q<HTMLElement>('[data-badge-label]')!;
  const accNote = q<HTMLElement>('[data-acc-note]')!;
  const mapped = q<HTMLElement>('[data-mapped]')!;
  const live = q<HTMLElement>('[data-live]')!;
  const qualitySel = q<HTMLSelectElement>('[data-quality]')!;
  const qualityStatus = q<HTMLElement>('[data-quality-status]')!;
  const chapterBtns = new Map<string, HTMLElement>();
  root.querySelectorAll<HTMLElement>('[data-chapter-btn]').forEach((b) => chapterBtns.set(b.dataset.chapterBtn!, b));
  const titles = new Map<string, string>();
  chapterBtns.forEach((b, id) => titles.set(id, b.querySelector('.label')?.textContent ?? id));

  // Jumps.
  root.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-goto]');
    if (!btn) return;
    const p = Number(btn.dataset.goto);
    getDriver()?.scrollToProgress(p);
  });

  // Marker + readout, batched to one rAF.
  const g = createGlobals();
  let pending = false;
  const mobile = matchMedia('(max-width: 767px)');
  const draw = () => {
    pending = false;
    const s = $time.get();
    marker.style.setProperty('--mp', String($progress.get()));
    const late = s.chapterIndex >= FIRST_LOOKBACK_CHAPTER;
    when.textContent = late ? formatLookback(s.lookback) : formatDuration(s.t, 'long');
    globalsAt(s.t, g);
    const zPart = g.epoch === 'friedmann' ? `z ${fmtZ(g.z)}` : g.epoch === 'inflation' ? 'inflating' : 'before inflation';
    phys.textContent = `T ${fmtTemp(g.T)} · ${zPart}`;
    if (mobile.matches) {
      const track = strip.firstElementChild as HTMLElement;
      const x = track.offsetLeft + $progress.get() * track.offsetWidth - strip.clientWidth / 2;
      strip.scrollLeft = x;
    }
  };
  const schedule = () => {
    if (!pending) {
      pending = true;
      requestAnimationFrame(draw);
    }
  };
  $progress.subscribe(schedule);

  // Chapter changes: title, current tick, polite announcement (chapter changes only).
  let lastChapter = '';
  $time.subscribe((s) => {
    if (s.chapterId === lastChapter) return;
    const first = lastChapter === '';
    lastChapter = s.chapterId;
    const title = titles.get(s.chapterId) ?? s.chapterId;
    chapterTitle.textContent = title;
    chapterBtns.forEach((b, id) => b.setAttribute('aria-current', String(id === s.chapterId)));
    if (!first) {
      const late = s.chapterIndex >= FIRST_LOOKBACK_CHAPTER;
      const c = CHAPTERS[s.chapterIndex]!;
      const at = late ? formatLookback(c.lookbackStart) : `${formatDuration(c.tStart, 'long')} after the Big Bang`;
      live.textContent = `Chapter ${s.chapterIndex + 1} of ${CHAPTERS.length}: ${title}. ${at}.`;
    }
  });

  $sceneInfo.subscribe((info) => {
    if (!info) return;
    badge.dataset.acc = info.accuracy;
    badgeLabel.textContent = ACCURACY_LABEL[info.accuracy];
    accNote.textContent = info.accuracyNote;
    mapped.hidden = !info.colourMapped;
  });

  // Quality control.
  qualitySel.value = $qualityOverride.get();
  qualitySel.addEventListener('change', () => $qualityOverride.set(qualitySel.value as 'auto' | 'low' | 'medium' | 'high'));
  $quality.subscribe((t) => {
    if (!t) return;
    qualityStatus.textContent = `${t.auto ? 'auto · ' : ''}${t.name} · ${t.backend === 'webgpu' ? 'WebGPU' : 'WebGL 2'}`;
  });
}
