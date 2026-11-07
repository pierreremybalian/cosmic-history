// TSL for the dark ages: the fading afterglow sky and the ?debug=field overlay (shared materials: structure.ts).

import { AdditiveBlending, BackSide, DoubleSide, MeshBasicNodeMaterial, SpriteNodeMaterial, type DataTexture, type Data3DTexture } from 'three/webgpu';
import { float, instanceIndex, positionLocal, smoothstep, texture3D, vec3, vec4 } from 'three/tsl';
import type { UniformArrayNode } from 'three/webgpu';
import { blackbodyNode } from '../../render/globals.ts';
import { cmbColorNode } from '../../shared/color.ts';
import { WORLD_BOX } from '../../shared/gaussianField.ts';
import type { FloatUniform } from '../../render/globals.ts';
import { spriteR } from './structure.ts';

/**
 * The afterglow of recombination seen from inside: a uniform blackbody sky at the photon temperature, dimming as
 * its peak slides into the infrared. Brightness is computed on the CPU (visible luminance), colour from the LUT.
 */
export function afterglowMaterial(lut: DataTexture, uLogT: FloatUniform, uGlow: FloatUniform): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, depthTest: false });
  // Very slight brightening toward the horizon band so the sky reads as a volume, not a flat fill.
  const band = float(0.88).add(float(1).sub(positionLocal.normalize().y.abs()).mul(0.12));
  m.colorNode = blackbodyNode(lut, uLogT).mul(uGlow).mul(band);
  return m;
}

/** ?debug=field: hollow rank-coloured rings on the top peaks. seeds[i] = (x, y, z, rank 0–1). */
export function markerMaterial(seeds: UniformArrayNode<'vec4'>, size: number): SpriteNodeMaterial {
  const m = new SpriteNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending });
  const s = seeds.element(instanceIndex);
  m.positionNode = s.xyz;
  m.scaleNode = float(size);
  const r = spriteR();
  const ring = smoothstep(0.72, 0.8, r).mul(float(1).sub(smoothstep(0.86, 0.94, r)));
  const dot = float(1).sub(smoothstep(0.08, 0.16, r));
  const col = cmbColorNode(float(1).sub(s.w.mul(2)));
  m.colorNode = col.mul(ring.add(dot)).mul(1.6);
  m.opacityNode = float(1);
  return m;
}

/**
 * ?debug=field: a horizontal slice through the focus showing the primordial field (Lagrangian coordinates):
 * channel 'b' = smoothed δ/σ (the field the halo peaks are found in), 'g' = ζ (the inflation ripples).
 * `shift` is the world re-centring, so world → box uvw = (world − shift)/BOX + 0.5 (texture repeat-wraps).
 */
export function sliceMaterial(density: Data3DTexture, shift: { x: number; y: number; z: number }, channel: 'b' | 'g', radius: number): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
  const p = positionLocal; // plane in XY, rotated to XZ by the mesh
  const world = vec3(p.x, 0, p.y.negate());
  const uvw = world.sub(vec3(shift.x, shift.y, shift.z)).div(WORLD_BOX).add(0.5);
  const sample = texture3D(density, uvw);
  const v = channel === 'b' ? sample.b : sample.g;
  const disc = float(1).sub(smoothstep(radius * 0.9, radius, p.xy.length()));
  m.colorNode = vec4(cmbColorNode(v.div(3)).mul(0.3), 1);
  m.opacityNode = disc.mul(0.6);
  return m;
}

