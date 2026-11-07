#!/usr/bin/env python3
"""
cmb_to_equirect.py — Planck 2018 (PR3) SMICA CMB temperature map -> equirectangular textures.

Part of the Cosmic History offline data pipeline (HANDOFF.md §9.7, §14). See scripts/DATA_NOTES.md
for sources, processing details and the credit/licence lines the app must show.

USAGE
    python3 -m venv scripts/.venv
    scripts/.venv/bin/pip install -r scripts/requirements.txt
    scripts/.venv/bin/python scripts/cmb_to_equirect.py              # download (if needed) + build
    scripts/.venv/bin/python scripts/cmb_to_equirect.py --help       # all options

    Run from anywhere; paths default relative to the repo root (the parent of scripts/).
    The ~1.9 GB FITS file is cached in scripts/cache/ (gitignored) and only downloaded once
    (resumable). The smoothed HEALPix map is also cached there, so re-runs take seconds.
    Re-running with the same inputs and options rewrites byte-identical outputs (idempotent).

INPUT
    COM_CMB_IQU-smica_2048_R3.00_full.fits (Planck PR3 SMICA, HEALPix Nside 2048, NESTED,
    Galactic coordinates, K_CMB). Column I_STOKES_INP (inpainted temperature) is used when
    present, else I_STOKES.

PROCESSING
    1. K_CMB -> µK.
    2. Gaussian smoothing, FWHM 5 arcmin by default (--fwhm-arcmin), done in harmonic space up
       to lmax = 3*Nside-1. In the same step the monopole (ℓ=0) and dipole (ℓ=1) are zeroed
       (--keep-low-ell to disable). Both are ~0 in SMICA already; the fitted values are logged
       in the meta file. With --fwhm-arcmin 0 the monopole/dipole are removed in pixel space.
    3. Equirectangular resampling with bilinear HEALPix interpolation (healpy get_interp_val),
       supersampled 2x2 per output pixel (--supersample) and box-averaged (anti-aliasing).
       The 2048 and 1024 products are box-downsampled from the 4096 float image.
    4. 8-bit quantisation: ΔT -300 µK -> 0, +300 µK -> 255, linear, clipped.

OUTPUTS (public/data/cmb/)
    cmb_dT_4096x2048.png       8-bit grayscale ΔT (raw data; the app colour-maps it in a shader)
    cmb_dT_2048x1024.png       same, medium tier
    cmb_dT_4096x2048.webp      lossless WebP of the 4096 map, only if the PNG exceeds
                               --webp-threshold-mb (default 6 MB)
    cmb_preview_1024x512.webp  colour-mapped preview (CMB_STOPS from src/shared/color.ts)
    cmb_meta.json              encoding, orientation convention, provenance, credit, licence

ORIENTATION CONVENTION (also written to cmb_meta.json)
    Galactic coordinates (l, b). Image row 0 is the TOP (b = +90°, North Galactic Pole).
    The image centre column boundary u = 0.5 is l = 0° (Galactic Centre direction); Galactic
    longitude INCREASES TO THE LEFT (standard "sky seen from inside" orientation, as in the
    published Planck maps). u = 0 / u = 1 (left/right edges) are l = 180°.
        pixel column i of W:  l = (180 - 360*(i+0.5)/W) mod 360  [deg]
        pixel row    j of H:  b =  90 - 180*(j+0.5)/H            [deg]
    Shader, for a unit direction d in the Galactic Cartesian frame
    (x -> (l=0,b=0), y -> (l=90°,b=0), z -> North Galactic Pole):
        l = atan2(d.y, d.x);  b = asin(d.z)
        u = fract(0.5 - l / (2π))
        v = 0.5 + b / π        (three.js texture with flipY = true, the TextureLoader default;
                                image-row fraction from the top is 1 - v)
    Equivalently, three.js's built-in equirectUV(dirWorld) reproduces this exactly when
    world = (x_G, z_G, -y_G): world +X = Galactic Centre, +Y = North Galactic Pole,
    -Z = (l = 90°, b = 0). That is a proper rotation (no mirroring).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np

SCRIPT_VERSION = "1.0.0"

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FILE = "COM_CMB_IQU-smica_2048_R3.00_full.fits"
IRSA_URL = (
    "https://irsa.ipac.caltech.edu/data/Planck/release_3/all-sky-maps/maps/component-maps/cmb/"
    + DEFAULT_FILE
)
PLA_URL = "https://pla.esac.esa.int/pla/aio/product-action?MAP.MAP_ID=" + DEFAULT_FILE
KNOWN_SIZES = {DEFAULT_FILE: 2_013_312_960}

# Fallback copy of CMB_STOPS in src/shared/color.ts (the script reads that file when present).
FALLBACK_CMB_STOPS = [
    (-1.0, "#0a0f3d"),
    (-0.66, "#1b3fa8"),
    (-0.33, "#5aa2e6"),
    (0.0, "#f4f1e6"),
    (0.33, "#f2a35a"),
    (0.66, "#c8432a"),
    (1.0, "#5c0d12"),
]

CREDIT = "CMB map: ESA and the Planck Collaboration (Planck 2018 SMICA, Planck Legacy Archive). Colour mapped."
CREDIT_SHORT = "Credit: ESA, Planck Collaboration"
LICENSE = (
    "ESA Space Science Archives terms (https://www.cosmos.esa.int/web/esdc/terms-and-conditions): "
    "data distributed under CC BY-NC 3.0 IGO; free to use with acknowledgement; commercial use "
    "requires prior authorisation from ESA (data.licences@esa.int)."
)
ACKNOWLEDGEMENT = (
    "Based on observations obtained with Planck (http://www.esa.int/Planck), an ESA science mission "
    "with instruments and contributions directly funded by ESA Member States, NASA, and Canada."
)
CITATION = (
    "Planck Collaboration 2020, Planck 2018 results. IV. Diffuse component separation, "
    "A&A 641, A4, doi:10.1051/0004-6361/201833881"
)


def log(*a: object) -> None:
    print(*a, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------------------------
# Download / provenance
# --------------------------------------------------------------------------------------------


def download(url: str, dest: Path, expected: int | None) -> None:
    """Resumable download to dest (via dest.part). Verifies size when known."""
    part = dest.with_name(dest.name + ".part")
    if dest.exists() and expected and dest.stat().st_size < expected:
        log(f"[download] {dest.name} is incomplete ({dest.stat().st_size} B); resuming")
        dest.replace(part)
    have = part.stat().st_size if part.exists() else 0
    req = urllib.request.Request(url, headers={"User-Agent": f"cosmic-history-pipeline/{SCRIPT_VERSION}"})
    if have:
        req.add_header("Range", f"bytes={have}-")
    log(f"[download] {url}\n           -> {dest} (resume from {have} B)" if have else f"[download] {url}\n           -> {dest}")
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                if have and r.status != 206:
                    log("[download] server ignored Range; restarting from 0")
                    have = 0
                total = have + int(r.headers.get("Content-Length", "0") or 0)
                mode = "ab" if have else "wb"
                t0, done, last = time.time(), have, 0.0
                with open(part, mode) as f:
                    while True:
                        buf = r.read(8 << 20)
                        if not buf:
                            break
                        f.write(buf)
                        done += len(buf)
                        if time.time() - last > 5:
                            last = time.time()
                            rate = (done - have) / max(1e-6, last - t0) / 1e6
                            pct = f"{100 * done / total:5.1f}%" if total else ""
                            log(f"[download] {done / 1e6:8.1f} MB {pct}  {rate:5.2f} MB/s")
            break
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            have = part.stat().st_size if part.exists() else 0
            log(f"[download] attempt {attempt + 1} failed ({e}); retrying from {have} B")
            time.sleep(5 * (attempt + 1))
            req = urllib.request.Request(url, headers={"User-Agent": f"cosmic-history-pipeline/{SCRIPT_VERSION}"})
            if have:
                req.add_header("Range", f"bytes={have}-")
    else:
        sys.exit("[download] giving up")
    size = part.stat().st_size
    if expected and size != expected:
        sys.exit(f"[download] size mismatch: got {size} B, expected {expected} B (left at {part})")
    part.replace(dest)
    log(f"[download] done: {size} B")


def sha256_cached(path: Path) -> str:
    """sha256 of a large file, cached in a sidecar keyed by size+mtime."""
    side = path.with_name(path.name + ".sha256")
    st = path.stat()
    key = f"{st.st_size} {int(st.st_mtime)}"
    if side.exists():
        k, _, h = side.read_text().strip().rpartition(" ")
        if k == key:
            return h
    log(f"[sha256] hashing {path.name} …")
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for buf in iter(lambda: f.read(16 << 20), b""):
            h.update(buf)
    digest = h.hexdigest()
    side.write_text(f"{key} {digest}\n")
    return digest


# --------------------------------------------------------------------------------------------
# Map processing
# --------------------------------------------------------------------------------------------


def read_header_and_column(path: Path, column: str | None) -> tuple[dict, str, int]:
    from astropy.io import fits

    with fits.open(path, memmap=True) as hdul:
        hdr = hdul[1].header
        names = [hdr[f"TTYPE{i}"].strip() for i in range(1, int(hdr["TFIELDS"]) + 1)]
        units = [str(hdr.get(f"TUNIT{i}", "")).strip() for i in range(1, int(hdr["TFIELDS"]) + 1)]
        info = {
            "NSIDE": int(hdr["NSIDE"]),
            "ORDERING": str(hdr["ORDERING"]).strip(),
            "COORDSYS": str(hdr.get("COORDSYS", "")).strip(),
            "BAD_DATA": float(hdr.get("BAD_DATA", -1.6375e30)),
            "METHOD": str(hdr.get("METHOD", "")).strip(),
            "columns": names,
        }
    if column is None:
        column = "I_STOKES_INP" if "I_STOKES_INP" in names else "I_STOKES"
    if column not in names:
        sys.exit(f"column {column!r} not in {names}")
    idx = names.index(column)
    info["unit"] = units[idx]
    return info, column, idx


def load_processed_map(args: argparse.Namespace, path: Path, sha: str) -> tuple[np.ndarray, dict]:
    import healpy as hp

    info, column, idx = read_header_and_column(path, args.column)
    if info["COORDSYS"].upper() not in ("GALACTIC", "G"):
        sys.exit(f"expected a Galactic-coordinate map, got COORDSYS={info['COORDSYS']!r}")
    nside = info["NSIDE"]
    lmax = args.lmax or 3 * nside - 1
    remove = not args.keep_low_ell
    key = f"{path.stem}_{sha[:12]}_{column}_fwhm{args.fwhm_arcmin:g}_lmax{lmax}_iter{args.iter}_{'l2+' if remove else 'all'}"
    cache_npy = args.cache_dir / f"{key}.npy"
    cache_json = args.cache_dir / f"{key}.json"
    if cache_npy.exists() and cache_json.exists() and not args.reprocess:
        log(f"[map] using cached processed map {cache_npy.name}")
        return np.load(cache_npy), json.loads(cache_json.read_text())

    unit = info["unit"].upper()
    scale = {"K_CMB": 1e6, "K": 1e6, "MK_CMB": 1e3, "UK_CMB": 1.0, "UK": 1.0}.get(unit)
    if scale is None:
        sys.exit(f"unexpected unit {info['unit']!r}")

    t0 = time.time()
    log(f"[map] reading {path.name} column {column} (field {idx}, {info['ORDERING']}, Nside {nside}) …")
    m = hp.read_map(str(path), field=idx, nest=False, dtype=np.float64)  # reorders NESTED -> RING
    bad = ~np.isfinite(m) | (m <= info["BAD_DATA"] * 0.9) | (m == hp.UNSEEN)
    n_bad = int(bad.sum())
    m *= scale
    m[bad] = hp.UNSEEN
    mono, dip = hp.fit_dipole(m, gal_cut=0)
    dip_amp = float(np.linalg.norm(dip))
    dip_l, dip_b = hp.vec2ang(np.asarray(dip) / dip_amp, lonlat=True) if dip_amp > 0 else ([0.0], [0.0])
    log(f"[map] read in {time.time() - t0:.1f}s; bad pixels {n_bad}; fitted monopole {mono:+.3f} µK, "
        f"dipole {dip_amp:.3f} µK towards (l,b)=({float(dip_l[0]):.1f},{float(dip_b[0]):.1f})")
    if n_bad:
        log(f"[map] WARNING: {n_bad} bad pixels set to the monopole before smoothing")
        m[bad] = mono

    if args.fwhm_arcmin > 0:
        t1 = time.time()
        log(f"[map] map2alm lmax={lmax} iter={args.iter} …")
        alm = hp.map2alm(m, lmax=lmax, iter=args.iter)
        fl = hp.gauss_beam(math.radians(args.fwhm_arcmin / 60.0), lmax=lmax)
        if remove:
            fl[:2] = 0.0
        alm = hp.almxfl(alm, fl)
        log("[map] alm2map …")
        m = hp.alm2map(alm, nside, lmax=lmax)
        del alm
        log(f"[map] smoothing done in {time.time() - t1:.1f}s")
    elif remove:
        m = hp.remove_dipole(m, gal_cut=0)

    m = m.astype(np.float32)
    proc = {
        "column": column,
        "unit": info["unit"],
        "nside": nside,
        "ordering": info["ORDERING"],
        "coordsys": info["COORDSYS"],
        "method": info["METHOD"],
        "badPixels": n_bad,
        "lmax": lmax if args.fwhm_arcmin > 0 else None,
        "iter": args.iter if args.fwhm_arcmin > 0 else None,
        "fittedMonopoleMicroK": round(float(mono), 4),
        "fittedDipoleAmplitudeMicroK": round(dip_amp, 4),
        "fittedDipoleDirectionLB": [round(float(dip_l[0]), 2), round(float(dip_b[0]), 2)],
        "monopoleDipoleRemoved": remove,
    }
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    np.save(cache_npy, m)
    cache_json.write_text(json.dumps(proc, indent=2))
    return m, proc


def sample_equirect(m: np.ndarray, W: int, H: int, ss: int, block_rows: int = 64) -> np.ndarray:
    """Bilinear HEALPix interpolation on an ss×ss supersampled grid, box-averaged to W×H."""
    import healpy as hp

    Wf, Hf = W * ss, H * ss
    lon = 180.0 - 360.0 * (np.arange(Wf) + 0.5) / Wf  # longitude increases to the LEFT
    out = np.empty((H, W), np.float32)
    t0 = time.time()
    for r0 in range(0, H, block_rows):
        r1 = min(H, r0 + block_rows)
        jf = np.arange(r0 * ss, r1 * ss)
        lat = 90.0 - 180.0 * (jf + 0.5) / Hf
        LON = np.broadcast_to(lon, (jf.size, Wf)).ravel()
        LAT = np.repeat(lat, Wf)
        vals = hp.get_interp_val(m, LON, LAT, lonlat=True).reshape(jf.size, Wf)
        out[r0:r1] = vals.reshape(r1 - r0, ss, W, ss).mean(axis=(1, 3))
    log(f"[sample] {W}x{H} (x{ss} supersampled) in {time.time() - t0:.1f}s")
    return out


def box_down(a: np.ndarray, f: int) -> np.ndarray:
    H, W = a.shape
    return a.reshape(H // f, f, W // f, f).mean(axis=(1, 3), dtype=np.float64).astype(np.float32)


def quantize(T: np.ndarray, lo: float, hi: float) -> np.ndarray:
    return np.clip(np.rint((T - lo) / (hi - lo) * 255.0), 0, 255).astype(np.uint8)


# --------------------------------------------------------------------------------------------
# Colour preview (mirrors cmbColor() in src/shared/color.ts)
# --------------------------------------------------------------------------------------------


def load_cmb_stops(color_ts: Path) -> tuple[list[tuple[float, str]], str]:
    try:
        txt = color_ts.read_text()
        block = re.search(r"CMB_STOPS[^=]*=\s*\[(.*?)\];", txt, re.S)
        pairs = re.findall(r"\[\s*(-?[0-9.]+)\s*,\s*['\"](#[0-9a-fA-F]{6})['\"]\s*\]", block.group(1) if block else "")
        stops = [(float(a), c.lower()) for a, c in pairs]
        if len(stops) >= 2:
            return stops, str(color_ts.relative_to(ROOT)) if color_ts.is_relative_to(ROOT) else str(color_ts)
    except OSError:
        pass
    log(f"[preview] WARNING: could not parse CMB_STOPS from {color_ts}; using built-in copy")
    return FALLBACK_CMB_STOPS, "built-in copy of src/shared/color.ts CMB_STOPS"


def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    return np.where(c < 0.04045, c * 0.0773993808, (c * 0.9478672986 + 0.0521327014) ** 2.4)


def linear_to_srgb(c: np.ndarray) -> np.ndarray:
    return np.where(c < 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 0), 0.41666) - 0.055)


def colour_map(T: np.ndarray, range_uK: float, stops: list[tuple[float, str]]) -> np.ndarray:
    """t = ΔT/range in [-1,1]; piecewise-linear between stops in linear-light RGB (as three.js
    Color.lerp does in cmbColor()), encoded back to sRGB 8-bit."""
    t = np.clip(T / range_uK, -1.0, 1.0)
    xs = np.array([s[0] for s in stops])
    rgb = np.array([[int(h[i : i + 2], 16) / 255.0 for i in (1, 3, 5)] for _, h in stops])
    lin = srgb_to_linear(rgb)
    out = np.empty(T.shape + (3,), np.float64)
    for ch in range(3):
        out[..., ch] = np.interp(t, xs, lin[:, ch])
    return np.clip(np.rint(linear_to_srgb(out) * 255.0), 0, 255).astype(np.uint8)


# --------------------------------------------------------------------------------------------
# Verification
# --------------------------------------------------------------------------------------------


def dir_to_uv(l_deg: np.ndarray, b_deg: np.ndarray, mirrored: bool = False) -> tuple[np.ndarray, np.ndarray]:
    """Documented convention -> (u, row fraction from top)."""
    u = np.mod(0.5 + (l_deg if mirrored else -l_deg) / 360.0, 1.0)
    return u, 0.5 - b_deg / 180.0


def bilinear_decode(img: np.ndarray, u: np.ndarray, vtop: np.ndarray, lo: float, hi: float) -> np.ndarray:
    H, W = img.shape
    x = u * W - 0.5
    y = np.clip(vtop * H - 0.5, 0, H - 1)
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx, fy = x - x0, y - y0
    x0 %= W
    x1 = (x0 + 1) % W
    y1 = np.minimum(y0 + 1, H - 1)
    a = img.astype(np.float64)
    v = (a[y0, x0] * (1 - fx) * (1 - fy) + a[y0, x1] * fx * (1 - fy) + a[y1, x0] * (1 - fx) * fy + a[y1, x1] * fx * fy)
    return lo + v / 255.0 * (hi - lo)


def self_check(m: np.ndarray, png: Path, lo: float, hi: float, n: int = 20000) -> dict:
    """Decode the written PNG at random directions using the documented (l,b)->(u,v) convention
    and compare with the HEALPix map. A mirrored convention must fail."""
    import healpy as hp
    from PIL import Image

    img = np.asarray(Image.open(png))
    rng = np.random.default_rng(12345)
    lon = rng.uniform(0.0, 360.0, n)
    lat = np.degrees(np.arcsin(rng.uniform(-1.0, 1.0, n)))
    truth = np.clip(hp.get_interp_val(m, lon, lat, lonlat=True), lo, hi)
    ok = bilinear_decode(img, *dir_to_uv(lon, lat), lo, hi)
    bad = bilinear_decode(img, *dir_to_uv(lon, lat, mirrored=True), lo, hi)
    r_ok = float(np.corrcoef(truth, ok)[0, 1])
    r_bad = float(np.corrcoef(truth, bad)[0, 1])
    rms = float(np.sqrt(np.mean((truth - ok) ** 2)))
    return {
        "samples": n,
        "image": png.name,
        "correlation": round(r_ok, 4),
        "correlationIfMirrored": round(r_bad, 4),
        "rmsResidualMicroK": round(rms, 2),
        "passed": bool(r_ok > 0.9 and abs(r_bad) < 0.3),
    }


def cold_spot_stat(m: np.ndarray, radius_deg: float = 5.0, n_random: int = 300) -> dict:
    """Mean ΔT in a disc at the CMB Cold Spot (l=209°, b=-57°) vs random discs with |b|>30°."""
    import healpy as hp

    nside = hp.npix2nside(m.size)
    r = math.radians(radius_deg)

    def disc_mean(l: float, b: float) -> float:
        return float(m[hp.query_disc(nside, hp.ang2vec(l, b, lonlat=True), r)].mean())

    cs = disc_mean(209.0, -57.0)
    rng = np.random.default_rng(7)
    vals = []
    while len(vals) < n_random:
        l, b = rng.uniform(0, 360), math.degrees(math.asin(rng.uniform(-1, 1)))
        if abs(b) > 30:
            vals.append(disc_mean(l, b))
    vals = np.array(vals)
    return {
        "centreLB": [209.0, -57.0],
        "discRadiusDeg": radius_deg,
        "meanMicroK": round(cs, 2),
        "randomDiscMeanMicroK": round(float(vals.mean()), 2),
        "randomDiscStdMicroK": round(float(vals.std()), 2),
        "sigma": round(float((cs - vals.mean()) / vals.std()), 2),
        "fractionOfRandomDiscsColder": round(float((vals < cs).mean()), 4),
    }


# --------------------------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------------------------


def show(path: Path) -> str:
    return str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path)


def save_atomic(img, path: Path, **kw) -> int:
    tmp = path.with_name(path.name + ".tmp")
    img.save(tmp, **kw)
    tmp.replace(path)
    return path.stat().st_size


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter,
                                epilog="See the module docstring (top of this file) for the full convention.")
    p.add_argument("--input", type=Path, default=ROOT / "scripts/cache" / DEFAULT_FILE, help="HEALPix FITS file (default: scripts/cache/%(default)s)")
    p.add_argument("--url", default=IRSA_URL, help=f"download URL if --input is missing (default: IRSA mirror; ESA PLA: {PLA_URL})")
    p.add_argument("--no-download", action="store_true", help="fail instead of downloading a missing input")
    p.add_argument("--column", default=None, help="FITS column (default: I_STOKES_INP if present, else I_STOKES)")
    p.add_argument("--fwhm-arcmin", type=float, default=5.0, help="Gaussian smoothing FWHM in arcmin; 0 disables (default: %(default)s)")
    p.add_argument("--keep-low-ell", action="store_true", help="do not remove the monopole and dipole")
    p.add_argument("--lmax", type=int, default=None, help="harmonic lmax for smoothing (default: 3*Nside-1)")
    p.add_argument("--iter", type=int, default=1, help="map2alm Jacobi iterations (default: %(default)s)")
    p.add_argument("--range-uK", type=float, default=300.0, help="ΔT mapped to [0,255] is [-R,+R] µK (default: %(default)s)")
    p.add_argument("--supersample", type=int, default=2, help="per-axis supersampling for the 4096 map (default: %(default)s)")
    p.add_argument("--out-dir", type=Path, default=ROOT / "public/data/cmb")
    p.add_argument("--cache-dir", type=Path, default=ROOT / "scripts/cache")
    p.add_argument("--color-ts", type=Path, default=ROOT / "src/shared/color.ts", help="file holding CMB_STOPS")
    p.add_argument("--webp-threshold-mb", type=float, default=6.0, help="also write a lossless WebP of the 4096 map if its PNG exceeds this")
    p.add_argument("--reprocess", action="store_true", help="ignore the cached smoothed map")
    p.add_argument("--skip-checks", action="store_true", help="skip orientation self-check and Cold Spot statistic")
    args = p.parse_args()

    from PIL import Image

    src = args.input.resolve()
    if not src.exists() or (src.name in KNOWN_SIZES and src.stat().st_size < KNOWN_SIZES[src.name]):
        if args.no_download:
            sys.exit(f"missing or incomplete input {src}")
        src.parent.mkdir(parents=True, exist_ok=True)
        download(args.url, src, KNOWN_SIZES.get(src.name))
    sha = sha256_cached(src)
    m, proc = load_processed_map(args, src, sha)

    lo, hi = -args.range_uK, args.range_uK
    W, H = 4096, 2048
    full = sample_equirect(m, W, H, args.supersample)
    med = box_down(full, 2)
    prev = box_down(full, 4)

    out = args.out_dir
    out.mkdir(parents=True, exist_ok=True)
    files = []

    def rel(path: Path) -> str:
        return "/" + str(path.relative_to(ROOT / "public")) if path.is_relative_to(ROOT / "public") else str(path)

    for arr, name, tier in ((full, "cmb_dT_4096x2048.png", "high"), (med, "cmb_dT_2048x1024.png", "medium")):
        q = quantize(arr, lo, hi)
        path = out / name
        size = save_atomic(Image.fromarray(q, mode="L"), path, format="PNG", optimize=True)
        files.append({"path": rel(path), "width": q.shape[1], "height": q.shape[0], "format": "png",
                      "pixel": "uint8 grayscale (L8)", "bytes": size, "tier": tier})
        log(f"[write] {show(path)}  {size / 1e6:.2f} MB")

    big = out / "cmb_dT_4096x2048.webp"
    if files[0]["bytes"] > args.webp_threshold_mb * 1e6:
        q = quantize(full, lo, hi)
        size = save_atomic(Image.fromarray(q, mode="L").convert("RGB"), big, format="WEBP", lossless=True, quality=100, method=6)
        files.insert(1, {"path": rel(big), "width": W, "height": H, "format": "webp-lossless",
                         "pixel": "identical values in R=G=B (read .r)", "bytes": size, "tier": "high (smaller alternative to the PNG)"})
        log(f"[write] {show(big)}  {size / 1e6:.2f} MB (lossless; PNG exceeded {args.webp_threshold_mb} MB)")
    elif big.exists():
        big.unlink()

    stops, stops_src = load_cmb_stops(args.color_ts)
    rgb = colour_map(prev, args.range_uK, stops)
    path = out / "cmb_preview_1024x512.webp"
    size = save_atomic(Image.fromarray(rgb, mode="RGB"), path, format="WEBP", quality=90, method=6)
    files.append({"path": rel(path), "width": 1024, "height": 512, "format": "webp", "pixel": "sRGB colour-mapped preview",
                  "bytes": size, "tier": "HUD / stills"})
    log(f"[write] {show(path)}  {size / 1e6:.2f} MB")

    stats = {
        "rmsMicroK": round(float(np.sqrt(np.mean(full.astype(np.float64) ** 2))), 2),
        "minMicroK": round(float(full.min()), 1),
        "maxMicroK": round(float(full.max()), 1),
        "clippedFraction": round(float(np.mean((full < lo) | (full > hi))), 6),
        "note": "pixel statistics of the 4096x2048 float image (equirectangular, not area-weighted)",
    }
    checks = {}
    if not args.skip_checks:
        checks["orientation"] = self_check(m, out / "cmb_dT_4096x2048.png", lo, hi)
        log(f"[check] orientation: {checks['orientation']}")
        checks["coldSpot"] = cold_spot_stat(m)
        log(f"[check] cold spot: {checks['coldSpot']}")

    meta = {
        "minMicroK": lo,
        "maxMicroK": hi,
        "encoding": {
            "type": "uint8 grayscale, linear in ΔT",
            "decode": "dT_microK = value / 255 * (maxMicroK - minMicroK) + minMicroK   (0 -> -300 µK, 255 -> +300 µK; values beyond ±300 µK are clipped)",
            "shader": "s = texture(...).r in [0,1]; t = 2*s - 1 in [-1,1] (= ΔT/300 µK) -> cmbColorNode(t)",
            "stepMicroK": round((hi - lo) / 255.0, 4),
            "colorSpace": "data, not colour: load with texture.colorSpace = NoColorSpace (no sRGB decode)",
        },
        "projection": "equirectangular",
        "frame": "galactic",
        "lonAtCenterDeg": 0,
        "lonIncreases": "left",
        "lonAtLeftEdgeDeg": 180,
        "lonAtRightEdgeDeg": 180,
        "latTop": 90,
        "latBottom": -90,
        "convention": {
            "pixelCentres": "column i (0-based, left to right) of W: l = (180 - 360*(i+0.5)/W) mod 360 deg; row j (0-based, top to bottom) of H: b = 90 - 180*(j+0.5)/H deg",
            "galacticCentre": "l = 0 lies exactly on the boundary between columns W/2-1 and W/2 (u = 0.5); u = 0.25 is l = 90°, u = 0.75 is l = 270°, u = 0 and u = 1 are l = 180° (wrap: use RepeatWrapping on S)",
            "galacticCartesian": "x -> (l=0°, b=0°) Galactic Centre, y -> (l=90°, b=0°), z -> North Galactic Pole (b=+90°); right-handed",
            "dirToUv": "l = atan2(d.y, d.x); b = asin(d.z); u = fract(0.5 - l/(2π)); v = 0.5 + b/π  (v for three.js flipY = true, the TextureLoader default; image row fraction from top = 1 - v = 0.5 - b/π)",
            "threeEquirectUV": "three.js equirectUV(dirWorld) [u = atan(d.z, d.x)/(2π) + 0.5, v = asin(d.y)/π + 0.5] samples this texture correctly when world = (x_G, z_G, -y_G): world +X = Galactic Centre, world +Y = North Galactic Pole, world -Z = (l=90°, b=0°). Proper rotation, not mirrored.",
            "orientation": "sky as seen from inside the celestial sphere, same as published Planck all-sky maps (Galactic Centre in the middle, l increasing to the left)",
        },
        "files": files,
        "source": args.url,
        "sourceAlternate": PLA_URL if args.url != PLA_URL else IRSA_URL,
        "file": src.name,
        "fileBytes": src.stat().st_size,
        "fileSha256": sha,
        "release": "Planck 2018 (PR3) SMICA CMB map, R3.00 full mission",
        "column": proc["column"],
        "unit": proc["unit"],
        "nside": proc["nside"],
        "ordering": proc["ordering"],
        "smoothingArcmin": args.fwhm_arcmin,
        "smoothing": (f"Gaussian beam FWHM {args.fwhm_arcmin:g}′ applied in harmonic space (lmax {proc['lmax']}, map2alm iter {proc['iter']}), on top of SMICA's native 5′ resolution"
                      if args.fwhm_arcmin > 0 else "none"),
        "monopoleDipoleRemoved": proc["monopoleDipoleRemoved"],
        "fittedMonopoleMicroK": proc["fittedMonopoleMicroK"],
        "fittedDipoleAmplitudeMicroK": proc["fittedDipoleAmplitudeMicroK"],
        "badPixels": proc["badPixels"],
        "resampling": f"bilinear HEALPix interpolation (healpy get_interp_val), {args.supersample}x{args.supersample} supersampled and box-averaged for 4096x2048; 2048x1024 and 1024x512 box-downsampled from the 4096 float image before quantisation",
        "previewColorMap": {"stops": [[a, c] for a, c in stops], "from": stops_src,
                            "interpolation": "piecewise linear in linear-light RGB between stops (mirrors cmbColor() in src/shared/color.ts), sRGB-encoded",
                            "t": "ΔT / 300 µK, clipped to [-1, 1]"},
        "stats": stats,
        "checks": checks,
        "credit": CREDIT,
        "creditShort": CREDIT_SHORT,
        "acknowledgement": ACKNOWLEDGEMENT,
        "citation": CITATION,
        "license": LICENSE,
        "generator": f"scripts/cmb_to_equirect.py {SCRIPT_VERSION} (healpy {__import__('healpy').__version__}, numpy {np.__version__})",
    }
    meta_path = out / "cmb_meta.json"
    tmp = meta_path.with_name(meta_path.name + ".tmp")
    tmp.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(meta_path)
    log(f"[write] {show(meta_path)}")

    if checks and not checks["orientation"]["passed"]:
        sys.exit("[check] FAILED: orientation self-check did not pass")
    log("[done]")


if __name__ == "__main__":
    main()
