// cosmicNoon-only TSL: dwarf satellites that sink into the young Milky Way and the tidal streams they shed.
// Stateless: every position is f(seed, sink clock, idle spin), so scrubbing backwards works.

import { AdditiveBlending, InstancedBufferAttribute, Sprite, SpriteNodeMaterial } from 'three/webgpu';
import { clamp, cos, exp, float, instancedBufferAttribute, length, mix, pow, sin, smoothstep, uniform, uv, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { FloatUniform } from '../../render/globals.ts';
import { gaussian, mulberry32 } from '../../shared/math.ts';
import { galaxyLight, stellarPalette } from './galaxies.ts';

type F = Node<'float'>;

export interface SatelliteOptions {
  count: number;
  /** Stream stars per satellite. */
  streamStars: number;
  seed?: number;
}

export interface Satellites {
  sprites: Sprite;
  stream: Sprite;
  uniforms: {
    /** 0 → 1: satellites spiral in, are stretched into streams and absorbed. */
    sink: FloatUniform;
    spin: FloatUniform;
    brightness: FloatUniform;
    sf: FloatUniform;
  };
  dispose(): void;
}

/**
 * Satellites live in the host's local frame (host disk in XZ, visible radius 1). Orbit i: radius r0 decaying
 * to 0 at its own merge time, inclined plane, prograde or retrograde.
 */
export function createSatellites(o: SatelliteOptions): Satellites {
  const rand = mulberry32(o.seed ?? 314);
  const n = o.count;
  const orb = new Float32Array(n * 4); // r0, phase, merge time (sink units), angular speed
  const tilt = new Float32Array(n * 4); // inclination, node angle, size, seed
  for (let i = 0; i < n; i++) {
    orb.set([1.9 + 1.4 * rand(), rand() * Math.PI * 2, 0.55 + 0.4 * (i / Math.max(1, n - 1)) + 0.05 * rand(), (rand() < 0.75 ? 1 : -1) * (5 + 3 * rand())], i * 4);
    tilt.set([0.3 + 0.9 * rand(), rand() * Math.PI * 2, 0.11 + 0.06 * rand(), rand()], i * 4);
  }
  const u = { sink: uniform(0), spin: uniform(0), brightness: uniform(1), sf: uniform(0.5) };
  const pal = stellarPalette();

  // Orbit position at phase angle `a`, radius `rad`, for orbit params (inc, node).
  const orbitPos = (rad: F, a: F, inc: F, node: F) => {
    const x = rad.mul(cos(a));
    const y = rad.mul(sin(a));
    // incline about the X axis, then rotate the node about Y
    const py = y.mul(sin(inc));
    const pz = y.mul(cos(inc));
    return vec3(x.mul(cos(node)).sub(pz.mul(sin(node))), py, x.mul(sin(node)).add(pz.mul(cos(node))));
  };

  // ── satellites ──
  const O = instancedBufferAttribute<'vec4'>(new InstancedBufferAttribute(orb, 4), 'vec4');
  const T = instancedBufferAttribute<'vec4'>(new InstancedBufferAttribute(tilt, 4), 'vec4');
  const toGo = clamp(O.z.sub(u.sink).div(O.z), 0, 1);
  const rad = O.x.mul(pow(toGo, 0.6)).add(0.05);
  const ang = O.y.add(float(1).sub(toGo).mul(O.w)).add(u.spin.mul(0.5));
  const satMat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  satMat.positionNode = orbitPos(rad, ang, T.x, T.y);
  // Satellites lose stars as they sink: size and brightness shrink.
  const keep = smoothstep(0.0, 0.35, toGo);
  satMat.scaleNode = T.z.mul(2.4).mul(keep.mul(0.6).add(0.4));
  const s = uv().sub(0.5).mul(2.4);
  const light = galaxyLight({ p: s, seed: T.w, spin: u.spin, settle: float(0.1), sf: u.sf.mul(0.8), ell: float(0.0), disturb: float(1).sub(toGo) }, pal);
  const edge = float(1).sub(smoothstep(0.85, 1.2, length(s)));
  satMat.colorNode = light.mul(edge).mul(keep).mul(u.brightness).mul(1.2);
  satMat.opacityNode = keep;
  const sprites = new Sprite(satMat);
  sprites.count = n;
  sprites.frustumCulled = false;

  // ── tidal streams: stars stripped along the orbit, trailing and leading the satellite ──
  const m = n * o.streamStars;
  const st = new Float32Array(m * 4); // satellite index, lag (−0.3…1), radial scatter, vertical scatter
  const st2 = new Float32Array(m * 4); // brightness, seed, -, -
  for (let k = 0; k < m; k++) {
    const i = Math.floor(k / o.streamStars);
    const lag = rand() < 0.65 ? Math.pow(rand(), 0.7) : -0.35 * Math.pow(rand(), 0.7);
    st.set([i, lag, gaussian(rand) * 0.035, gaussian(rand) * 0.025], k * 4);
    st2.set([Math.exp(gaussian(rand) * 0.5), rand(), 0, 0], k * 4);
  }
  const S = instancedBufferAttribute<'vec4'>(new InstancedBufferAttribute(st, 4), 'vec4');
  const S2 = instancedBufferAttribute<'vec4'>(new InstancedBufferAttribute(st2, 4), 'vec4');
  // Per-star orbit params: fetched by satellite index from small uniform-free tables (unrolled select).
  let sr0: F = float(0);
  let sph: F = float(0);
  let smt: F = float(1);
  let sw: F = float(0);
  let sinc: F = float(0);
  let snode: F = float(0);
  for (let i = 0; i < n; i++) {
    const on = float(1).sub(smoothstep(0.0, 0.5, S.x.sub(i).abs()));
    sr0 = sr0.add(on.mul(orb[i * 4]!));
    sph = sph.add(on.mul(orb[i * 4 + 1]!));
    smt = smt.add(on.mul(orb[i * 4 + 2]! - 1));
    sw = sw.add(on.mul(orb[i * 4 + 3]!));
    sinc = sinc.add(on.mul(tilt[i * 4]!));
    snode = snode.add(on.mul(tilt[i * 4 + 1]!));
  }
  const sToGo = clamp(smt.sub(u.sink).div(smt), 0, 1);
  const stripped = float(1).sub(sToGo);
  // Stream length grows as the satellite is disrupted; a stripped star lags behind along the orbit.
  const lagAng = S.y.mul(stripped.mul(5.5)).mul(sw.sign());
  const sRad = sr0.mul(pow(sToGo, 0.6)).add(0.05).mul(float(1).add(S.z.mul(stripped.mul(2.0).add(0.4))));
  const sAng = sph.add(stripped.mul(sw)).add(u.spin.mul(0.5)).sub(lagAng);
  const base = orbitPos(sRad, sAng, sinc, snode);
  const streamMat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  streamMat.positionNode = base.add(vec3(0, S.w.mul(stripped.add(0.3)), 0));
  streamMat.scaleNode = float(0.012).mul(S2.x.sqrt());
  const d = uv().sub(0.5).length().mul(2);
  const vis = smoothstep(0.02, 0.2, stripped).mul(float(1).sub(smoothstep(0.85, 1.0, stripped).mul(0.7)));
  const pd = exp(d.mul(d).mul(-5)).mul(float(1).sub(smoothstep(0.8, 1, d)));
  const tint = mix(vec3(pal.old.x, pal.old.y, pal.old.z), vec3(pal.young.x, pal.young.y, pal.young.z), S2.y.mul(0.35));
  streamMat.colorNode = tint.mul(S2.x).mul(vis).mul(u.brightness).mul(0.3);
  streamMat.opacityNode = pd;
  const stream = new Sprite(streamMat);
  stream.count = m;
  stream.frustumCulled = false;

  return {
    sprites,
    stream,
    uniforms: u,
    dispose() {
      satMat.dispose();
      streamMat.dispose();
    },
  };
}
