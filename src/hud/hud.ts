// HUD logic: which card shows in which chapter, and live values from the physics modules.

import { $time } from '../state/store.ts';
import { abundancesAt, type Abundances } from '../physics/abundances.ts';
import { AGE_SECONDS, aAt, createGlobals, globalsAt } from '../physics/cosmology.ts';
import { madauDickinsonSFR } from '../physics/recombination.ts';
import { GYR_S } from '../physics/constants.ts';

/** chapterId → [card, local from, local to] */
const SHOW: Record<string, [string, number, number][]> = {
  bbn: [['bbn', 0.04, 0.98]],
  recombination: [['cmb', 0.8, 1]],
  cosmicNoon: [['sfr', 0.08, 0.96]],
  darkEnergy: [['omega', 0.05, 1]],
  now: [
    ['omega', 0, 0.55],
    ['cmb', 0.72, 1],
  ],
};

const pct = (x: number) => (x >= 0.1 ? `${(x * 100).toFixed(1)}%` : x >= 1e-3 ? `${(x * 100).toFixed(2)}%` : x.toExponential(1));

export function initHud(root: HTMLElement): void {
  const cards = new Map<string, HTMLElement>();
  root.querySelectorAll<HTMLElement>('[data-hud]').forEach((el) => cards.set(el.dataset.hud!, el));

  // SFR curve against cosmic time (built once).
  const path = root.querySelector<SVGPathElement>('[data-sfr-path]')!;
  const nowLine = root.querySelector<SVGLineElement>('[data-sfr-now]')!;
  const N = 160;
  let maxSfr = 0;
  const pts: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const t = (AGE_SECONDS * i) / N;
    const z = i === 0 ? 1e4 : 1 / aAt(t) - 1;
    const s = madauDickinsonSFR(z);
    maxSfr = Math.max(maxSfr, s);
    pts.push([(200 * i) / N, s]);
  }
  path.setAttribute('d', `M0,80 ${pts.map(([x, s]) => `L${x.toFixed(1)},${(80 - (s / maxSfr) * 74).toFixed(1)}`).join(' ')} L200,80 Z`);
  const peakT = pts.reduce((a, b) => (b[1] > a[1] ? b : a))[0] / 200;
  root.querySelector('[data-sfr-peak]')!.textContent = `peak ~${((peakT * AGE_SECONDS) / GYR_S).toFixed(1)} Gyr`;

  const ab: Abundances = abundancesAt(1);
  const bbnRows = new Map<string, { bar: HTMLElement; v: HTMLElement; log: boolean }>();
  root.querySelectorAll<HTMLElement>('[data-el]').forEach((li) =>
    bbnRows.set(li.dataset.el!, {
      bar: li.querySelector('i')!,
      v: li.querySelector('.v')!,
      log: li.querySelector('.bar')!.classList.contains('log'),
    }),
  );
  const g = createGlobals();
  const omBars = [...root.querySelectorAll<HTMLElement>('[data-om]')];
  const omVals = [...root.querySelectorAll<HTMLElement>('[data-omv]')];

  let pending = false;
  const draw = () => {
    pending = false;
    const s = $time.get();
    const wanted = new Set<string>();
    for (const [card, a, b] of SHOW[s.chapterId] ?? []) if (s.local >= a && s.local <= b) wanted.add(card);
    cards.forEach((el, id) => {
      const on = wanted.has(id);
      if (on && !el.classList.contains('is-on')) {
        el.classList.add('is-on');
        requestAnimationFrame(() => el.classList.add('is-visible'));
      } else if (!on && el.classList.contains('is-on')) {
        el.classList.remove('is-visible', 'is-on');
      }
    });
    if (wanted.has('bbn')) {
      abundancesAt(s.t, ab);
      for (const [k, row] of bbnRows) {
        const v = ab[k as keyof Abundances] as number;
        const w = row.log ? Math.max(0, (Math.log10(Math.max(v, 1e-12)) + 12) / 12) : v;
        row.bar.style.setProperty('--w', String(w));
        row.v.textContent = pct(v);
      }
    }
    if (wanted.has('sfr')) {
      nowLine.setAttribute('x1', String((s.t / AGE_SECONDS) * 200));
      nowLine.setAttribute('x2', String((s.t / AGE_SECONDS) * 200));
    }
    if (wanted.has('omega')) {
      globalsAt(s.t, g);
      for (const el of omBars) el.style.setProperty('--w', String(g.omega[el.dataset.om as keyof typeof g.omega]));
      for (const el of omVals) el.textContent = pct(g.omega[el.dataset.omv as keyof typeof g.omega]);
    }
  };
  $time.subscribe(() => {
    if (!pending) {
      pending = true;
      requestAnimationFrame(draw);
    }
  });
}
