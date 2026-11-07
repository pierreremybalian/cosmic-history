// Offline: build the life scene's geography textures from public-domain data.
//   Natural Earth 1:50m land polygons (public domain) → 8 per-plate signed-distance masks (2 RGBA PNGs)
//   NASA Blue Marble (public domain) → land colour, dilated into the sea so coasts never sample ocean.
// Usage: node scripts/planet/geo.mjs <dir with ne_50m_land.geojson + bm2048.jpg> <outdir>
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
// sharp ships with Astro (image service); resolve it from Astro's own dependencies.
const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve('astro/package.json'))('sharp');

const [srcDir, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const W = 2048;
const H = 1024;
const OW = 1024; // shipped mask size
const OH = 512;

// ── 1. Rasterise land (antialiased) ───────────────────────────────────────────
const gj = JSON.parse(readFileSync(join(srcDir, 'ne_50m_land.geojson'), 'utf8'));
const X = (lon) => ((lon + 180) / 360) * W;
const Y = (lat) => ((90 - lat) / 180) * H;
let paths = '';
for (const f of gj.features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) {
    let d = '';
    for (const ring of poly) {
      d += 'M' + ring.map(([lo, la]) => `${X(lo).toFixed(2)},${Y(la).toFixed(2)}`).join('L') + 'Z';
    }
    paths += `<path d="${d}"/>`;
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="black"/><g fill="white" fill-rule="evenodd">${paths}</g></svg>`;
const land = new Uint8Array((await sharp(Buffer.from(svg)).greyscale().raw().toBuffer({ resolveWithObject: false })).buffer.slice(0));
console.log('land raster', land.length, W * H);

// ── 2. Plate assignment ───────────────────────────────────────────────────────
// 0 Africa (+Arabia, Madagascar) 1 South America 2 North America (+Greenland, Central America)
// 3 Europe (Eurasia west of ~58°E) 4 India 5 Australia (+New Guinea, NZ) 6 Antarctica 7 Asia (east of ~58°E)
const lerpLine = (pts, x) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return pts.at(-1)[1];
};
const ZAGROS = [
  [32.3, 36.6],
  [36, 36.9],
  [42, 37.3],
  [44.5, 35.5],
  [46, 33.5],
  [48.5, 30.0],
  [52, 28.0],
  [56.5, 26.6],
  [60, 25.3],
];
const HIMALAYA = [
  [61, 25.3],
  [66.5, 29.5],
  [68.5, 32.8],
  [71.5, 34.8],
  [74, 35.6],
  [78, 33.8],
  [81, 30.4],
  [84, 28.4],
  [88, 27.7],
  [92, 27.9],
  [96, 28.2],
];
function plateOf(lat, lon) {
  if (lat < -60) return 6;
  // West
  if (lon < -20 || (lon < -10 && lat > 59 && !(lat > 62.5 && lat < 67 && lon > -25.5))) {
    if (lon < -168.8 && lat > 64) return 7; // Chukotka
    if (lon < -135 && lat < 50) return -1; // Hawaii & mid-Pacific islands (Pacific plate)
    if (lat < 13 && lon > -82.5 && lon < -33) {
      if (lon > -77.3 || lat < 6.8) return 1;
      if (lat < 11.2 && lon > -62.2) return 1; // Trinidad
    }
    if (lat < -54 && lon > -40 && lon < -25) return 1; // South Georgia
    return 2;
  }
  if (lat > 62.5 && lat < 67 && lon > -25.5 && lon < -12) return 3; // Iceland
  // Antarctic and sub-Antarctic islands
  if (lat < -45 && lon > 35 && lon < 110) return 6;
  // Australia, New Guinea, Zealandia, SW Pacific
  if (lon > 112 && lat < -9.5) return 5;
  if (lon > 130.8 && lat < 0 && lat > -12) return 5; // New Guinea + Aru
  if (lon > 155 && lat < -5) return 5; // Solomons, Vanuatu, Fiji, NZ
  if (lon > 160 && lat < 10 && lat > -60) return 5;
  // India
  if (lon > 60.5 && lon < 97 && lat > 5 && lat < lerpLine(HIMALAYA, lon)) {
    const east = lat < 24 ? 92.8 : 96.5;
    if (lon < east) return 4;
  }
  if (lon > 79 && lon < 82.5 && lat > 5.5 && lat < 10.2) return 4; // Sri Lanka
  // Africa + Arabia (+ Sinai, Levant, Madagascar, Socotra)
  if (lon > -20 && lon < 60.5 && lat > -40 && lat < 38) {
    const iberia = lat > 35.97 && lon < 0;
    const sicily = lat > 36.4 && lon > 12 && lon < 16;
    const greece = lat > 35.9 && lon > 19.5 && lon < 32.3;
    const crete = lat > 34.7 && lon > 23 && lon < 27;
    const cyprus = lat > 34.4 && lon > 32 && lon < 34.7 && lat < 35.8;
    const malta = lat > 35.7 && lon > 14 && lon < 14.7;
    const asia = lon > 32.3 && lat > lerpLine(ZAGROS, lon);
    if (!(iberia || sicily || greece || crete || cyprus || malta || asia)) return 0;
  }
  if (lon > 57.5) return 7;
  return 3;
}

const plate = new Int8Array(W * H).fill(-1);
for (let y = 0; y < H; y++) {
  const lat = 90 - ((y + 0.5) / H) * 180;
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (land[i] < 8) continue;
    const lon = ((x + 0.5) / W) * 360 - 180;
    plate[i] = plateOf(lat, lon);
  }
}

// ── 3. Per-plate signed distance (px at 2048), horizontally periodic ────────────
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}
/** Squared EDT to the nearest "inside" pixel; columns padded by PAD for wrap. */
function edt(inside) {
  const PAD = 256;
  const WW = W + 2 * PAD;
  const INF = 1e12;
  const g = new Float64Array(WW * H);
  for (let y = 0; y < H; y++)
    for (let xx = 0; xx < WW; xx++) {
      const x = (((xx - PAD) % W) + W) % W;
      g[y * WW + xx] = inside[y * W + x] ? 0 : INF;
    }
  const n = Math.max(WW, H);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let xx = 0; xx < WW; xx++) {
    for (let y = 0; y < H; y++) f[y] = g[y * WW + xx];
    edt1d(f, H, d, v, z);
    for (let y = 0; y < H; y++) g[y * WW + xx] = d[y];
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let xx = 0; xx < WW; xx++) f[xx] = g[y * WW + xx];
    edt1d(f, WW, d, v, z);
    for (let x = 0; x < W; x++) out[y * W + x] = Math.sqrt(d[x + PAD]);
  }
  return out;
}
const RAMP = 40; // px at 2048 (~7°): value 0.5 ± sd / (2·RAMP)
const channels = [];
for (let p = 0; p < 8; p++) {
  const inside = new Uint8Array(W * H);
  let count = 0;
  for (let i = 0; i < W * H; i++) {
    if (plate[i] === p && land[i] >= 128) {
      inside[i] = 1;
      count++;
    }
  }
  const outside = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) outside[i] = inside[i] ? 0 : 1;
  const dIn = edt(inside); // distance from outside pixels to the plate
  const dOut = edt(outside); // distance from inside pixels to the edge
  const ch = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const sd = inside[i] ? dOut[i] - 0.5 : -(dIn[i] - 0.5);
    ch[i] = Math.max(0, Math.min(1, 0.5 + sd / (2 * RAMP)));
  }
  channels.push(ch);
  console.log('plate', p, 'pixels', count);
}
// Downsample 2× (box) and pack.
for (const [name, base] of [
  ['plates-a.png', 0],
  ['plates-b.png', 4],
]) {
  const buf = Buffer.alloc(OW * OH * 4);
  for (let y = 0; y < OH; y++)
    for (let x = 0; x < OW; x++)
      for (let c = 0; c < 4; c++) {
        const ch = channels[base + c];
        const i0 = 2 * y * W + 2 * x;
        const v = (ch[i0] + ch[i0 + 1] + ch[i0 + W] + ch[i0 + W + 1]) / 4;
        buf[(y * OW + x) * 4 + c] = Math.round(v * 255);
      }
  await sharp(buf, { raw: { width: OW, height: OH, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(join(outDir, name));
  console.log('wrote', name);
}
// Debug: plate id map.
{
  const pal = [
    [230, 160, 60],
    [60, 200, 90],
    [70, 120, 230],
    [220, 80, 200],
    [240, 230, 70],
    [200, 60, 60],
    [240, 240, 240],
    [80, 220, 220],
  ];
  const buf = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    const p = plate[i];
    const c = p >= 0 && land[i] >= 128 ? pal[p] : [10, 20, 40];
    buf[i * 3] = c[0];
    buf[i * 3 + 1] = c[1];
    buf[i * 3 + 2] = c[2];
  }
  await sharp(buf, { raw: { width: W, height: H, channels: 3 } })
    .png()
    .toFile(join(process.argv[4] ?? outDir, 'plates-debug.png'));
}

// ── 4. Land colour, dilated into the sea ─────────────────────────────────────
const src = await sharp(join(srcDir, 'bm2048.jpg'), { limitInputPixels: false })
  .resize(W, H, { kernel: 'lanczos3' })
  .removeAlpha()
  .raw()
  .toBuffer();
const mask = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) mask[i] = land[i] >= 200 ? 1 : 0; // interior land only: coast pixels mix sea colour
async function blurF(arr, ch, sigma) {
  // Separable box blur ×3 (≈ gaussian), horizontally periodic.
  const res = Float32Array.from(arr);
  const tmp = new Float32Array(arr.length);
  const r = Math.max(1, Math.round(sigma * 0.87));
  for (let pass = 0; pass < 3; pass++) {
    // horizontal (wrap)
    for (let y = 0; y < H; y++)
      for (let c = 0; c < ch; c++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) acc += res[(y * W + ((k + W) % W)) * ch + c];
        for (let x = 0; x < W; x++) {
          tmp[(y * W + x) * ch + c] = acc / (2 * r + 1);
          const xa = (x + r + 1) % W;
          const xr = (x - r + W) % W;
          acc += res[(y * W + xa) * ch + c] - res[(y * W + xr) * ch + c];
        }
      }
    // vertical (clamp)
    for (let x = 0; x < W; x++)
      for (let c = 0; c < ch; c++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) acc += tmp[(Math.min(H - 1, Math.max(0, k)) * W + x) * ch + c];
        for (let y = 0; y < H; y++) {
          res[(y * W + x) * ch + c] = acc / (2 * r + 1);
          const ya = Math.min(H - 1, y + r + 1);
          const yr = Math.max(0, y - r);
          acc += tmp[(ya * W + x) * ch + c] - tmp[(yr * W + x) * ch + c];
        }
      }
  }
  return res;
}
const col = new Float32Array(W * H * 3);
for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) col[i * 3 + c] = (src[i * 3 + c] / 255) * mask[i];
const filled = new Float32Array(W * H * 3);
const done = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++)
  if (mask[i] > 0) {
    done[i] = 1;
    for (let c = 0; c < 3; c++) filled[i * 3 + c] = src[i * 3 + c] / 255;
  }
for (const sigma of [3, 8, 20, 48, 120]) {
  const bc = await blurF(col, 3, sigma);
  const bm = await blurF(mask, 1, sigma);
  for (let i = 0; i < W * H; i++) {
    if (done[i] || bm[i] < 0.02) continue;
    done[i] = 1;
    for (let c = 0; c < 3; c++) filled[i * 3 + c] = bc[i * 3 + c] / bm[i];
  }
  console.log('fill sigma', sigma);
}
const avg = [0, 0, 0];
let na = 0;
for (let i = 0; i < W * H; i++) {
  if (mask[i] > 0) {
    avg[0] += filled[i * 3];
    avg[1] += filled[i * 3 + 1];
    avg[2] += filled[i * 3 + 2];
    na++;
  }
}
const out = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++)
  for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(255 * Math.min(1, done[i] ? filled[i * 3 + c] : avg[c] / na));
await sharp(out, { raw: { width: W, height: H, channels: 3 } })
  .webp({ quality: 82, effort: 6 })
  .toFile(join(outDir, 'land-colour.webp'));
console.log('wrote land-colour.webp');
