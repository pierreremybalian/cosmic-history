// darkEnergy TSL: expansion-history rings.
//
// Rings: concentric circles around the Milky Way, one per billion years of cosmic time. Ring k has radius
// R_ref · a(t_k) / a(t_start): the size, at time t_k, of a sphere of galaxies whose radius is R_ref at the
// start of the chapter. Their spacing is ȧ per Gyr, so the second derivative of the expansion is visible:
// rings crowd together while gravity decelerates the expansion, then spread apart as it accelerates.
// Trails: the same clock as stroboscopic dots along the radial paths of real galaxies of the web.
// t(radius) comes from a CPU lookup table built with cosmology.ts (no physics in the shader).

import {
  AdditiveBlending,
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  DoubleSide,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  RGBAFormat,
  InstancedBufferAttribute,
  Sprite,
  SpriteNodeMaterial,
  Vector3,
} from 'three/webgpu';
import { abs, exp, float, fract, fwidth, instancedBufferAttribute, length, max, mix, positionLocal, round, smoothstep, step, texture, uniform, uv, vec2, vec3 } from 'three/tsl';
import { aAt, tAt } from '../../physics/cosmology.ts';
import { GYR_S } from '../../physics/constants.ts';
import type { FloatUniform, Vec2Uniform } from '../../render/globals.ts';

export interface RingOptions {
  /** Comoving radius (world units at the chapter start) of the reference sphere. */
  rRef: number;
  /** Scale factor at the chapter start. */
  a0: number;
  /** Outermost ring time, Gyr. */
  tMaxGyr: number;
}

export interface ExpansionRings {
  mesh: Mesh;
  rMax: number;
  uniforms: {
    /** Current cosmic time, Gyr. */
    tNow: FloatUniform;
    /** Present age of the universe, Gyr (the "today" ring). */
    tToday: FloatUniform;
    /** Forecast front, Gyr: future rings are drawn from tNow out to here. */
    tFront: FloatUniform;
    /** Visibility of past rings / the moving "now" ring / future rings (0–1 each). */
    past: FloatUniform;
    now: FloatUniform;
    future: FloatUniform;
    brightness: FloatUniform;
  };
  dispose(): void;
}

export function createExpansionRings(o: RingOptions): ExpansionRings {
  const rMax = (o.rRef * aAt(o.tMaxGyr * GYR_S)) / o.a0 * 1.04;
  // LUT: cosmic time (Gyr) at in-plane radius ρ = R_ref · a / a0.
  const N = 2048;
  const data = new Uint16Array(N * 4);
  for (let i = 0; i < N; i++) {
    const rho = (i / (N - 1)) * rMax;
    const a = Math.max(1e-6, (rho / o.rRef) * o.a0);
    const t = tAt(a) / GYR_S;
    data[i * 4] = DataUtils.toHalfFloat(t);
    data[i * 4 + 1] = 0;
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = DataUtils.toHalfFloat(1);
  }
  const lut = new DataTexture(data, N, 1, RGBAFormat, HalfFloatType);
  lut.minFilter = LinearFilter;
  lut.magFilter = LinearFilter;
  lut.wrapS = lut.wrapT = ClampToEdgeWrapping;
  lut.needsUpdate = true;

  const u = {
    tNow: uniform(8),
    tToday: uniform(13.8),
    tFront: uniform(8),
    past: uniform(1),
    now: uniform(1),
    future: uniform(0),
    brightness: uniform(1),
  };

  const geo = new PlaneGeometry(rMax * 2, rMax * 2, 1, 1);
  const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
  const p = vec2(positionLocal.x, positionLocal.y);
  const rho = length(p);
  const texel = 0.5 / N;
  const tf = texture(lut, vec2(rho.div(rMax).mul(1 - 2 * texel).add(texel), 0.5)).r;
  const fw = max(fwidth(tf), 1e-4);
  const k = round(tf);
  const dk = abs(tf.sub(k));
  const thin = float(1).sub(smoothstep(fw.mul(0.3), fw.mul(1.0), dk));
  // Every 5th ring is a major ring; minor rings fade out where they would be closer than ~6 px apart.
  const major = float(1).sub(step(0.01, abs(fract(k.div(5).add(0.5)).sub(0.5))));
  const minorLod = smoothstep(4.0, 9.0, float(1).div(fw));
  const weight = mix(minorLod.mul(0.0), float(1.0), major);
  const isRing = step(0.5, k);
  const isPast = step(k, u.tNow.sub(0.02)).mul(isRing);
  // The forecast is laid down from "now" out to the moving front.
  const isFuture = step(u.tNow, k).mul(float(1).sub(smoothstep(u.tFront.sub(0.6), u.tFront, k)));
  const dToday = abs(tf.sub(u.tToday));
  const today = float(1).sub(smoothstep(fw.mul(0.4), fw.mul(1.3), dToday)).mul(step(u.tNow, u.tToday)).mul(step(u.tToday, u.tFront));
  const dNow = abs(tf.sub(u.tNow));
  const nowRing = float(1).sub(smoothstep(fw.mul(0.45), fw.mul(1.5), dNow));
  const nowGlow = exp(dNow.div(fw.mul(4)).negate()).mul(0.08);
  const dFront = abs(tf.sub(u.tFront));
  const front = exp(dFront.div(fw.mul(3)).negate()).mul(step(u.tNow.add(0.3), u.tFront)).mul(step(u.tFront, float(o.tMaxGyr - 0.5)));
  // Rings fade gently with radius so the outermost don't form a hard frame.
  const fade = float(1).sub(smoothstep(rMax * 0.8, rMax, rho));
  const colPast = vec3(0.6, 0.72, 1.0).mul(0.3);
  const colNow = vec3(1.0, 0.92, 0.78).mul(0.6);
  const colFuture = vec3(0.66, 0.55, 1.0).mul(0.3);
  const colToday = vec3(1.0, 0.84, 0.66).mul(0.6);
  const colFront = vec3(0.7, 0.6, 1.0).mul(0.35);
  const col = colPast
    .mul(thin.mul(weight).mul(isPast).mul(u.past))
    .add(colFuture.mul(thin.mul(weight).mul(isFuture).mul(u.future)))
    .add(colToday.mul(today.mul(u.future)))
    .add(colFront.mul(front.mul(u.future)))
    .add(colNow.mul(nowRing.add(nowGlow).mul(u.now)));
  mat.colorNode = col.mul(fade).mul(u.brightness);
  mat.opacityNode = float(1);
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return {
    mesh,
    rMax,
    uniforms: u,
    dispose() {
      geo.dispose();
      mat.dispose();
      lut.dispose();
    },
  };
}

export interface TrailOptions {
  /** Comoving offsets (world units at the chapter start) of the tagged galaxies from the Milky Way. */
  offsets: Vector3[];
  a0: number;
  /** Dots at t = 1, 2, … tMaxGyr Gyr. */
  tMaxGyr: number;
  /** Render-target height uniform (pixels), for constant-pixel-size dots. */
  resolution: Vec2Uniform;
  fovDeg: number;
}

export interface Trails {
  sprite: Sprite;
  uniforms: {
    tNow: FloatUniform;
    tFront: FloatUniform;
    past: FloatUniform;
    future: FloatUniform;
    brightness: FloatUniform;
  };
  dispose(): void;
}

/**
 * Stroboscopic trails: for each tagged galaxy, a dot where it is at every billion years (r ∝ a(t)). Spacing
 * between dots is the expansion speed; its change is the acceleration. Positions are fixed relative to the
 * Milky Way (place the sprite there); only visibility follows the clock.
 */
export function createTrails(o: TrailOptions): Trails {
  const nT = Math.floor(o.tMaxGyr);
  const n = o.offsets.length * nT;
  const arr = new Float32Array(n * 4);
  for (let g = 0; g < o.offsets.length; g++) {
    const off = o.offsets[g]!;
    for (let k = 1; k <= nT; k++) {
      const f = aAt(k * GYR_S) / o.a0;
      arr.set([off.x * f, off.y * f, off.z * f, k], (g * nT + k - 1) * 4);
    }
  }
  const P = instancedBufferAttribute<'vec4'>(new InstancedBufferAttribute(arr, 4), 'vec4');
  const u = { tNow: uniform(8), tFront: uniform(8), past: uniform(1), future: uniform(0), brightness: uniform(1) };
  const mat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false });
  mat.positionNode = P.xyz;
  const k = P.w;
  const isPast = step(k, u.tNow);
  const isFuture = step(u.tNow, k).mul(float(1).sub(smoothstep(u.tFront.sub(0.8), u.tFront, k)));
  const major = float(1).sub(step(0.01, abs(fract(k.div(5).add(0.5)).sub(0.5))));
  const px = mix(float(2.6), float(3.6), major);
  const tanHalf = Math.tan(((o.fovDeg / 2) * Math.PI) / 180);
  mat.scaleNode = px.mul(2 * tanHalf).div(o.resolution.y);
  const d = uv().sub(0.5).length().mul(2);
  const disc = float(1).sub(smoothstep(0.55, 1.0, d));
  const colPast = vec3(0.75, 0.84, 1.0).mul(0.55);
  const colFuture = vec3(0.72, 0.6, 1.0).mul(0.6);
  const col = colPast.mul(isPast.mul(u.past)).add(colFuture.mul(isFuture.mul(u.future)));
  mat.colorNode = col.mul(mix(float(0.7), float(1.2), major)).mul(u.brightness);
  mat.opacityNode = disc;
  const sprite = new Sprite(mat);
  sprite.count = n;
  sprite.frustumCulled = false;
  sprite.renderOrder = 4;
  return {
    sprite,
    uniforms: u,
    dispose() {
      mat.dispose();
    },
  };
}
