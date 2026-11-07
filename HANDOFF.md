# Cosmic History — Engineering Handoff

> **Read this whole file before writing code.** It is the source of truth for scope, architecture, contracts, physics, and build order. If something here conflicts with your instincts, follow this file and flag the conflict in your report. If something is ambiguous, pick the simplest option that keeps the contracts intact, note the decision in `DECISIONS.md`, and keep going.

---

## 1. What we're building

A scroll-driven, full-screen 3D journey through the history of the universe, from the Planck epoch to today, including the emergence of life.

- **The scroll *is* time.** Scrolling advances cosmic time `t` (seconds since the Big Bang).
- **A timeline rail is the navigation.** A sticky rail shows every epoch and event on a distorted time axis, highlights "now" as you scroll, and can be clicked to jump.
- **A persistent WebGPU/WebGL canvas renders each epoch** as a shader-driven 3D scene with continuous motion graphics. Scenes blend into each other; there are no hard cuts.
- **Physics drives visuals.** Expansion, temperature, color and composition come from a shared cosmology module, not from hand-tuned constants.
- **Honesty is a feature.** Every scene declares how accurate it is (measured / simulated / modelled / metaphor) and the UI shows it.

### Non-goals (for now)
- No backend. Static site.
- No user accounts, analytics, or CMS.
- No VR/XR.
- No real-time N-body simulation of the whole universe in the browser (we approximate and use precomputed data).

---

## 2. Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | **Astro** (current stable) + **TypeScript** (`strict: true`) | Narrative is static HTML; interactivity in islands |
| Rendering | **three.js** `WebGPURenderer` (`three/webgpu`) with automatic WebGL2 fallback | Write shaders in **TSL** (`three/tsl`) so one source targets both backends |
| State | **nanostores** | Framework-agnostic, works across Astro islands |
| Scroll | **Lenis** + custom driver | Do **not** use GSAP ScrollTrigger for the time mapping |
| Tests | **Vitest** | Physics and time-scale modules must be numerically tested |
| Lint/format | ESLint + Prettier | |
| Package manager | pnpm | |

Pin exact versions in `package.json` at the time you install. Use versions that have been released for at least two weeks.

Islands use vanilla TypeScript (no React/Vue/Svelte) unless a component becomes unmanageable; if you add a UI framework, record why in `DECISIONS.md`.

---

## 3. Architecture

```
┌──────────────────────────── index.astro ────────────────────────────┐
│                                                                     │
│  <Renderer client:only transition:persist />   ← fixed, full-screen │
│  <TimelineNav client:load />                   ← sticky rail        │
│                                                                     │
│  <main>  chapter sections (static HTML from content/chapters/*.mdx) │
│          each section = a scroll span with narrative text           │
│  </main>                                                            │
└─────────────────────────────────────────────────────────────────────┘

scroll ──▶ ScrollDriver ──▶ progress (0–1)
                              │
                              ▼
                     chapters.progressToTime()
                              │
                              ▼
                 store: { t, chapterId, sceneId, local, ... }
                    │                         │
                    ▼                         ▼
              TimelineNav              Renderer loop
                                    physics.globals(t)
                                    SceneManager.update()
                                    Compositor.render()
```

### Principles
1. **One source of truth: `t`.** Everything visible is a function of `t` (plus wall-clock time for idle motion).
2. **One GPU context, created once.** The renderer island never remounts (`transition:persist`). Scenes come and go inside it.
3. **Scenes are isolated modules** that share only the global uniforms and shared libraries. A broken scene must not break others.
4. **Render-to-target + composite.** Every scene renders to its own render target; a compositor blends outgoing and incoming scenes.
5. **Physics is CPU-side TypeScript** and is unit-tested. Shaders receive results as uniforms and never recompute cosmology.
6. **Never allocate in the frame loop.** Reuse vectors, buffers, and uniform objects.

---

## 4. Project structure

```
/
├─ HANDOFF.md                 ← this file
├─ DECISIONS.md               ← you create; log non-obvious choices
├─ astro.config.mjs
├─ package.json
├─ tsconfig.json
├─ public/
│  └─ data/
│     ├─ events.json          ← seeded from Appendix A
│     ├─ eras.json            ← seeded from Appendix B
│     ├─ cmb/                 ← Planck CMB texture(s), see §9.7
│     └─ tng/                 ← IllustrisTNG-derived point clouds, see §9.8
├─ scripts/                   ← offline data prep (Python allowed here only)
│  ├─ cmb_to_equirect.py
│  └─ tng_to_points.py
└─ src/
   ├─ pages/index.astro
   ├─ layouts/Base.astro
   ├─ content/
   │  └─ chapters/*.mdx       ← narrative copy per chapter
   ├─ physics/
   │  ├─ constants.ts
   │  ├─ cosmology.ts         ← Friedmann integration, a(t), H(t), T(t), Ω(t)
   │  ├─ blackbody.ts         ← temperature → linear RGB
   │  ├─ abundances.ts        ← BBN mass fractions vs time
   │  ├─ powerSpectrum.ts     ← primordial + simple transfer function
   │  └─ __tests__/
   ├─ time/
   │  ├─ chapters.ts          ← chapter table, progress ↔ t mapping
   │  ├─ format.ts            ← unit-aware time labels
   │  └─ __tests__/
   ├─ state/store.ts
   ├─ scroll/driver.ts
   ├─ nav/
   │  ├─ TimelineNav.astro
   │  └─ timelineNav.ts
   ├─ render/
   │  ├─ Renderer.astro
   │  ├─ renderer.ts          ← boot, loop, resize, visibility
   │  ├─ globals.ts           ← global uniforms
   │  ├─ SceneManager.ts      ← load/dispose/preload scenes
   │  ├─ Compositor.ts        ← transitions between scene targets
   │  ├─ quality.ts           ← tiers + feature detection + probe
   │  └─ transitions/         ← dissolve.ts, zoom.ts, stretch.ts
   ├─ scenes/
   │  ├─ registry.ts
   │  ├─ _placeholder/
   │  ├─ planck/  inflation/  qgp/  hadrons/  leptons/  bbn/
   │  ├─ recombination/  darkAges/  firstStars/  reionization/
   │  ├─ cosmicNoon/  darkEnergy/  solarSystem/  life/  now/
   └─ shared/
      ├─ noise.ts             ← TSL simplex/fbm/curl
      ├─ gaussianField.ts     ← the one primordial field (§8)
      ├─ particles/           ← GPU particle system (compute / ping-pong)
      ├─ volumetric/          ← raymarch helpers
      └─ math.ts
```

---

## 5. Core contracts

These interfaces are the stable seams between modules. Change them only if necessary, and log it in `DECISIONS.md`.

```ts
// src/physics/cosmology.ts
export interface Globals {
  t: number;            // seconds since Big Bang
  log10t: number;       // convenience; use this on GPU, not t
  a: number;            // scale factor, a(today) = 1
  z: number;            // redshift = 1/a - 1
  H: number;            // Hubble rate, 1/s
  T: number;            // photon temperature, K
  omega: {              // fractional energy densities at time t (sum = 1)
    radiation: number;
    matter: number;     // dark + baryonic
    baryon: number;
    darkMatter: number;
    darkEnergy: number;
  };
  lookbackYears: number; // years before present
}
export function globalsAt(t: number): Globals;
export function aAt(t: number): number;
export function tAt(a: number): number;
export const AGE_SECONDS: number; // computed, not hard-coded

// src/scenes/types.ts
export type Accuracy = 'measured' | 'simulated' | 'modelled' | 'metaphor';

export interface RenderContext {
  renderer: import('three/webgpu').WebGPURenderer;
  globals: GlobalUniforms;     // shared TSL uniform nodes
  quality: QualityTier;
  assets: AssetLoader;
  field: PrimordialField;      // §8, shared
}

export interface CosmicScene {
  id: string;
  range: [tStart: number, tEnd: number];  // seconds
  accuracy: Accuracy;
  accuracyNote: string;                   // shown in UI, one sentence
  init(ctx: RenderContext): Promise<void>;
  /** local: 0–1 progress through this scene's range (in the chapter's timeMap) */
  update(local: number, g: Globals, dt: number, elapsed: number): void;
  render(target: import('three/webgpu').RenderTarget): void;
  resize(width: number, height: number, dpr: number): void;
  dispose(): void;
}

// src/time/chapters.ts
export type TimeMap = 'log' | 'linear' | 'lookback';
export type TransitionKind = 'dissolve' | 'zoom' | 'stretch';

export interface Chapter {
  id: string;
  sceneId: string;
  tStart: number;          // seconds
  tEnd: number;            // seconds
  timeMap: TimeMap;        // how scroll maps to t *within* this chapter
  scrollWeight: number;    // relative share of total scroll length
  transitionIn: TransitionKind;
  transitionSpan: number;  // 0–1 fraction of this chapter used to blend in
}
export function progressToTime(p: number): { t: number; chapter: Chapter; local: number };
export function timeToProgress(t: number): number;

// src/state/store.ts  (nanostores)
export const $progress: WritableAtom<number>;    // 0–1 page scroll
export const $time: ReadableAtom<{ t: number; chapterId: string; sceneId: string; local: number }>;
export const $quality: WritableAtom<QualityTier>;
export const $reducedMotion: ReadableAtom<boolean>;
```

---

## 6. Physics core (`src/physics/`)

### 6.1 Parameters (Planck 2018, TT,TE,EE+lowE+lensing)

| Symbol | Value |
|---|---|
| H₀ | 67.4 km/s/Mpc |
| Ω_m | 0.315 |
| Ω_b | 0.0493 |
| Ω_Λ | 0.685 |
| T_CMB,0 | 2.7255 K |
| N_eff | 3.046 |
| Ω_γ h² | 2.47 × 10⁻⁵ |
| Ω_r | Ω_γ (1 + 0.2271 N_eff); with h = 0.674 → ≈ 9.1 × 10⁻⁵ |

Put these in `constants.ts`. Convert H₀ to 1/s. Use the Julian year (3.15576 × 10⁷ s).

Set Ω_Λ so the total is exactly 1 (flat): `Ω_Λ = 1 − Ω_m − Ω_r`. Log the tiny difference from 0.685.

### 6.2 Expansion

```
H(a) = H₀ · sqrt( Ω_r a⁻⁴ + Ω_m a⁻³ + Ω_Λ )
t(a) = ∫₀ᵃ da' / (a' H(a'))  =  ∫_{-∞}^{ln a} d(ln a') / H(a')
```

- Integrate in **ln a** on a dense grid (e.g. ln a from −80 to 0, ~20k points) with Simpson's rule. For the earliest segment where radiation dominates, use the analytic start `t ≈ 1 / (2 H₀ √Ω_r) · a²`.
- Build a monotonic lookup table `(ln t, ln a)` and interpolate (monotone cubic). `aAt(t)` and `tAt(a)` use it.
- `AGE_SECONDS = t(1)`. **Test:** 13.79 ± 0.03 Gyr.

### 6.3 Temperature

- Baseline `T = T₀ / a`.
- **Correction for e⁺e⁻ annihilation:** annihilation dumps energy into photons, so `T·a` *increases* by `(11/4)^(1/3)` ≈ 1.401 across it. Before it (T ≳ 10¹⁰ K) the photon temperature is therefore `T = (4/11)^(1/3) · T₀/a` ≈ 0.714 · T₀/a, transitioning smoothly around T ≈ 5 × 10⁹ K (t ≈ 1–10 s). Implement as a smooth step in log a. Visually, cooling briefly slows — the "temperature bump" beat in §9.5.
- Earlier changes in the number of relativistic species (e.g. at the QCD transition, t ≈ 10⁻⁵ s) also shift `T·a` slightly; ignore them and note it in code.

### 6.4 Energy fractions

```
ρ_x(a) ∝ Ω_x a^(−3(1+w_x)) ;  w_r = 1/3, w_m = 0, w_Λ = −1
omega.x = ρ_x / Σρ
```

Split matter into baryon (Ω_b) and dark matter (Ω_m − Ω_b).

### 6.5 Before Friedmann applies

The Friedmann + radiation model above is valid after inflation (t ≳ 10⁻³² s). For t < 10⁻³² s:

- **Inflation** (10⁻³⁶ → 10⁻³² s): parametric, illustrative. `a(t) = a_end · exp(N · (s − 1))` where `s` is normalised scene progress and `N = 60` e-folds. Mark as `modelled`.
- **Before inflation:** no physical `a`. Scenes are `metaphor`; `globalsAt` returns the post-inflation extrapolation clamped and a flag `preInflation: true`.

### 6.6 Big Bang nucleosynthesis (`abundances.ts`)

Simple smooth model, not a reaction network:

- Before t = 100 s: free p, n; neutron fraction falls from 0.5 toward ≈ 0.14 by freeze-out (~1 s) then decays with τₙ = 879 s.
- 180 s → 1200 s: deuterium bottleneck breaks; nearly all neutrons go into He-4.
- Final mass fractions: **Yₚ ≈ 0.247**, D/H ≈ 2.5 × 10⁻⁵, Li-7/H ≈ 5 × 10⁻¹⁰ (note the lithium problem in `accuracyNote`).

### 6.7 Recombination

- Use a smooth ionization fraction `x_e(z)` with midpoint at **z ≈ 1100**, width ~80 in z (good enough for visuals). Last scattering ≈ z 1090, t ≈ 3.8 × 10⁵ yr.
- `x_e` drives fog opacity in the recombination scene.

### 6.8 Blackbody color (`blackbody.ts`)

- Integrate Planck's law against CIE 1931 2° colour-matching functions (embed a 5 nm table, 380–780 nm), convert XYZ → linear sRGB, normalise to max channel = 1.
- Precompute a 1D LUT over log₁₀ T from 3 to 12 (K); clamp outside. Expose as a 1D texture for shaders plus a CPU function.
- Temperatures below ~1000 K are not visible to the eye. For the dark ages and the CMB, use a **labelled visualisation colour map** instead (see §9.7). The UI must say "colour mapped" in those scenes.

### 6.9 Physics tests (must pass before any scene work)

| Test | Expectation |
|---|---|
| Age | 13.79 ± 0.03 Gyr |
| Matter–radiation equality | a ≈ Ω_r/Ω_m ≈ 2.9 × 10⁻⁴, t ≈ 5 × 10⁴ yr (±20%) |
| Recombination | z = 1090 → t ≈ 3.7–3.8 × 10⁵ yr |
| Acceleration onset | q = 0 at a = (Ω_m / 2Ω_Λ)^(1/3) → z ≈ 0.63 |
| Matter–Λ equality | z ≈ 0.30 |
| Monotonic | a(t) strictly increasing; tAt(aAt(t)) round-trips to 1e-9 relative |
| Fractions | omega sums to 1 ± 1e-12 everywhere |
| Blackbody | 5800 K ≈ white-yellow; 3000 K orange; 10000 K blue-white (check hue ranges) |

---

## 7. Time mapping (`src/time/`)

The universe spans ~61 powers of ten of time. No single axis works, so **the global mapping is piecewise by chapter**: each chapter owns a scroll span (`scrollWeight`) and its own internal map.

```
log      : t = 10^( lerp(log10 tStart, log10 tEnd, local) )
linear   : t = lerp(tStart, tEnd, local)
lookback : L = 10^( lerp(log10 Lstart, log10 Lend, local) );  t = t0 − L
           where L = t0 − t (lookback), clamp Lend ≥ 10⁴ yr
```

- The global function is monotonic by construction. Test it.
- `progressToTime` and `timeToProgress` must invert each other.
- Keep `t` as a JS `number` (double) on the CPU. **Never send raw `t` to the GPU** — float32 cannot hold it meaningfully. Send `log10t`, `local`, and derived globals.
- Near the present, compute lookback directly (`t0 − t`) to avoid catastrophic cancellation; prefer storing late-chapter positions in lookback.

### 7.1 Chapter table (initial)

Times in seconds unless noted. `scrollWeight` values are relative; tune later.

| id | scene | tStart | tEnd | timeMap | weight | transitionIn |
|---|---|---|---|---|---|---|
| planck | planck | 5.39e-44 | 1e-36 | log | 6 | dissolve |
| inflation | inflation | 1e-36 | 1e-32 | log | 8 | stretch |
| qgp | qgp | 1e-32 | 1e-6 | log | 8 | dissolve |
| hadrons | hadrons | 1e-6 | 1 | log | 6 | zoom |
| leptons | leptons | 1 | 180 | log | 4 | dissolve |
| bbn | bbn | 180 | 1200 | linear | 5 | zoom |
| photon | recombination | 1200 | 1.2e13 (380 kyr) | log | 9 | dissolve |
| darkAges | darkAges | 1.2e13 | 4.7e15 (150 Myr) | log | 7 | dissolve |
| firstStars | firstStars | 4.7e15 | 1.6e16 (500 Myr) | linear | 7 | zoom |
| reionization | reionization | 1.6e16 | 3.2e16 (1 Gyr) | linear | 5 | dissolve |
| cosmicNoon | cosmicNoon | 3.2e16 | 2.46e17 (7.8 Gyr) | linear | 7 | dissolve |
| darkEnergy | darkEnergy | 2.46e17 | 2.90e17 (4.6 Gyr ago) | linear | 4 | stretch |
| solarSystem | solarSystem | 4.6 Gyr ago | 4.4 Gyr ago | lookback | 6 | zoom |
| life | life | 4.4 Gyr ago | 10 kyr ago | lookback | 10 | dissolve |
| now | now | 10 kyr ago | now | lookback | 3 | zoom |

Convert "ago" values using `AGE_SECONDS` at startup. The recombination scene covers the whole photon era and peaks at its end.

### 7.2 Time labels (`format.ts`)

Unit-aware, short and long forms:
- `< 1e-3 s` → `10⁻³⁶ s` (superscript exponent)
- ms, s, min, h, days, yr, kyr, Myr, Gyr
- Late chapters show lookback: `4.6 Gyr ago`, `66 Myr ago`, `300,000 yr ago`
Test against a table of cases.

---

## 8. The primordial field (`src/shared/gaussianField.ts`)

**One** Gaussian random density field is generated once and reused by inflation, dark ages, first stars, reionization and cosmic noon. This is the throughline: the ripples seen during inflation *become* the cosmic web.

- 3D grid (quality: 64³ low / 128³ medium / 256³ high), periodic.
- Fill in Fourier space with amplitudes √P(k) × complex Gaussian noise, Hermitian-symmetric, then inverse FFT (implement a radix-2 FFT in TS, run once in a Web Worker at boot; or precompute at build time and ship as a binary asset — your choice, log it).
- Primordial spectrum `P(k) ∝ k^(n_s)` with **n_s = 0.965**. For structure scenes apply a BBKS transfer function (Bardeen et al. 1986) with shape parameter Γ = Ω_m h.
- Fixed seed so the experience is deterministic.
- Expose: density texture (3D), displacement field (gradient of potential) for Zel'dovich.

**Zel'dovich approximation** for structure: particle position `x = q + D(a) · ψ(q)` where `ψ` is the displacement field and `D(a)` the linear growth factor (compute D(a) in `cosmology.ts` by integrating the growth equation or using the Carroll–Press–Turner fit). Beyond shell-crossing, clamp/soften and blend toward TNG data (§9.8).

---

## 9. Scenes

Each scene folder contains `index.ts` (implements `CosmicScene`), `shaders.ts` (TSL), and optional `assets.ts`. Every scene must:
- Read only global uniforms + its own state.
- Animate continuously even when scroll is still (`elapsed` for idle motion).
- Respect the quality tier.
- Declare `accuracy` and a one-sentence `accuracyNote`.
- Dispose all GPU resources in `dispose()`. Test by loading/unloading 50× and checking the renderer's memory info.

Visual language: deep blacks, emissive light, physically motivated colours, slow cinematic camera. Camera is scene-owned, but every transition must hand off smoothly (Compositor handles the blend; scenes should end on a calm frame).

### 9.1 `planck` — Planck epoch & unification · *metaphor*
- **Beats:** churning quantum foam → a single bright unified field → gravity peels away as a distinct, darker layer → strong force separates (colour flicker).
- **Technique:** raymarched volume of 4D fBm noise (3D space + time), domain warping; "force strands" as instanced tube curves splitting at beats.
- **Note:** "No tested physics describes this era; this is an artistic metaphor."

### 9.2 `inflation` — cosmic inflation · *modelled*
- **Beats:** a tiny patch of foam → violent exponential stretch (camera dolly + scale) → quantum fluctuations freeze into a smooth field of faint ripples (the primordial field, §8, rendered as a translucent density slice/volume).
- **Technique:** `a` from §6.5; the field's visible scale is multiplied by `a` so ripples stretch beyond the horizon. Horizon shown as a soft spherical boundary.
- **Note:** "Inflation is strongly supported indirectly; its mechanism is unknown. Ripples follow the measured spectrum."

### 9.3 `qgp` — quark–gluon plasma & Higgs · *modelled*
- **Beats:** dense glowing particle soup (quarks R/G/B colour charge, gluon streaks) → **Higgs moment** at 10⁻¹² s: particles visibly gain inertia (motion damps, trails shorten), electroweak "split" flash → matter–antimatter asymmetry hint (one extra particle per many pairs, exaggerated).
- **Technique:** GPU particle system (compute shader on WebGPU; ping-pong float textures on WebGL2), curl-noise turbulence, additive blending, temperature from `T` via blackbody LUT (T ~10¹⁵→10¹³ K saturates to blue-white; add HDR bloom).
- **Particles:** 1M high / 250k medium / 60k low.

### 9.4 `hadrons` — confinement & annihilation · *modelled*
- **Beats:** quarks snap into triplets (protons/neutrons) and pairs (mesons) → matter/antimatter pairs annihilate in photon flashes → a sparse survivor population remains.
- **Note:** "Real survival ratio is ~1 in a billion; shown at ~1 in 50 for visibility."

### 9.5 `leptons` — neutrino decoupling & e⁺e⁻ annihilation · *modelled*
- **Beats:** neutrinos peel off as faint, fast, non-interacting streaks → electron–positron annihilation flashes, photon bath brightens (the §6.3 temperature bump visibly happens).

### 9.6 `bbn` — first nuclei · *measured (abundances)*
- **Beats:** protons and neutrons collide; deuterium forms and breaks apart until the bottleneck breaks; helium-4 nuclei form rapidly; trace lithium.
- **Technique:** instanced nucleon spheres with bonding animation; an on-canvas HUD gauge (HTML overlay, not canvas text) showing live mass fractions from `abundances.ts`.
- **Accept:** gauge settles to Yₚ ≈ 0.247 at chapter end.

### 9.7 `recombination` — photon era → CMB · *measured* — **anchor scene**
- **Beats:** opaque glowing plasma fog (photons scattering) cooling in colour → fog clears as `x_e` drops → camera pulls back to reveal the **real Planck CMB map** on the inside of a sky sphere.
- **Data:** Planck 2018 SMICA temperature map (ESA Planck Legacy Archive). `scripts/cmb_to_equirect.py` uses `healpy` to reproject HEALPix → equirectangular, export 4096×2048 (high), 2048×1024 (medium) 16-bit PNG or KTX2. Map ΔT (±300 µK) through a labelled diverging colour map (blue–white–red). Ship the CMB colour bar in the HUD.
- **Technique:** volumetric fog with density ∝ `x_e`; Rayleigh-ish scattering look; at the clearing moment, temperature anisotropies imprinted in the fog match the CMB texture (sample it on the sphere's direction) so the reveal is continuous.
- **Accept:** CMB is recognisable vs the published Planck map; credit line present.

### 9.8 `darkAges` — dark ages & cosmic web · *simulated*
- **Beats:** dark, neutral gas → dark-matter density grows from the primordial field into filaments, sheets and halos (Zel'dovich, §8), lit only by a faint visualisation colour map.
- **Data (optional, high tier):** IllustrisTNG (TNG100 or TNG50) dark-matter snapshots via the public API, downsampled to ≤2M points per snapshot at a few redshifts; `scripts/tng_to_points.py` writes binary Float32 positions + density. Blend Zel'dovich → TNG as `a` grows.
- **Technique:** instanced points with density-based size/brightness, or a raymarched density volume on high tier.

### 9.9 `firstStars` — first stars & nebulae · *modelled*
- **Beats:** gas pools in the densest halos → Population III stars ignite (very hot, blue-white, from blackbody at ~10⁵ K) → ionised nebulae glow → first supernovae blast heavy elements outward.
- **Technique:** raymarched emission nebulae; emission colours from real lines: Hα 656.3 nm (red), Hβ 486.1 nm, [O III] 500.7 nm (teal), [S II] 671.6 nm; convert wavelengths to sRGB via the CMF table. Supernova shells as expanding noise-displaced spheres.
- **Data:** halo positions taken from the darkAges field's density peaks — same universe.

### 9.10 `reionization` — reionization, first galaxies, black holes · *observed + simulated*
- **Beats:** ionised bubbles around galaxies grow and merge until the intergalactic medium is transparent → first galaxies (small, clumpy) → a quasar ignites with jets.
- **Technique:** 3D signed-distance bubbles seeded at halo peaks, radius growing with time; fog density = neutral fraction outside bubbles.

### 9.11 `cosmicNoon` — peak star formation & the Milky Way · *simulated*
- **Beats:** galaxies merge and blaze with star formation (peak ~3 Gyr) → zoom into one forming spiral that becomes the Milky Way.
- **Technique:** instanced galaxy impostors (sprite atlas generated procedurally or from TNG morphologies); the Milky Way as a particle disk with spiral density waves.
- **HUD:** cosmic star-formation-rate curve (Madau & Dickinson 2014 fit) with current-time marker.

### 9.12 `darkEnergy` — expansion accelerates · *measured*
- **Beats:** the cosmic web keeps its shape while comoving distances stretch faster; energy-budget gauge (from `omega`) shows dark energy overtaking matter.
- **Technique:** reuse the web point cloud; scale by `a` with visible acceleration; HUD stacked bar of `omega`.

### 9.13 `solarSystem` — solar nebula, Sun, Earth · *modelled (precisely dated)*
- **Beats:** an enriched molecular cloud collapses → protostar + protoplanetary disk (particle sim with Keplerian rotation and gaps) → Earth accretes → Moon-forming impact → molten Earth cools.
- **Technique:** disk particles with Keplerian velocity `v ∝ r^(−1/2)`, dust lanes; planet as a displaced sphere with emissive lava shader that cools.

### 9.14 `life` — oceans to humans · *measured dates, illustrative visuals*
- **Beats (lookback):** oceans form → earliest life (~3.8 Gyr ago) → Great Oxidation (sky and ocean colours shift as O₂ rises) → eukaryotes → Cambrian explosion → dinosaurs and their extinction (impact flash) → Homo sapiens.
- **Technique:** planet shader with atmospheric scattering (Rayleigh + Mie), changing atmosphere composition parameters; continents evolve via a noise-based approximation (label as illustrative); life shown via surface colour and HTML overlay milestones rather than literal creatures.

### 9.15 `now` — the observable universe · *measured*
- **Beats:** pull back from Earth through the Milky Way, Local Group, cosmic web, to the CMB sphere at the edge. Final energy budget: ~5% ordinary matter, ~27% dark matter, ~68% dark energy (from `omega` today, not typed).

---

## 10. Rendering system (`src/render/`)

### 10.1 Renderer
- Create `WebGPURenderer` with `antialias: false` (post AA optional), HDR float targets, ACES or AgX tone mapping, bloom post pass.
- `await renderer.init()`; detect backend (`renderer.backend.isWebGPUBackend`) and record it in `$quality`.
- Loop with `renderer.setAnimationLoop`. Pause when `document.hidden` or canvas not intersecting.
- Resize via `ResizeObserver`; DPR = `min(devicePixelRatio, tier.maxDpr)`.

### 10.2 Global uniforms (`globals.ts`)
TSL `uniform()` nodes updated once per frame from `globalsAt(t)`:
`uLog10T, uA, uLogA, uH, uTemp, uLogTemp, uOmegaR, uOmegaM, uOmegaB, uOmegaDM, uOmegaL, uElapsed, uLocal, uResolution, uBlackbodyLUT`.

### 10.3 SceneManager
- Holds the registry (`scenes/registry.ts` maps id → dynamic `import()`).
- Keeps **active + next + previous** scenes initialised; disposes others.
- Preloads the next scene when current `local > 0.6` (or when scrolling backward, the previous one when `local < 0.4`).
- If a scene fails to init, log, show its fallback still, and continue.

### 10.4 Compositor
- Each live scene renders to its own `RenderTarget` (HalfFloat).
- During a chapter's `transitionSpan`, composite outgoing and incoming targets with the chapter's `transitionIn` shader:
  - `dissolve`: noise-thresholded crossfade.
  - `zoom`: incoming scales up from centre with radial blur on outgoing.
  - `stretch`: anisotropic stretch of outgoing (expansion feel) into incoming.
- Outside transitions, render only the active scene (skip offscreen work).
- Post: bloom → tone map → film grain (subtle) → output.

### 10.5 Quality tiers (`quality.ts`)

| | low | medium | high |
|---|---|---|---|
| maxDpr | 1 | 1.5 | 2 |
| render scale | 0.6 | 0.8 | 1.0 |
| particles | 60k | 250k | 1M |
| raymarch steps | 32 | 64 | 128 |
| field grid | 64³ | 128³ | 256³ |
| TNG data | off | off | on |

- Initial tier from backend + `navigator.hardwareConcurrency` + a 1-second frame-time probe on a test scene.
- Dynamic: if median frame time > 22 ms for 3 s, drop a tier; never auto-raise mid-session.
- User override control in the nav.

### 10.6 Fallbacks
- `prefers-reduced-motion: reduce` → no continuous motion; each chapter shows a still (render one frame at `local = 0.5` and hold) and transitions are plain crossfades.
- No WebGPU and no WebGL2 → static images per chapter from `public/stills/` with the same narrative.

---

## 11. Scroll & navigation

### 11.1 Scroll driver (`scroll/driver.ts`)
- Lenis on the document; read normalised progress each frame; write `$progress`.
- Total scroll height = Σ scrollWeight × `VH_PER_WEIGHT` (start at 60vh per weight unit; tune).
- Chapter `<section>` elements are sized to match so narrative text aligns with the scene.
- Keyboard: arrow/PageUp/PageDown move by chapter beats; Home/End to start/now.

### 11.2 Timeline nav (`nav/`)
- Port of the prototype timeline (events + eras + dominant-component spine) as a **sticky rail**: right edge on desktop (vertical), top strip on mobile (horizontal, scrollable).
- Uses `timeToProgress` so rail positions match scroll exactly — the rail *is* a minimap of the scroll.
- Shows: era bands, event dots coloured by category, a moving "you are here" marker with the current time label (`format.ts`), the current scene's accuracy badge.
- Click/tap an event → smooth-scroll to its progress (Lenis `scrollTo`).
- Accessible: it's a `nav` landmark; events are buttons with labels; current position announced via an `aria-live="polite"` region at chapter changes only.

Category colours (keep consistent across nav and scenes):
`Spacetime & forces`, `Particles`, `Elements`, `Dark sector & expansion`, `Structure`, `Life` — define as CSS custom properties and mirror in TS.

---

## 12. Content

- Each chapter's narrative lives in `src/content/chapters/<id>.mdx` (Astro content collection with a zod schema: `id`, `title`, `summary`, optional `beats[]` with `{ local, text }`).
- Beats appear as HTML overlay captions at their `local` positions.
- Every chapter has a "How we know" expandable note and a sources list.
- Keep copy plain and short: one idea per beat.

---

## 13. Accuracy & honesty rules

1. Every scene declares `accuracy` + `accuracyNote`; the nav shows the badge.
2. No physical value is hand-typed in a shader. If a shader needs it, it comes from §6 via a uniform or LUT.
3. Any exaggeration (counts, speeds, sizes, ratios) is stated in the scene's note.
4. Colour-mapped (non-visible) imagery is labelled "colour mapped".
5. Use real data where it exists (Planck CMB, TNG, measured abundances) and credit it on screen and in a Credits section.
6. Uncertain dates show ranges in the nav tooltips (from `events.json` once ranges are added).

---

## 14. Data

- Seed `public/data/events.json` and `eras.json` from Appendices A and B.
- **Phase 1 task:** extend each event to `{ id, name, category, t_seconds: { best, min, max }, label, certainty, summary, sources: [{label, url}] }`. Fill `min`/`max` from the literature; where uncertain, widen and say so. Add a JSON schema and validate in tests.
- **Licensing:** check terms for Planck Legacy Archive and IllustrisTNG data before shipping; record in `DECISIONS.md` and the Credits page.

---

## 15. Testing & quality gates

- `pnpm test` (Vitest) must pass: physics (§6.9), time mapping (monotonic, round-trip, every event maps inside [0,1]), formatter, data schema.
- `pnpm build` must succeed with no TS errors (`strict`).
- Scene smoke test (dev-only route `/dev/scenes`): pick any scene, scrub `local` with a slider, show FPS and GPU memory; a "load/unload ×50" button for leak checks.
- Performance budget: 60 fps on a recent laptop at medium; ≥ 30 fps on a recent phone at low.
- Lighthouse: Accessibility ≥ 90 on the static content.

---

## 16. Build phases

Do **one phase per session**. End each phase with: tests passing, a short report (what changed, decisions, known issues), and an updated `DECISIONS.md`.

### Phase 1 — Physics & time
- `physics/*` (§6), `time/*` (§7), data schema + seeded JSON (§14).
- **Done when:** all §6.9 and §7 tests pass; a script prints `globalsAt` at each chapter boundary and the tick labels.

### Phase 2 — Skeleton
- Astro page, layouts, content collection with stub chapters, store, scroll driver, nav island (rail with eras/events/marker), renderer island with `_placeholder` scene (a coloured plane per chapter, colour from blackbody LUT of `T`).
- **Done when:** scrolling moves `t`; nav tracks it; placeholders switch per chapter; clicking a nav event jumps there.

### Phase 3 — Render system
- Global uniforms, SceneManager (load/preload/dispose), Compositor with the three transitions, post-processing, quality tiers, reduced-motion path, `/dev/scenes`.
- **Done when:** placeholder scenes blend with each transition type; leak test passes; tier switching works.

### Phase 4 — Anchor scene: recombination + CMB
- `scripts/cmb_to_equirect.py`, CMB asset, `recombination` scene complete.
- **Done when:** fog → clearing → CMB reveal is continuous and recognisable; credits shown.

### Phase 5 — Structure chain
- `gaussianField`, growth factor, `inflation`, `darkAges`, `firstStars`, `reionization`, `cosmicNoon` — all from the same field.
- **Done when:** ripples seen in inflation are traceably the same structures in the web and star-forming halos (verify by fixed seed and a debug overlay).

### Phase 6 — Early universe
- `planck`, `qgp`, `hadrons`, `leptons`, `bbn`.

### Phase 7 — Late universe
- `darkEnergy`, `solarSystem`, `life`, `now`.

### Phase 8 — Polish
- Copy pass, sources, credits, stills fallback generation, accessibility audit, performance pass on real devices, SEO metadata, Open Graph image.

---

## 17. Conventions

- TypeScript `strict`; no `any` without a comment explaining why.
- Units in names when ambiguous: `tSeconds`, `lookbackYears`, `tempK`.
- Physics functions are pure and deterministic.
- No magic numbers in scenes: put tunables in a typed `params` object at the top of each scene file.
- Shaders in TSL; shared nodes in `src/shared/`.
- Commit per logical step with clear messages.
- Don't add dependencies without logging why in `DECISIONS.md`.

---

## 18. Open questions (decide and log; don't block)

1. Precompute the primordial field at build time (binary asset) vs in a Worker at boot.
2. Mobile nav: horizontal strip vs collapsible drawer.
3. Whether the TNG data is worth its download size on medium tier.
4. Audio (ambient score/sonification) — out of scope unless requested.

---

## 19. Session 1 prompt (paste this to start)

```
Read HANDOFF.md fully. Then do Phase 1 only:

1. Scaffold an Astro + TypeScript (strict) project with pnpm, Vitest,
   ESLint and Prettier. No UI yet beyond a blank index page.
2. Implement src/physics/ (constants, cosmology, blackbody, abundances,
   powerSpectrum) per §6, and src/time/ (chapters, format) per §7.
3. Seed public/data/events.json and eras.json from Appendices A and B,
   extend events to the §14 schema with min/max ranges and sources,
   and add schema validation tests.
4. Write every test in §6.9 and §7.
5. Add scripts/print-globals.ts that prints globalsAt() at each chapter
   boundary and sample time labels.

Stop when tests pass. Report: test output, the printed table,
any deviations from HANDOFF.md, and entries added to DECISIONS.md.
```

---

## Appendix A — Seed events (`events.json`)

Times are approximate consensus values (`t_seconds` = seconds since the Big Bang, Julian years). Extend per §14.

```json
[
 {
  "event": "Planck time",
  "category": "Spacetime & forces",
  "t_seconds": 5.39e-44,
  "t_label": "5.4×10⁻⁴⁴ s",
  "certainty": "Theoretical limit",
  "description": "Earliest moment current physics can describe. Gravity is thought to split from a single unified force; spacetime behaves classically from here on."
 },
 {
  "event": "Strong force separates",
  "category": "Spacetime & forces",
  "t_seconds": 1e-36,
  "t_label": "~10⁻³⁶ s",
  "certainty": "Theoretical",
  "description": "End of grand unification: the strong nuclear force splits from the electroweak force."
 },
 {
  "event": "Cosmic inflation",
  "category": "Dark sector & expansion",
  "t_seconds": 1e-35,
  "t_label": "~10⁻³⁶–10⁻³² s",
  "certainty": "Strong indirect evidence",
  "description": "Space expands by at least a factor of 10²⁶. Quantum fluctuations are stretched into the density ripples that later seed galaxies."
 },
 {
  "event": "Reheating fills space with particles",
  "category": "Particles",
  "t_seconds": 1e-32,
  "t_label": "~10⁻³² s",
  "certainty": "Theoretical",
  "description": "Inflation ends; the inflaton field's energy converts into a hot soup of particles and radiation."
 },
 {
  "event": "Matter beats antimatter",
  "category": "Particles",
  "t_seconds": 5e-13,
  "t_label": "by ~10⁻¹² s",
  "certainty": "Unknown mechanism",
  "description": "Baryogenesis leaves a tiny excess of matter — about one extra particle per billion pairs. Why is still unsolved."
 },
 {
  "event": "Higgs field switches on",
  "category": "Spacetime & forces",
  "t_seconds": 1e-12,
  "t_label": "~10⁻¹² s",
  "certainty": "Well supported (LHC)",
  "description": "Electroweak symmetry breaking: electromagnetism and the weak force separate; quarks, electrons and W/Z bosons gain mass."
 },
 {
  "event": "Dark matter freezes out",
  "category": "Dark sector & expansion",
  "t_seconds": 4e-08,
  "t_label": "~10⁻⁸ s (if WIMP)",
  "certainty": "Model-dependent",
  "description": "If dark matter is a heavy particle, its abundance locks in here. Its identity is still unknown."
 },
 {
  "event": "Quarks bind into protons and neutrons",
  "category": "Particles",
  "t_seconds": 1e-06,
  "t_label": "~1 µs",
  "certainty": "Well supported",
  "description": "Quark–gluon plasma cools enough for quarks to be confined inside hadrons."
 },
 {
  "event": "Protons and antiprotons annihilate",
  "category": "Particles",
  "t_seconds": 0.001,
  "t_label": "~1 ms",
  "certainty": "Well supported",
  "description": "Nearly all hadrons annihilate with their antimatter partners, leaving the small matter excess behind."
 },
 {
  "event": "Neutrinos decouple",
  "category": "Particles",
  "t_seconds": 1.0,
  "t_label": "~1 s",
  "certainty": "Well supported",
  "description": "Neutrinos stop interacting and stream freely — the cosmic neutrino background."
 },
 {
  "event": "Electrons and positrons annihilate",
  "category": "Particles",
  "t_seconds": 10.0,
  "t_label": "~10 s",
  "certainty": "Well supported",
  "description": "Most electrons annihilate with positrons, heating the photons; the leftover electrons are all we have today."
 },
 {
  "event": "First nuclei: H, He, Li",
  "category": "Elements",
  "t_seconds": 180.0,
  "t_label": "3–20 min",
  "certainty": "Precisely measured",
  "description": "Big Bang nucleosynthesis: about 75% hydrogen, 25% helium by mass, a trace of lithium. Every other element comes later."
 },
 {
  "event": "Matter starts to dominate",
  "category": "Dark sector & expansion",
  "t_seconds": 1483210000000.0,
  "t_label": "~47,000 yrs",
  "certainty": "Precisely measured",
  "description": "Matter (mostly dark matter) outweighs radiation; dark-matter clumps begin to grow, building the scaffolding for galaxies."
 },
 {
  "event": "Atoms form; CMB released",
  "category": "Particles",
  "t_seconds": 11991900000000.0,
  "t_label": "~380,000 yrs",
  "certainty": "Precisely measured",
  "description": "Recombination: electrons join nuclei, the universe turns transparent, and the light we now see as the cosmic microwave background escapes."
 },
 {
  "event": "Dark ages begin",
  "category": "Structure",
  "t_seconds": 12023400000000.0,
  "t_label": "~380,000 yrs",
  "certainty": "Well supported",
  "description": "No stars yet — only cooling neutral gas and growing dark-matter halos."
 },
 {
  "event": "First stars ignite",
  "category": "Structure",
  "t_seconds": 4733640000000000.0,
  "t_label": "~100–200 Myr",
  "certainty": "Indirect evidence",
  "description": "Massive Population III stars form in the first gas clouds — the first stellar nebulae."
 },
 {
  "event": "First heavy elements forged",
  "category": "Elements",
  "t_seconds": 6311520000000000.0,
  "t_label": "~200 Myr",
  "certainty": "Indirect evidence",
  "description": "First stars fuse carbon, oxygen and iron, then explode as supernovae, seeding space with heavier elements."
 },
 {
  "event": "Earliest galaxies seen",
  "category": "Structure",
  "t_seconds": 9151700000000000.0,
  "t_label": "~290 Myr",
  "certainty": "Observed (JWST)",
  "description": "The most distant confirmed galaxies, observed by the James Webb Space Telescope."
 },
 {
  "event": "First supermassive black holes",
  "category": "Structure",
  "t_seconds": 1.35698e+16,
  "t_label": "~400–700 Myr",
  "certainty": "Observed",
  "description": "Black holes millions of times the Sun's mass already power quasars and active galaxies."
 },
 {
  "event": "Gold and uranium from neutron-star mergers",
  "category": "Elements",
  "t_seconds": 1.57788e+16,
  "t_label": "~0.5 Gyr onward",
  "certainty": "Model-dependent",
  "description": "Rapid neutron capture in mergers and rare supernovae makes the heaviest elements."
 },
 {
  "event": "Milky Way begins assembling",
  "category": "Structure",
  "t_seconds": 1.89346e+16,
  "t_label": "~0.6 Gyr",
  "certainty": "Estimated",
  "description": "Our galaxy's oldest stars date from here; it grows by swallowing smaller galaxies."
 },
 {
  "event": "Reionization complete",
  "category": "Structure",
  "t_seconds": 3.15576e+16,
  "t_label": "~1 Gyr",
  "certainty": "Observed",
  "description": "Ultraviolet light from stars and quasars has ionized nearly all the hydrogen between galaxies."
 },
 {
  "event": "Cosmic noon",
  "category": "Structure",
  "t_seconds": 1.0414e+17,
  "t_label": "~3 Gyr",
  "certainty": "Observed",
  "description": "Peak rate of star formation in the universe's history."
 },
 {
  "event": "Expansion starts accelerating",
  "category": "Dark sector & expansion",
  "t_seconds": 2.46149e+17,
  "t_label": "~7.8 Gyr",
  "certainty": "Observed (supernovae)",
  "description": "Dark energy's push overtakes gravity's pull and cosmic expansion begins to speed up."
 },
 {
  "event": "Solar nebula collapses; Sun forms",
  "category": "Structure",
  "t_seconds": 2.9033e+17,
  "t_label": "4.6 Gyr ago",
  "certainty": "Precisely dated",
  "description": "A cloud of gas and dust, enriched by earlier stars, collapses into the Sun and a planet-forming disk."
 },
 {
  "event": "Earth forms",
  "category": "Structure",
  "t_seconds": 2.92223e+17,
  "t_label": "4.54 Gyr ago",
  "certainty": "Precisely dated",
  "description": "Rocky material in the disk accretes into Earth; the Moon forms soon after in a giant impact."
 },
 {
  "event": "Dark energy dominates",
  "category": "Dark sector & expansion",
  "t_seconds": 3.25043e+17,
  "t_label": "~3.5 Gyr ago",
  "certainty": "Observed",
  "description": "Dark energy becomes the largest component of the universe's energy budget."
 },
 {
  "event": "Earliest life",
  "category": "Life",
  "t_seconds": 3.15576e+17,
  "t_label": "~3.8 Gyr ago",
  "certainty": "Debated (3.5–4.1)",
  "description": "Single-celled microbes appear in Earth's oceans."
 },
 {
  "event": "Great Oxidation Event",
  "category": "Life",
  "t_seconds": 3.59757e+17,
  "t_label": "~2.4 Gyr ago",
  "certainty": "Well dated",
  "description": "Photosynthesizing cyanobacteria fill the atmosphere with oxygen."
 },
 {
  "event": "Complex cells (eukaryotes)",
  "category": "Life",
  "t_seconds": 3.78691e+17,
  "t_label": "~1.8 Gyr ago",
  "certainty": "Debated",
  "description": "Cells with nuclei and mitochondria arise, likely from one microbe engulfing another."
 },
 {
  "event": "Cambrian explosion",
  "category": "Life",
  "t_seconds": 4.18517e+17,
  "t_label": "538 Myr ago",
  "certainty": "Well dated",
  "description": "Most major animal groups appear in the fossil record."
 },
 {
  "event": "Dinosaurs go extinct",
  "category": "Life",
  "t_seconds": 4.33412e+17,
  "t_label": "66 Myr ago",
  "certainty": "Precisely dated",
  "description": "An asteroid impact ends the age of dinosaurs and opens the way for mammals."
 },
 {
  "event": "Homo sapiens",
  "category": "Life",
  "t_seconds": 4.35485e+17,
  "t_label": "~300,000 yrs ago",
  "certainty": "Well dated",
  "description": "Anatomically modern humans appear in Africa."
 },
 {
  "event": "Now",
  "category": "Structure",
  "t_seconds": 4.35495e+17,
  "t_label": "13.8 billion years",
  "certainty": "Precisely measured",
  "description": "Today: about 5% ordinary matter, 27% dark matter, 68% dark energy."
 }
]
```

## Appendix B — Seed eras (`eras.json`)

`lane: "Epoch"` are cosmological epochs; `lane: "Dominant component"` drives the nav spine colour. A `start_s` of 0 means "from the beginning" — clamp to the Planck time on log axes.

```json
[
 {
  "era": "Planck",
  "lane": "Epoch",
  "start_s": 0.0,
  "end_s": 1e-43,
  "description": "Quantum gravity; physics unknown"
 },
 {
  "era": "Grand unification",
  "lane": "Epoch",
  "start_s": 1e-43,
  "end_s": 1e-36,
  "description": "Strong and electroweak forces unified"
 },
 {
  "era": "Inflation",
  "lane": "Epoch",
  "start_s": 1e-36,
  "end_s": 1e-32,
  "description": "Exponential expansion"
 },
 {
  "era": "Electroweak",
  "lane": "Epoch",
  "start_s": 1e-32,
  "end_s": 1e-12,
  "description": "Electromagnetic and weak forces unified"
 },
 {
  "era": "Quark",
  "lane": "Epoch",
  "start_s": 1e-12,
  "end_s": 1e-06,
  "description": "Quark–gluon plasma"
 },
 {
  "era": "Hadron",
  "lane": "Epoch",
  "start_s": 1e-06,
  "end_s": 1.0,
  "description": "Protons and neutrons form"
 },
 {
  "era": "Lepton",
  "lane": "Epoch",
  "start_s": 1.0,
  "end_s": 10.0,
  "description": "Leptons dominate the mass"
 },
 {
  "era": "Photon",
  "lane": "Epoch",
  "start_s": 10.0,
  "end_s": 11991900000000.0,
  "description": "Light dominates; nuclei form"
 },
 {
  "era": "Dark ages",
  "lane": "Epoch",
  "start_s": 11991900000000.0,
  "end_s": 4733640000000000.0,
  "description": "Neutral gas, no stars"
 },
 {
  "era": "Reionization",
  "lane": "Epoch",
  "start_s": 4733640000000000.0,
  "end_s": 3.15576e+16,
  "description": "First stars and galaxies"
 },
 {
  "era": "Stars & galaxies",
  "lane": "Epoch",
  "start_s": 3.15576e+16,
  "end_s": 4.35495e+17,
  "description": "Galaxies, planets, life"
 },
 {
  "era": "Inflaton field",
  "lane": "Dominant component",
  "start_s": 1e-36,
  "end_s": 1e-32,
  "description": "Vacuum energy drives inflation"
 },
 {
  "era": "Radiation",
  "lane": "Dominant component",
  "start_s": 1e-32,
  "end_s": 1483210000000.0,
  "description": "Radiation-dominated expansion"
 },
 {
  "era": "Matter",
  "lane": "Dominant component",
  "start_s": 1483210000000.0,
  "end_s": 3.25043e+17,
  "description": "Matter-dominated (mostly dark matter)"
 },
 {
  "era": "Dark energy",
  "lane": "Dominant component",
  "start_s": 3.25043e+17,
  "end_s": 4.35495e+17,
  "description": "Dark-energy-dominated, accelerating"
 }
]
```
