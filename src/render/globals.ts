// Global TSL uniforms, updated once per frame from globalsAt(t) (HANDOFF §10.2).
// Never send raw t to the GPU: float32 cannot hold it. Use log10t, local and derived values.

import { ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, RGBAFormat, Vector2 } from 'three/webgpu';
import { clamp, float, texture, uniform, vec2 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import {
  BLACKBODY_LUT,
  BLACKBODY_LUT_LOG10_MAX,
  BLACKBODY_LUT_LOG10_MIN,
  BLACKBODY_LUT_SIZE,
} from '../physics/blackbody.ts';
import type { Globals } from '../physics/cosmology.ts';

const mkFloat = () => uniform(0);
const mkVec2 = () => uniform(new Vector2());
export type FloatUniform = ReturnType<typeof mkFloat>;
export type Vec2Uniform = ReturnType<typeof mkVec2>;

export interface GlobalUniforms {
  uLog10T: FloatUniform;
  uA: FloatUniform;
  uLogA: FloatUniform; // log10 a
  uH: FloatUniform; // 1/s (float32 holds 1e-18…1e31)
  uLogH: FloatUniform; // log10 H
  uTemp: FloatUniform; // K
  uLogTemp: FloatUniform; // log10 K
  uOmegaR: FloatUniform;
  uOmegaM: FloatUniform;
  uOmegaB: FloatUniform;
  uOmegaDM: FloatUniform;
  uOmegaL: FloatUniform;
  uElapsed: FloatUniform; // wall-clock seconds (idle motion)
  uLocal: FloatUniform; // active chapter progress 0–1
  uResolution: Vec2Uniform; // render-target pixels
  uBlackbodyLUT: ReturnType<typeof texture>;
  lut: DataTexture;
  update(g: Globals, local: number, elapsed: number): void;
  setResolution(w: number, h: number): void;
  dispose(): void;
}

export function createBlackbodyTexture(): DataTexture {
  const half = new Uint16Array(BLACKBODY_LUT.length);
  for (let i = 0; i < BLACKBODY_LUT.length; i++) half[i] = DataUtils.toHalfFloat(BLACKBODY_LUT[i]!);
  const tex = new DataTexture(half, BLACKBODY_LUT_SIZE, 1, RGBAFormat, HalfFloatType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export function createGlobalUniforms(): GlobalUniforms {
  const lut = createBlackbodyTexture();
  const u: GlobalUniforms = {
    uLog10T: uniform(0),
    uA: uniform(1),
    uLogA: uniform(0),
    uH: uniform(0),
    uLogH: uniform(0),
    uTemp: uniform(0),
    uLogTemp: uniform(0),
    uOmegaR: uniform(0),
    uOmegaM: uniform(0),
    uOmegaB: uniform(0),
    uOmegaDM: uniform(0),
    uOmegaL: uniform(0),
    uElapsed: uniform(0),
    uLocal: uniform(0),
    uResolution: uniform(new Vector2(1, 1)),
    uBlackbodyLUT: texture(lut),
    lut,
    update(g, local, elapsed) {
      u.uLog10T.value = g.log10t;
      u.uA.value = g.a;
      u.uLogA.value = Math.log10(g.a);
      u.uH.value = g.H;
      u.uLogH.value = Math.log10(g.H);
      u.uTemp.value = g.T;
      u.uLogTemp.value = Math.log10(g.T);
      u.uOmegaR.value = g.omega.radiation;
      u.uOmegaM.value = g.omega.matter;
      u.uOmegaB.value = g.omega.baryon;
      u.uOmegaDM.value = g.omega.darkMatter;
      u.uOmegaL.value = g.omega.darkEnergy;
      u.uElapsed.value = elapsed;
      u.uLocal.value = local;
    },
    setResolution(w, h) {
      u.uResolution.value.set(w, h);
    },
    dispose() {
      lut.dispose();
    },
  };
  return u;
}

/**
 * Linear-sRGB blackbody colour (max channel 1) for log10(T/K), from the shared LUT.
 * Clamped to 10³–10¹² K. Use for anything that glows thermally (§6.8).
 */
export function blackbodyNode(lut: DataTexture, log10T: Node<'float'> | number) {
  const u = clamp(
    float(log10T).sub(BLACKBODY_LUT_LOG10_MIN).div(BLACKBODY_LUT_LOG10_MAX - BLACKBODY_LUT_LOG10_MIN),
    0,
    1,
  );
  const texel = 0.5 / BLACKBODY_LUT_SIZE;
  return texture(lut, vec2(u.mul(1 - 2 * texel).add(texel), 0.5)).rgb;
}
