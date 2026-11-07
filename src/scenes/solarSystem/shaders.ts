// TSL builders for the solarSystem scene: the parent molecular cloud (raymarched), the protoplanetary disk
// (a dusty ring mesh under Keplerian dust particles), bipolar jets, the accretion swarm and the Moon-forming
// debris. All particles are stateless (position = f(seed, local, elapsed)) so scrubbing works both ways.

import {
  AdditiveBlending,
  BackSide,
  HalfFloatType,
  LinearFilter,
  OrthographicCamera,
  PlaneGeometry,
  RenderTarget,
  RepeatWrapping,
  Scene,
  type WebGPURenderer,
  CustomBlending,
  DoubleSide,
  InstancedBufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteNodeMaterial,
  Vector3,
  type DataTexture,
} from 'three/webgpu';
import {
  Break,
  Fn,
  If,
  Loop,
  abs,
  asin,
  atan,
  cameraPosition,
  clamp,
  cos,
  dot,
  exp,
  float,
  fract,
  instancedBufferAttribute,
  length,
  max,
  min,
  mix,
  mx_noise_float,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  screenCoordinate,
  sin,
  smoothstep,
  sqrt,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { blackbodyNode } from '../../render/globals.ts';
import { fbm } from '../../shared/noise.ts';
import { mulberry32, gaussian } from '../../shared/math.ts';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

const mkF = (v = 0) => uniform(v);
const mkV3 = (x = 0, y = 0, z = 0) => uniform(new Vector3(x, y, z));
export type FU = ReturnType<typeof mkF>;
export type V3U = ReturnType<typeof mkV3>;

const premultiplied = (m: MeshBasicNodeMaterial | SpriteNodeMaterial) => {
  m.blending = CustomBlending;
  m.blendSrc = OneFactor;
  m.blendDst = OneMinusSrcAlphaFactor;
};

// ── Background: faint emission nebulosity (Hα red, [O III] teal) ───────────────

/**
 * Faint emission nebulosity on the sky, baked once into an equirectangular target (it is ~20 noise taps per
 * pixel, too costly to evaluate every frame behind the cloud's raymarch).
 */
export function createSkyNebula(renderer: WebGPURenderer, radius: number, ha: Vector3, oiii: Vector3, behind: Vector3) {
  const u = { brightness: mkF(1) };
  const nebulaColour = (d: V3): V3 => {
    const n1 = fbm(d.mul(2.6).add(vec3(3.1, 0.7, 5.2)), 5);
    const n2 = fbm(d.mul(4.1).add(vec3(9.4, 2.2, 1.3)), 4);
    // An H II region behind the cloud (the massive neighbours whose winds and supernovae enriched it).
    const toward = dot(d, vec3(behind.x, behind.y, behind.z));
    const region = smoothstep(0.6, 0.98, toward).mul(smoothstep(-0.3, 0.3, fbm(d.mul(1.3).add(vec3(7.7, 1.1, 0.3)), 3)));
    const wide = smoothstep(-0.2, 0.9, toward);
    // Soft H II glow plus thin, ridged filaments (shock fronts of an old supernova shell).
    const ridge = float(1).sub(abs(fbm(d.mul(3.2).add(vec3(2.2, 5.5, 0.9)), 5)).mul(2.2)).clamp(0, 1).pow(6);
    const halpha = smoothstep(-0.25, 0.45, n1).mul(0.55).add(ridge.mul(1.6)).mul(region.mul(1.0).add(wide.mul(0.12)).add(0.02));
    const teal = smoothstep(0.0, 0.55, n2).mul(region.mul(0.55).add(0.02));
    const dust = smoothstep(-0.15, 0.3, fbm(d.mul(5.0).add(vec3(1.1, 4.4, 2.0)), 5)).mul(0.9);
    return vec3(ha.x, ha.y, ha.z)
      .mul(halpha.mul(0.075))
      .add(vec3(oiii.x, oiii.y, oiii.z).mul(teal.mul(0.03)))
      .mul(float(1).sub(dust));
  };
  // Bake: a full-screen quad whose uv is the equirectangular (lon, lat) of a direction.
  const W = 2048;
  const target = new RenderTarget(W, W / 2, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
  target.texture.wrapS = RepeatWrapping;
  const bakeMat = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  const lon = uv().x.sub(0.5).mul(Math.PI * 2);
  const lat = uv().y.sub(0.5).mul(Math.PI);
  bakeMat.colorNode = nebulaColour(vec3(cos(lat).mul(sin(lon)), sin(lat), cos(lat).mul(cos(lon))));
  const quad = new Mesh(new PlaneGeometry(2, 2), bakeMat);
  const bakeScene = new Scene();
  bakeScene.add(quad);
  const bakeCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(bakeScene, bakeCam);
  renderer.setRenderTarget(prev);
  quad.geometry.dispose();
  bakeMat.dispose();

  const mat = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false });
  const d = normalize(positionLocal);
  const st = vec2(atan(d.x, d.z).div(Math.PI * 2).add(0.5), asin(clamp(d.y, -1, 1)).div(Math.PI).add(0.5));
  mat.colorNode = texture(target.texture).sample(st).level(float(0)).rgb.mul(u.brightness);
  const mesh = new Mesh(new SphereGeometry(radius, 64, 32), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;
  return {
    mesh,
    u,
    dispose() {
      mesh.geometry.dispose();
      mat.dispose();
      target.dispose();
    },
  };
}

// ── The parent molecular cloud: raymarched dust with an embedded, igniting protostar ─────────────

export function createMolecularCloud(radius: number, steps: number, octaves: number, lut: DataTexture, rimDir: Vector3, ha: Vector3) {
  const u = {
    /** Envelope radius (world). */
    envelope: mkF(radius),
    /** Opacity scale. */
    opacity: mkF(1),
    /** Central concentration 0..1 (collapse). */
    collapse: mkF(0),
    /** Flattening toward the disk plane 0..1. */
    flatten: mkF(0),
    /** Bipolar outflow cavities 0..1. */
    cavity: mkF(0),
    /** Protostar luminosity (relative) and log10 T. */
    starLum: mkF(0),
    starLogT: mkF(3.5),
    /** Rim light from a massive neighbour (ionisation front). */
    rim: mkF(1),
    time: mkF(0),
    fade: mkF(1),
  };
  const mat = new MeshBasicNodeMaterial({ side: BackSide, transparent: true, depthWrite: false });
  premultiplied(mat);
  const S = vec3(rimDir.x, rimDir.y, rimDir.z);
  const out = Fn(() => {
    const ro = cameraPosition;
    const rd = normalize(positionWorld.sub(cameraPosition));
    // March only the sphere that holds the (shrinking) envelope and its tail.
    const R = min(float(radius), u.envelope.mul(1.75));
    const b = dot(ro, rd);
    const c = dot(ro, ro).sub(R.mul(R));
    const disc = b.mul(b).sub(c);
    const sq = sqrt(max(disc, 0));
    const t0 = max(b.negate().sub(sq), 0);
    const t1 = b.negate().add(sq);
    const seg = max(t1.sub(t0), 0).div(steps);
    // White-noise start offset: the half-resolution upsample turns it into soft grain (no fixed pattern).
    const jitter = fract(sin(dot(screenCoordinate.xy, vec2(12.9898, 78.233))).mul(43758.5453));
    const T = float(1).toVar();
    const col = vec3(0).toVar();
    const starCol = blackbodyNode(lut, u.starLogT);
    const env = u.envelope;
    const core = env.mul(0.16);
    // Bright rim: warm scattered starlight with an Hα fringe (ionisation front).
    const rimCol = mix(vec3(1.0, 0.86, 0.72), vec3(ha.x, ha.y, ha.z), 0.3);
    const mu = dot(rd, S);
    const phase = float(0.25).add(pow(max(mu.negate(), 0), 3).mul(0.0)).add(pow(max(mu, 0), 4).mul(1.5));
    const ang = u.collapse.mul(2.2).add(u.time.mul(0.008));
    const ca = cos(ang);
    const sa = sin(ang);
    /** Density at a point (world, disk frame). */
    const density = (p: V3, oct: number, warped = true): F => {
      const pr = vec3(p.x.mul(ca).sub(p.z.mul(sa)), p.y.mul(float(1).add(u.flatten.mul(2.5))), p.x.mul(sa).add(p.z.mul(ca)));
      const qn = pr.div(env.mul(0.55));
      const warp = warped
        ? vec3(mx_noise_float(qn.mul(0.7).add(vec3(1.7, 3.1, 0.4))), mx_noise_float(qn.mul(0.7).add(vec3(6.2, 0.3, 2.9))), mx_noise_float(qn.mul(0.7).add(vec3(3.3, 8.8, 5.1)))).mul(0.7)
        : vec3(0);
      const n = fbm(qn.add(warp), oct);
      // Cometary globule: a compact head facing the massive star, a tail streaming away from it.
      // The shape relaxes to a sphere as the core collapses.
      const along = dot(p, S).div(env);
      const perp = length(p.div(env).sub(S.mul(along)));
      const shapeW = float(1).sub(u.collapse);
      const rs = length(pr).div(env);
      const rc = perp.mul(1.15).add(max(along, 0).mul(1.25)).add(max(along.negate(), 0).mul(0.42));
      const r = mix(rs, rc, shapeW);
      const radial = float(1).sub(r);
      const bound = float(1).sub(smoothstep(radius * 0.8, radius * 0.98, length(p)));
      return clamp(n.mul(1.3).add(radial.mul(1.5)).sub(0.5).mul(3.4), 0, 3).mul(bound);
    };
    Loop(steps, ({ i }) => {
      const t = t0.add(seg.mul(float(i).add(jitter)));
      const p = ro.add(rd.mul(t)).toVar();
      const rr = length(p);
      let dens: F = density(p, octaves);
      const conc = exp(rr.div(core).negate()).mul(u.collapse.mul(5.0));
      dens = dens.add(conc);
      // Outflow cavities along the spin axis (y).
      const axial = abs(p.y).div(max(rr, 1));
      const cav = smoothstep(0.8, 0.95, axial).mul(u.cavity);
      dens = dens.mul(float(1).sub(cav));
      const sig = dens.mul(u.opacity).mul(seg).div(env.mul(0.14));
      // Rim light from the massive neighbour: a two-tap estimate of the dust column toward it.
      const l1 = density(p.add(S.mul(env.mul(0.12))), 2, false);
      const l2 = density(p.add(S.mul(env.mul(0.35))), 1, false);
      const rimL = exp(l1.mul(3.0).add(l2.mul(1.5)).negate()).mul(u.rim);
      // The protostar: light escaping through the cavities, smothered elsewhere by the dense core.
      const column = conc.mul(0.35).add(float(1).sub(cav).mul(rr.div(env).mul(7.0)));
      const x = rr.div(core);
      const lit = u.starLum.div(float(0.15).add(x.mul(x))).mul(exp(column.negate()));
      const emis = starCol.mul(lit).mul(0.6).add(rimCol.mul(rimL).mul(phase).mul(0.55));
      col.addAssign(T.mul(emis).mul(sig));
      T.mulAssign(exp(sig.negate()));
      If(T.lessThan(0.015), () => {
        Break();
      });
    });
    const a = float(1).sub(T).mul(u.fade);
    return vec4(col.mul(u.fade), a);
  })();
  mat.colorNode = out.xyz;
  mat.opacityNode = out.w;
  const mesh = new Mesh(new SphereGeometry(radius, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return {
    mesh,
    u,
    dispose() {
      mesh.geometry.dispose();
      mat.dispose();
    },
  };
}

// ── The protoplanetary disk ─────────────────────────────────────────────────────

export interface DiskOptions {
  au: number; // world units per AU
  innerAU: number;
  outerAU: number;
  gapsAU: readonly number[];
  lut: DataTexture;
}

export function createDiskMesh(o: DiskOptions) {
  const u = {
    opacity: mkF(0),
    brightness: mkF(1),
    tau: mkF(0), // orbital phase clock
    gapDepth: mkF(0),
    starLogT: mkF(3.6),
    innerLogT: mkF(3.15), // dust sublimation rim temperature (log10 K)
    viewCos: mkF(0.5),
    gas: mkF(1),
  };
  const mat = new MeshBasicNodeMaterial({ side: DoubleSide, transparent: true, depthWrite: false });
  premultiplied(mat);
  const out = Fn(() => {
    const p = positionLocal; // ring lies in local XY; we rotate the mesh into XZ
    const rho = length(p.xy).div(o.au); // AU
    const phi = atan(p.y, p.x);
    const omega = pow(rho, -1.5);
    const phiRot = phi.sub(omega.mul(u.tau));
    // Surface density: ρ^-0.8 with a soft outer edge, a cleared inner hole.
    let sigma: F = pow(rho, -0.8).mul(exp(rho.div(o.outerAU * 0.75).mul(rho.div(o.outerAU * 0.75)).negate()));
    sigma = sigma.mul(smoothstep(o.innerAU, o.innerAU * 1.8, rho));
    for (const g of o.gapsAU) {
      const w = g * 0.12;
      sigma = sigma.mul(float(1).sub(exp(rho.sub(g).div(w).pow(2).negate()).mul(u.gapDepth.mul(0.92))));
      // bright rims at the gap edges
      sigma = sigma.mul(float(1).add(exp(rho.sub(g + w * 1.6).div(w * 0.6).pow(2).negate()).mul(u.gapDepth.mul(0.6))));
    }
    // Rotating clumpy texture in polar coordinates (Keplerian shear winds it up).
    const tp = vec3(rho.mul(3.0), cos(phiRot).mul(rho.mul(0.9).add(0.6)), sin(phiRot).mul(rho.mul(0.9).add(0.6)));
    const n = fbm(tp, 4).mul(0.6).add(1);
    const spiral = sin(phiRot.mul(2).sub(rho.log().mul(5.0))).mul(0.12).add(1);
    sigma = sigma.mul(n).mul(spiral).mul(u.gas.mul(0.85).add(0.15));
    // Optical depth along the view ray.
    const tauV = sigma.mul(1.4).div(max(u.viewCos, 0.12));
    const alpha = float(1).sub(exp(tauV.negate())).mul(u.opacity);
    // Scattered starlight (flared disk: ~ρ^-1.75) and thermal glow of the warm inner disk (T ∝ ρ^-1/2).
    const starCol = blackbodyNode(o.lut, u.starLogT);
    const illum = pow(rho.add(0.08), -1.75).mul(0.22);
    const dustCol = vec3(0.95, 0.62, 0.42);
    const logT = u.innerLogT.sub(rho.div(o.innerAU).log().mul(0.5 / Math.LN10));
    const thermal = blackbodyNode(o.lut, logT).mul(pow(float(10), logT.sub(u.innerLogT).mul(4)).mul(1.6));
    const col = starCol.mul(dustCol).mul(illum).add(thermal).mul(u.brightness).mul(alpha);
    return vec4(col, alpha);
  })();
  mat.colorNode = out.xyz;
  mat.opacityNode = out.w;
  const geo = new RingGeometry(o.innerAU * o.au * 0.8, o.outerAU * o.au * 1.6, 256, 48);
  const mesh = new Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return {
    mesh,
    u,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/**
 * Dust grains and planetesimals: Keplerian orbits (Ω ∝ ρ^-3/2, v ∝ ρ^-1/2) in a flared disk, pushed out of
 * the gaps as planets clear them. Before the disk exists they sit in the parent cloud and fall in.
 */
export function createDiskParticles(count: number, o: DiskOptions & { cloudRadius: number }) {
  const rand = mulberry32(4242);
  const a = new Float32Array(count * 4); // ρ (AU), φ0, z seed, kind (0 grain, 1 planetesimal, 2 protoplanet)
  const b = new Float32Array(count * 4); // cloud position (unit dir · radius frac), collapse order
  const nProto = o.gapsAU.length;
  for (let i = 0; i < count; i++) {
    let rho: number;
    let kind: number;
    if (i < nProto) {
      rho = o.gapsAU[i]!;
      kind = 2;
    } else {
      // Surface density ~ ρ^-0.8 → sample with more particles inside.
      rho = o.innerAU + Math.pow(rand(), 1.6) * (o.outerAU - o.innerAU);
      kind = rand() < 0.08 ? 1 : 0;
    }
    a[i * 4] = rho;
    a[i * 4 + 1] = rand() * Math.PI * 2;
    a[i * 4 + 2] = gaussian(rand) * 0.5;
    a[i * 4 + 3] = kind + rand() * 0.9;
    const z = rand() * 2 - 1;
    const th = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    const rf = Math.pow(rand(), 0.5);
    b[i * 4] = Math.cos(th) * s * rf;
    b[i * 4 + 1] = z * rf;
    b[i * 4 + 2] = Math.sin(th) * s * rf;
    b[i * 4 + 3] = rand();
  }
  const attrA = new InstancedBufferAttribute(a, 4);
  const attrB = new InstancedBufferAttribute(b, 4);
  const u = {
    tau: mkF(0),
    collapse: mkF(0), // 0 all in the cloud → 1 all in the disk
    gapDepth: mkF(0),
    gas: mkF(1), // fades small grains as the gas disk clears
    rocks: mkF(0), // planetesimal prominence
    starLum: mkF(0),
    starLogT: mkF(3.6),
    brightness: mkF(1),
    envelope: mkF(o.cloudRadius),
    size: mkF(1),
    camFadeNear: mkF(30),
  };
  const A = instancedBufferAttribute<'vec4'>(attrA, 'vec4');
  const B = instancedBufferAttribute<'vec4'>(attrB, 'vec4');
  const rho0 = A.x;
  const kind = A.w.floor();
  const isGrain = float(1).sub(min(kind, 1));
  const isProto = smoothstep(1.5, 2.0, kind);
  // Gaps push particles to their edges (bright rims), except the protoplanets themselves.
  let rho: F = rho0;
  for (const g of o.gapsAU) {
    const w = g * 0.14;
    const d = rho0.sub(g);
    const push = d.sign().mul(max(float(w).sub(d.abs()), 0)).mul(u.gapDepth).mul(float(1).sub(isProto));
    rho = rho.add(push);
  }
  const omega = pow(rho, -1.5);
  const phi = A.y.add(omega.mul(u.tau));
  const h = pow(rho, 1.25).mul(0.05).mul(A.z);
  const diskPos = vec3(cos(phi).mul(rho), h, sin(phi).mul(rho)).mul(o.au);
  // In-fall: inner material first; spin-up conserving angular momentum (illustrative).
  const order = B.w.mul(0.5).add(rho0.div(o.outerAU).mul(0.5));
  const k = smoothstep(order.mul(0.7), order.mul(0.7).add(0.3), u.collapse);
  const cloudAng = A.y.add(u.tau.mul(0.02)).add(k.mul(k).mul(2.0));
  const cr = vec3(B.x.mul(cos(cloudAng)).sub(B.z.mul(sin(cloudAng))), B.y, B.x.mul(sin(cloudAng)).add(B.z.mul(cos(cloudAng)))).mul(u.envelope);
  const pos = mix(cr, diskPos, k);
  const mat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  mat.positionNode = pos;
  const dCam = length(positionWorld.sub(cameraPosition));
  // Brightness: starlight falling off with distance; grains fade with the gas; rocks and protoplanets persist.
  const rr = length(pos).div(o.au);
  const illum = u.starLum.div(rr.mul(rr).add(0.15)).mul(0.6);
  const vis = isGrain.mul(u.gas).add(float(1).sub(isGrain).mul(float(0.35).add(u.rocks.mul(0.65))));
  const starCol = blackbodyNode(o.lut, u.starLogT);
  const rockCol = vec3(0.8, 0.62, 0.48);
  const protoGlow = isProto.mul(6.0);
  const nearFade = smoothstep(u.camFadeNear, u.camFadeNear.mul(4), dCam);
  const bright = illum.mul(vis).mul(float(0.5).add(fract(A.w).mul(0.8))).add(protoGlow.mul(u.rocks.add(0.2))).mul(u.brightness).mul(nearFade);
  mat.colorNode = starCol.mul(rockCol).mul(bright);
  const r = uv().sub(0.5).length().mul(2);
  const disc = float(1).sub(smoothstep(0.0, 1.0, r)).pow(1.8);
  mat.opacityNode = disc;
  const sizeW = float(o.au * 0.012)
    .mul(float(0.6).add(isGrain.negate().add(1).mul(1.2)).add(isProto.mul(3.0)))
    .mul(u.size)
    .mul(min(dCam.div(o.au * 4), 1).max(0.05));
  mat.scaleNode = sizeW;
  const sprite = new Sprite(mat);
  sprite.count = count;
  sprite.frustumCulled = false;
  sprite.renderOrder = 3;
  return {
    sprite,
    u,
    dispose() {
      mat.dispose();
    },
  };
}

// ── Bipolar jets (Herbig–Haro): knotty, along ±y ─────────────────────────────────

export function createJets(length0: number, ha: Vector3, sii: Vector3) {
  const u = { intensity: mkF(0), length: mkF(length0), time: mkF(0) };
  const mat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  const N = 700;
  const arr = new Float32Array(N * 4);
  const rand = mulberry32(99);
  for (let i = 0; i < N; i++) {
    arr[i * 4] = i % 2 ? 1 : -1;
    arr[i * 4 + 1] = rand();
    arr[i * 4 + 2] = rand();
    arr[i * 4 + 3] = rand();
  }
  const A = instancedBufferAttribute<'vec4'>(new InstancedBufferAttribute(arr, 4), 'vec4');
  const s = fract(A.y.add(u.time.mul(0.012))); // material streams outward
  const y = A.x.mul(pow(s, 0.8)).mul(u.length);
  const spread = s.mul(u.length).mul(0.035);
  const wob = sin(s.mul(9.0).add(u.time.mul(0.05))).mul(u.length.mul(0.01)).mul(s);
  const jx = A.z.sub(0.5).mul(spread).add(wob);
  const jz = A.w.sub(0.5).mul(spread);
  mat.positionNode = vec3(jx, y, jz);
  mat.scaleNode = u.length.mul(0.012).mul(float(0.5).add(s.mul(1.5)));
  const r = uv().sub(0.5).length().mul(2);
  const disc = float(1).sub(smoothstep(0.0, 1.0, r)).pow(2.0);
  // Knots: shocks travelling outward with the flow.
  const knots = pow(sin(s.mul(26.0).sub(A.x.mul(1.3))).mul(0.5).add(0.5), 6).mul(2.5).add(0.25);
  const col = mix(vec3(ha.x, ha.y, ha.z), vec3(sii.x, sii.y, sii.z), A.z.mul(0.6));
  mat.colorNode = col.mul(u.intensity).mul(disc).mul(knots).mul(float(1).sub(s).pow(1.5)).mul(0.5);
  mat.opacityNode = disc;
  const sprite = new Sprite(mat);
  sprite.count = N;
  sprite.frustumCulled = false;
  sprite.renderOrder = 4;
  return {
    sprite,
    u,
    dispose() {
      mat.dispose();
    },
  };
}

// ── Accretion swarm: planetesimals spiralling into the growing Earth (Earth frame) ─────────────

export function createAccretionSwarm(count: number, lut: DataTexture, t0: number, t1: number) {
  const rand = mulberry32(777);
  const a = new Float32Array(count * 4); // r0 (R_E), φ0, inclination, impact local
  for (let i = 0; i < count; i++) {
    a[i * 4] = 3 + Math.pow(rand(), 0.7) * 40;
    a[i * 4 + 1] = rand() * Math.PI * 2;
    a[i * 4 + 2] = (rand() - 0.5) * 0.5;
    a[i * 4 + 3] = t0 + Math.pow(rand(), 0.8) * (t1 - t0);
  }
  const u = { local: mkF(0), tau: mkF(0), radius: mkF(1), brightness: mkF(1), step: mkF((t1 - t0) * 0.35) };
  const A = instancedBufferAttribute<'vec4'>(new InstancedBufferAttribute(a, 4), 'vec4');
  const tImp = A.w;
  const before = float(1).sub(smoothstep(tImp.sub(u.step), tImp, u.local)); // 1 → 0 as it falls in
  const r = A.x.mul(pow(before, 0.6)).add(u.radius);
  const phi = A.y.add(u.tau.mul(pow(r, -1.5)).mul(6.0)).add(float(1).sub(before).mul(3.0));
  const inc = A.z.mul(before);
  const pos = vec3(cos(phi).mul(r), sin(phi).mul(r).mul(inc), sin(phi).mul(r));
  const mat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  mat.positionNode = pos;
  const alive = smoothstep(tImp.sub(u.step.mul(3)), tImp.sub(u.step.mul(2)), u.local).mul(float(1).sub(smoothstep(tImp, tImp.add(0.002), u.local)));
  const flash = exp(u.local.sub(tImp).abs().div(0.0015).negate()).mul(8.0);
  const heat = float(1).sub(before);
  mat.colorNode = blackbodyNode(lut, float(3.1).add(heat.mul(0.35))).mul(alive.mul(float(0.25).add(heat.mul(heat).mul(2.0))).add(flash)).mul(u.brightness);
  const rr = uv().sub(0.5).length().mul(2);
  mat.opacityNode = float(1).sub(smoothstep(0.0, 1.0, rr)).pow(2);
  mat.scaleNode = float(0.12).add(flash.mul(0.05));
  const sprite = new Sprite(mat);
  sprite.count = count;
  sprite.frustumCulled = false;
  sprite.renderOrder = 5;
  return {
    sprite,
    u,
    dispose() {
      mat.dispose();
    },
  };
}

// ── Moon-forming debris: ejecta → circumplanetary ring → the Moon (Earth frame, R_E units) ─────────

export function createImpactDebris(count: number, lut: DataTexture) {
  const rand = mulberry32(1234);
  const a = new Float32Array(count * 4); // launch spread (2), speed, ring radius
  const b = new Float32Array(count * 4); // ring phase, ring height, condense order, size
  for (let i = 0; i < count; i++) {
    a[i * 4] = gaussian(rand) * 0.6;
    a[i * 4 + 1] = gaussian(rand) * 0.35;
    a[i * 4 + 2] = 0.6 + rand() * 1.4;
    a[i * 4 + 3] = 1.5 + Math.pow(rand(), 1.3) * 2.6;
    b[i * 4] = rand() * Math.PI * 2;
    b[i * 4 + 1] = gaussian(rand) * 0.06;
    b[i * 4 + 2] = rand();
    b[i * 4 + 3] = rand();
  }
  const u = {
    age: mkF(-1), // < 0 before impact; 0..1 ejection → ring
    condense: mkF(0), // 0 ring → 1 all in the Moon
    impactDir: mkV3(1, 0, 0), // world-oriented unit vector from Earth's centre to the impact point
    tangent: mkV3(0, 0, 1), // impactor's direction of travel at contact
    ringNormal: mkV3(0, 1, 0),
    moonPos: mkV3(4, 0, 0), // relative to Earth, R_E
    tau: mkF(0),
    brightness: mkF(1),
  };
  const A = instancedBufferAttribute<'vec4'>(new InstancedBufferAttribute(a, 4), 'vec4');
  const B = instancedBufferAttribute<'vec4'>(new InstancedBufferAttribute(b, 4), 'vec4');
  const age = clamp(u.age, 0, 1);
  // Ejection: a plume from the contact point, thrown forward along the impactor's path.
  const n = u.impactDir;
  const tdir = u.tangent;
  const side = n.cross(tdir).normalize();
  const launch = normalize(n.mul(0.7).add(tdir.mul(1.0)).add(side.mul(A.x)).add(n.cross(side).mul(A.y)));
  const tb = smoothstep(0.0, 0.5, age);
  const plume = n.add(launch.mul(A.z.mul(tb).mul(3.2)));
  // Ring: circular orbits in the plane ⟂ ringNormal; Ω ∝ r^-3/2.
  const e1 = normalize(n.sub(u.ringNormal.mul(dot(n, u.ringNormal))));
  const e2 = u.ringNormal.cross(e1);
  const rr = A.w;
  const ph = B.x.add(u.tau.mul(pow(rr, -1.5)).mul(3.0));
  const ring = e1.mul(cos(ph).mul(rr)).add(e2.mul(sin(ph).mul(rr))).add(u.ringNormal.mul(B.y));
  const toRing = smoothstep(0.25, 1.0, age);
  let pos: V3 = mix(plume, ring, toRing);
  // Accretion into the Moon: clumps join in order.
  const join = smoothstep(B.z.mul(0.7), B.z.mul(0.7).add(0.3), u.condense);
  pos = mix(pos, u.moonPos.add(pos.sub(u.moonPos).mul(0.05)), join);
  const mat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  mat.positionNode = pos;
  const alive = smoothstep(-0.001, 0.02, u.age).mul(float(1).sub(join));
  // Cooling: incandescent vapour and melt (≈3000 K) cooling toward ≈1200 K in the ring.
  const logT = float(3.48).sub(age.mul(0.33)).sub(u.condense.mul(0.1));
  const glow = blackbodyNode(lut, logT).mul(pow(float(10), logT.sub(3.3).mul(4))).mul(float(0.5).add(B.w.mul(0.8)));
  mat.colorNode = glow.mul(alive).mul(u.brightness);
  const r = uv().sub(0.5).length().mul(2);
  mat.opacityNode = float(1).sub(smoothstep(0.0, 1.0, r)).pow(1.6);
  mat.scaleNode = float(0.01).add(B.w.mul(0.016)).mul(float(1.6).sub(age.mul(0.6)));
  const sprite = new Sprite(mat);
  sprite.count = count;
  sprite.frustumCulled = false;
  sprite.renderOrder = 6;
  return {
    sprite,
    u,
    dispose() {
      mat.dispose();
    },
  };
}

