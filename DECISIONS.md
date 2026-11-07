# Decisions

Non-obvious choices, deviations from HANDOFF.md, and why. Newest at the bottom of each section.

## Stack and tooling

- **Versions pinned exactly**, each released ≥ 2 weeks before install (2026-11-07): astro 7.4.2, @astrojs/mdx 8.1.1, three 0.186.1, nanostores 1.5.5, lenis 1.3.27, vitest 5.0.5, typescript 6.0.3, eslint 10.13.0, prettier 3.9.10. TypeScript 7 (the native port) is newer but typescript-eslint and @astrojs/check only support ≤ 6.0, so 6.0.3.
- **House conventions** (matching our other Astro sites): static output for Cloudflare Pages (`wrangler.toml`, `pnpm deploy`), `scripts/headers.mjs` writes `dist/_headers` with a CSP that hashes inline scripts, strict tsconfig with `noUncheckedIndexedAccess` and `allowImportingTsExtensions` (so Node runs the physics and scripts directly), Tailwind v4 (`@tailwindcss/vite`) with a cleared default palette and `@theme` tokens in `src/styles/global.css`, fontsource fonts.
- **Added dependencies** beyond HANDOFF §2: `@astrojs/mdx` (chapters are MDX per §12), `@astrojs/sitemap`, `tailwindcss` + `@tailwindcss/vite` (house styling), `sass` (available for component styles), fontsource `newsreader` / `inter-tight` / `jetbrains-mono` (typography), `playwright` (screenshot harness, stills and OG generation), `wrangler` (deploy), `globals`/`typescript-eslint`/`eslint-plugin-astro`/`prettier-plugin-astro` (lint/format). No UI framework: islands are vanilla TypeScript.
- **JSON Schema without ajv**: schemas are written in zod (`src/data/schema.ts`, via `astro/zod`), JSON Schema files in `public/data/*.schema.json` are generated from them by `scripts/seed-data.ts`, and a test fails if they drift.
- **Node runs TypeScript directly** (Node 24 type stripping) for `scripts/*.ts`; no tsx.

## Physics

- **Ω_Λ = 1 − Ω_m − Ω_r = 0.684908**, vs 0.685 quoted: Δ = −9.2 × 10⁻⁵ (flatness enforced, §6.1). Ω_r = 9.198 × 10⁻⁵ from Ω_γh² = 2.47 × 10⁻⁵ and N_eff = 3.046.
- **Age = 13.791 Gyr** (test: 13.79 ± 0.03). Recombination at z = 1090 → 371 kyr; equality t = 50.4 kyr.
- **t(a) table**: ln a ∈ [−80, 1], 20,480 intervals, cumulative Simpson (3-point quadratic per interval) with the analytic radiation-era start. Interpolation is monotone cubic Hermite (Fritsch–Butland slopes) in (ln a → ln t); `aAt` inverts the *same* cubic by safeguarded Newton, so `tAt(aAt(t))` round-trips to machine precision (the test asks for 1e-9).
- **e⁺e⁻ step**: smoothstep in log a between the epochs where T₀/a crosses 1.5 × 10¹⁰ K and 1.5 × 10⁹ K (t ≈ 0.3 s → 40 s). The QCD/electroweak changes in g*s are ignored (noted in code).
- **Before 10⁻³² s**: `globalsAt` clamps a, z, H, T, Ω to their end-of-inflation values and reports `epoch: 'preInflation' | 'inflation' | 'friedmann'` and `preInflation` (contract extension of `Globals`). Inflation's illustrative a comes from `inflationScaleFactor(s)`.
- **Growth factor** D(a): Heath (1977) integral for matter + Λ, normalised D(1) = 1. Radiation is ignored (structure scenes start after recombination).
- **BBN**: weak-equilibrium n/p (Q = 1.293 MeV) softly frozen (8-norm) at X_f, decaying with τₙ = 879 s; neutrons locked into ⁴He as the deuterium bottleneck breaks (smoothstep in log t, 180 → 360 s). X_f is *calibrated* at load (≈ 0.16) so Yₚ lands on 0.247; the handoff's "≈ 0.14 by freeze-out" is reached around 100 s. D has a transient peak (5 × 10⁻³ by mass near 270 s) and settles to D/H = 2.5 × 10⁻⁵; Li/H → 5 × 10⁻¹⁰.
- **Recombination** x_e(z): tanh, width 80, residual 2 × 10⁻⁴, **midpoint z = 1135** (HANDOFF: ≈ 1100). With 1100 the Thomson optical depth reaches 1 only at z ≈ 1056, so the fog would still be opaque at last scattering; 1135 puts τ = 1 at z = 1090. `opticalDepth(z)` and `transparency(z) = e^(−τ)` drive the fog clearing. **Reionization**: tanh in z, z_re = 7.7 (Planck 2018), width widened to 1.0 for visibility.
- **Power spectrum**: BBKS with Γ = Ω_m h, n_s = 0.965, normalised to σ₈ = 0.811.
- **Blackbody**: CIE 1931 2° table at 5 nm embedded from the colour-science dataset (official CIE CSV URL was 404). LUT is RGBA half-float, 256 samples over log₁₀T ∈ [3, 12]. Monochromatic line colours are desaturated toward white just enough to fit sRGB.

## Time mapping

- **Lookback map** is log-uniform in (L + 10 kyr), not in L, so the final chapter can end at L = 0 ("clamp Lend ≥ 10⁴ yr" in §7 would make the `now` chapter degenerate). For L ≫ 10 kyr it is the §7 log map.
- **Chapter table changes** (§7.1 says "initial"; contracts unchanged):
  - `bbn` uses a log map: with linear, helium formation (180–360 s) occupied only the first 12% of the chapter.
  - The photon era is split: `photon` (20 min → 250 kyr, log, weight 6) and `recombination` (250 → 380 kyr, linear, weight 6), both showing the recombination scene. On the original log map, the fog clearing (z ≈ 1400 → 1000) happened in the last 1.5% of the chapter.
  - Life is split: `life` (4.4 Gyr → 540 Myr ago, linear in t, weight 6) and `complexLife` (540 Myr → 10 kyr ago, lookback, weight 7), both showing the life scene. On one lookback-log chapter, oceans → eukaryotes (3.9 Gyr of history) fit into its first 7%.
  - Scenes that span two chapters drive their visuals from `g` (t, z, lookback), not `local`. The renderer does not transition between chapters that share a scene.
- **Late events are dated by lookback** (`lookback_years` in events.json); `t_seconds` for them is derived from the computed age, and the nav uses `lookbackToProgress` (no cancellation). The seed data's late `t_seconds` assumed a 13.8 Gyr age and put Homo sapiens *after* now on our 13.791 Gyr axis.
- **Derived event times are computed**, not typed: matter–radiation equality, recombination (z = 1090), acceleration onset (q = 0), matter–Λ equality, earliest JWST galaxy (z = 14.32), reionization end (z = 5.8), cosmic noon (z = 1.86). Added events the scenes need: Moon-forming impact, first oceans.
- **Narrative layout**: chapter sections are absolutely positioned at their exact scroll offsets; the story container is Σ weight × 60svh + 100svh, progress = (scrollY − top)/(height − viewport), so section i's top meets the viewport top exactly at CHAPTER_STARTS[i]. Beats sit at `local` + 52svh so a caption is mid-screen when its moment plays.

## Rendering

- **three r186 API**: `RenderPipeline` (PostProcessing was renamed in r183), `bloom()` from `three/addons/tsl/display/BloomNode.js`, AgX tone mapping, `Sprite` + `SpriteNodeMaterial` with `count` for instanced billboards.
- **Compositor = one TSL graph**: two texture nodes (outgoing/incoming scene targets) → transition branch (`dissolve` / `zoom` / `stretch` / plain `fade` for reduced motion) → bloom → vignette + luminance-weighted grain → tone map (RenderPipeline output transform). Swapping scene targets only changes `textureNode.value`. Found: two texture nodes created on the *same* placeholder texture share a binding and ignore later swaps (black frames) — each gets its own 1×1 placeholder.
- **Transitions blend over the first 12% of the incoming chapter**; the outgoing scene is held at `local = 1` with globals at its chapter end.
- **Particles are stateless** (position = f(seed, local, elapsed) in the vertex stage). HANDOFF §9.3 suggests compute/ping-pong; stateless gives reversible scrubbing (principle 1: everything is a function of t), determinism, and one code path for WebGPU and WebGL2.
- **Primordial field**: generated in a Web Worker at boot (open question 1), not shipped: 128³ takes ~1.5 s including 250k Zel'dovich particles; a 128³ RGBA16F texture pair is 32 MB on the GPU. **Grid capped at 128³ on high** (256³ would need ~0.5 GB of worker memory and 128 MB of VRAM for no visible gain at our particle counts). Hermitian symmetry comes for free by FFT-ing real white noise. ζ (P ∝ k^(n_s−4)), δ (BBKS, σ₈) and ψ all come from the same noise.
- **Truncated Zel'dovich**: ψ is Gaussian-smoothed (R = 1.2 Mpc/h; Coles, Melott & Shandarin 1993) in a 100 Mpc/h box. Per particle the deformation-tensor eigenvalues are precomputed so the GPU evaluates ρ/ρ̄ = 1/|Π(1 − Aλᵢ)| (softened past shell crossing). Particle order is shuffled so any prefix is a random subset (tier changes draw fewer).
- **Growth compression**: every structure scene uses `webAmplitude(a) = D(a)^0.35` (normalised to 1 today) instead of D(a), so the web is visible from the dark ages on and continuous across chapters; the scenes' accuracy notes say so.
- **Quality**: initial tier from backend + cores + device memory + coarse-pointer, refined by a 1 s probe rendering an 8-octave fBm placeholder at the real resolution. Dynamic drop if the median frame > 22 ms for 3 s; never auto-raise. The user override in the nav re-initialises scenes (and the field if it needs more particles).
- **Reduced motion**: each chapter's scene renders once at local 0.5 and is held; transitions become plain crossfades; Lenis smoothing is off; elapsed time stops.
- **Fallback**: no WebGPU and no WebGL2 → `public/stills/<chapter>.webp` crossfade per chapter; a scene that fails to init shows its still in the compositor.

## Data and licensing

- **Planck CMB**: `COM_CMB_IQU-smica_2048_R3.00_full.fits` (IRSA mirror; the ESA archive returned 503), column `I_STOKES_INP`, 5′ smoothing, monopole/dipole removed, reprojected to equirectangular Galactic (l = 0 at u = 0.5, longitude increasing to the left, as published), 8-bit grayscale ΔT ∈ ±300 µK (2.35 µK steps; HANDOFF suggested 16-bit, but browsers decode PNGs to 8 bits per channel anyway). Orientation verified by correlation 0.9989 with the HEALPix map and by the Cold Spot at (209°, −57°). **Licence: CC BY-NC 3.0 IGO (ESA). Non-commercial: any ads, sales or sponsorship need permission from data.licences@esa.int before launch.** Credit is in the page footer and the HUD.
- **IllustrisTNG**: `scripts/tng_to_points.py` defaults to TNG100-3-Dark (same initial conditions as TNG100-1-Dark, ~3 GB per snapshot instead of ~190 GB). Not run (needs an API key); the app does not depend on it.

- See `scripts/DATA_NOTES.md` for the Planck map pipeline and IllustrisTNG script (TNG needs an API key; the app runs without it, high tier only, off by default — open question 3: not worth the download on medium).
- Audio: out of scope (open question 4).
- Mobile nav: horizontal strip at the top, auto-scrolled to keep the marker centred (open question 2).
