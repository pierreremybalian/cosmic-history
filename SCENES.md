# Scene authoring guide

How to build a scene for Cosmic History. Read `HANDOFF.md` §3, §5, §9, §13 first; this file is the practical companion.

## Contract

Every scene lives in `src/scenes/<id>/` with:

- `index.ts` — default-exports a `SceneFactory` (`() => CosmicScene`, see `src/scenes/types.ts`). A typed `params` object with every tunable sits at the top of the file. No magic numbers further down.
- `shaders.ts` — TSL node builders for this scene (import from `three/tsl`, materials from `three/webgpu`).
- `assets.ts` — optional.

Lifecycle, called by `src/render/SceneManager.ts`:

| call | when | rules |
|---|---|---|
| `init(ctx)` | once, async | Build `Scene`, camera, materials. `await ctx.field.ready` before touching the shared field. End with `await ctx.renderer.compileAsync(scene, camera)` so the first frame does not hitch. |
| `update(local, g, dt, elapsed)` | every frame while live | `local` ∈ [0,1] through the chapter (already in the chapter's time map). `g` = `Globals` at the current t (`src/physics/cosmology.ts`). `elapsed` = wall-clock seconds for idle motion (it stops under reduced motion). **No allocation**: reuse vectors, write uniforms' `.value`. |
| `render(target)` | every frame | `renderer.setRenderTarget(target); renderer.render(scene, camera);` (multiple passes allowed). Output is **linear HDR**; the compositor does bloom (threshold ≈ 0.72) → AgX tone map → grain. Values > 1 bloom. |
| `resize(w, h, dpr)` | on resize | Update camera aspect, any internal targets. |
| `dispose()` | when unloaded | Dispose every geometry, material, texture and render target you created. **Never** dispose anything from `ctx.field` or `ctx.globals`. Leak test must pass. |

Declare `accuracy` (`measured | simulated | modelled | metaphor`), a one-sentence `accuracyNote` (state every exaggeration: counts, speeds, sizes, ratios), and set `colourMapped = true` whenever you show non-visible light/matter through a colour map (§13.4). The nav shows these.

## What you can use

- `ctx.globals` (`src/render/globals.ts`): TSL uniforms updated per frame — `uLog10T, uA, uLogA, uH, uLogH, uTemp, uLogTemp, uOmegaR, uOmegaM, uOmegaB, uOmegaDM, uOmegaL, uElapsed, uLocal, uResolution` — and `blackbodyNode(ctx.globals.lut, log10TNode)` → linear RGB of a blackbody (max channel 1). Never send raw `t` to the GPU.
- Physics on the CPU (pure): `src/physics/cosmology.ts` (`globalsAt, aAt, tAt, temperatureAt, growthFactor, inflationScaleFactor, omegaAt, decelerationAt`), `abundances.ts` (`abundancesAt(t)`), `recombination.ts` (`ionizationFraction(z)`, `neutralFractionIGM(z)`, `madauDickinsonSFR(z)`), `blackbody.ts` (`blackbodyRGB(T)`, `wavelengthRGB(nm)`), `constants.ts`. **No physical value is hand-typed in a shader** (§13.2): compute it on the CPU from these modules and pass a uniform, or use the LUT.
- Time mapping: `src/time/chapters.ts` (`CHAPTERS`, `timeInChapter(chapter, local)`) — use it to find the `local` at which a dated event happens in your chapter, so your visual beat lands where the narrative beat is (`src/content/chapters/<chapterId>.mdx` has `beats[].local`).
- Shared TSL: `src/shared/noise.ts` (`fbm, fbm3, domainWarp, curlNoise, abcFlow`), `src/shared/color.ts` (`cmbColorNode`, `densityColorNode`, `lineColor(nm)`, emission line wavelengths), `src/shared/math.ts` (CPU easing, `mulberry32`, `gaussian`, TSL `rotY`).
- The primordial field (`src/shared/gaussianField.ts`, built in a Worker at boot): `ctx.field.textures()` → `density` (RGBA16F 3D, R = δ/σ, G = ζ, B = smoothed δ/σ; repeat-wrapped; sample with `texture3D(tex, uvw)`) and `displacement` (ψ/σψ). `ctx.field.attributes()` → per-particle `InstancedBufferAttribute`s (q, ψ, λ) already shuffled so any prefix is a random subset. `ctx.field.peaksAt(A, n)` → halo seed positions (world units) at amplitude A. `webAmplitude(a)` = the Zel'dovich amplitude every structure scene uses, so the web is continuous across chapters. `WORLD_BOX` = 10 world units per field box.
- The cosmic web (`src/shared/web.ts`): `createCosmicWeb(ctx, opts)` → instanced sprite points of the same universe with uniforms `amplitude, brightness, scale, colourMap, tint, size, reveal, contrast`. Structure scenes should use this so the same filaments appear throughout.
- `ctx.quality` (`src/render/quality.ts`): `particles` (60k/250k/1M), `raymarchSteps` (32/64/128), `renderScale`, `name`. Respect them.
- `ctx.assets` (`src/render/assets.ts`): cached texture/binary/json loading with `release(url)`.

## TSL / three r186 gotchas (learned the hard way)

- Two `texture()` nodes that start on the **same** Texture object share a binding; later `.value` swaps are ignored. Give each its own initial texture.
- Never use reversed `smoothstep` edges (`smoothstep(1, 0, x)` is undefined in WGSL/GLSL). Use `float(1).sub(smoothstep(0, 1, x))`.
- Instanced data: `instancedBufferAttribute<'vec4'>(attr, 'vec4')` (the generic + type string keeps TypeScript happy). Billboards: `new Sprite(new SpriteNodeMaterial(...))` with `sprite.count = N`, `material.positionNode` = per-instance centre, `scaleNode` = world size, `colorNode`/`opacityNode`; `uv()` is the quad UV. Set `frustumCulled = false`.
- Particles are **stateless**: position = f(seed, local, elapsed) evaluated in the vertex stage, so scrubbing backwards works and both backends share one path (DECISIONS.md). No compute shaders, no ping-pong.
- Loops: unroll in JS (a `for` building nodes) or `Loop(count, ({ i }) => …)` with a JS-number count fixed at build time (e.g. `quality.raymarchSteps`). Branches: `If(cond, () => …).ElseIf(…).Else(…)` inside a `Fn(() => …)()`, writing to a `.toVar()`.
- Types in `@types/three` are strict (`Node<'float'>`, `Node<'vec3'>`). Annotate helper params with `Node<'vec3'>` etc. (`import type { Node } from 'three/webgpu'`). If a type genuinely cannot be expressed, a narrowly scoped cast with a comment is acceptable; `any` needs a comment saying why.
- Rendering into the scene target is linear, untonemapped (`renderer.isOutputTarget` is false). Keep backgrounds truly black; emissive highlights 1–8.
- `MeshBasicNodeMaterial`, `SpriteNodeMaterial`, `PointsNodeMaterial`, `MeshStandardNodeMaterial` from `three/webgpu`. Additive blending + `depthWrite: false` for glows.
- Fullscreen effects inside a scene: a `Mesh(new PlaneGeometry(2, 2), material)` with an `OrthographicCamera(-1,1,1,-1,0,1)` in a second `Scene`, or a large sphere `BackSide` for sky/volume.
- Raymarching: ray origin `cameraPosition`, direction `positionWorld.sub(cameraPosition).normalize()` on a bounding box/sphere mesh with `side: BackSide`.

## Visual direction

Deep blacks, emissive light, physically motivated colour, slow cinematic camera (ease everything; no snapping). Continuous idle motion even when the scroll is still. Every scene starts compatible with the previous scene's last frame and ends on a calm frame — the compositor blends the first 12% of each chapter with the previous scene using the chapter's transition (dissolve / zoom / stretch). Aim for documentary-grade quality: think ESA/NASA visualisations, not a screensaver. Prefer one strong, legible idea per beat over clutter. Avoid text in the canvas (HTML overlays exist for that).

Performance budget: 60 fps at medium on a recent laptop, ≥30 fps on a phone at low. Fill-rate is the usual killer: keep raymarch steps from the tier, keep particle sprites small, avoid huge overdraw of additive quads.

## Self-test loop (do this, repeatedly)

A dev server is usually running; find it with `curl -s -o /dev/null -w "%{http_code}" http://localhost:4332/dev/scenes/`. If it is not up, start your own: `pnpm astro dev --port <4400–4499>` (background it). Then:

```
node scripts/shoot.ts --base http://localhost:4332 --scene <id> --locals 0.05,0.3,0.6,0.95 --outdir scratch/<id>
node scripts/shoot.ts --base http://localhost:4332 --scene <id> --locals 0.5 --webgl --outdir scratch/<id>
node scripts/shoot.ts --base http://localhost:4332 --scene <id> --locals 0.5 --leak --outdir scratch/<id>
pnpm exec tsc --noEmit -p .
pnpm exec eslint src/scenes/<id>
```

Look at every screenshot with the Read tool and judge it honestly against the beats and the visual direction. Iterate until it is genuinely beautiful and legible at every local, on both backends. The harness exits non-zero on page errors or a failed scene. The interactive page is `http://localhost:4332/dev/scenes/?scene=<id>` (slider, FPS, leak button).
