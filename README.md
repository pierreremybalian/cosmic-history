# Cosmic History

A scroll-driven, full-screen 3D journey through the history of the universe, from the Planck epoch to today. Scroll is time; captions narrate each stage one at a time; a persistent WebGPU/WebGL2 canvas renders each epoch from a shared cosmology module; every scene declares how accurate it is.

```
pnpm install
pnpm dev          # http://localhost:4340
pnpm test         # physics, time mapping, data schema
pnpm build        # static site in dist/
```

- Spec: `HANDOFF.md`. Decisions and deviations: `DECISIONS.md`. Scene authoring: `SCENES.md`.
- Physics: `src/physics/` (Friedmann integration, blackbody colour, BBN, power spectrum) — unit-tested.
- Time: `src/time/` (chapter table, scroll ↔ time mapping, labels).
- Rendering: `src/render/` (renderer, scene manager, compositor, quality tiers), scenes in `src/scenes/`.
- Data: `public/data/` (events, eras, Planck CMB map). Credits and licensing: `scripts/DATA_NOTES.md` and the page footer.

Dev-only pages: `/dev/scenes/?scene=<id>&local=0.5` (scene smoke test) and `/dev/field/` (field traceability).
Regenerate fallback stills and the OG image: start `pnpm dev`, then `pnpm stills -- --base http://localhost:4340`.

Deploy (Cloudflare Pages): `pnpm deploy`. Note: the Planck CMB map is CC BY-NC 3.0 IGO (non-commercial); see DECISIONS.md.
