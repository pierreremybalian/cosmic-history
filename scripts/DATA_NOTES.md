# Data notes — sources, processing, licensing, credits

Offline data pipeline for Cosmic History (HANDOFF §9.7, §9.8, §14). Copy the credit lines below
into the on-screen HUD credits and the Credits page, and the licensing summary into `DECISIONS.md`.

Environment: CPython 3.14.7 (Homebrew `/opt/homebrew/bin/python3.14`), venv in `scripts/.venv`,
versions pinned in `scripts/requirements.txt` (healpy 1.20.1, numpy 2.5.4, astropy 8.0.2,
pillow 13.0.0, h5py 3.16.0, requests 2.34.2). healpy has arm64 wheels for 3.14, so no fallback
interpreter was needed.

---

## 1. Planck CMB map (`public/data/cmb/`)

### Source

| | |
| --- | --- |
| Product | Planck 2018 (PR3) SMICA CMB map, full mission, release R3.00 |
| File | `COM_CMB_IQU-smica_2048_R3.00_full.fits` (2,013,312,960 bytes; header DATE 2018-04-20) |
| sha256 | `60952c645eb33d151905ddf5837477e15ca02a3261feca4ceca3c3feece4f9ac` (downloaded 2026-11-07; spot-checked against the server at range boundaries) |
| Downloaded from | NASA/IPAC IRSA mirror of the Planck Legacy Archive: https://irsa.ipac.caltech.edu/data/Planck/release_3/all-sky-maps/maps/component-maps/cmb/COM_CMB_IQU-smica_2048_R3.00_full.fits |
| Primary archive | ESA Planck Legacy Archive, https://pla.esac.esa.int/ (direct: https://pla.esac.esa.int/pla/aio/product-action?MAP.MAP_ID=COM_CMB_IQU-smica_2048_R3.00_full.fits — returned HTTP 503 on 2026-11-07, hence the mirror) |
| Format | HEALPix Nside 2048, NESTED ordering, Galactic coordinates, units K_CMB, native resolution 5′ FWHM |
| Column used | `I_STOKES_INP` (inpainted temperature; the Galactic plane and point-source holes are filled by constrained Gaussian realisation, so the map has no masked pixels) |
| Reference | Planck Collaboration 2020, *Planck 2018 results. IV. Diffuse component separation*, A&A 641, A4, doi:10.1051/0004-6361/201833881 |

A smaller official file exists (`COM_CMB_IQU-smica-nosz_2048_R3.00_full.fits`, 384 MB, the
tSZ-deprojected variant). We used the standard SMICA map, as requested; for visual use they are
indistinguishable.

### Processing (`scripts/cmb_to_equirect.py`)

1. Read `I_STOKES_INP`, reorder NESTED → RING, K_CMB → µK. Zero bad pixels found.
2. Fit monopole + dipole (full sky, for the record): monopole −0.010 µK, dipole 0.25 µK (SMICA already has both removed).
3. Smooth with a Gaussian beam of **5′ FWHM** (on top of SMICA's native 5′, so ≈7′ effective) in
   harmonic space (`map2alm` lmax 6143, 1 Jacobi iteration → `almxfl` → `alm2map`), zeroing
   ℓ = 0 and ℓ = 1 in the same step (monopole and dipole removed).
4. Resample to equirectangular with bilinear HEALPix interpolation (`healpy.get_interp_val`) on an
   8192×4096 grid, box-averaged 2×2 → 4096×2048 (anti-aliasing). 2048×1024 and 1024×512 are
   box-downsampled from the 4096 float image.
5. Quantise to 8 bits: ΔT −300 µK → 0, +300 µK → 255, linear, clipped
   (`ΔT_µK = value / 255 × 600 − 300`, step 2.35 µK). 0.39 % of pixels clip (map range −508…+520 µK, rms 104 µK).
6. Preview: ΔT/300 µK clipped to [−1, 1] through `CMB_STOPS` (parsed from `src/shared/color.ts`),
   interpolated in linear-light RGB like `cmbColor()`, sRGB-encoded, WebP q90.
7. Self-checks (written to `cmb_meta.json` → `checks`): 
   - Orientation: the written 4096 PNG, decoded at 20,000 random sky directions with the documented
     (l, b) → (u, v) formula, correlates 0.9989 with the HEALPix map (rms residual 5.3 µK); the
     mirrored convention gives 0.03. The script exits non-zero if this check fails.
   - CMB Cold Spot: mean ΔT in a 5° disc at (l, b) = (209°, −57°) is −109 µK, −3.1σ against 300
     random |b| > 30° discs (none colder); the mirrored position (151°, −57°) is +27 µK. A scan of
     5° discs below b = −30° finds a local minimum at (206.6°, −57.4°). Visually: lower right of
     the image (u ≈ 0.92, 82 % down), as in the published Planck map; the inpainted Galactic plane
     (image equator) shows no residual foreground band.

Outputs:

| File | Size | Use |
| --- | --- | --- |
| `cmb_dT_4096x2048.png` | 4,568,270 B (4.6 MB) | 8-bit gray ΔT, high tier (under 6 MB, so no WebP variant was emitted) |
| `cmb_dT_2048x1024.png` | 1,422,700 B (1.4 MB) | 8-bit gray ΔT, medium tier |
| `cmb_preview_1024x512.webp` | 375,004 B | colour-mapped preview for HUD/stills |
| `cmb_meta.json` | ~6 KB | encoding, orientation, provenance, checks, credit, licence |

Rebuild: `scripts/.venv/bin/python scripts/cmb_to_equirect.py` (≈15 s once the FITS is cached;
the first run downloads 2.0 GB). Outputs are byte-identical across re-runs.

### Orientation convention (also in `cmb_meta.json`)

- Frame: **Galactic** (l, b). Projection: equirectangular (plate carrée), full sky.
- Row 0 (top of the image) is b = +90° (North Galactic Pole); the bottom row is b = −90°.
- **l = 0° (Galactic Centre) is at the horizontal centre, u = 0.5** — exactly on the boundary
  between columns W/2 − 1 and W/2. **Longitude increases to the LEFT**: u = 0.25 is l = 90°,
  u = 0 and u = 1 (edges) are l = 180°, u = 0.75 is l = 270°. This is the standard
  "seen from inside the sphere" orientation of the published Planck all-sky maps.
- Pixel centres: column i → l = (180 − 360·(i + 0.5)/W) mod 360°; row j → b = 90 − 180·(j + 0.5)/H.
- Shader, for a unit direction d in Galactic Cartesian coordinates (x → l = 0°, b = 0°;
  y → l = 90°, b = 0°; z → NGP):
  `l = atan2(d.y, d.x); b = asin(d.z); u = fract(0.5 − l/2π); v = 0.5 + b/π`
  (v assumes three.js `flipY = true`, the `TextureLoader` default; the image-row fraction from
  the top is 1 − v). Wrap S with `RepeatWrapping` (seam at l = 180°).
- three.js shortcut: the built-in `equirectUV(dirWorld)` (`u = atan(d.z, d.x)/2π + 0.5`,
  `v = asin(d.y)/π + 0.5`) samples this texture correctly when world = (x_G, z_G, −y_G), i.e.
  world +X = Galactic Centre, world +Y = North Galactic Pole, world −Z = (l = 90°, b = 0°).
  That is a proper rotation, so the sky is not mirrored.
- The PNGs are **data**, not colour: load with `texture.colorSpace = NoColorSpace`;
  `t = 2·s − 1` (s = sampled `.r`) is ΔT / 300 µK and feeds `cmbColorNode(t)`.

### Licence and acknowledgement (Planck)

- Planck data are distributed through the ESA Space Science Archives, whose terms
  (https://www.cosmos.esa.int/web/esdc/terms-and-conditions) state: data and higher-level
  products are "open and free to use by the User subject to proper acknowledgment", distributed
  under **CC BY-NC 3.0 IGO**. **Commercial use** (anything that "directly or indirectly generates
  a financial gain") requires prior authorisation: email `data.licences@esa.int`. Users must not
  imply ESA endorsement. If Cosmic History will carry ads, sales or sponsorship, request that
  authorisation before launch.
- Mission credit line (from the ESA terms' credit table): **"Credit: ESA, Planck Collaboration"**.
- ESA's requested acknowledgement for publications using Planck data
  (https://www.cosmos.esa.int/web/planck/planck-data-use):
  > Based on observations obtained with Planck (http://www.esa.int/Planck), an ESA science
  > mission with instruments and contributions directly funded by ESA Member States, NASA, and
  > Canada.
- Cite: Planck Collaboration 2020, A&A 641, A1 (*Planck 2018 results. I. Overview*) and A&A 641,
  A4 (*IV. Diffuse component separation*, the SMICA map).
- Optional courtesy for the mirror: "This research has made use of the NASA/IPAC Infrared Science
  Archive, which is funded by the National Aeronautics and Space Administration and operated by
  the California Institute of Technology."

---

## 2. IllustrisTNG (`public/data/tng/`, optional, not generated)

### Source

- Public API: https://www.tng-project.org/api/ (docs: https://www.tng-project.org/data/docs/api/),
  requires a personal API key (`TNG_API_KEY`, sent as the `api-key` header).
- Default run: **TNG100-3-Dark** (gravity-only, 455³ = 94,196,375 DM particles, 75 Mpc/h box,
  same initial conditions as TNG100-1). Snapshots nearest z = 6, 3, 1, 0 (TNG numbering 13, 25,
  50, 99). Files fetched: `/api/TNG100-3-Dark/files/snapshot-{N}.{chunk}.hdf5?dm=Coordinates,ParticleIDs`.
- TNG100-1-Dark (1820³ ≈ 6.0 × 10⁹ particles) would need ~190 GB per snapshot for the same
  2M-point output; supported with `--sim TNG100-1-Dark --allow-large`.

### Processing (`scripts/tng_to_points.py`)

1. All particles of every chunk → periodic cloud-in-cell deposit on a 256³ grid
   (cell 293 ckpc/h for TNG100); Gaussian smoothing σ = 1 cell; ρ/ρ̄ = cell / mean.
2. Selection: keep the 2,000,000 particles with the smallest `splitmix64(ParticleID ^ seed)`;
   the same particles in every snapshot, sorted by ParticleID.
3. Each point: position / BoxSize ∈ [0, 1), density =
   clip((log10 ρ/ρ̄ + 1) / 4, 0, 1) (fixed range −1…3 for all snapshots).
4. Output little-endian Float32 `[x, y, z, density] × N` → `tng_z{z}.bin` (32 MB each at 2M points)
   plus `tng_meta.json`. Details and loading snippet: `public/data/tng/README.md`.

Status: **script written and tested against synthetic HDF5 chunks only** (no API key available).
The unauthenticated API answers 403, as expected; the first real run should start with `--dry-run`.

### Licence and acknowledgement (IllustrisTNG)

- No formal licence is published; the data are publicly released "(c) The TNG Collaboration" with
  citation requirements (https://www.tng-project.org/data/docs/background/):
  - **Always**: Nelson D. et al. 2019a, *The IllustrisTNG simulations: public data release*,
    Computational Astrophysics and Cosmology 6, 2 (arXiv:1812.05609).
  - **TNG100/TNG300 data** (our default): also the five introduction papers —
    Pillepich et al. 2018b, MNRAS 475, 648; Springel et al. 2018, MNRAS 475, 676;
    Nelson et al. 2018a, MNRAS 475, 624; Naiman et al. 2018, MNRAS 477, 1206;
    Marinacci et al. 2018, MNRAS 480, 5113.
  - **TNG50 data**: also Nelson et al. 2019b, MNRAS 490, 3234; Pillepich et al. 2019, MNRAS 490, 3196.
  - Name the project "IllustrisTNG" or "TNG", never "Illustris-TNG".
- Requested acknowledgement text: "The IllustrisTNG simulations were undertaken with compute time
  awarded by the Gauss Centre for Supercomputing (GCS) under GCS Large-Scale Projects GCS-ILLU and
  GCS-DWAR on the GCS share of the supercomputer Hazel Hen at the High Performance Computing
  Center Stuttgart (HLRS), as well as on the machines of the Max Planck Computing and Data
  Facility (MPCDF) in Garching, Germany."

---

## 3. Credit lines for the app

On screen (HUD, whenever the CMB map is visible — `recombination` and any still using it):

> Cosmic microwave background: ESA and the Planck Collaboration (Planck 2018 SMICA map, Planck Legacy Archive). Colour mapped.

Short form where space is tight: **Credit: ESA, Planck Collaboration · colour mapped**

On screen when TNG points are visible (`darkAges`, high tier only):

> Dark-matter simulation: IllustrisTNG (TNG100), Nelson et al. 2019, tng-project.org. Colour mapped.

Credits page:

> **Cosmic microwave background map** — Planck 2018 SMICA temperature map (inpainted),
> ESA Planck Legacy Archive, via NASA/IPAC IRSA. Credit: ESA, Planck Collaboration. Based on
> observations obtained with Planck (http://www.esa.int/Planck), an ESA science mission with
> instruments and contributions directly funded by ESA Member States, NASA, and Canada.
> Planck Collaboration 2020, A&A 641, A4. Used under the ESA Space Science Archives terms
> (CC BY-NC 3.0 IGO). Smoothed to ≈7′, reprojected to equirectangular, colour mapped.
>
> **Cosmic web simulation** (when TNG data ships) — IllustrisTNG Collaboration, TNG100-3-Dark,
> www.tng-project.org. Nelson et al. 2019, Computational Astrophysics and Cosmology 6, 2;
> Pillepich et al. 2018; Springel et al. 2018; Nelson et al. 2018; Naiman et al. 2018;
> Marinacci et al. 2018. The IllustrisTNG simulations were undertaken with compute time awarded
> by the Gauss Centre for Supercomputing (GCS) under GCS Large-Scale Projects GCS-ILLU and
> GCS-DWAR on the GCS share of the supercomputer Hazel Hen at the High Performance Computing
> Center Stuttgart (HLRS), as well as on the machines of the Max Planck Computing and Data
> Facility (MPCDF) in Garching, Germany. Downsampled to 2M particles, colour mapped.


## Earth geography (life scene)

- `src/scenes/life/geo/*` are built offline by `scripts/planet/geo.mjs` (Natural Earth 1:50m land polygons → per-plate signed-distance masks; NASA Blue Marble 2048 → land colour) and `scripts/planet/clouds.mjs` (Blue Marble cloud map). Both sources are public domain. The scripts use `sharp` (present transitively via Astro) and take the downloaded source files as arguments; see the header of each script.
- `src/scenes/life/geo/elevation.png` is built by `scripts/planet/elevation.py` (venv Python, numpy + Pillow): NOAA ETOPO1 Ice Surface (public domain) fetched at 5 arc-minutes from NOAA CoastWatch ERDDAP as DAP2 binary (cached in `scripts/cache/`, 37 MB), box-filtered and resampled to 2048 × 1024 in the land-colour layout, and encoded as `(metres + 150) / 2` clamped to 0–255 (−150 to +360 m in 2 m steps). Checks printed by the script: Chicxulub ≈ 0 m, central Florida ≈ 40 m, Amsterdam ≈ −2 m.
- Credit (footer): NASA Blue Marble (NASA Earth Observatory); Natural Earth; NOAA ETOPO1.
