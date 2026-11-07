// The observable universe for the end of `now` (units: Gpc, centred on us).
// • CMB sphere at the comoving distance of last scattering (computed from cosmology.ts), textured with the real
//   Planck 2018 SMICA map through the labelled CMB colour map. Seen from inside: the sky as Planck saw it
//   (correct Galactic orientation); from outside: a luminous shell whose near side thins to let us see in.
// • Galaxy haze: points uniform in comoving volume (homogeneity), clustered by the shared primordial field tiled
//   at its true box size, and lit along our past light cone: brightness follows the cosmic star-formation
//   history at the redshift each shell is seen at, and stops before the first galaxies, leaving the dark ages
//   as a dark band inside the CMB.

import {
  AdditiveBlending,
  BackSide,
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  PlaneGeometry,
  FrontSide,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  RGBAFormat,
  SphereGeometry,
  type Texture,
  Vector3,
} from 'three/webgpu';
import { abs, cameraPosition, dot, equirectUV, float, length, min, mix, normalize, positionLocal, positionWorld, pow, texture, uniform, vec2, vec3 } from 'three/tsl';
import { E } from '../../physics/cosmology.ts';
import { C_M_S, H0_PER_S, LITTLE_H, MPC_M } from '../../physics/constants.ts';
import { madauDickinsonSFR } from '../../physics/recombination.ts';
import { cmbColorNode } from '../../shared/color.ts';
import { fbm } from '../../shared/noise.ts';
import { sampleGrid } from '../../shared/fieldCore.ts';
import { gaussian, mulberry32 } from '../../shared/math.ts';
import type { PrimordialField } from '../../shared/gaussianField.ts';
import type { FloatUniform, Vec2Uniform } from '../../render/globals.ts';
import { createPoints, type Points } from './points.ts';

const GPC_M = MPC_M * 1000;

/** Comoving distance (Gpc) to scale factor a, flat ΛCDM from cosmology.ts. */
export function comovingDistanceGpc(a: number): number {
  const n = 4000;
  const l0 = Math.log(a);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const la = l0 * (1 - (i + 0.5) / n);
    const ai = Math.exp(la);
    s += 1 / (ai * E(ai));
  }
  return ((s * -l0) / n) * (C_M_S / H0_PER_S) / GPC_M;
}

export interface Cosmos {
  group: Group;
  radius: number;
  haze: Points;
  marker: Points;
  uniforms: {
    cmb: FloatUniform;
    front: FloatUniform;
    haze: FloatUniform;
    glow: FloatUniform;
    marker: FloatUniform;
    useMap: FloatUniform;
    /** Brightness of the CMB seen from inside / through the shell (the far side). */
    back: FloatUniform;
    /** Explicit mip level (no derivative seams at the poles or the l = 180° wrap). */
    lod: FloatUniform;
    /** Shell look from outside: limb exponent (higher = thinner rim) and face-on brightness. */
    limbPow: FloatUniform;
    faceOn: FloatUniform;
  };
  /** Camera-facing billboard of the projected galaxy light (orient it to the camera every frame). */
  glow: Mesh;
  setMap(tex: Texture): void;
  dispose(): void;
}

export function createCosmos(
  field: PrimordialField,
  zLastScattering: number,
  hazeCount: number,
  resolution: Vec2Uniform,
  fovDeg: number,
): Cosmos {
  const R = comovingDistanceGpc(1 / (1 + zLastScattering));
  const u = { cmb: uniform(0), front: uniform(0), back: uniform(0.3), haze: uniform(0), glow: uniform(0), marker: uniform(0), useMap: uniform(0), lod: uniform(0), limbPow: uniform(3.6), faceOn: uniform(0.008) };

  // ── CMB shell ──
  const placeholder = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, RGBAFormat);
  placeholder.needsUpdate = true;
  const map = texture(placeholder);
  const dir = normalize(positionLocal);
  const fromMap = map.sample(equirectUV(dir)).level(u.lod).r.mul(2).sub(1);
  // Stand-in until the Planck map is available: a smooth random field with similar look (never shown as data).
  const standIn = fbm(dir.mul(9.0), 5).mul(1.7);
  const t = mix(standIn, fromMap, u.useMap);
  const col = cmbColorNode(t);
  const geo = new SphereGeometry(R, 192, 96);
  const backMat = new MeshBasicNodeMaterial({ side: BackSide, transparent: true, depthWrite: false, blending: AdditiveBlending });
  backMat.colorNode = col.mul(u.back).mul(u.cmb);
  backMat.opacityNode = float(1);
  const back = new Mesh(geo, backMat);
  back.renderOrder = 0;
  back.frustumCulled = false;
  // Near side seen from outside: transparent face-on, opaque toward the limb (a shell, not a ball).
  const frontMat = new MeshBasicNodeMaterial({ side: FrontSide, transparent: true, depthWrite: false, blending: AdditiveBlending });
  const N = normalize(positionWorld);
  const V = normalize(cameraPosition.sub(positionWorld));
  const mu = abs(dot(N, V));
  // A luminous membrane: faint face-on, glowing toward the limb where the line of sight grazes the shell.
  const limb = pow(float(1).sub(mu), u.limbPow);
  const rimGlow = pow(float(1).sub(mu), 10.0);
  frontMat.colorNode = min(col.mul(u.faceOn.add(limb.mul(1.2)).add(rimGlow.mul(0.9))), vec3(1.3)).mul(u.front);
  frontMat.opacityNode = float(1);
  const front = new Mesh(geo, frontMat);
  front.renderOrder = 5;
  front.frustumCulled = false;

  // ── galaxy haze along the past light cone ──
  const rand = mulberry32(13800);
  const fd = field.data!;
  const boxGpc = field.boxMpcH / LITTLE_H / 1000;
  const zOf = (() => {
    // χ(z) table for inversion.
    const zs: number[] = [];
    const cs: number[] = [];
    for (let i = 0; i <= 240; i++) {
      const z = Math.pow(10, -3 + (i / 240) * Math.log10(20 / 1e-3));
      zs.push(z);
      cs.push(comovingDistanceGpc(1 / (1 + z)));
    }
    return (chi: number) => {
      if (chi <= cs[0]!) return zs[0]!;
      for (let i = 1; i < cs.length; i++) if (chi <= cs[i]!) return zs[i - 1]! + ((zs[i]! - zs[i - 1]!) * (chi - cs[i - 1]!)) / (cs[i]! - cs[i - 1]!);
      return zs.at(-1)!;
    };
  })();
  let sfrPeak = 0;
  for (let z = 0; z < 10; z += 0.01) sfrPeak = Math.max(sfrPeak, madauDickinsonSFR(z));
  const zFirst = 14; // first galaxies: nothing farther than this shell
  const rMin = 0.18;
  const rMax = comovingDistanceGpc(1 / (1 + zFirst));
  const haze = createPoints({ count: hazeCount, resolution, fovDeg, sharpness: 5 });
  const v = new Vector3();
  for (let k = 0; k < hazeCount; k++) {
    let chi = 0;
    for (let tries = 0; tries < 40; tries++) {
      chi = rMax * Math.cbrt(rand());
      if (chi < rMin) continue;
      v.set(gaussian(rand), gaussian(rand), gaussian(rand)).normalize().multiplyScalar(chi);
      const q = (x: number) => {
        const f = x / boxGpc + 0.5;
        return f - Math.floor(f);
      };
      const nu = sampleGrid(fd.deltaSmooth, fd.n, 1, 0, q(v.x), q(v.y), q(v.z)) / fd.sigmaSmooth;
      if (rand() < Math.min(1, Math.max(0.03, (nu + 0.6) * 0.45))) break;
    }
    const z = zOf(chi);
    const sfr = madauDickinsonSFR(z) / sfrPeak;
    const w = (0.2 + sfr) * (1 - smooth(8, zFirst, z));
    // Nearby galaxies look like mature starlight, distant ones young and blue.
    const c = Math.min(1, z / 3);
    haze.pos.setXYZW(k, v.x, v.y, v.z, 1.3 + rand() * 0.8);
    haze.col.setXYZW(k, 1.0 - 0.3 * c, 0.86 - 0.02 * c, 0.66 + 0.34 * c, w * (0.05 + Math.pow(rand(), 6) * 2.4) * 0.1);
  }
  haze.material.colorNode = haze.material.colorNode!.mul(u.haze);
  haze.sprite.renderOrder = 2;

  // ── projected galaxy light: ∫ j(χ) along each line of sight, j from the star-formation history ──
  const NG = 256;
  const glowData = new Uint16Array(NG * 4);
  let gMax = 0;
  const gRow: [number, number][] = [];
  for (let i = 0; i < NG; i++) {
    const rho = (i / (NG - 1)) * R;
    let gold = 0;
    let blue = 0;
    const S = 160;
    const sMax = Math.sqrt(Math.max(0, rMax * rMax - rho * rho));
    for (let k = 0; k < S; k++) {
      const sk = ((k + 0.5) / S) * sMax;
      const chi = Math.sqrt(rho * rho + sk * sk);
      if (chi < rMin * 0.5) continue;
      const z = zOf(chi);
      const j = (0.2 + madauDickinsonSFR(z) / sfrPeak) * (1 - smooth(8, zFirst, z));
      const c = Math.min(1, z / 3);
      gold += j * (1 - c);
      blue += j * c;
    }
    gold *= (2 * sMax) / S;
    blue *= (2 * sMax) / S;
    gMax = Math.max(gMax, gold + blue);
    gRow.push([gold, blue]);
  }
  gRow.forEach(([g, b], i) => {
    glowData.set([DataUtils.toHalfFloat(g / gMax), DataUtils.toHalfFloat(b / gMax), 0, DataUtils.toHalfFloat(1)], i * 4);
  });
  const glowLut = new DataTexture(glowData, NG, 1, RGBAFormat, HalfFloatType);
  glowLut.minFilter = LinearFilter;
  glowLut.magFilter = LinearFilter;
  glowLut.wrapS = glowLut.wrapT = ClampToEdgeWrapping;
  glowLut.needsUpdate = true;
  const glowGeo = new PlaneGeometry(2 * R, 2 * R, 1, 1);
  const glowMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  const gr = length(vec2(positionLocal.x, positionLocal.y)).div(R);
  const gs = texture(glowLut, vec2(gr.clamp(0, 1).mul(1 - 1 / NG).add(0.5 / NG), 0.5));
  const goldC = vec3(1.0, 0.64, 0.3);
  const blueC = vec3(0.78, 0.76, 0.95);
  glowMat.colorNode = goldC.mul(gs.r.mul(1.6)).add(blueC.mul(gs.g.mul(0.55))).mul(float(1).sub(gr.step(1))).mul(u.glow).mul(0.26);
  glowMat.opacityNode = float(1);
  const glow = new Mesh(glowGeo, glowMat);
  glow.frustumCulled = false;
  glow.renderOrder = 1;

  // ── "you are here" ──
  const marker = createPoints({ count: 1, resolution, fovDeg, sharpness: 3 });
  marker.pos.setXYZW(0, 0, 0, 0, 14);
  marker.col.setXYZW(0, 1.0, 0.86, 0.66, 1.6);
  marker.material.colorNode = marker.material.colorNode!.mul(u.marker);
  marker.sprite.renderOrder = 3;

  const group = new Group();
  group.add(back);
  group.add(glow);
  group.add(haze.sprite);
  group.add(marker.sprite);
  group.add(front);

  return {
    group,
    radius: R,
    glow,
    haze,
    marker,
    uniforms: u,
    setMap(tex: Texture) {
      map.value = tex;
      u.useMap.value = 1;
    },
    dispose() {
      geo.dispose();
      backMat.dispose();
      frontMat.dispose();
      haze.dispose();
      marker.dispose();
      glowGeo.dispose();
      glowMat.dispose();
      glowLut.dispose();
      placeholder.dispose();
    },
  };
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
