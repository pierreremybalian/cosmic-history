# IllustrisTNG point clouds (optional)

Optional data for the `darkAges` scene (HANDOFF §9.8). **The app works without these files.** TNG is
used only on the high quality tier and is off by default (`tng: false` on low/medium in
`src/render/quality.ts`); when the files are missing the scene stays on the Zel'dovich field (§8).

Nothing here is committed by default: the `.bin` files are generated locally from the public
IllustrisTNG API, which needs a (free) personal API key.

## Generate

1. Register at https://www.tng-project.org/users/register/ and copy your API key from
   https://www.tng-project.org/users/profile/.
2. From the repo root:

```bash
python3 -m venv scripts/.venv
```

```bash
scripts/.venv/bin/pip install -r scripts/requirements.txt
```

```bash
export TNG_API_KEY=your-key-here
```

```bash
scripts/.venv/bin/python scripts/tng_to_points.py --dry-run
```

```bash
scripts/.venv/bin/python scripts/tng_to_points.py
```

Defaults: `TNG100-3-Dark`, z = 6, 3, 1, 0 (snapshots 13, 25, 50, 99), 2,000,000 points per
snapshot, 256³ density grid. Downloads only dark-matter `Coordinates` + `ParticleIDs`
(~3.0 GB per snapshot, ~12 GB total, streamed chunk by chunk; each chunk is deleted after it is
processed unless `--keep-chunks`). Interrupted runs resume from `scripts/cache/tng/`. Expect
roughly 15–60 min depending on bandwidth. Peak RAM ~1 GB.

Other runs: `--sim TNG50-4-Dark` (~0.6 GB/snapshot, 35 Mpc/h box) is a quick test.
`--sim TNG100-1-Dark` (~190 GB/snapshot) or `TNG50-1-Dark` need `--allow-large` and give no
visible benefit at 2M points. `scripts/.venv/bin/python scripts/tng_to_points.py --help` lists all options.

## Output

| File | Content |
| --- | --- |
| `tng_z6.bin`, `tng_z3.bin`, `tng_z1.bin`, `tng_z0.bin` | little-endian Float32, N × `[x, y, z, density]`, 16 B/record, no header (2M points = 32 MB each) |
| `tng_meta.json` | simulation, box size, snapshot/redshift per file, point count, density encoding, credit, citations |

- `x, y, z`: comoving position ÷ BoxSize, in [0, 1). The box is **periodic**.
- `density`: `clip((log10(ρ/ρ̄) − log10Min) / (log10Max − log10Min), 0, 1)`, default range −1…3,
  **the same for every snapshot** so growth of structure shows. Feeds `densityColorNode(t)` directly.
  ρ/ρ̄ comes from a cloud-in-cell deposit of **all** particles (not just the kept ones) on a
  256³ grid, Gaussian-smoothed by 1 cell.
- Every file holds **the same particles in the same order** (sorted by ParticleID; selected by a
  deterministic hash of the ID), so record *i* can be interpolated between snapshots. Use the
  minimum-image displacement (`d -= round(d)`) because of the periodic wrap.

Loading in the app:

```ts
const buf = await (await fetch('/data/tng/tng_z0.bin')).arrayBuffer();
const data = new Float32Array(buf); // x,y,z,density interleaved; platform is little-endian
```

## Credit (must be shown on screen when TNG data is visible, and on the Credits page)

> Dark-matter simulation: IllustrisTNG (TNG100), Nelson et al. 2019, tng-project.org. Colour mapped.

Cite: Nelson et al. 2019, *Computational Astrophysics and Cosmology* 6, 2 (data release) plus the
TNG100 introduction papers. Full list and terms: `scripts/DATA_NOTES.md`.
