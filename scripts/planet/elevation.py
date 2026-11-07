"""Offline: life-scene elevation near sea level, from NOAA ETOPO1 (Ice Surface, public domain).

Downloads (once, into scripts/cache/) ETOPO1 at 5 arc-minutes from NOAA CoastWatch ERDDAP as DAP2 binary,
resamples it to the life scene's equirectangular layout (2048 x 1024; column 0 = 180 W, row 0 = north, the same
as geo/land-colour.webp), and encodes only the band that matters for flooding and exposing shelves:

    code = clamp(round((elevation_m + 150) / 2), 0, 255)   ->   -150 m .. +360 m in 2 m steps

The shader decodes elevation_m = code * 2 - 150 (planet.ts, ELEV_*).

Usage: scripts/.venv/bin/python -I scripts/planet/elevation.py src/scenes/life/geo/elevation.png
"""

import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

URL = 'https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180.dods?altitude[(-90.0):5:(90.0)][(-180.0):5:(180.0)]'
CACHE = Path(__file__).resolve().parents[1] / 'cache' / 'etopo1_5min.dods'
W, H = 2048, 1024
ELEV_MIN, ELEV_STEP = -150.0, 2.0


def load() -> np.ndarray:
    if not CACHE.exists():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        print('downloading', URL)
        urllib.request.urlretrieve(URL.replace('[', '%5B').replace(']', '%5D'), CACHE)
    raw = CACHE.read_bytes()
    off = raw.index(b'\nData:\n') + len(b'\nData:\n')
    n0, n1 = np.frombuffer(raw, '>u4', 2, off)
    assert n0 == n1 == 2161 * 4321, (n0, n1)
    # DAP2 sends Int16 as 32-bit big-endian integers.
    z = np.frombuffer(raw, '>i4', n0, off + 8).astype(np.float32).reshape(2161, 4321)
    lat = np.frombuffer(raw, '>f8', 2161, off + 8 + 4 * n0 + 8)
    assert abs(lat[0] + 90) < 1e-6 and abs(lat[-1] - 90) < 1e-6, (lat[0], lat[-1])
    return z[::-1]  # row 0 = north


def resample(z: np.ndarray) -> np.ndarray:
    # 3x3 box pre-filter (the target pixel is ~2.1 source cells), then bilinear at the target pixel centres.
    p = np.pad(z, 1, mode='edge')
    s = sum(p[1 + dy : 1 + dy + z.shape[0], 1 + dx : 1 + dx + z.shape[1]] for dy in (-1, 0, 1) for dx in (-1, 0, 1)) / 9
    lon = -180 + (np.arange(W) + 0.5) * 360 / W
    lat = 90 - (np.arange(H) + 0.5) * 180 / H
    x = (lon + 180) * 12  # source column (node-registered, 1/12 degree)
    y = (90 - lat) * 12
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx = (x - x0)[None, :]
    fy = (y - y0)[:, None]
    a = s[y0][:, x0]
    b = s[y0][:, x0 + 1]
    c = s[y0 + 1][:, x0]
    d = s[y0 + 1][:, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def main() -> None:
    out = Path(sys.argv[1])
    e = resample(load())
    code = np.clip(np.round((e - ELEV_MIN) / ELEV_STEP), 0, 255).astype(np.uint8)
    Image.fromarray(code, 'L').save(out, optimize=True)
    # Sanity: a few known places (lat, lon, rough elevation).
    for name, la, lo in [('Chicxulub', 21.3, -89.5), ('Florida', 28.0, -81.6), ('Denver', 39.7, -105.0), ('Amsterdam', 52.4, 4.9)]:
        i = int((90 - la) / 180 * H)
        j = int((lo + 180) / 360 * W)
        print(f'{name:10s} {e[i, j]:8.1f} m  code {code[i, j]}')
    print(out, out.stat().st_size, 'bytes')


if __name__ == '__main__':
    main()
