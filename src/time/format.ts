// Unit-aware time labels (HANDOFF §7.2). Pure.

import { GYR_S, KYR_S, MYR_S, YEAR_S } from '../physics/constants.ts';
import { AGE_SECONDS } from '../physics/cosmology.ts';

const SUP: Record<string, string> = {
  '-': '⁻',
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
};

export function superscript(n: number): string {
  return String(n)
    .split('')
    .map((ch) => SUP[ch] ?? ch)
    .join('');
}

/** Round to `sig` significant figures. */
export function roundSig(x: number, sig = 2): number {
  if (x === 0 || !isFinite(x)) return x;
  const p = Math.pow(10, sig - Math.ceil(Math.log10(Math.abs(x))));
  return Math.round(x * p) / p;
}

/** Plain number: ≤1 decimal below 10, grouped integers above. */
export function num(x: number, sig = 2): string {
  const r = roundSig(x, sig);
  if (Number.isInteger(r)) return r.toLocaleString('en-US');
  return r.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

/** "10⁻³⁶" or "5.4 × 10⁻⁴⁴". */
export function sci(x: number, sig = 2): string {
  let e = Math.floor(Math.log10(x));
  let m = roundSig(x / Math.pow(10, e), sig);
  if (m >= 10) {
    m /= 10;
    e += 1;
  }
  return m === 1 ? `10${superscript(e)}` : `${num(m, sig)} × 10${superscript(e)}`;
}

export type LabelStyle = 'short' | 'long';

/** Duration (seconds) → label. Short for compact labels; long spells out years below a million. */
export function formatDuration(seconds: number, style: LabelStyle = 'short'): string {
  const s = Math.abs(seconds);
  const long = style === 'long';
  if (s < 1e-3) return `${sci(s)} s`;
  if (s < 1) return `${num(s * 1e3)} ms`;
  if (s < 60) return `${num(s)} s`;
  if (s < 3600) return `${num(s / 60)} min`;
  if (s < 86400) return `${num(s / 3600)} h`;
  if (s < YEAR_S) return `${num(s / 86400)} days`;
  const yr = s / YEAR_S;
  if (yr < 1e4) return `${num(yr)} yr`;
  if (yr < 1e6) return long ? `${num(yr)} yr` : `${num(s / KYR_S)} kyr`;
  if (yr < 1e9) return `${num(s / MYR_S)} Myr`;
  const gyr = s / GYR_S;
  return `${num(gyr, gyr >= 10 ? 3 : 2)} Gyr`;
}

/** "4.6 Gyr ago", "66 Myr ago", "300,000 yr ago", "now". */
export function formatLookback(lookbackSeconds: number, style: LabelStyle = 'long'): string {
  if (lookbackSeconds < YEAR_S) return 'now';
  return `${formatDuration(lookbackSeconds, style)} ago`;
}

/** Cosmic time since the Big Bang. Late chapters pass `lookback` to switch to "… ago". */
export function formatTime(
  tSeconds: number,
  opts: { style?: LabelStyle; lookback?: boolean; lookbackSeconds?: number } = {},
): string {
  const style = opts.style ?? 'short';
  if (opts.lookback) return formatLookback(opts.lookbackSeconds ?? AGE_SECONDS - tSeconds, style);
  return formatDuration(tSeconds, style);
}

/** Age today, e.g. "13.8 Gyr". */
export const AGE_LABEL = formatDuration(AGE_SECONDS, 'short');

/** Plain-language duration for the on-screen clock: "20 seconds", "380,000 years", "3.6 billion years". */
export function plainDuration(seconds: number): string {
  const s = Math.abs(seconds);
  const unit = (v: string, one: string, many: string) => `${v} ${v === '1' ? one : many}`;
  if (s < 1e-3) return `${sci(s)} seconds`;
  if (s < 60) return unit(num(s), 'second', 'seconds');
  if (s < 3600) return unit(num(s / 60), 'minute', 'minutes');
  if (s < 86400) return unit(num(s / 3600), 'hour', 'hours');
  if (s < YEAR_S) return unit(num(s / 86400), 'day', 'days');
  const yr = s / YEAR_S;
  if (yr < 1e6) return unit(num(yr), 'year', 'years');
  if (yr < 1e9) return `${num(yr / 1e6)} million years`;
  return `${num(yr / 1e9, yr >= 1e10 ? 3 : 2)} billion years`;
}

/** "20 seconds after the Big Bang" early on; "4.6 billion years ago" (or "Today") once `lookback` is set. */
export function plainWhen(tSeconds: number, opts: { lookback?: boolean; lookbackSeconds?: number } = {}): string {
  if (opts.lookback) {
    const l = opts.lookbackSeconds ?? AGE_SECONDS - tSeconds;
    return l < YEAR_S ? 'Today' : `${plainDuration(l)} ago`;
  }
  return `${plainDuration(tSeconds)} after the Big Bang`;
}
