// Prints globalsAt() at each chapter boundary and sample time labels (HANDOFF §16 Phase 1).
// Run: pnpm globals
import { CHAPTERS, CHAPTER_STARTS } from '../src/time/chapters.ts';
import { AGE_SECONDS, globalsAt } from '../src/physics/cosmology.ts';
import { formatDuration, formatTime } from '../src/time/format.ts';
import { OMEGA_L, OMEGA_L_QUOTED, YEAR_S } from '../src/physics/constants.ts';
import { NEUTRON_FREEZE_FRACTION, abundancesAt } from '../src/physics/abundances.ts';

const e = (x: number, d = 3) => x.toExponential(d).padStart(11);
const f = (x: number) => x.toFixed(4).padStart(7);

console.log(`Age: ${(AGE_SECONDS / YEAR_S / 1e9).toFixed(4)} Gyr   Ω_Λ(flat) = ${OMEGA_L.toFixed(6)} vs quoted ${OMEGA_L_QUOTED} (Δ ${(OMEGA_L - OMEGA_L_QUOTED).toExponential(2)})`);
console.log(`BBN: freeze-out n fraction ${NEUTRON_FREEZE_FRACTION.toFixed(4)}, Yp(1200 s) = ${abundancesAt(1200).helium4.toFixed(4)}\n`);
console.log('chapter        p      t (s)        label             a           z            T (K)       H (1/s)     Ω_r     Ω_m     Ω_Λ   epoch');
const rows: [string, number, number][] = CHAPTERS.map((c, i) => [c.id, CHAPTER_STARTS[i]!, c.tStart]);
rows.push(['(now)', 1, AGE_SECONDS]);
for (const [id, p, t] of rows) {
  const g = globalsAt(t);
  const label = formatTime(t, { lookback: t > 2.5e17, style: 'short' });
  console.log(
    `${id.padEnd(13)} ${p.toFixed(3)} ${e(t)}  ${label.padEnd(16)} ${e(g.a)} ${e(g.z)} ${e(g.T)} ${e(g.H)} ${f(g.omega.radiation)} ${f(g.omega.matter)} ${f(g.omega.darkEnergy)}  ${g.epoch}`,
  );
}
console.log('\nSample tick labels:');
const samples = [5.39e-44, 1e-36, 1e-32, 1e-12, 1e-6, 1e-3, 1, 180, 1200, 1.6e12, 1.2e13, 4.7e15, 3.2e16, 1e17, 2.46e17];
console.log(samples.map((t) => `${formatDuration(t, 'short')} | ${formatDuration(t, 'long')}`).join('\n'));
console.log(['4.6e9', '66e6', '3e5', '1e4'].map((y) => formatTime(0, { lookback: true, lookbackSeconds: Number(y) * YEAR_S })).join(' · '));
