// Offline: cloud opacity from NASA Blue Marble 2002 (public domain): composite with clouds vs the cloud-free base.
import { createRequire } from 'node:module';
// sharp ships with Astro (image service); resolve it from Astro's own dependencies.
const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve('astro/package.json'))('sharp');
const [dir, out, preview] = process.argv.slice(2);
const W = 2048, H = 1024;
const comp = await sharp(`${dir}/loic_hires.jpg`).resize(W, H, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer();
const bg = await sharp(`${dir}/loi_2048.jpg`).resize(W, H).removeAlpha().raw().toBuffer();
const a = Buffer.alloc(W * H);
for (let i = 0; i < W * H; i++) {
  const c = Math.max(comp[i * 3], comp[i * 3 + 1], comp[i * 3 + 2]) / 255;
  const b = Math.max(bg[i * 3], bg[i * 3 + 1], bg[i * 3 + 2]) / 255;
  const lc = (comp[i * 3] * 0.3 + comp[i * 3 + 1] * 0.59 + comp[i * 3 + 2] * 0.11) / 255;
  const lb = (bg[i * 3] * 0.3 + bg[i * 3 + 1] * 0.59 + bg[i * 3 + 2] * 0.11) / 255;
  let al = Math.max((c - b) / Math.max(0.02, 1 - b), (lc - lb) / Math.max(0.02, 1 - lb));
  al = Math.max(0, Math.min(1, (al - 0.03) / 0.97));
  a[i] = Math.round(255 * al);
}
// Despeckle (desert texture differences between the two products), then fade the unreliable polar caps
// (ice in both images) to a soft constant the shader breaks up procedurally.
const med = await sharp(a, { raw: { width: W, height: H, channels: 1 } }).median(5).extractChannel(0).raw().toBuffer();
const blur = await sharp(med, { raw: { width: W, height: H, channels: 1 } }).blur(24).extractChannel(0).raw().toBuffer();
for (let y = 0; y < H; y++) {
  const lat = 90 - ((y + 0.5) / H) * 180;
  const s = lat > 0 ? Math.min(1, Math.max(0, (lat - 70) / 6)) : Math.min(1, Math.max(0, (-lat - 63) / 6));
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    // Remove speckle over bright deserts: keep only alpha that survives the median.
    // Bright, warm, unclouded-looking land in the base image (deserts): suppress the speckle there.
    const r = bg[i * 3] / 255, g = bg[i * 3 + 1] / 255, b = bg[i * 3 + 2] / 255;
    const desert = Math.min(1, Math.max(0, (r - b - 0.12) / 0.1)) * Math.min(1, Math.max(0, (r - 0.45) / 0.15));
    const v = Math.min(med[i], a[i] * 1.05) * (1 - desert * Math.max(0, 1 - med[i] / 170));
    // Ice in the base image (Greenland, sea ice) hides clouds: replace with a soft value.
    const ice = Math.abs(lat) > 55 ? Math.min(1, Math.max(0, (Math.min(r, g, b) - 0.6) / 0.15)) : 0;
    const s2 = Math.max(s, ice);
    med[i] = Math.round(v * (1 - s2) + (lat > 0 ? 70 : 90) * s2 * (0.6 + 0.4 * (blur[i] / 255)));
  }
}
await sharp(med, { raw: { width: W, height: H, channels: 1 } }).webp({ quality: 72, effort: 6 }).toFile(out);
if (preview) await sharp(med, { raw: { width: W, height: H, channels: 1 } }).resize(1536, 768).png().toFile(preview);
console.log('wrote', out);
