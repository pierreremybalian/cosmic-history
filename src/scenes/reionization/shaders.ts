// TSL for reionization: the ionised-bubble field (smooth union of Strömgren-scaled spheres at the field's
// galaxies), the raymarched neutral-hydrogen fog with glowing ionisation fronts, clumpy first galaxies dimmed by
// the fog in front of them, and the quasar with its jets.

import {
  AdditiveBlending,
  BackSide,
  CustomBlending,
  DoubleSide,
  MeshBasicNodeMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  SpriteNodeMaterial,
  Vector3,
  type DataTexture,
} from 'three/webgpu';
import {
  Fn,
  Loop,
  abs,
  cameraPosition,
  clamp,
  exp,
  float,
  fract,
  hash,
  instanceIndex,
  max,
  min,
  mx_noise_float,
  positionGeometry,
  positionWorld,
  pow,
  sin,
  smoothstep,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { Node, UniformArrayNode } from 'three/webgpu';
import { blackbodyNode } from '../../render/globals.ts';
import type { FloatUniform } from '../../render/globals.ts';
import { STRUCTURE, ballSpan, eulerianDelta, ign, spriteR, type FieldNodes } from '../darkAges/structure.ts';

type F = Node<'float'>;
type V3 = Node<'vec3'>;
const _mkV3 = () => uniform(new Vector3());
export type Vec3Uniform = ReturnType<typeof _mkV3>;

export interface BubbleNodes {
  /** (x, y, z, radius) per bubble; radius 0 = off. */
  bubbles: UniformArrayNode<'vec4'>;
  count: number;
  /** Extinction per world unit outside bubbles (∝ the global neutral fraction). */
  uSigma: FloatUniform;
  /** Smooth-union width (world units). */
  uSmooth: FloatUniform;
  /** Amplitude of the noise that roughens the fronts (world units). */
  uRough: FloatUniform;
  uTime: FloatUniform;
}

/** Signed distance to the ionised region (< 0 inside a bubble). */
export function bubbleSDF(b: BubbleNodes, p: V3): F {
  return Fn(() => {
    const d = float(1e4).toVar();
    Loop(b.count, ({ i }) => {
      const s = b.bubbles.element(i);
      const di = p.sub(s.xyz).length().sub(s.w);
      // Polynomial smooth minimum: merging bubbles fuse with a neck instead of a crease.
      const k = b.uSmooth;
      const h = max(k.sub(abs(d.sub(di))), 0).div(k);
      d.assign(min(d, di).sub(h.mul(h).mul(k).mul(0.25)));
    });
    const rough = mx_noise_float(p.mul(1.15).add(vec3(0, b.uTime.mul(0.01), 0))).mul(b.uRough);
    return d.add(rough);
  })();
}

/**
 * Neutral-hydrogen fog with ionisation fronts, raymarched through the ball. Output is premultiplied:
 * rgb = emission, a = 1 − transmittance, so whatever was drawn before is veiled by the remaining neutral gas.
 * Gas density follows the web (smoothed δ at each point), the fog itself is a labelled colour map.
 */
export function fogMaterial(
  b: BubbleNodes,
  f: FieldNodes,
  steps: number,
  u: { uA: FloatUniform; uFogGlow: FloatUniform; uFront: FloatUniform; uFrontWidth: FloatUniform; fogColour: Vec3Uniform; frontColour: Vec3Uniform },
): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({
    side: BackSide,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });
  const R = STRUCTURE.ballRadius;
  const out = Fn(() => {
    const ro = cameraPosition;
    const rd = positionWorld.sub(ro).normalize();
    const span = ballSpan(ro, rd, R);
    const dt = span.y.sub(span.x).div(steps);
    const jit = ign();
    const T = float(1).toVar();
    const acc = vec3(0).toVar();
    Loop(steps, ({ i }) => {
      const t = span.x.add(float(i).add(jit).mul(dt));
      const p = ro.add(rd.mul(t));
      const sdf = bubbleSDF(b, p);
      const neutral = smoothstep(-0.05, 0.08, sdf);
      const ball = float(1).sub(smoothstep(R - STRUCTURE.ballFeather, R, p.length()));
      const delta = eulerianDelta(f, p, u.uA);
      const gas = clamp(exp(delta.mul(0.8)), 0.35, 3);
      const near = smoothstep(0.3, 1.6, t);
      const sigma = b.uSigma.mul(neutral).mul(ball).mul(gas).mul(near);
      // Ionisation front: just outside the bubble surface, where neutral gas is being ionised.
      const fw = u.uFrontWidth;
      const ds = sdf.sub(fw.mul(0.5));
      const front = exp(ds.mul(ds).div(fw.mul(fw)).negate()).mul(ball).mul(near).mul(clamp(gas, 0.5, 1.6));
      const e = u.fogColour.mul(sigma.mul(u.uFogGlow)).add(u.frontColour.mul(front.mul(u.uFront)));
      acc.addAssign(e.mul(T).mul(dt));
      T.mulAssign(exp(sigma.mul(dt).negate()));
    });
    return vec4(acc, float(1).sub(T));
  })();
  m.colorNode = out.rgb;
  m.opacityNode = out.a;
  return m;
}

/** Transmittance of the fog from world point p back to the camera (few steps, used per vertex). */
export function fogTransmittance(b: BubbleNodes, p: V3, steps: number): F {
  return Fn(() => {
    const seg = cameraPosition.sub(p);
    const len = seg.length();
    const dir = seg.div(max(len, 1e-4));
    const tau = float(0).toVar();
    const dt = len.div(steps);
    const R = STRUCTURE.ballRadius;
    Loop(steps, ({ i }) => {
      const q = p.add(dir.mul(float(i).add(0.5).mul(dt)));
      const neutral = smoothstep(-0.05, 0.08, bubbleSDF(b, q));
      const ball = float(1).sub(smoothstep(R - STRUCTURE.ballFeather, R, q.length()));
      tau.addAssign(b.uSigma.mul(neutral).mul(ball).mul(dt));
    });
    return exp(tau.negate());
  })();
}

/**
 * The first galaxies: small and clumpy — a few knots of hot young stars (blackbody, CPU-given temperatures),
 * one H II knot in Hα, and a faint diffuse glow of cooler stars. galaxies[i] = (x, y, z, brightness 0–1).
 */
export function galaxyMaterial(
  galaxies: UniformArrayNode<'vec4'>,
  b: BubbleNodes,
  lut: DataTexture,
  u: { uSize: FloatUniform; uPeak: FloatUniform; uLogTYoung: FloatUniform; uLogTOld: FloatUniform; hAlpha: Vec3Uniform; uRef: FloatUniform },
): SpriteNodeMaterial {
  const m = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  const g = galaxies.element(instanceIndex);
  const w = g.w;
  m.positionNode = g.xyz;
  const dCam = g.xyz.sub(cameraPosition).length();
  const trans = varying(fogTransmittance(b, g.xyz, 6));
  m.scaleNode = u.uSize.mul(w.mul(0.7).add(0.5)).mul(clamp(dCam.div(u.uRef), 0.25, 1)).mul(smoothstep(0.0, 0.02, w));
  const seed = float(instanceIndex).mul(17);
  m.colorNode = Fn(() => {
    const p = uv().sub(0.5).mul(2);
    const young = blackbodyNode(lut, u.uLogTYoung);
    const old = blackbodyNode(lut, u.uLogTOld);
    const acc = vec3(0).toVar();
    // Four knots on a lumpy ring-ish layout, plus a central one.
    for (let j = 0; j < 5; j++) {
      const a = hash(seed.add(j * 3)).mul(Math.PI * 2);
      const rr = j === 0 ? float(0.05) : hash(seed.add(j * 3 + 1)).mul(0.32).add(0.12);
      const c = vec2(rr.mul(sin(a.add(1.5708))), rr.mul(sin(a)));
      const k = p.sub(c);
      const size = hash(seed.add(j * 3 + 2)).mul(60).add(50).mul(j === 2 ? 0.5 : 1);
      const blob = exp(k.dot(k).mul(size).negate());
      const col = j === 2 ? u.hAlpha.mul(0.35).add(young.mul(0.25)) : young;
      acc.addAssign(col.mul(blob).mul(j === 0 ? 1.2 : 0.8));
    }
    const r = p.length();
    acc.addAssign(old.mul(exp(r.mul(r).mul(-7))).mul(0.18));
    const edge = float(1).sub(smoothstep(0.8, 1.0, r));
    return acc.mul(edge).mul(w).mul(u.uPeak).mul(trans);
  })();
  m.opacityNode = float(1);
  return m;
}

/** The quasar: an intense accretion-disc point (blackbody at the CPU-given temperature) with a broad glow. */
export function quasarMaterial(
  pos: Vec3Uniform,
  b: BubbleNodes,
  lut: DataTexture,
  u: { uLogT: FloatUniform; uSize: FloatUniform; uPeak: FloatUniform },
): SpriteNodeMaterial {
  const m = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  m.positionNode = pos;
  m.scaleNode = u.uSize.mul(step0(u.uPeak));
  const trans = varying(fogTransmittance(b, pos, 8));
  const r = spriteR();
  const core = exp(r.mul(r).mul(-400));
  const glow = exp(r.mul(r).mul(-30)).mul(0.08);
  const halo = float(0.01).div(r.mul(r).add(0.01)).mul(0.035);
  m.colorNode = blackbodyNode(lut, u.uLogT).mul(core.add(glow).add(halo)).mul(float(1).sub(smoothstep(0.7, 1, r))).mul(u.uPeak).mul(trans);
  m.opacityNode = float(1);
  return m;
}
const step0 = (x: F) => smoothstep(0, 0.001, x);

/**
 * A pair of relativistic jets as one camera-facing ribbon (geometry y ∈ [−1, 1], x ∈ [−0.5, 0.5]): knots stream
 * outward, the beam widens slowly and ends in faint hotspots. Colour from params (synchrotron is not thermal).
 */
export function jetMaterial(
  origin: V3,
  axis: V3,
  u: { uLength: FloatUniform; uWidth: FloatUniform; uPeak: FloatUniform; uTime: FloatUniform; colour: Vec3Uniform },
): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, side: DoubleSide });
  const y = positionGeometry.y;
  const s = abs(y);
  const along = origin.add(axis.mul(y.mul(u.uLength)));
  const view = along.sub(cameraPosition).normalize();
  const side = axis.cross(view).normalize();
  const width = u.uWidth.mul(s.mul(1.4).add(0.25));
  m.positionNode = along.add(side.mul(positionGeometry.x.mul(2).mul(width)));
  m.colorNode = Fn(() => {
    const x = uv().x.sub(0.5).mul(2);
    const sy = abs(uv().y.sub(0.5).mul(2));
    const beam = exp(x.mul(x).mul(-6)).mul(0.8);
    const spine = exp(x.mul(x).mul(-40)).mul(0.35);
    const cocoon = exp(x.mul(x).mul(-1.4)).mul(0.12);
    const knots = pow(fract(sy.mul(7).sub(u.uTime.mul(0.35))), 3).mul(0.7).add(0.45);
    const fade = pow(float(1).sub(sy), 1.3);
    const hotspot = exp(sy.sub(0.9).mul(sy.sub(0.9)).mul(-160)).mul(0.5);
    const baseFade = smoothstep(0.0, 0.06, sy);
    const I = beam.mul(knots).mul(fade).add(spine.mul(fade)).add(cocoon.mul(fade)).add(hotspot.mul(beam)).mul(baseFade);
    return u.colour.mul(I).mul(u.uPeak);
  })();
  m.opacityNode = float(1);
  return m;
}

