import { describe, expect, it } from 'vitest';
import { z } from 'astro/zod';
import events from '../../../public/data/events.json';
import eras from '../../../public/data/eras.json';
import eventsJsonSchema from '../../../public/data/events.schema.json';
import erasJsonSchema from '../../../public/data/eras.schema.json';
import { eraSchema, erasSchema, eventSchema, eventsSchema } from '../schema.ts';
import { AGE_SECONDS } from '../../physics/cosmology.ts';
import { YEAR_S } from '../../physics/constants.ts';

describe('data', () => {
  it('events.json validates', () => {
    expect(() => eventsSchema.parse(events)).not.toThrow();
  });
  it('eras.json validates', () => {
    expect(() => erasSchema.parse(eras)).not.toThrow();
  });
  it('JSON Schemas are up to date with the zod source', () => {
    expect(eventsJsonSchema).toEqual(JSON.parse(JSON.stringify(z.toJSONSchema(z.array(eventSchema)))));
    expect(erasJsonSchema).toEqual(JSON.parse(JSON.stringify(z.toJSONSchema(z.array(eraSchema)))));
  });
  it('ids are unique and events are sorted by time', () => {
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.t_seconds.best).toBeGreaterThanOrEqual(events[i - 1]!.t_seconds.best);
    }
  });
  it('lookback-dated events agree with the computed age', () => {
    for (const e of events) {
      if (!e.lookback_years) continue;
      const t = AGE_SECONDS - e.lookback_years.best * YEAR_S;
      expect(Math.abs(e.t_seconds.best - t) / AGE_SECONDS).toBeLessThan(1e-9);
    }
  });
  it('every event has at least one https source', () => {
    for (const e of events) expect(e.sources.every((s) => s.url.startsWith('https://'))).toBe(true);
  });
});
