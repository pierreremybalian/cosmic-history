// TSL for the inflation scene: the primordial curvature ζ (shared field, G channel) shown on the slice
// z = 0.5 of the box, magnified by the (compressed) scale factor; quantum jitter inside a soft horizon;
// the horizon itself as a glowing bubble.
//
// The infinite stretch: what is on screen at magnification M is a sum of copies of the same ζ field at
// scales M·Rᵏ (k = 0 … ). ζ is almost scale-invariant (n_s = 0.965: nearly equal power per octave), so a
// stack of rescaled copies is statistically the same field at every zoom. Copy 0 is the real box at the
// real slice (scale 1 at the end of the chapter); the others are decorrelated slices of the same texture,
// standing in for modes larger than the box. Each copy is only drawn while its box is about one to a few
// screens wide (so its periodic tiling never shows and it is never minified); the CPU picks the copies
// in that window and passes them in three slots.

import { AdditiveBlending, Color, FrontSide, MeshBasicNodeMaterial, Vector2, Vector4, type Data3DTexture } from 'three/webgpu';
import {
  Fn,
  abs,
  cameraPosition,
  clamp,
  cos,
  dot,
  exp,
  float,
  floor,
  If,
  length,
  mix,
  mx_noise_float,
  select,
  normalWorld,
  positionWorld,
  sin,
  smoothstep,
  texture3D,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { densityColorNode } from '../../shared/color.ts';

const _mkF = () => uniform(0);
const _mkV2 = () => uniform(new Vector2());
const _mkV4 = () => uniform(new Vector4());
const _mkC = () => uniform(new Color());
type F = ReturnType<typeof _mkF>;
type V2 = ReturnType<typeof _mkV2>;
type V4 = ReturnType<typeof _mkV4>;
type C = ReturnType<typeof _mkC>;

export const SLOTS = 3;

export interface FieldUniforms {
  /** Zoom centre on the slice (world xy): the fixed point of the stretch, and the horizon's centre. */
  centre: V2;
  /** Per slot: (box size in world units, z of the slice in box units, rotation (rad), weight). */
  slot: V4[];
  /** 1 / √(Σ w²): keeps the summed ripples at unit variance while copies cross-fade. */
  norm: F;
  /** Radial blur (fraction of the radius) along the stretch, for the violent phase. */
  blur: F;
  /** Ripple contrast and brightness. */
  contrast: F;
  bright: F;
  /** Uniform inflaton glow under the ripples. */
  energy: F;
  /** Horizon radius (world), ring brightness, and quantum jitter strength inside it. */
  horizonR: F;
  ring: F;
  jitter: F;
  jitterPhase: F;
  /** Cool (ζ < 0) and warm (ζ > 0) ends of the ripple palette, and the energy glow colour. */
  cool: C;
  warm: C;
  glow: C;
  /** Soft vignette radius (world) around the zoom centre for the early, small field. */
  extent: F;
  /** Idle light drift: amplitude and (wall-clock) phase. */
  idle: F;
  idlePhase: F;
  /** Top of the colour map used for the brightest crests (0–1). */
  mapTop: F;
  /** Debug: 1 = raw ζ slice (box at scale 1) with a strong diverging map. */
  debug: F;
}

export function createFieldUniforms(): FieldUniforms {
  const slot: V4[] = [];
  for (let i = 0; i < SLOTS; i++) slot.push(uniform(new Vector4(10, 0.5, 0, 0)));
  return {
    centre: uniform(new Vector2()),
    slot,
    norm: uniform(1),
    blur: uniform(0),
    contrast: uniform(1),
    bright: uniform(0),
    energy: uniform(0),
    horizonR: uniform(1.5),
    ring: uniform(0),
    jitter: uniform(0),
    jitterPhase: uniform(0),
    cool: uniform(new Color(0.02, 0.05, 0.22)),
    warm: uniform(new Color(0.85, 0.78, 0.7)),
    glow: uniform(new Color(0.3, 0.44, 1)),
    extent: uniform(100),
    mapTop: uniform(0.9),
    idle: uniform(0),
    idlePhase: uniform(0),
    debug: uniform(0),
  };
}

/** Cubic B-spline weights → two bilinear taps per axis (Sigg & Hadwiger 2005), here in the slice plane. */
function bspline2(tex: Data3DTexture, n: number, uv: Node<'vec2'>, z: Node<'float'>): Node<'float'> {
  const p = uv.mul(n).sub(0.5);
  const i = floor(p);
  const f = p.sub(i);
  const f2 = f.mul(f);
  const f3 = f2.mul(f);
  const w0 = f3.negate().add(f2.mul(3)).sub(f.mul(3)).add(1).div(6);
  const w1 = f3.mul(3).sub(f2.mul(6)).add(4).div(6);
  const w2 = f3.mul(-3).add(f2.mul(3)).add(f.mul(3)).add(1).div(6);
  const w3 = f3.div(6);
  const g0 = w0.add(w1);
  const g1 = w2.add(w3);
  const h0 = w1.div(g0).sub(1).add(i).add(0.5).div(n);
  const h1 = w3.div(g1).add(1).add(i).add(0.5).div(n);
  const s00 = texture3D(tex, vec3(h0.x, h0.y, z)).g;
  const s10 = texture3D(tex, vec3(h1.x, h0.y, z)).g;
  const s01 = texture3D(tex, vec3(h0.x, h1.y, z)).g;
  const s11 = texture3D(tex, vec3(h1.x, h1.y, z)).g;
  return g0.y.mul(g0.x.mul(s00).add(g1.x.mul(s10))).add(g1.y.mul(g0.x.mul(s01).add(g1.x.mul(s11))));
}

/** ζ on the slice at world xy for one slot (box size L, slice z, rotation θ); W = world size of the real box. */
function zetaSlot(tex: Data3DTexture, n: number, W: number, xy: Node<'vec2'>, c: V2, s: V4): Node<'float'> {
  const d = xy.sub(c);
  const ca = cos(s.z);
  const sa = sin(s.z);
  const r = vec2(d.x.mul(ca).sub(d.y.mul(sa)), d.x.mul(sa).add(d.y.mul(ca)));
  // q = (x − c)/L + c/W + 0.5: at L = W (copy 0 at the end) this is exactly the box mapping x/W + 0.5.
  const uv = r.div(s.x).add(c.div(W)).add(0.5);
  return bspline2(tex, n, uv, s.y);
}

export function createFieldMaterial(tex: Data3DTexture, n: number, worldBox: number, u: FieldUniforms, blurTaps: number): MeshBasicNodeMaterial {
  const color = Fn(() => {
    const xy = positionWorld.xy;
    const d = xy.sub(u.centre);
    const rr = length(d);
    const out = vec3(0).toVar();
    If(u.debug.greaterThan(0.5), () => {
      // Raw slice z = 0.5 of the box, full contrast (compare with the cosmic web: same field, same seed).
      const v = bspline2(tex, n, xy.div(worldBox).add(0.5), float(0.5));
      out.assign(mix(vec3(0.05, 0.2, 1), vec3(1, 0.35, 0.1), smoothstep(-2, 2, v)).mul(abs(v).mul(0.35).add(0.15)));
    }).Else(() => {
      // Ripples, with an optional radial blur along the stretch (copies sampled at slightly smaller scales).
      // Slots with zero weight and the blur taps are skipped by uniform branches (the same for every pixel).
      const taps = Math.max(1, blurTaps);
      const sum = float(0).toVar();
      for (let k = 0; k < taps; k++) {
        const xk = u.centre.add(d.mul(float(1).sub(u.blur.mul(k / taps))));
        const tap = () => {
          for (let j = 0; j < SLOTS; j++) {
            const sl = u.slot[j]!;
            If(sl.w.greaterThan(1e-4), () => {
              sum.addAssign(zetaSlot(tex, n, worldBox, xk, u.centre, sl).mul(sl.w));
            });
          }
        };
        if (k === 0) tap();
        else If(u.blur.greaterThan(1e-3), tap);
      }
      const nTaps = select(u.blur.greaterThan(1e-3), float(taps), float(1));
      const v = sum.div(nTaps).mul(u.norm);
      // Quantum jitter: fine, fast-changing noise inside the horizon (sub-horizon modes still fluctuate).
      const inside = float(1).sub(smoothstep(u.horizonR.mul(0.75), u.horizonR.mul(1.02), rr));
      const jit = float(0).toVar();
      If(u.jitter.mul(inside).greaterThan(1e-3), () => {
        const jp = vec3(d.mul(9).div(u.horizonR), u.jitterPhase);
        jit.assign(mx_noise_float(jp).add(mx_noise_float(jp.mul(2.1).add(7.3)).mul(0.5)).mul(u.jitter).mul(inside));
      });
      const vv = v.mul(u.contrast).add(jit.mul(0.6)).add(inside.mul(u.jitter).mul(0.35));
      // The labelled density colour map (dark ages uses it for matter): voids sink to black, crests glow.
      const t = smoothstep(-2.6, 3.0, vv);
      // Inside the horizon the jitter also shimmers the brightness (multiplicative: no grey veil).
      const ripple = densityColorNode(t.mul(u.mapTop)).mul(t.mul(t).mul(1.6).add(0.06)).mul(float(1).add(jit.mul(0.9)).max(0));
      const extent = exp(rr.div(u.extent).mul(rr.div(u.extent)).negate());
      // Idle life once the ripples have frozen: a very slow, large-scale drift of light across the field
      // (the ζ pattern itself never changes).
      const idle = float(1).add(mx_noise_float(vec3(xy.mul(0.16), u.idlePhase)).mul(u.idle));
      // Faint light filling the horizon: the region light can still cross (in causal contact).
      const innerGlow = float(1).sub(smoothstep(u.horizonR.mul(0.1), u.horizonR.mul(1.05), rr)).mul(u.ring).mul(0.045);
      out.assign(ripple.mul(u.bright).mul(idle).add(u.glow.mul(u.energy)).mul(extent).add(u.glow.mul(innerGlow)));
    });
    return out;
  })();
  const mat = new MeshBasicNodeMaterial({ depthWrite: true });
  mat.colorNode = color;
  return mat;
}

/** The horizon as a soft glowing bubble: a Fresnel rim, front hemisphere above the slice. */
export function createHorizonMaterial(gain: F, colour: C): MeshBasicNodeMaterial {
  const view = cameraPosition.sub(positionWorld).normalize();
  const facing = clamp(abs(dot(normalWorld, view)), 0, 1);
  const rim = float(1).sub(facing);
  // A soft limb (no hard edge) plus a faint wide halo: the boundary is a gradient, not a wall.
  const glow = rim.pow(5).mul(0.9).add(rim.pow(2).mul(0.04));
  const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: FrontSide });
  mat.colorNode = colour.mul(glow).mul(gain);
  return mat;
}
