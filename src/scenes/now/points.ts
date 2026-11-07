// Constant-pixel-size point sprites for the `now` scene (planets, belts, stars, distant galaxies).

import { AdditiveBlending, InstancedBufferAttribute, Sprite, SpriteNodeMaterial } from 'three/webgpu';
import { exp, float, instancedBufferAttribute, smoothstep, uniform, uv } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { FloatUniform, Vec2Uniform } from '../../render/globals.ts';

export interface Points {
  sprite: Sprite;
  material: SpriteNodeMaterial;
  /** xyz position, w = size in pixels. */
  pos: InstancedBufferAttribute;
  /** rgb colour (linear HDR), w = extra per-point weight. */
  col: InstancedBufferAttribute;
  uniforms: { opacity: FloatUniform; size: FloatUniform };
  dispose(): void;
}

export interface PointsOptions {
  count: number;
  resolution: Vec2Uniform;
  fovDeg: number;
  /** Optional per-point brightness modifier built from the attributes (e.g. flux from distance). */
  shade?: (pos: Node<'vec4'>, col: Node<'vec4'>) => { color: Node<'vec3'>; size?: Node<'float'> };
  /** Gaussian core sharpness. */
  sharpness?: number;
}

export function createPoints(o: PointsOptions): Points {
  const posArr = new InstancedBufferAttribute(new Float32Array(o.count * 4), 4);
  const colArr = new InstancedBufferAttribute(new Float32Array(o.count * 4), 4);
  const P = instancedBufferAttribute<'vec4'>(posArr, 'vec4');
  const C = instancedBufferAttribute<'vec4'>(colArr, 'vec4');
  const u = { opacity: uniform(1), size: uniform(1) };
  const mat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false });
  mat.positionNode = P.xyz;
  const shaded = o.shade ? o.shade(P, C) : { color: C.rgb.mul(C.w) };
  const px = (shaded.size ?? P.w).mul(u.size);
  const tanHalf = Math.tan(((o.fovDeg / 2) * Math.PI) / 180);
  mat.scaleNode = px.mul(2 * tanHalf).div(o.resolution.y);
  const d = uv().sub(0.5).length().mul(2);
  const k = o.sharpness ?? 6;
  const disc = exp(d.mul(d).mul(-k)).mul(float(1).sub(smoothstep(0.75, 1.0, d)));
  mat.colorNode = shaded.color.mul(u.opacity);
  mat.opacityNode = disc;
  const sprite = new Sprite(mat);
  sprite.count = o.count;
  sprite.frustumCulled = false;
  return {
    sprite,
    material: mat,
    pos: posArr,
    col: colArr,
    uniforms: u,
    dispose() {
      mat.dispose();
    },
  };
}
