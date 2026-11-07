// TSL for the first stars: infalling gas (colour mapped), Population III stars (blackbody from the LUT), their
// ionised nebulae (real emission-line colours, stratified like real H II regions), supernova shells (Sedov–Taylor
// growth, noise-displaced, oxygen-teal filaments) and the second-generation star clusters.
// Every per-site quantity comes from two uniform arrays filled on the CPU:
//   sitesA[k] = (x, y, z, ν)                         — moved with the Zel'dovich amplitude each frame
//   sitesB[k] = (t_ignite, t_supernova, t_popII, w)  — chapter-local times, w = peak weight 0–1
//   sitesC[k] = (explodes 0/1, random, 0, 0)         — 40–140 M☉ stars collapse to black holes without a blast

import { AdditiveBlending, SpriteNodeMaterial, Vector3, type DataTexture } from 'three/webgpu';
import {
  Fn,
  Loop,
  atan,
  cameraViewMatrix,
  clamp,
  cos,
  exp,
  float,
  floor,
  hash,
  cameraPosition,
  instanceIndex,
  int,
  max,
  mix,
  mx_noise_float,
  pow,
  sin,
  smoothstep,
  sqrt,
  step,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { UniformArrayNode } from 'three/webgpu';
import { blackbodyNode } from '../../render/globals.ts';
import type { FloatUniform } from '../../render/globals.ts';
import { densityColorNode } from '../../shared/color.ts';
import { fbm } from '../../shared/noise.ts';
import { rotY } from '../../shared/math.ts';
import { spriteR } from '../darkAges/structure.ts';

const _mkV3 = () => uniform(new Vector3());
/** vec3 uniform node (directions, line colours). */
export type Vec3Node = ReturnType<typeof _mkV3>;

export interface SiteNodes {
  A: UniformArrayNode<'vec4'>;
  B: UniformArrayNode<'vec4'>;
  C: UniformArrayNode<'vec4'>;
  /** Screen-size clamp distance for small sprites (see StructureWeb.refDist). */
  uRef: FloatUniform;
  uL: FloatUniform;
  uTime: FloatUniform;
  /** Camera basis (world): impostor noise is anchored in world space, so nebulae don't swim as the camera orbits. */
  uRight: Vec3Node;
  uUp: Vec3Node;
  uFwd: Vec3Node;
}

const additive = () => new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });

/** Gas sinking into each halo along a tightening spiral, brightening as it compresses (density colour map). */
export function gasMaterial(s: SiteNodes, perSite: number, u: { uR: FloatUniform; uSize: FloatUniform; uInfall: FloatUniform; uPeak: FloatUniform }) {
  const m = additive();
  const fi = float(instanceIndex);
  const site = floor(fi.div(perSite));
  const k = int(site);
  const A = s.A.element(k);
  const B = s.B.element(k);
  const h1 = hash(fi.mul(4));
  const h2 = hash(fi.mul(4).add(1));
  const h3 = hash(fi.mul(4).add(2));
  const start = B.x.sub(u.uInfall);
  const f = clamp(s.uL.sub(start).div(u.uInfall), 0, 1);
  const cosT = float(1).sub(h1.mul(2));
  const sinT = sqrt(max(float(1).sub(cosT.mul(cosT)), 0));
  const phi = h2.mul(Math.PI * 2);
  const r0 = u.uR.mul(sqrt(h3).mul(0.8).add(0.2)).mul(B.w.mul(0.4).add(0.8));
  const r = r0.mul(pow(float(1).sub(f), 1.7)).add(0.008);
  const flat = float(1).sub(f.mul(0.8));
  const local = vec3(sinT.mul(cos(phi)), cosT.mul(flat), sinT.mul(sin(phi))).mul(r);
  const spin = f.mul(float(1.5).add(float(1).sub(h3).mul(4))).add(s.uTime.mul(0.03)).add(site.mul(1.7));
  const pos = A.xyz.add(rotY(spin).mul(local));
  m.positionNode = pos;
  const fadeIn = smoothstep(start.sub(0.08), start, s.uL);
  const eaten = float(1).sub(smoothstep(B.x.sub(0.01), B.x.add(0.04), s.uL));
  const bright = fadeIn.mul(eaten).mul(f.mul(f).mul(1.4).add(0.18));
  const dCam = pos.sub(cameraPosition).length();
  m.scaleNode = u.uSize.mul(f.mul(0.6).add(1)).mul(clamp(dCam.div(s.uRef), 0.1, 1));
  const rr = spriteR();
  const disc = float(1).sub(smoothstep(0.0, 1.0, rr)).pow(1.8);
  m.colorNode = densityColorNode(f.mul(0.45).add(0.52)).mul(disc).mul(bright).mul(u.uPeak);
  m.opacityNode = float(1);
  return m;
}

/** Population III stars: blackbody colour at the CPU-given log T, ignition flare, supernova flash, then gone. */
export function starMaterial(
  s: SiteNodes,
  lut: DataTexture,
  u: { uLogT: FloatUniform; uSize: FloatUniform; uPeak: FloatUniform; uFlash: FloatUniform; uFlashTau: FloatUniform },
) {
  const m = additive();
  const A = s.A.element(instanceIndex);
  const B = s.B.element(instanceIndex);
  const C = s.C.element(instanceIndex);
  const L = s.uL;
  const ign = smoothstep(B.x, B.x.add(0.018), L);
  // Exploders die in a flash; direct-collapse stars simply wink out over a short time.
  const dead = smoothstep(B.y, B.y.add(mix(0.03, 0.004, C.x)), L);
  const since = max(L.sub(B.x), 0);
  const flare = float(1).add(exp(since.div(0.012).negate()).mul(1.6));
  const sn = L.sub(B.y);
  const flash = step(0, sn).mul(exp(max(sn, 0).div(u.uFlashTau).negate())).mul(C.x);
  const live = ign.mul(float(1).sub(dead)).mul(flare);
  m.positionNode = A.xyz;
  m.scaleNode = u.uSize.mul(B.w.mul(0.5).add(0.75)).mul(flash.mul(1.5).add(1)).mul(step(0.0001, live.add(flash)));
  const r = spriteR();
  const core = exp(r.mul(r).mul(-260));
  const glow = exp(r.mul(r).mul(-22)).mul(0.09);
  const tail = float(0.012).div(r.mul(r).add(0.012)).mul(0.06);
  const edge = float(1).sub(smoothstep(0.7, 1.0, r));
  const bb = blackbodyNode(lut, u.uLogT);
  const intensity = live.mul(u.uPeak).add(flash.mul(u.uFlash));
  m.colorNode = bb.mul(core.add(glow).add(tail).mul(edge)).mul(intensity);
  m.opacityNode = float(1);
  return m;
}

export interface LineColours {
  /** Each colour already scaled by its relative line strength on the CPU. */
  hAlpha: Vec3Node;
  hBeta: Vec3Node;
  heII: Vec3Node;
  oIII: Vec3Node;
  sII: Vec3Node;
}

/**
 * Ionised nebulae as sphere impostors: four depth slices through a sphere of 3D fBm, anchored in world space.
 * Phase 1 (primordial, around Pop III): Hα + Hβ throughout, He II in the hard-UV inner zone.
 * Phase 2 (enriched, around the next generation): [O III] inner, Hα throughout, [S II] at the ionisation front.
 */
export function nebulaMaterial(s: SiteNodes, lines: LineColours, u: { uR: FloatUniform; uPeak: FloatUniform; uGrow: FloatUniform; uNoise: FloatUniform }) {
  const m = additive();
  const A = s.A.element(instanceIndex);
  const B = s.B.element(instanceIndex);
  const L = s.uL;
  const p1 = smoothstep(B.x.add(0.004), B.x.add(0.05), L).mul(float(1).sub(smoothstep(B.y, B.y.add(0.07), L)));
  const g1 = float(1).sub(exp(max(L.sub(B.x), 0).div(u.uGrow).negate()));
  const p2 = smoothstep(B.z, B.z.add(0.09), L);
  const g2 = sqrt(smoothstep(B.z, B.z.add(0.16), L));
  const metal = p2.div(max(p1.add(p2), 0.001));
  const size = B.w.mul(0.45).add(0.75);
  const R = u.uR.mul(size).mul(mix(g1, g2.mul(0.78), metal)).add(0.001);
  const vis = max(p1, p2);
  const seed = hash(float(instanceIndex).mul(13).add(5)).mul(97);
  m.positionNode = A.xyz;
  m.scaleNode = R.mul(2.3).mul(step(0.0001, vis));
  m.colorNode = Fn(() => {
    const p = uv().sub(0.5).mul(2.3);
    const r2 = p.dot(p);
    const h = sqrt(max(float(1).sub(r2), 0));
    const acc = vec3(0).toVar();
    Loop(4, ({ i }) => {
      const z = h.mul(float(i).add(0.5).div(2).sub(1));
      const P = s.uRight.mul(p.x).add(s.uUp.mul(p.y)).add(s.uFwd.mul(z));
      const rho = vec3(p.x, p.y, z).length();
      const n = fbm(P.mul(u.uNoise).add(vec3(seed, seed.mul(0.7), s.uTime.mul(0.012))), 3);
      const fil = pow(smoothstep(-0.3, 0.55, n), 2.2);
      // Ionisation front with a ragged edge (the noise eats into the boundary), brighter toward the front.
      const edge = rho.add(n.mul(0.25));
      const body = float(1).sub(smoothstep(0.72, 0.98, edge));
      const dens = body.mul(smoothstep(0.35, 0.95, edge).mul(0.75).add(0.25)).mul(fil.mul(0.92).add(0.08));
      const inner = float(1).sub(smoothstep(0.12, 0.5, rho)).mul(fil.mul(0.6).add(0.4));
      const core = float(1).sub(smoothstep(0.1, 0.75, rho)).mul(fil.mul(0.5).add(0.5));
      const front = smoothstep(0.6, 0.92, edge).mul(body).mul(fil);
      const primordial = lines.hAlpha.mul(dens).add(lines.hBeta.mul(dens)).add(lines.heII.mul(inner));
      const enriched = lines.oIII
        .mul(core)
        .add(lines.hAlpha.mul(core.mul(0.5).add(dens.mul(0.15))))
        .add(lines.sII.mul(front.mul(0.5)));
      acc.addAssign(mix(primordial, enriched, metal));
    });
    return acc.mul(h.mul(0.5)).mul(vis).mul(u.uPeak);
  })();
  m.opacityNode = float(1);
  return m;
}

/**
 * The collapsing gas cloud in each halo before ignition (density colour map): a soft, swirling cloud whose width
 * shrinks and central brightness rises as it falls in, photo-evaporated once its star switches on.
 */
export function cloudMaterial(s: SiteNodes, u: { uR: FloatUniform; uInfall: FloatUniform; uPeak: FloatUniform }) {
  const m = additive();
  const A = s.A.element(instanceIndex);
  const B = s.B.element(instanceIndex);
  const L = s.uL;
  const start = B.x.sub(u.uInfall);
  const f = clamp(L.sub(start).div(u.uInfall), 0, 1);
  const fadeIn = smoothstep(start.sub(0.08), start.add(0.03), L);
  const gone = float(1).sub(smoothstep(B.x.sub(0.004), B.x.add(0.05), L));
  const vis = fadeIn.mul(gone);
  const seed = hash(float(instanceIndex).mul(11).add(2)).mul(71);
  const sigma = mix(float(0.55), float(0.07), pow(f, 1.2));
  m.positionNode = A.xyz;
  m.scaleNode = u.uR.mul(2.2).mul(B.w.mul(0.4).add(0.8)).mul(step(0.0001, vis));
  m.colorNode = Fn(() => {
    const p = uv().sub(0.5).mul(2.2);
    const r = p.length();
    // Swirl tightens as it collapses (angular momentum → a disc).
    const a = float(1).sub(clamp(r, 0, 1)).mul(f.mul(1.6).add(0.3)).add(s.uTime.mul(0.04));
    const q = vec3(p.x.mul(cos(a)).sub(p.y.mul(sin(a))), p.x.mul(sin(a)).add(p.y.mul(cos(a))), 0);
    const P = s.uRight.mul(q.x).add(s.uUp.mul(q.y));
    const n = fbm(P.mul(3.2).add(seed), 3);
    const prof = exp(r.mul(r).div(sigma.mul(sigma)).mul(-1.6));
    const halo = exp(r.mul(r).mul(-3.5)).mul(0.2);
    const edge = float(1).sub(smoothstep(0.75, 1.05, r));
    const dens = prof.mul(n.mul(0.9).add(0.65)).add(halo.mul(n.mul(0.5).add(0.5))).mul(edge);
    const lift = pow(float(0.55).div(sigma), 0.6);
    return densityColorNode(clamp(f.mul(0.4).add(0.42).add(prof.mul(0.08)), 0, 1)).mul(dens).mul(lift).mul(vis).mul(u.uPeak);
  })();
  m.opacityNode = float(1);
  return m;
}

/**
 * Supernova remnants: limb-brightened thin shells (column through a shell of radius s, thickness w), the radius
 * noise-displaced by direction and growing as the Sedov–Taylor blast wave, R ∝ t^(2/5). A hot white flash first,
 * then [O III]-teal shock filaments (newly made oxygen) with Hα and [S II] in the ridges.
 */
export function shellMaterial(
  s: SiteNodes,
  lut: DataTexture,
  lines: LineColours,
  u: { uRmax: FloatUniform; uDur: FloatUniform; uSedov: FloatUniform; uPeak: FloatUniform; uLogTHot: FloatUniform },
) {
  const m = additive();
  const A = s.A.element(instanceIndex);
  const B = s.B.element(instanceIndex);
  const C = s.C.element(instanceIndex);
  const f = s.uL.sub(B.y).div(u.uDur);
  const active = step(0, f).mul(float(1).sub(step(1, f))).mul(C.x);
  const fc = clamp(f, 0.0001, 1);
  const seed = hash(float(instanceIndex).mul(7).add(3)).mul(53);
  m.positionNode = A.xyz;
  m.scaleNode = u.uRmax.mul(2.5).mul(B.w.mul(0.3).add(0.85)).mul(active);
  m.colorNode = Fn(() => {
    const p = uv().sub(0.5).mul(2.5);
    const r = p.length();
    const sR = pow(fc, u.uSedov).mul(0.95);
    const zf = sqrt(max(sR.mul(sR).sub(r.mul(r)), 0));
    const dir = s.uRight.mul(p.x).add(s.uUp.mul(p.y)).add(s.uFwd.mul(zf)).normalize();
    const nLow = mx_noise_float(dir.mul(2.2).add(seed));
    const se = sR.mul(nLow.mul(0.15).add(1));
    const w = se.mul(0.05).add(0.004);
    const outer = sqrt(max(se.add(w).mul(se.add(w)).sub(r.mul(r)), 0));
    const innerC = sqrt(max(se.mul(se).sub(r.mul(r)), 0));
    const chord = outer.sub(innerC).div(sqrt(se.mul(w)).mul(1.5).add(0.0001));
    // Limb-dominated (face suppressed), broken into bright arcs like the Veil Nebula / Tycho.
    const limbW = pow(clamp(chord, 0, 1.5), 2);
    const patch = smoothstep(-0.12, 0.42, fbm(dir.mul(1.6).add(seed.mul(0.37)), 3));
    const hot = blackbodyNode(lut, u.uLogTHot);
    const cool = lines.oIII.mul(0.9).add(lines.hAlpha.mul(patch.mul(0.35)));
    const age = smoothstep(0.015, 0.22, fc);
    const col = mix(hot.mul(1.4), cool, age);
    const fade = pow(float(1).sub(fc), 1.4);
    const fill = float(1).sub(smoothstep(0, sR.add(0.02), r)).mul(float(1).sub(age)).mul(0.6);
    const limb = limbW.mul(patch.mul(0.85).add(0.15));
    return col.mul(limb.add(fill)).mul(fade).mul(u.uPeak);
  })();
  m.opacityNode = float(1);
  return m;
}

/**
 * Supernova ejecta: knots of freshly made elements thrown outward inside the blast wave, drawn as short streaks
 * aligned with their motion on screen. Colours from the lines the knots shine in: [O III] (oxygen), Hα, [S II].
 */
export function ejectaMaterial(
  s: SiteNodes,
  lines: LineColours,
  perSN: number,
  u: { uRmax: FloatUniform; uDur: FloatUniform; uSedov: FloatUniform; uSize: FloatUniform; uPeak: FloatUniform },
) {
  const m = additive();
  const fi = float(instanceIndex);
  const site = floor(fi.div(perSN));
  const k = int(site);
  const A = s.A.element(k);
  const B = s.B.element(k);
  const C = s.C.element(k);
  const f = s.uL.sub(B.y).div(u.uDur);
  const active = step(0, f).mul(float(1).sub(step(1, f))).mul(C.x);
  const fc = clamp(f, 0.0001, 1);
  const h1 = hash(fi.mul(6));
  const h2 = hash(fi.mul(6).add(1));
  const h3 = hash(fi.mul(6).add(2));
  const h4 = hash(fi.mul(6).add(3));
  const cosT = float(1).sub(h1.mul(2));
  const sinT = sqrt(max(float(1).sub(cosT.mul(cosT)), 0));
  const phi = h2.mul(Math.PI * 2);
  const dir = vec3(sinT.mul(cos(phi)), cosT, sinT.mul(sin(phi)));
  const speed = pow(h3, 0.35).mul(0.35).add(0.62);
  const R = u.uRmax.mul(B.w.mul(0.3).add(0.85)).mul(pow(fc, u.uSedov)).mul(speed).mul(0.93);
  m.positionNode = A.xyz.add(dir.mul(R));
  const vd = cameraViewMatrix.mul(vec4(dir, 0)).xy;
  m.rotationNode = atan(vd.y, vd.x);
  const streak = float(1).add(speed.mul(float(1).sub(fc)).mul(vd.length()).mul(2.2));
  m.scaleNode = vec2(u.uSize.mul(streak), u.uSize.mul(0.5)).mul(active);
  const col = mix(lines.oIII, lines.sII.mul(1.8), step(0.72, h4));
  const r = spriteR();
  const prof = exp(r.mul(r).mul(-7));
  const bright = pow(float(1).sub(fc), 1.2).mul(h3.add(0.5)).mul(smoothstep(0.0, 0.04, fc));
  m.colorNode = col.mul(prof).mul(bright).mul(u.uPeak).mul(float(1).sub(smoothstep(0.8, 1, r)));
  m.opacityNode = float(1);
  return m;
}

/** Second-generation (Pop II) stars: small clumpy clusters around each former Pop III site, blackbody colours. */
export function clusterMaterial(
  s: SiteNodes,
  lut: DataTexture,
  perSite: number,
  u: { uLogTMin: FloatUniform; uLogTMax: FloatUniform; uR: FloatUniform; uSize: FloatUniform; uPeak: FloatUniform },
) {
  const m = additive();
  const fi = float(instanceIndex);
  const site = floor(fi.div(perSite));
  const j = fi.sub(site.mul(perSite));
  const k = int(site);
  const A = s.A.element(k);
  const B = s.B.element(k);
  const h1 = hash(fi.mul(5));
  const h2 = hash(fi.mul(5).add(1));
  const h3 = hash(fi.mul(5).add(2));
  const h4 = hash(fi.mul(5).add(3));
  // Three clumps per site; stars scatter around their clump.
  const c = floor(h4.mul(3));
  const ca = c.mul(2.1).add(site.mul(0.9));
  const clump = vec3(cos(ca), hash(site.mul(3).add(c)).sub(0.5).mul(0.9), sin(ca)).mul(u.uR.mul(0.55));
  const ang = h1.mul(Math.PI * 2);
  const rad = u.uR.mul(0.42).mul(h2.mul(h2).add(0.08));
  const star = vec3(cos(ang).mul(rad), h3.sub(0.5).mul(rad).mul(0.8), sin(ang).mul(rad));
  const spin = s.uTime.mul(0.02).add(site);
  const start = B.z.add(j.mul(0.006));
  const appear = smoothstep(start, start.add(0.03), s.uL);
  m.positionNode = A.xyz.add(rotY(spin).mul(clump.add(star)));
  const logT = mix(u.uLogTMin, u.uLogTMax, h3.mul(h3));
  const bb = blackbodyNode(lut, logT);
  m.scaleNode = u.uSize.mul(h3.mul(0.6).add(0.7)).mul(step(0.0001, appear));
  const r = spriteR();
  const prof = exp(r.mul(r).mul(-90)).add(exp(r.mul(r).mul(-10)).mul(0.07));
  const lum = h3.mul(h3).mul(1.6).add(0.35);
  m.colorNode = bb.mul(prof).mul(lum).mul(appear).mul(u.uPeak).mul(float(1).sub(smoothstep(0.75, 1, r)));
  m.opacityNode = float(1);
  return m;
}

