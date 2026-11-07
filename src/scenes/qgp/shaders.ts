// TSL for the quark–gluon plasma. Everything rides streamlines of one slowly morphing flow (the plasma is a
// near-perfect liquid), so the soup reads as coherent currents rather than confetti. Three streak layers:
//   bath    — photons, leptons and the rest of the thermal soup: fine blackbody-coloured beads flowing along
//             strands. Photons stay massless after the Higgs moment; everything else slows to dotted beads.
//   quarks  — slots of six riding their own strand like a string of pearls (r/g/b quarks + paler antiquarks).
//             At the asymmetry beat each quark pairs with its antiquark; excess-matter slots have no antiquarks
//             and turn gold.
//   gluons  — sparks that run along a slot's strand from one quark to another: the strong force exchanged.

import { Color } from 'three/webgpu';
import { float, floor, fract, hash, mix, mod, sin, smoothstep, texture3D, uniform, vec3 } from 'three/tsl';
import type { Data3DTexture } from 'three/webgpu';
import {
  abc,
  below,
  boxFade,
  chargeColour,
  currents,
  flowDir,
  iid,
  rand,
  rand3,
  randC,
  ringOffset,
  SLOT,
  slotExtra,
  slotAt,
  slotOf,
  slotStrand,
  strandPoint,
  unitVec,
  wrapBox,
  createHeroes,
  heroMatch,
  lightPackets,
  type Hero,
  type ColorU,
  type F,
  type FloatU,
  type SlotStrand,
  type StrandFlow,
  type U,
  type V3,
  type ViewRig,
} from './particles.ts';

export interface QgpUniforms {
  clockM: FloatU;
  clockC: FloatU;
  trailM: FloatU;
  trailC: FloatU;
  /** Quark trail window (clock units). */
  trailQ: FloatU;
  reveal: FloatU;
  ripple: FloatU;
  higgs: FloatU;
  split: FloatU;
  flash: FloatU;
  pair: FloatU;
  gold: FloatU;
  bright: FloatU;
  thermal: ColorU;
  /** Slow morph of the flow field (clock units). */
  morph: FloatU;
  /** Hot-current structure (particles.ts currents): spatial scale, sharpness, void strength, floor. */
  curScale: FloatU;
  curSharp: FloatU;
  curVoids: FloatU;
  curFloor: FloatU;
  /** Foreground slots: 0 = an ordinary slot that follows the camera, 1 = an excess-matter (gold) slot. */
  heroes: Hero[];
}

export function createQgpUniforms(): QgpUniforms {
  return {
    clockM: uniform(0),
    clockC: uniform(0),
    trailM: uniform(0.2),
    trailC: uniform(0.2),
    trailQ: uniform(0.06),
    reveal: uniform(1),
    ripple: uniform(0),
    higgs: uniform(0),
    split: uniform(0),
    flash: uniform(0),
    pair: uniform(0),
    gold: uniform(0),
    bright: uniform(1),
    thermal: uniform(new Color(0.3, 0.44, 1)),
    morph: uniform(0),
    curScale: uniform(0.35),
    curSharp: uniform(3),
    curVoids: uniform(0.95),
    curFloor: uniform(0.15),
    heroes: createHeroes(2),
  };
}

export interface QgpShape {
  /** Visual speed of light along the flow (world units per clock second). */
  c: number;
  flowK: number;
  flowSteps: number;
  bathStrandLength: number;
  bathBeads: number;
  bathWidth: number;
  bathIntensity: number;
  photonShare: number;
  slotStrandLength: number;
  slotSpacing: number;
  wobble: number;
  pairRadius: number;
  pairSpin: number;
  extraFrac: number;
  quarkWidth: number;
  quarkIntensity: number;
  gluonWidth: number;
  gluonIntensity: number;
  gluonPeriod: number;
  /** Spark length as a fraction of the quark-to-quark run. */
  gluonLag: number;
  gold: readonly [number, number, number];
  colourCharge: readonly (readonly [number, number, number])[];
  rippleScale: number;
  /** Gluon instances reserved for the hero slots. */
  heroGluons: number;
  glitterWidth: number;
  glitterIntensity: number;
  /** Amplitude of the glitter's swirl (world units). */
  glitterDrift: number;
}

/** 1 inside a hero slot. */
function isHero(slot: U, u: QgpUniforms): F {
  return u.heroes.reduce<F>((acc, h) => acc.add(heroMatch(slot, h)), float(0)).clamp(0, 1);
}

/** Brightness from the plasma's hot currents at world position p. */
export function heat(p: V3, u: QgpUniforms): F {
  return mix(u.curFloor, float(1), currents(p, u.clockM, u.curScale, u.curSharp, u.curVoids));
}

function flowOf(s: QgpShape, u: QgpUniforms, length: number): StrandFlow {
  return { k: s.flowK, length, steps: s.flowSteps, morph: u.morph };
}

function slotsOf(s: QgpShape, u: QgpUniforms, view: ViewRig): SlotStrand {
  return { box: view.box, flow: flowOf(s, u, s.slotStrandLength), c: s.c, spacing: s.slotSpacing, heroes: u.heroes };
}

function ripple(base: V3, box: F, u: QgpUniforms, density: Data3DTexture, scale: number): F {
  const delta = texture3D(density, base.div(box)).b;
  return float(1).add(u.ripple.mul(delta).mul(scale)).max(0);
}

/** Arc position (in member spacings) of quark instance i: members string out, then pair k with k + 3. */
function memberArc(i: U, u: QgpUniforms): { arcM: F; ease: F } {
  const { slot, memberF, charge } = slotOf(i);
  const ease = smoothstep(0, 1, u.pair.sub(rand(slot, 30).mul(0.35)).div(0.65).clamp(0, 1));
  // Free order along the strand: a per-slot rotation of the six (so colours do not repeat like a pattern),
  // plus uneven spacing.
  const order = mod(memberF.add(floor(rand(slot, 31).mul(SLOT))).mul(5), SLOT);
  const loose = order.add(rand(i, 32).mul(0.6).sub(0.3));
  return { arcM: mix(loose, charge.mul(2.2).add(0.5), ease), ease };
}

/** World position (unwrapped) of quark instance i at clock τ. */
function quarkPos(i: U, tau: F, s: QgpShape, u: QgpUniforms, so: SlotStrand): V3 {
  const { slot, anti, charge } = slotOf(i);
  const extra = slotExtra(slot, s.extraFrac);
  const st = slotStrand(slot, tau, so);
  const { arcM, ease } = memberArc(i, u);
  const p = slotAt(st, arcM);
  const wob = abc(rand3(i, 20).mul(6.28).add(vec3(tau.mul(1.1), tau.mul(0.9), tau.mul(1.3)))).mul(float(s.wobble).mul(float(1).add(isHero(slot, u).mul(2.5))));
  const kid = slot.mul(64).add(charge.toUint().add(40)) as U;
  const axis = unitVec(hash(kid), hash(kid.add(3)));
  const phase = hash(kid.add(6)).mul(Math.PI * 2).add(anti.mul(Math.PI));
  const twin = ringOffset(axis, tau, s.pairRadius, s.pairSpin, phase).mul(ease).mul(float(1).sub(extra));
  return p.add(wob.mul(float(1).sub(ease.mul(0.8)))).add(twin);
}

export function quarkLayer(s: QgpShape, u: QgpUniforms, view: ViewRig, density: Data3DTexture, gain: number) {
  const i = iid();
  const box = view.box;
  const so = slotsOf(s, u, view);
  const { slot, anti, charge } = slotOf(i);
  const extra = slotExtra(slot, s.extraFrac);
  const st = slotStrand(slot, u.clockM, so);

  const headU = quarkPos(i, u.clockM, s, u, so);
  const head = wrapBox(headU, view.centre, box);
  // Motion trail: tangent to the flow over one trail window (cheap and continuous through the strand wrap).
  const tail = head.sub(st.tan.mul(st.speed.mul(u.trailQ)));

  const quarkCol = chargeColour(charge, s.colourCharge);
  const antiCol = mix(quarkCol, vec3(1), 0.5).mul(0.85);
  let col: V3 = mix(quarkCol, antiCol, anti);
  // Asymmetry: the annihilation-bound pairs fade toward neutral; the excess quarks turn gold.
  const neutral = vec3(col.x.add(col.y).add(col.z).div(3)).mul(vec3(0.85, 0.95, 1.15));
  col = mix(col, neutral, u.gold.mul(0.6).mul(float(1).sub(extra)));
  col = mix(col, vec3(s.gold[0], s.gold[1], s.gold[2]).mul(2.2), u.gold.mul(extra));
  const dim = mix(float(1), float(0.45), u.gold.mul(float(1).sub(extra)));
  const goldGlow = float(1).add(u.gold.mul(extra).mul(1.4));

  const vis = below(rand(slot, 16), u.reveal).mul(float(1).sub(extra.mul(anti))).mul(boxFade(head, view.centre, box)).mul(st.fade);
  const flash = float(1).add(u.flash.mul(1.4));
  const heatK = mix(heat(head, u), float(1), u.gold.mul(extra).max(isHero(slot, u)));
  const intensity = float(s.quarkIntensity * gain)
    .mul(u.bright)
    .mul(ripple(st.x0, box, u, density, s.rippleScale))
    .mul(vis)
    .mul(dim)
    .mul(flash)
    .mul(goldGlow)
    .mul(heatK);
  const width = float(s.quarkWidth)
    .mul(float(1).add(u.gold.mul(extra).mul(0.8)))
    .mul(float(1).add(u.higgs.mul(0.2)))
    .mul(float(1).add(isHero(slot, u).mul(0.5)));
  return { head, tail, width, color: col.mul(intensity), tailGlow: 0.05 };
}

export function gluonLayer(s: QgpShape, u: QgpUniforms, view: ViewRig, gain: number, slots: number) {
  const j = iid();
  const box = view.box;
  const so = slotsOf(s, u, view);
  const period = float(s.gluonPeriod).mul(rand(j, 0).mul(0.8).add(0.6));
  const x = u.clockC.div(period).add(rand(j, 1).mul(17));
  const cyc = floor(x);
  const ph = fract(x);
  // The first gluons always spark inside the hero slots, so the foreground cluster is visibly bound by them.
  const jf = j.toFloat();
  const heroPick = float(1).sub(smoothstep(s.heroGluons - 0.5, s.heroGluons, jf));
  const heroId = mix(u.heroes[0]!.id, u.heroes[1]!.id, mod(jf, 2));
  const slot = floor(mix(randC(j, 2, cyc).mul(slots), heroId.add(0.5), heroPick)).toUint() as U;
  const a = floor(randC(j, 3, cyc).mul(SLOT));
  const b = mod(a.add(1).add(floor(randC(j, 4, cyc).mul(SLOT - 1))), SLOT);
  const ia = slot.mul(SLOT).add(a.toUint()) as U;
  const ib = slot.mul(SLOT).add(b.toUint()) as U;
  const st = slotStrand(slot, u.clockM, so);
  const arcA = memberArc(ia, u).arcM;
  const arcB = memberArc(ib, u).arcM;
  // A spark that runs along the strand from quark a to quark b.
  const run = ph.mul(1.0 + s.gluonLag);
  const arcH = mix(arcA, arcB, smoothstep(0, 1, run.clamp(0, 1)));
  const arcT = mix(arcA, arcB, smoothstep(0, 1, run.sub(s.gluonLag).clamp(0, 1)));
  const headU = slotAt(st, arcH);
  const tailU = slotAt(st, arcT);
  const head = wrapBox(headU, view.centre, box);
  const tail = head.sub(headU.sub(tailU));

  const extra = slotExtra(slot, s.extraFrac);
  const usesAnti = smoothstep(2.4, 2.6, a).max(smoothstep(2.4, 2.6, b));
  const exists = float(1).sub(extra.mul(usesAnti));
  const life = sin(ph.mul(Math.PI)).pow(1.2);
  const ka = a.sub(smoothstep(2.4, 2.6, a).mul(3));
  const kb = b.sub(smoothstep(2.4, 2.6, b).mul(3));
  const hue = mix(chargeColour(ka, s.colourCharge), chargeColour(kb, s.colourCharge), 0.5);
  const col = mix(vec3(1, 0.95, 0.88), hue, 0.3);
  const vis = below(rand(slot, 16), u.reveal).mul(boxFade(head, view.centre, box)).mul(exists).mul(st.fade);
  const dim = mix(float(1), float(0.3), u.gold);
  const intensity = float(s.gluonIntensity * gain)
    .mul(u.bright)
    .mul(life)
    .mul(vis)
    .mul(dim)
    .mul(float(1).add(u.flash))
    .mul(mix(heat(head, u), float(1), heroPick));
  return { head, tail, width: float(s.gluonWidth), color: col.mul(intensity), tailGlow: 0.1 };
}

export function bathLayer(s: QgpShape, u: QgpUniforms, view: ViewRig, density: Data3DTexture, gain: number) {
  const i = iid();
  const box = view.box;
  const strand = i.div(s.bathBeads) as U;
  const x0 = rand3(strand, 0).mul(box);
  const photon = smoothstep(0, 1e-4, float(s.photonShare).sub(rand(strand, 5)));
  const tau = mix(u.clockM, u.clockC, photon);
  const trail = mix(u.trailM, u.trailC, photon);
  const f = flowOf(s, u, s.bathStrandLength);
  const speed = rand(strand, 6).mul(0.4).add(0.8).mul(s.c / s.bathStrandLength);
  const arc = fract(rand(i, 7).add(tau.mul(speed)));
  const headU = strandPoint(x0, arc, f);
  // Tail on the strand itself (a chord of the curve), clamped at the strand start: smooth curves, no combs.
  const tailU = strandPoint(x0, arc.sub(trail.mul(speed)).max(0), f);
  const head = wrapBox(headU, view.centre, box);
  const tail = head.sub(headU.sub(tailU));

  const vis = below(rand(strand, 9), u.reveal).mul(boxFade(head, view.centre, box));
  const ends = sin(arc.mul(Math.PI)).sqrt();
  // After the split photons stand out as the fast, bright streams (with gluons).
  const lift = mix(float(1), float(2.2), u.split.mul(photon));
  const tone = lightPackets(rand(i, 7), strand, rand(i, 8));
  const flash = float(1).add(u.flash.mul(2.0));
  const intensity = float(s.bathIntensity * gain)
    .mul(u.bright)
    .mul(ripple(x0, box, u, density, s.rippleScale))
    .mul(vis)
    .mul(ends)
    .mul(tone)
    .mul(lift)
    .mul(flash)
    .mul(heat(head, u));
  const col = mix(u.thermal, vec3(1), 0.35);
  return { head, tail, width: float(s.bathWidth), color: col.mul(intensity), tailGlow: 0.1 };
}

/** Fine thermal glitter (leptons and the rest of the soup): many tiny specks drifting with the flow; slow after Higgs. */
export function glitterLayer(s: QgpShape, u: QgpUniforms, view: ViewRig, gain: number) {
  const i = iid();
  const box = view.box;
  const base = rand3(i, 0).mul(box);
  const f = flowOf(s, u, 1);
  const pos = (t: F): V3 => {
    const ph = t.mul(0.35);
    return base.add(abc(base.mul(s.flowK).add(vec3(ph, ph.mul(0.8), ph.mul(-0.6)))).mul(s.glitterDrift));
  };
  const headU = pos(u.clockM);
  const head = wrapBox(headU, view.centre, box);
  const tail = head.sub(flowDir(headU, f).mul(u.trailQ.mul(s.c)));
  const vis = below(rand(i, 6), u.reveal).mul(boxFade(head, view.centre, box));
  const twinkle = sin(u.clockC.mul(rand(i, 9).mul(3).add(1)).add(rand(i, 10).mul(6.28))).mul(0.35).add(0.65);
  const intensity = float(s.glitterIntensity * gain)
    .mul(u.bright)
    .mul(vis)
    .mul(twinkle)
    .mul(rand(i, 8).mul(0.8).add(0.2))
    .mul(float(1).add(u.flash.mul(2.0)))
    .mul(heat(head, u));
  const col = mix(u.thermal, vec3(1), 0.5);
  return { head, tail, width: float(s.glitterWidth), color: col.mul(intensity), tailGlow: 0.3 };
}
