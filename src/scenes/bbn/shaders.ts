// TSL for the BBN scene: lit, glossy nucleons immersed in the photon bath, and the bath itself.

import {
  AdditiveBlending,
  BackSide,
  MeshBasicNodeMaterial,
  SpriteNodeMaterial,
  Vector3,
  type DataTexture,
  type InstancedBufferAttribute,
} from 'three/webgpu';
import {
  dot,
  exp,
  float,
  instancedBufferAttribute,
  max,
  mix,
  mx_noise_float,
  normalize,
  normalView,
  positionView,
  positionWorld,
  pow,
  smoothstep,
  step,
  uniform,
  uv,
  vec3,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { blackbodyNode } from '../../render/globals.ts';

type V3 = Node<'vec3'>;
const _mkF = () => uniform(0);
const _mkV3 = () => uniform(new Vector3());
type FU = ReturnType<typeof _mkF>;
type V3U = ReturnType<typeof _mkV3>;

export interface BathUniforms {
  /** log10 T of the photon bath (blackbody LUT). */
  logT: FU;
  /** HDR brightness of the bath glow. */
  glow: FU;
  /** Distance haze toward the bath colour (1/world unit). */
  haze: FU;
  time: FU;
  /** Nucleon colours (linear). */
  proton: V3U;
  neutron: V3U;
  /** Key light colour × intensity (view-space direction fixed: studio light). */
  key: V3U;
  rim: FU;
  spec: FU;
  /** Brightness of bonding/decay flashes. */
  flash: FU;
}

export function createBathUniforms(): BathUniforms {
  return {
    logT: uniform(9),
    glow: uniform(0.3),
    haze: uniform(0.05),
    time: uniform(0),
    proton: uniform(new Vector3(0.8, 0.2, 0.1)),
    neutron: uniform(new Vector3(0.5, 0.55, 0.6)),
    key: uniform(new Vector3(1, 0.95, 0.9)),
    rim: uniform(1),
    spec: uniform(1),
    flash: uniform(4),
  };
}

/**
 * Nucleons: an InstancedMesh of spheres. Per instance `info` = (neutron 0–1, flash 0–1, bond glow 0–1, unused).
 * Shading: warm key light from the upper left (fixed in view space), the bath as ambient fill and a Fresnel rim
 * (the nucleons are bathed in light from every side), Blinn–Phong highlight, and haze toward the bath with depth.
 */
export function createNucleonMaterial(lut: DataTexture, u: BathUniforms, info: InstancedBufferAttribute): MeshBasicNodeMaterial {
  const inf = instancedBufferAttribute<'vec4'>(info, 'vec4');
  const bath = blackbodyNode(lut, u.logT) as unknown as V3;
  const N = normalize(normalView);
  const V = normalize(positionView.negate());
  const L = normalize(vec3(-0.55, 0.65, 0.55));
  const diff = max(dot(N, L), 0);
  const wrap = max(dot(N, L).mul(0.5).add(0.5), 0); // soft terminator
  const H = normalize(L.add(V));
  const spec = pow(max(dot(N, H), 0), 60).mul(u.spec);
  const nv = max(dot(N, V), 0);
  const fres = pow(float(1).sub(nv), 3);
  const base = mix(u.proton, u.neutron, inf.x);
  // Bath light wraps around from behind (every direction glows), so the limb is the brightest part of a nucleon.
  const ambient = bath.mul(u.glow).mul(0.9);
  const key = u.key.mul(diff.mul(0.8).add(wrap.mul(0.2)));
  const lit = base
    .mul(ambient.add(key))
    .add(u.key.mul(spec))
    .add(bath.mul(fres).mul(u.rim));
  // Flashes: bonding (gamma photon released) and β-decay; a warm-white emissive bloom.
  const glowCol = vec3(1.0, 0.92, 0.8).mul(inf.y.mul(u.flash).mul(0.35)).add(vec3(1.0, 0.85, 0.6).mul(inf.z.mul(0.25)));
  const depth = positionView.z.negate();
  const hz = float(1).sub(exp(depth.mul(u.haze).negate()));
  const col = mix(lit.add(glowCol), bath.mul(u.glow), hz.mul(0.9));
  const mat = new MeshBasicNodeMaterial();
  mat.colorNode = col;
  return mat;
}

/** The photon bath: a softly varying blue-white glow on a large inner sphere. */
export function createBathMaterial(lut: DataTexture, u: BathUniforms): MeshBasicNodeMaterial {
  const bath = blackbodyNode(lut, u.logT) as unknown as V3;
  const d = normalize(positionWorld);
  const n1 = mx_noise_float(d.mul(2.2).add(vec3(0, u.time.mul(0.02), 0)));
  const n2 = mx_noise_float(d.mul(6.5).add(vec3(u.time.mul(0.03), 0, 0)));
  const v = float(0.8).add(n1.mul(0.35)).add(n2.mul(0.15));
  const mat = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false });
  mat.colorNode = bath.mul(u.glow).mul(max(v, 0.2));
  return mat;
}

/** Flash halos: one sprite per nucleon (xyz, strength) so a forming nucleus blooms with released energy. */
export function createFlashMaterial(lut: DataTexture, u: BathUniforms, flashes: InstancedBufferAttribute): SpriteNodeMaterial {
  const f = instancedBufferAttribute<'vec4'>(flashes, 'vec4');
  const r = uv().sub(0.5).length().mul(2);
  const halo = exp(r.mul(r).mul(-6)).add(exp(r.mul(-6)).mul(0.3)).mul(float(1).sub(smoothstep(0.85, 1, r)));
  const mat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  mat.positionNode = f.xyz;
  mat.scaleNode = float(0.35).add(f.w.mul(0.5)).mul(step(0.02, f.w));
  const warm = mix(blackbodyNode(lut, u.logT) as unknown as V3, vec3(1, 0.9, 0.75), 0.6);
  mat.colorNode = warm.mul(halo.mul(f.w).mul(u.flash).mul(0.35));
  mat.opacityNode = float(1);
  return mat;
}
