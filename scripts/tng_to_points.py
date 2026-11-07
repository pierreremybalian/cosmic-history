#!/usr/bin/env python3
"""
tng_to_points.py — IllustrisTNG dark-matter snapshots -> Float32 point clouds (HANDOFF.md §9.8).

Optional, high-tier-only data for the `darkAges` scene. The app works without these files.

USAGE
    python3 -m venv scripts/.venv
    scripts/.venv/bin/pip install -r scripts/requirements.txt
    export TNG_API_KEY=...        # free account: https://www.tng-project.org/users/register/
    scripts/.venv/bin/python scripts/tng_to_points.py --dry-run     # show plan + download size only
    scripts/.venv/bin/python scripts/tng_to_points.py               # TNG100-3-Dark at z = 6, 3, 1, 0
    scripts/.venv/bin/python scripts/tng_to_points.py --sim TNG50-4-Dark --redshifts 6 3 1 0
    scripts/.venv/bin/python scripts/tng_to_points.py --help

    Resumable: downloaded chunks (scripts/cache/tng/, gitignored) and a per-snapshot checkpoint
    are reused, so an interrupted run continues where it stopped. Re-running with the same options
    rewrites identical outputs (deterministic selection; no timestamps in the meta file).

WHAT IT DOES (per requested redshift)
    1. Picks the snapshot nearest to z from the API snapshot list (warns if |Δz| > 0.1).
    2. Streams every snapshot chunk, requesting only dark-matter Coordinates + ParticleIDs:
           GET https://www.tng-project.org/api/{sim}/files/snapshot-{snap}.{chunk}.hdf5?dm=Coordinates,ParticleIDs
       Chunks are group-ordered (not spatially random), so ALL chunks are needed for a uniform sample.
    3. Density: cloud-in-cell deposit of ALL particles onto an N³ periodic grid (default 256³),
       Gaussian-smoothed (default σ = 1 cell, FFT), ρ/ρ̄ = cell / mean. Each kept point gets the
       trilinearly interpolated ρ/ρ̄ at its position.
    4. Downsampling: a particle is kept iff splitmix64(ParticleID ^ seed) is among the smallest
       `--max-points` hashes (default 2,000,000). ParticleIDs are constant through the simulation,
       so EVERY snapshot contains the SAME particles in the SAME order (sorted by ParticleID) —
       the app can interpolate positions between snapshots per point (use the minimum-image
       convention: positions are periodic).
    5. Writes public/data/tng/tng_z{z}.bin and public/data/tng/tng_meta.json.

OUTPUT FORMAT
    tng_z{z}.bin: little-endian Float32, N records × 4 floats = [x, y, z, density], 16 bytes/record,
    no header (N = bytes / 16, also in tng_meta.json). x, y, z = comoving position / BoxSize in [0, 1).
    density = clip((log10(ρ/ρ̄) - densityLog10Min) / (densityLog10Max - densityLog10Min), 0, 1),
    with a FIXED range for all snapshots (default -1 .. 3) so structure growth is visible; invert with
    ρ/ρ̄ = 10 ** (densityLog10Min + density * (densityLog10Max - densityLog10Min)).
    {z} is the requested redshift formatted with %g, '.' replaced by 'p' (z=6 -> tng_z6.bin, 0.5 -> tng_z0p5.bin).

WHICH SIMULATION
    Default TNG100-3-Dark (455³ = 94.2M DM particles, 75 Mpc/h box, ~3.0 GB download per snapshot).
    It shares TNG100's initial conditions with TNG100-1-Dark (1820³ = 6.0 billion particles,
    ~190 GB per snapshot for Coordinates + IDs). At ≤ 2M points (≈126³) the two are visually
    indistinguishable, and the 256³ density grid is well sampled by 94M particles (~5.6 per cell).
    TNG100-1-Dark / TNG50-1-Dark work too (pass --sim and --allow-large).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import time
from pathlib import Path

import numpy as np

SCRIPT_VERSION = "1.0.0"
ROOT = Path(__file__).resolve().parent.parent
API = "https://www.tng-project.org/api"
BYTES_PER_PARTICLE = 3 * 8 + 8  # float64 Coordinates + uint64 ParticleIDs (TNG snapshot dtypes)
SLICE = 4_000_000  # particles processed at a time within a chunk (bounds memory)

CREDIT = "Dark-matter simulation: IllustrisTNG ({family}), Nelson et al. 2019, tng-project.org. Colour mapped."
CITATIONS = {
    "release": "Nelson D. et al. 2019, The IllustrisTNG simulations: public data release, Computational Astrophysics and Cosmology 6, 2 (arXiv:1812.05609)",
    "TNG100/TNG300": [
        "Pillepich A. et al. 2018b, MNRAS 475, 648 (arXiv:1707.03406)",
        "Springel V. et al. 2018, MNRAS 475, 676 (arXiv:1707.03397)",
        "Nelson D. et al. 2018a, MNRAS 475, 624 (arXiv:1707.03395)",
        "Naiman J. P. et al. 2018, MNRAS 477, 1206 (arXiv:1707.03401)",
        "Marinacci F. et al. 2018, MNRAS 480, 5113 (arXiv:1707.03396)",
    ],
    "TNG50": [
        "Nelson D. et al. 2019b, MNRAS 490, 3234 (arXiv:1902.05554)",
        "Pillepich A. et al. 2019, MNRAS 490, 3196 (arXiv:1902.05553)",
    ],
}
LICENSE = (
    "IllustrisTNG public data release (https://www.tng-project.org/data/). No formal licence is stated; "
    "use requires citing the data release paper (Nelson et al. 2019a) and the simulation introduction papers "
    "(see https://www.tng-project.org/data/docs/background/). (c) The TNG Collaboration."
)


def log(*a: object) -> None:
    print(*a, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------------------------


def session(api_key: str):
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry

    s = requests.Session()
    s.headers.update({"api-key": api_key, "User-Agent": f"cosmic-history-pipeline/{SCRIPT_VERSION}"})
    retry = Retry(total=8, connect=8, read=8, backoff_factor=2.0, status_forcelist=(429, 500, 502, 503, 504),
                  allowed_methods=("GET",), respect_retry_after_header=True)
    s.mount("https://", HTTPAdapter(max_retries=retry))
    s.mount("http://", HTTPAdapter(max_retries=retry))
    return s


def get_json(s, url: str) -> dict | list:
    r = s.get(url, timeout=60)
    if r.status_code in (401, 403):
        sys.exit(f"[api] {r.status_code} for {url}: check TNG_API_KEY (and that your account has data access)")
    r.raise_for_status()
    return r.json()


def download_chunk(s, url: str, params: dict, dest: Path) -> None:
    """Stream to dest.part, verify Content-Length, then rename. Retries whole-file on failure."""
    import requests

    part = dest.with_name(dest.name + ".part")
    for attempt in range(6):
        try:
            with s.get(url, params=params, stream=True, timeout=(30, 300)) as r:
                if r.status_code in (401, 403):
                    sys.exit(f"[api] {r.status_code} for {url}: check TNG_API_KEY")
                r.raise_for_status()
                expected = int(r.headers.get("Content-Length", "0") or 0)
                n = 0
                with open(part, "wb") as f:
                    for buf in r.iter_content(chunk_size=8 << 20):
                        f.write(buf)
                        n += len(buf)
            if expected and n != expected:
                raise IOError(f"short read {n}/{expected} B")
            part.replace(dest)
            return
        except (requests.RequestException, IOError) as e:
            wait = 10 * (attempt + 1)
            log(f"[download] {dest.name}: attempt {attempt + 1} failed ({e}); retrying in {wait}s")
            time.sleep(wait)
    sys.exit(f"[download] giving up on {url}")


# --------------------------------------------------------------------------------------------
# Numerics
# --------------------------------------------------------------------------------------------


def splitmix64(x: np.ndarray, seed: int) -> np.ndarray:
    """Deterministic 64-bit hash (uint64 arithmetic wraps, as intended)."""
    with np.errstate(over="ignore"):
        z = x.astype(np.uint64) ^ np.uint64(seed & 0xFFFFFFFFFFFFFFFF)
        z = z + np.uint64(0x9E3779B97F4A7C15)
        z = (z ^ (z >> np.uint64(30))) * np.uint64(0xBF58476D1CE4E5B9)
        z = (z ^ (z >> np.uint64(27))) * np.uint64(0x94D049BB133111EB)
        return z ^ (z >> np.uint64(31))


def _cic_weights(pos: np.ndarray, ng: int):
    g = pos * ng - 0.5
    i0 = np.floor(g).astype(np.int64)
    f = g - i0
    i0 %= ng
    i1 = (i0 + 1) % ng
    for dx in (0, 1):
        ix, wx = (i1[:, 0], f[:, 0]) if dx else (i0[:, 0], 1.0 - f[:, 0])
        for dy in (0, 1):
            iy, wy = (i1[:, 1], f[:, 1]) if dy else (i0[:, 1], 1.0 - f[:, 1])
            for dz in (0, 1):
                iz, wz = (i1[:, 2], f[:, 2]) if dz else (i0[:, 2], 1.0 - f[:, 2])
                yield (ix * ng + iy) * ng + iz, wx * wy * wz


def cic_deposit(grid: np.ndarray, pos: np.ndarray) -> None:
    ng = grid.shape[0]
    flat = grid.reshape(-1)
    for idx, w in _cic_weights(pos, ng):
        flat += np.bincount(idx, weights=w, minlength=flat.size)


def cic_interp(grid: np.ndarray, pos: np.ndarray) -> np.ndarray:
    ng = grid.shape[0]
    flat = grid.reshape(-1)
    out = np.zeros(len(pos), np.float64)
    for idx, w in _cic_weights(pos, ng):
        out += flat[idx] * w
    return out


def gaussian_smooth_periodic(grid: np.ndarray, sigma_cells: float) -> np.ndarray:
    if sigma_cells <= 0:
        return grid
    ng = grid.shape[0]
    k = np.fft.fftfreq(ng) * 2 * np.pi
    kz = np.fft.rfftfreq(ng) * 2 * np.pi
    g = np.fft.rfftn(grid)
    g *= np.exp(-0.5 * sigma_cells**2 * k[:, None, None] ** 2)
    g *= np.exp(-0.5 * sigma_cells**2 * k[None, :, None] ** 2)
    g *= np.exp(-0.5 * sigma_cells**2 * kz[None, None, :] ** 2)
    return np.fft.irfftn(g, s=grid.shape)


# --------------------------------------------------------------------------------------------
# Snapshot processing
# --------------------------------------------------------------------------------------------


class SnapshotState:
    """Accumulated grid + candidate points, checkpointed after every chunk."""

    def __init__(self, path: Path, key: str, nchunks: int, ng: int):
        self.path, self.key = path, key
        if path.exists():
            d = np.load(path, allow_pickle=False)
            if str(d["key"]) == key:
                self.grid = d["grid"].astype(np.float64)
                self.done = d["done"].copy()
                self.hash, self.ids, self.pos = d["hash"].copy(), d["ids"].copy(), d["pos"].copy()
                self.header = json.loads(str(d["header"]))
                log(f"[resume] {path.name}: {int(self.done.sum())}/{nchunks} chunks already processed")
                return
            log(f"[resume] {path.name} has different parameters; starting over")
        self.grid = np.zeros((ng, ng, ng), np.float64)
        self.done = np.zeros(nchunks, bool)
        self.hash = np.zeros(0, np.uint64)
        self.ids = np.zeros(0, np.uint64)
        self.pos = np.zeros((0, 3), np.float32)
        self.header: dict = {}

    def save(self) -> None:
        tmp = self.path.with_name(self.path.name + ".tmp.npz")
        np.savez(tmp, key=self.key, grid=self.grid, done=self.done, hash=self.hash,
                 ids=self.ids, pos=self.pos, header=json.dumps(self.header))
        tmp.replace(self.path)


def read_chunk_into(state: SnapshotState, h5path: Path, threshold: np.uint64, seed: int) -> int:
    import h5py

    with h5py.File(h5path, "r") as f:
        hd = dict(f["Header"].attrs)
        box = float(hd["BoxSize"])
        if not state.header:
            nt = np.asarray(hd["NumPart_Total"], np.uint64)
            hw = np.asarray(hd.get("NumPart_Total_HighWord", np.zeros(6)), np.uint64)
            state.header = {
                "BoxSize": box,
                "Redshift": float(hd["Redshift"]),
                "Time": float(hd["Time"]),
                "HubbleParam": float(hd.get("HubbleParam", float("nan"))),
                "Omega0": float(hd.get("Omega0", float("nan"))),
                "OmegaLambda": float(hd.get("OmegaLambda", float("nan"))),
                "NumFilesPerSnapshot": int(hd["NumFilesPerSnapshot"]),
                "NumPartTotalDM": int(nt[1] + (hw[1] << np.uint64(32))),
            }
        n = int(np.asarray(hd["NumPart_ThisFile"])[1])
        if n == 0 or "PartType1" not in f:
            return 0
        cds, ids_ds = f["PartType1/Coordinates"], f["PartType1/ParticleIDs"]
        if cds.shape[0] != n or ids_ds.shape[0] != n:
            raise IOError(f"{h5path.name}: dataset length mismatch")
        for a in range(0, n, SLICE):
            b = min(n, a + SLICE)
            pos = np.mod(np.asarray(cds[a:b], np.float64) / box, 1.0)
            cic_deposit(state.grid, pos)
            ids = np.asarray(ids_ds[a:b], np.uint64)
            h = splitmix64(ids, seed)
            keep = h < threshold
            if keep.any():
                state.hash = np.concatenate([state.hash, h[keep]])
                state.ids = np.concatenate([state.ids, ids[keep]])
                state.pos = np.concatenate([state.pos, pos[keep].astype(np.float32)])
        return n


def finalize(state: SnapshotState, max_points: int, sigma_cells: float, log_min: float, log_max: float):
    # exact, snapshot-independent selection: the max_points smallest hashes
    if len(state.hash) > max_points:
        sel = np.argpartition(state.hash, max_points - 1)[:max_points]
    else:
        sel = np.arange(len(state.hash))
    order = sel[np.argsort(state.ids[sel], kind="stable")]
    ids, pos = state.ids[order], state.pos[order].astype(np.float64)

    mean = state.grid.mean()
    rho = gaussian_smooth_periodic(state.grid / mean, sigma_cells)
    d = np.maximum(cic_interp(rho, pos), 1e-6)
    logd = np.log10(d)
    t = np.clip((logd - log_min) / (log_max - log_min), 0.0, 1.0)

    one_below = np.nextafter(np.float32(1.0), np.float32(0.0))
    out = np.empty((len(order), 4), "<f4")
    out[:, :3] = np.minimum(pos.astype(np.float32), one_below)
    out[:, 3] = t
    pct = {f"p{q}": round(float(np.percentile(logd, q)), 3) for q in (1, 5, 25, 50, 75, 95, 99)}
    grid_log = np.log10(np.maximum(rho, 1e-6))
    stats = {
        "pointLog10DensityPercentiles": pct,
        "gridLog10DensityPercentiles": {f"p{q}": round(float(np.percentile(grid_log, q)), 3) for q in (1, 50, 99)},
        "clippedLow": round(float(np.mean(logd < log_min)), 5),
        "clippedHigh": round(float(np.mean(logd > log_max)), 5),
    }
    return out, ids, stats


# --------------------------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------------------------


def z_label(z: float) -> str:
    return f"{z:g}".replace(".", "p").replace("-", "m")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter,
                                epilog="See the module docstring (top of this file) for format and conventions.")
    p.add_argument("--sim", default="TNG100-3-Dark", help="simulation name (default: %(default)s; e.g. TNG100-1-Dark, TNG50-4-Dark, TNG50-1-Dark)")
    p.add_argument("--redshifts", type=float, nargs="+", default=[6.0, 3.0, 1.0, 0.0], help="target redshifts (default: 6 3 1 0)")
    p.add_argument("--max-points", type=int, default=2_000_000, help="points per snapshot (default: %(default)s)")
    p.add_argument("--grid", type=int, default=256, help="density grid cells per side (default: %(default)s)")
    p.add_argument("--smooth-cells", type=float, default=1.0, help="Gaussian σ of the density grid in cells (default: %(default)s)")
    p.add_argument("--density-log10-min", type=float, default=-1.0, help="log10(ρ/ρ̄) mapped to density 0 (default: %(default)s)")
    p.add_argument("--density-log10-max", type=float, default=3.0, help="log10(ρ/ρ̄) mapped to density 1 (default: %(default)s)")
    p.add_argument("--seed", type=int, default=20190101, help="selection hash seed (default: %(default)s)")
    p.add_argument("--out-dir", type=Path, default=ROOT / "public/data/tng")
    p.add_argument("--cache-dir", type=Path, default=ROOT / "scripts/cache/tng")
    p.add_argument("--keep-chunks", action="store_true", help="keep downloaded HDF5 chunks in the cache (default: delete each after processing)")
    p.add_argument("--max-chunks", type=int, default=None, help="TESTING ONLY: process the first N chunks (non-uniform sample; flagged partial in meta)")
    p.add_argument("--allow-large", action="store_true", help="permit downloads above 25 GB per snapshot")
    p.add_argument("--dry-run", action="store_true", help="query the API, print the plan and download size, exit")
    p.add_argument("--api", default=API, help="API base URL (default: %(default)s)")
    args = p.parse_args()

    key = os.environ.get("TNG_API_KEY", "").strip()
    if not key:
        sys.exit("TNG_API_KEY is not set. Register at https://www.tng-project.org/users/register/, "
                 "then copy the key from https://www.tng-project.org/users/profile/ and `export TNG_API_KEY=...`.")
    if args.density_log10_max <= args.density_log10_min:
        sys.exit("--density-log10-max must exceed --density-log10-min")

    s = session(key)
    sim_url = f"{args.api}/{args.sim}/"
    sim = get_json(s, sim_url)
    nchunks = int(sim.get("num_files_snapshot") or 0)
    ndm = int(sim.get("num_dm") or 0)
    snaps = get_json(s, f"{sim_url}snapshots/")
    if not nchunks:
        sys.exit(f"[api] {args.sim}: num_files_snapshot missing from {sim_url}")

    plan = []
    for z in args.redshifts:
        best = min(snaps, key=lambda e: abs(float(e["redshift"]) - z))
        dz = abs(float(best["redshift"]) - z)
        if dz > 0.1:
            log(f"[plan] WARNING: nearest snapshot to z={z:g} is {best['number']} at z={float(best['redshift']):.3f}")
        plan.append((z, int(best["number"]), float(best["redshift"])))

    per_snap_gb = ndm * BYTES_PER_PARTICLE / 1e9 if ndm else float("nan")
    log(f"[plan] {args.sim}: {ndm:,} DM particles, {nchunks} chunks/snapshot, ~{per_snap_gb:.1f} GB download per snapshot "
        f"(Coordinates float64 + ParticleIDs uint64)")
    for z, num, zs in plan:
        log(f"[plan]   z={z:g} -> snapshot {num} (z={zs:.4f}) -> {args.out_dir / f'tng_z{z_label(z)}.bin'}")
    log(f"[plan] total ~{per_snap_gb * len(plan):.1f} GB; {args.max_points:,} points/snapshot; grid {args.grid}³; "
        f"peak RAM ~{(args.grid ** 3 * 8 * 3 + SLICE * 80) / 1e9:.1f} GB")
    if args.dry_run:
        return
    if per_snap_gb > 25 and not args.allow_large:
        sys.exit(f"[plan] {per_snap_gb:.0f} GB per snapshot; pass --allow-large to proceed (or use the default TNG100-3-Dark)")
    if ndm and args.max_points > ndm:
        args.max_points = ndm

    # Keep each particle with probability ~1.03 * max_points / N, then trim to exactly max_points smallest hashes.
    frac = min(1.0, 1.03 * args.max_points / ndm) if ndm else 1.0
    threshold = np.uint64(min(2**64 - 1, int(frac * 2**64)))

    args.out_dir.mkdir(parents=True, exist_ok=True)
    params = dict(sim=args.sim, seed=args.seed, grid=args.grid, max_points=args.max_points, max_chunks=args.max_chunks,
                  v=SCRIPT_VERSION)
    entries = []
    common_header: dict = {}

    for z, num, zs in plan:
        snap_dir = args.cache_dir / args.sim / f"snap{num:03d}"
        snap_dir.mkdir(parents=True, exist_ok=True)
        n_use = min(nchunks, args.max_chunks) if args.max_chunks else nchunks
        state_key = hashlib.sha1(json.dumps({**params, "snap": num, "n_use": n_use}, sort_keys=True).encode()).hexdigest()
        state = SnapshotState(snap_dir / "state.npz", state_key, n_use, args.grid)
        t0 = time.time()
        for c in range(n_use):
            if state.done[c]:
                continue
            h5 = snap_dir / f"snapshot-{num}.{c}.hdf5"
            if not h5.exists():
                download_chunk(s, f"{args.api}/{args.sim}/files/snapshot-{num}.{c}.hdf5",
                               {"dm": "Coordinates,ParticleIDs"}, h5)
            try:
                n = read_chunk_into(state, h5, threshold, args.seed)
            except (OSError, KeyError) as e:
                log(f"[chunk] {h5.name} unreadable ({e}); re-downloading once")
                h5.unlink(missing_ok=True)
                download_chunk(s, f"{args.api}/{args.sim}/files/snapshot-{num}.{c}.hdf5",
                               {"dm": "Coordinates,ParticleIDs"}, h5)
                n = read_chunk_into(state, h5, threshold, args.seed)
            state.done[c] = True
            state.save()
            if not args.keep_chunks:
                h5.unlink(missing_ok=True)
            el = time.time() - t0
            log(f"[snap {num}] chunk {c + 1}/{n_use}: {n:,} particles, {len(state.hash):,} candidates, {el / 60:.1f} min")

        hdr = state.header
        if hdr.get("NumFilesPerSnapshot") and hdr["NumFilesPerSnapshot"] != nchunks:
            log(f"[snap {num}] WARNING: header says {hdr['NumFilesPerSnapshot']} chunks, API said {nchunks}")
        deposited = state.grid.sum()
        if not args.max_chunks and hdr.get("NumPartTotalDM") and abs(deposited - hdr["NumPartTotalDM"]) > 0.5 + 1e-6 * deposited:
            sys.exit(f"[snap {num}] deposited {deposited:.0f} particles but header total is {hdr['NumPartTotalDM']}; aborting")

        out, ids, stats = finalize(state, args.max_points, args.smooth_cells, args.density_log10_min, args.density_log10_max)
        path = args.out_dir / f"tng_z{z_label(z)}.bin"
        tmp = path.with_name(path.name + ".tmp")
        out.tofile(tmp)
        tmp.replace(path)
        idhash = hashlib.sha1(ids.tobytes()).hexdigest()
        log(f"[write] {path} ({len(out):,} points, {path.stat().st_size / 1e6:.1f} MB) in {(time.time() - t0) / 60:.1f} min")
        common_header = {k: hdr[k] for k in ("BoxSize", "HubbleParam", "Omega0", "OmegaLambda", "NumPartTotalDM") if k in hdr}
        entries.append({
            "file": f"/data/tng/{path.name}",
            "zRequested": z,
            "snapshot": num,
            "redshift": round(hdr.get("Redshift", zs), 5),
            "scaleFactor": round(hdr.get("Time", 1.0 / (1.0 + zs)), 6),
            "count": int(len(out)),
            "bytes": int(path.stat().st_size),
            "particleIdSetSha1": idhash,
            "partial": bool(args.max_chunks),
            **stats,
        })

    meta_path = args.out_dir / "tng_meta.json"
    old = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    if old.get("sim") == args.sim and old.get("selection", {}).get("seed") == args.seed and old.get("grid") == args.grid:
        keep = [e for e in old.get("snapshots", []) if e["snapshot"] not in {x["snapshot"] for x in entries}]
        entries = keep + entries
    entries.sort(key=lambda e: -e["redshift"])
    ids_consistent = len({e["particleIdSetSha1"] for e in entries}) == 1
    meta = {
        "sim": args.sim,
        "layout": "little-endian float32; N records of [x, y, z, density]; 16 bytes per record; no header; N = bytes / 16",
        "positions": "comoving position / BoxSize, in [0, 1); periodic box (use minimum-image when interpolating between snapshots)",
        "density": {
            "encoding": "density = clip((log10(rho/rho_mean) - log10Min) / (log10Max - log10Min), 0, 1)",
            "inverse": "rho/rho_mean = 10 ** (log10Min + density * (log10Max - log10Min))",
            "log10Min": args.density_log10_min,
            "log10Max": args.density_log10_max,
            "estimator": f"cloud-in-cell deposit of all {common_header.get('NumPartTotalDM', ndm):,} DM particles on a {args.grid}^3 periodic grid, "
                         f"Gaussian smoothing sigma = {args.smooth_cells:g} cells, trilinear interpolation at each kept point",
            "cellSizeCkpcH": (common_header.get("BoxSize", float("nan")) / args.grid) if common_header else None,
            "note": "same fixed range for every snapshot, so values are comparable across redshift",
        },
        "boxSizeCkpcH": common_header.get("BoxSize"),
        "hubbleParam": common_header.get("HubbleParam"),
        "boxSizeMpc": round(common_header["BoxSize"] / 1000.0 / common_header["HubbleParam"], 3) if common_header.get("HubbleParam") else None,
        "omega0": common_header.get("Omega0"),
        "omegaLambda": common_header.get("OmegaLambda"),
        "numPartTotalDM": common_header.get("NumPartTotalDM", ndm),
        "grid": args.grid,
        "selection": {
            "method": "keep the max-points particles with the smallest splitmix64(ParticleID ^ seed); identical particle set in every snapshot",
            "order": "ascending ParticleID (record i is the same particle in every file)",
            "seed": args.seed,
            "maxPoints": args.max_points,
            "sameParticlesAcrossSnapshots": ids_consistent,
        },
        "snapshots": entries,
        "source": f"{args.api}/{args.sim}/",
        "credit": CREDIT.format(family=args.sim.split("-")[0]),
        "citation": CITATIONS["release"],
        "citationsSimulation": CITATIONS["TNG50"] if args.sim.startswith("TNG50") else CITATIONS["TNG100/TNG300"],
        "license": LICENSE,
        "generator": f"scripts/tng_to_points.py {SCRIPT_VERSION}",
    }
    tmp = meta_path.with_name(meta_path.name + ".tmp")
    tmp.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(meta_path)
    log(f"[write] {meta_path}")
    if not ids_consistent:
        log("[warn] particle sets differ between snapshots (different runs/options?)")
    log("[done]")


if __name__ == "__main__":
    main()
