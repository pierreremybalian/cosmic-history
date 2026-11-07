// Data schemas for public/data/*.json (HANDOFF §14). The JSON Schema files are generated from these.

import { z } from 'astro/zod';

export const CATEGORIES = [
  'Spacetime & forces',
  'Particles',
  'Elements',
  'Dark sector & expansion',
  'Structure',
  'Life',
] as const;
export type Category = (typeof CATEGORIES)[number];

/** CSS custom property names, mirrored in src/styles/global.css (§11.2). */
export const CATEGORY_VAR: Record<Category, string> = {
  'Spacetime & forces': '--cat-spacetime',
  Particles: '--cat-particles',
  Elements: '--cat-elements',
  'Dark sector & expansion': '--cat-dark',
  Structure: '--cat-structure',
  Life: '--cat-life',
};

/** Linear-ish sRGB hex mirrors of the CSS tokens, for canvas use. */
export const CATEGORY_HEX: Record<Category, string> = {
  'Spacetime & forces': '#b9a4ff',
  Particles: '#6fd3ff',
  Elements: '#ffc46b',
  'Dark sector & expansion': '#8f9bb8',
  Structure: '#7cf2c1',
  Life: '#a6e36a',
};

const range = z
  .object({ best: z.number().positive(), min: z.number().positive(), max: z.number().positive() })
  .refine((r) => r.min <= r.best && r.best <= r.max, { message: 'min ≤ best ≤ max' });

const source = z.object({ label: z.string().min(2), url: z.url() });

export const eventSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(2),
  category: z.enum(CATEGORIES),
  t_seconds: range,
  /** Set for events dated by lookback; authoritative for positioning near the present. */
  lookback_years: range.optional(),
  label: z.string().min(1),
  certainty: z.string().min(2),
  summary: z.string().min(10),
  /** Why the range is as wide as it is, when it is widened beyond the literature. */
  range_note: z.string().optional(),
  sources: z.array(source).min(1),
});
export type CosmicEvent = z.infer<typeof eventSchema>;
export const eventsSchema = z.array(eventSchema);

export const eraSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  era: z.string().min(2),
  lane: z.enum(['Epoch', 'Dominant component']),
  start_s: z.number().nonnegative(),
  end_s: z.number().positive(),
  description: z.string().min(2),
});
export type Era = z.infer<typeof eraSchema>;
export const erasSchema = z.array(eraSchema);
