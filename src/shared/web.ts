// The cosmic web as GPU points (HANDOFF §8, §9.8–9.12, §9.15). One shared look for every structure scene:
// particles sit at Lagrangian q and move to x = q + A ψ(q) (Zel'dovich), brightness from the Zel'dovich
// density ρ/ρ̄ = 1/|Π(1 − A λᵢ)| softened past shell crossing. All per-particle data comes from the shared
// primordial field, so the same structures appear in every scene that uses this.

import { AdditiveBlending, Color, Sprite, SpriteNodeMaterial } from 'three/webgpu';
import {
  abs,
  clamp,
  float,
  fract,
  instancedBufferAttribute,
  log,
  max,
  mix,
  smoothstep,
  uniform,
  uv,
  vec3,
} from 'three/tsl';
import { WORLD_BOX } from './gaussianField.ts';
import { densityColorNode } from './color.ts';
import type { RenderContext } from '../scenes/types.ts';
import type { FloatUniform } from '../render/globals.ts';

const mkColor = () => uniform(new Color());
type ColorUniform = ReturnType<typeof mkColor>;

export interface CosmicWebOptions {
  /** Cap on particles drawn (also capped by the quality tier and the field). */
  maxCount?: number;
  /** World-space sprite size at ρ = ρ̄. */
  size?: number;
  /** Wrap positions into the periodic box (tidy cube) instead of letting them drift out. */
  wrap?: boolean;
}

export interface CosmicWeb {
  object: Sprite;
  material: SpriteNodeMaterial;
  count: number;
  uniforms: {
    /** Zel'dovich amplitude A (use webAmplitude(a) for continuity across scenes). */
    amplitude: FloatUniform;
    /** Overall brightness multiplier. */
    brightness: FloatUniform;
    /** World scale multiplier (comoving → physical stretch, e.g. a(t)/a₀ in darkEnergy). */
    scale: FloatUniform;
    /** 0 = neutral starlight tint, 1 = labelled density colour map (dark ages: colour mapped). */
    colourMap: FloatUniform;
    /** Tint used when colourMap = 0. */
    tint: ColorUniform;
    /** Sprite size multiplier. */
    size: FloatUniform;
    /** Fraction of particles visible (0–1), for fading the web in by density rank. */
    reveal: FloatUniform;
    /** Emphasis on dense regions: raises the density exponent. */
    contrast: FloatUniform;
  };
  dispose(): void;
}

/** Requires `await ctx.field.ready` first. Do not dispose the field's attributes; dispose() only frees the material. */
export function createCosmicWeb(ctx: RenderContext, opts: CosmicWebOptions = {}): CosmicWeb {
  const attrs = ctx.field.attributes();
  const count = Math.max(1, Math.min(attrs.count, ctx.quality.particles, opts.maxCount ?? Infinity));
  const u = {
    amplitude: uniform(0),
    brightness: uniform(1),
    scale: uniform(1),
    colourMap: uniform(0),
    tint: uniform(new Color(0.75, 0.82, 1.0)),
    size: uniform(1),
    reveal: uniform(1),
    contrast: uniform(1),
  };
  const q = instancedBufferAttribute<'vec4'>(attrs.q, 'vec4');
  const psi = instancedBufferAttribute<'vec4'>(attrs.psi, 'vec4');
  const lam = instancedBufferAttribute<'vec4'>(attrs.lambda, 'vec4');

  const A = u.amplitude;
  const disp = q.xyz.add(psi.xyz.mul(A));
  const boxPos = opts.wrap === false ? disp : fract(disp);
  const world = boxPos.sub(0.5).mul(WORLD_BOX).mul(u.scale);

  // Zel'dovich density, softened past shell crossing.
  const j = float(1)
    .sub(A.mul(lam.x))
    .mul(float(1).sub(A.mul(lam.y)))
    .mul(float(1).sub(A.mul(lam.z)));
  const rho = float(1).div(max(abs(j), 0.04));
  const lr = log(rho.add(0.2)).mul(0.45).mul(u.contrast); // ~0 in voids, ~1.5 in knots
  const dens = clamp(lr.mul(0.55).add(0.3), 0, 1);

  // Reveal: particles with high density (or near peaks) appear first when reveal < 1.
  const rank = clamp(dens.mul(0.8).add(q.w.mul(0.2)), 0, 1);
  const visible = smoothstep(float(1).sub(u.reveal).sub(0.05), float(1).sub(u.reveal).add(0.05), rank);

  const neutral = u.tint.mul(float(0.35).add(dens.mul(1.6)));
  const mapped = densityColorNode(dens).mul(float(0.5).add(dens.mul(1.2)));
  const col = mix(neutral, mapped, u.colourMap);

  const r = uv().sub(0.5).length();
  const disc = float(1).sub(smoothstep(0.0, 0.5, r)).pow(1.6);

  const material = new SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  material.positionNode = world;
  const baseSize = opts.size ?? 0.028;
  material.scaleNode = float(baseSize).mul(u.size).mul(float(0.55).add(dens.mul(0.9)));
  material.colorNode = col.mul(u.brightness).mul(visible);
  material.opacityNode = disc.mul(visible).mul(float(0.25).add(dens.mul(0.75)));

  const object = new Sprite(material);
  object.count = count;
  object.frustumCulled = false;

  return {
    object,
    material,
    count,
    uniforms: u,
    dispose() {
      material.dispose();
    },
  };
}

/** Convenience: a neutral starlight tint vector for galaxies. */
export const STARLIGHT = vec3(1.0, 0.92, 0.82);
