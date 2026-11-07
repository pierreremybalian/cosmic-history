// Chapter narrative (HANDOFF §12). One MDX file per chapter; id must match src/time/chapters.ts.
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const chapters = defineCollection({
  loader: glob({ pattern: '*.mdx', base: './src/content/chapters' }),
  schema: z.object({
    id: z.string(),
    title: z.string(),
    /** Short label above the title, e.g. "10⁻³⁶ → 10⁻³² seconds". */
    kicker: z.string(),
    summary: z.string(),
    beats: z
      .array(
        z.object({
          local: z.number().min(0).max(1),
          text: z.string(),
          /** Optional time label shown with the beat, e.g. "10⁻¹² s" or "66 Myr ago". */
          time: z.string().optional(),
        }),
      )
      .default([]),
    howWeKnow: z.string(),
    sources: z.array(z.object({ label: z.string(), url: z.url() })).min(1),
  }),
});

export const collections = { chapters };
