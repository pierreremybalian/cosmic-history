# Cosmic History

Scroll-driven 3D journey from the Planck epoch to today. Astro 7, vanilla TypeScript islands, three.js r186 WebGPU renderer with TSL shaders (automatic WebGL2 fallback), nanostores, Lenis. Static output served by Cloudflare Workers static assets at https://cosmic-history.balian.dev (`pnpm deploy`). `HANDOFF.md` is the spec; `DECISIONS.md` logs deviations; `SCENES.md` is the scene authoring guide.

## Dev
- `pnpm dev` (port 4340). Scene harness: `/dev/scenes/?scene=<id>&local=0.5` (slider, FPS, GPU memory, load/unload ×50 leak test).
- `pnpm test` (physics, time mapping, formatter, data schema, field) and `pnpm check` must pass before anything is done. `pnpm build` also writes `dist/_headers`.
- Screenshots: `node scripts/shoot.ts --scene <id> --locals 0.1,0.5,0.9 --outdir scratch/shots` (`--webgl`, `--leak`, `--page 0,0.5`). Stills: `pnpm stills` (needs a running dev or preview server).
- Data: `node scripts/seed-data.ts` regenerates events/eras JSON + schemas; `scripts/cmb_to_equirect.py` rebuilds the CMB textures (venv in scripts/.venv).

## Rules
- `src/physics/` and `src/time/` are pure TypeScript: no DOM, no three. Node runs them directly.
- One source of truth: `$progress` → `progressToTime` → t. Everything visible is a function of t (plus wall-clock for idle motion). Never send raw t to the GPU.
- No physical value is hand-typed in a shader: compute it in `src/physics` and pass a uniform or LUT.
- Scenes are isolated modules (`src/scenes/<id>/`), share only global uniforms and `src/shared`. Typed `params` at the top of each scene; dispose everything you create; never dispose the shared field.
- Every scene declares accuracy + a one-sentence note stating any exaggeration; colour-mapped imagery sets `colourMapped`.
- No allocation in the frame loop. No new dependencies without a line in DECISIONS.md.
- Tokens only from `src/styles/global.css` (`@theme`); category colours are mirrored in `src/data/schema.ts`.
