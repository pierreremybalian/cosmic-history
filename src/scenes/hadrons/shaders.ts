// TSL for confinement & annihilation. Same slots, strands and flow as the qgp scene (../qgp/particles.ts):
//   quarks  — each slot's six quarks wander on their strand, then snap (with overshoot) into a baryon (0–2) and an
//             antibaryon (3–5), or into three mesons (k with k + 3). Mesons decay; baryon–antibaryon pairs drift
//             together and annihilate; excess-matter slots (no antiquarks) keep their baryon: the survivors.
//   strings — one flux tube per quark, from the quark to its hadron's centre (Y-shaped for baryons, a line for mesons).
//   bags    — the soft glow of each hadron (warm = matter, cool = antimatter, gold = survivor) and the flash when
//             a slot's pair annihilates.

import { Color } from 'three/webgpu';
import { abs, cos, exp, float, floor, mix, mod, smoothstep, uniform, vec3 } from 'three/tsl';
import {
  abc,
  boxFade,
  chargeColour,
  currents,
  hashU,
  iid,
  rand,
  rand3,
  ringOffset,
  SLOT,
  slotExtra,
  slotOf,
  slotStrand,
  strandPoint,
  unitVec,
  wrapBox,
  flowDir,
  type ColorU,
  type F,
  type FloatU,
  type SlotStrand,
  type StrandFlow,
  type StreakSpec,
  type U,
  type V3,
  type ViewRig,
} from '../qgp/particles.ts';

export interface HadronUniforms {
  local: FloatU;
  clockM: FloatU;
  clockC: FloatU;
  trailQ: FloatU;
  bright: FloatU;
  thermal: ColorU;
  morph: FloatU;
  curScale: FloatU;
  curSharp: FloatU;
  curVoids: FloatU;
  curFloor: FloatU;
  /** Survivors' gold glow (0–1). */
  survivor: FloatU;
  /** Gold carried over from the qgp asymmetry beat (1 at local 0, fades). */
  goldHint: FloatU;
  /** Neutron share among survivors (abundances.ts). */
  neutron: FloatU;
}

export function createHadronUniforms(): HadronUniforms {
  return {
    local: uniform(0),
    clockM: uniform(0),
    clockC: uniform(0),
    trailQ: uniform(0.03),
    bright: uniform(1),
    thermal: uniform(new Color(0.3, 0.44, 1)),
    morph: uniform(0),
    curScale: uniform(0.35),
    curSharp: uniform(3),
    curVoids: uniform(0.95),
    curFloor: uniform(0.15),
    survivor: uniform(0),
    goldHint: uniform(0),
    neutron: uniform(0.5),
  };
}

export interface HadronShape {
  c: number;
  flowK: number;
  flowSteps: number;
  slotStrandLength: number;
  slotSpacing: number;
  wobble: number;
  extraFrac: number;
  mesonShare: number;
  confineAt: number;
  confineSpread: number;
  confineDur: number;
  baryonRadius: number;
  mesonRadius: number;
  hadronSpin: number;
  mesonDecayStart: number;
  mesonDecayEnd: number;
  annCentre: number;
  annSpread: number;
  /** Local over which a pair drifts together before annihilating. */
  annApproach: number;
  quarkWidth: number;
  quarkIntensity: number;
  stringWidth: number;
  stringIntensity: number;
  bagWidth: number;
  bagIntensity: number;
  survivorWidth: number;
  flashWidth: number;
  flashIntensity: number;
  gold: readonly [number, number, number];
  neutronTint: readonly [number, number, number];
  matterTint: readonly [number, number, number];
  antiTint: readonly [number, number, number];
  colourCharge: readonly (readonly [number, number, number])[];
}

const v3 = (c: readonly [number, number, number]) => vec3(c[0], c[1], c[2]);

export function heat(p: V3, u: HadronUniforms): F {
  return mix(u.curFloor, float(1), currents(p, u.clockM, u.curScale, u.curSharp, u.curVoids));
}

export function flowOf(s: HadronShape, u: HadronUniforms, length: number): StrandFlow {
  return { k: s.flowK, length, steps: s.flowSteps, morph: u.morph };
}

function slotsOf(s: HadronShape, u: HadronUniforms, view: ViewRig): SlotStrand {
  return { box: view.box, flow: flowOf(s, u, s.slotStrandLength), c: s.c, spacing: s.slotSpacing };
}

/** Per-slot schedule: type flags and the local-driven state of confinement, decay and annihilation. */
function schedule(slot: U, s: HadronShape, u: HadronUniforms) {
  const extra = slotExtra(slot, s.extraFrac);
  const meson = float(1).sub(extra).mul(smoothstep(0, 1e-4, float(s.mesonShare).sub(rand(slot, 40))));
  const pairSlot = float(1).sub(extra).sub(meson).max(0);
  const tConf = float(s.confineAt).add(rand(slot, 41).sub(0.5).mul(s.confineSpread));
  const x = u.local.sub(tConf).div(s.confineDur).clamp(0, 4);
  // Snap with overshoot: the quarks overshoot into the bound state and ring down.
  const conf = float(1).sub(exp(x.mul(-3.2)).mul(cos(x.mul(7.5))));
  const bound = smoothstep(0.0, 0.6, x);
  const g = rand(slot, 42).add(rand(slot, 43)).add(rand(slot, 44)).sub(1.5);
  const tAnn = float(s.annCentre).add(g.mul(s.annSpread * 2));
  const approach = smoothstep(tAnn.sub(s.annApproach), tAnn, u.local);
  const annihilated = smoothstep(tAnn, tAnn.add(0.004), u.local).mul(pairSlot);
  const flashAnn = exp(u.local.sub(tAnn).div(0.006).pow(2).negate()).mul(pairSlot);
  return { extra, meson, pairSlot, conf, bound, tAnn, approach, annihilated, flashAnn };
}

function mesonDecayAt(slot: U, k: F, s: HadronShape): F {
  const h = rand(slot, 45).add(k.mul(0.29)).fract();
  return mix(float(s.mesonDecayStart), float(s.mesonDecayEnd), h);
}

/** Arc (in member spacings) of a hadron centre: baryon / antibaryon pair converge before annihilating. */
function hadronArc(isAnti: F, mesonK: F, sch: ReturnType<typeof schedule>): F {
  const gap = mix(float(3.0), float(0.15), sch.approach);
  const baryonic = mix(float(1.2), gap.add(1.2), isAnti);
  return mix(baryonic, mesonK.mul(2.0).add(0.6), sch.meson);
}

/** World position (unwrapped) of quark instance i at clock τ. */
function quarkPos(i: U, tau: F, s: HadronShape, u: HadronUniforms, so: SlotStrand): { p: V3; centre: V3 } {
  const { slot, memberF, anti, charge } = slotOf(i);
  const sch = schedule(slot, s, u);
  const st = slotStrand(slot, tau, so);
  const order = mod(memberF.add(floor(rand(slot, 31).mul(SLOT))).mul(5), SLOT);
  const freeArc = order.add(rand(i, 32).mul(0.6).sub(0.3));
  const hcArc = hadronArc(anti, charge, sch);
  const arc = mix(freeArc, hcArc, sch.conf);
  const centre = strandPoint(st.x0, st.arc0.add(hcArc.mul(st.du)), so.flow);
  const p = strandPoint(st.x0, st.arc0.add(arc.mul(st.du)), so.flow);
  const wob = abc(rand3(i, 20).mul(6.28).add(vec3(tau.mul(1.1), tau.mul(0.9), tau.mul(1.3)))).mul(s.wobble);
  // Bound: baryons as a spinning triangle, mesons as a spinning pair.
  const hid = hashU(slot, anti.add(charge.mul(sch.meson)).add(50));
  const axis = unitVec(rand(hid, 0), rand(hid, 1));
  const phB = charge.mul(Math.PI * 2 / 3).add(rand(hid, 2).mul(6.28));
  const phM = rand(hid, 2).mul(6.28).add(anti.mul(Math.PI));
  const r = mix(float(s.baryonRadius), float(s.mesonRadius), sch.meson);
  const ring = ringOffset(axis, tau, r, float(s.hadronSpin).mul(rand(hid, 3).mul(0.6).add(0.7)), mix(phB, phM, sch.meson));
  const tight = ring.mul(sch.conf);
  return { p: p.add(wob.mul(float(1).sub(sch.bound))).add(tight), centre };
}

function quarkAlive(i: U, s: HadronShape, u: HadronUniforms): F {
  const { slot, anti, charge } = slotOf(i);
  const sch = schedule(slot, s, u);
  const mesonGone = smoothstep(0, 0.004, u.local.sub(mesonDecayAt(slot, charge, s))).mul(sch.meson);
  return float(1).sub(sch.extra.mul(anti)).mul(float(1).sub(sch.annihilated)).mul(float(1).sub(mesonGone));
}

export function quarkLayer(s: HadronShape, u: HadronUniforms, view: ViewRig, gain: number): StreakSpec {
  const i = iid();
  const box = view.box;
  const so = slotsOf(s, u, view);
  const { slot, anti, charge } = slotOf(i);
  const sch = schedule(slot, s, u);
  const st = slotStrand(slot, u.clockM, so);
  const { p: headU } = quarkPos(i, u.clockM, s, u, so);
  const head = wrapBox(headU, view.centre, box);
  const tail = head.sub(flowDir(headU, so.flow).mul(st.speed.mul(u.trailQ)));

  const q = chargeColour(charge, s.colourCharge);
  let col: V3 = mix(q, mix(q, vec3(1), 0.5).mul(0.85), anti);
  col = mix(col, v3(s.gold).mul(2), u.goldHint.mul(sch.extra));
  // Survivors: quarks recede into the gold nucleon glow.
  const dimSurvivor = mix(float(1), float(0.55), u.survivor.mul(sch.extra));
  const alive = quarkAlive(i, s, u);
  const vis = alive.mul(boxFade(head, view.centre, box)).mul(st.fade);
  const intensity = float(s.quarkIntensity * gain).mul(u.bright).mul(vis).mul(dimSurvivor).mul(mix(heat(head, u), float(1), sch.bound.mul(0.6)));
  return { head, tail, width: float(s.quarkWidth), color: col.mul(intensity), tailGlow: 0.05 };
}

export function stringLayer(s: HadronShape, u: HadronUniforms, view: ViewRig, gain: number): StreakSpec {
  const i = iid();
  const box = view.box;
  const so = slotsOf(s, u, view);
  const { slot, anti, charge } = slotOf(i);
  const sch = schedule(slot, s, u);
  const st = slotStrand(slot, u.clockM, so);
  const { p, centre } = quarkPos(i, u.clockM, s, u, so);
  const head = wrapBox(p, view.centre, box);
  const tail = head.sub(p.sub(centre));
  const q = chargeColour(charge, s.colourCharge);
  const tint = mix(q, vec3(1), 0.55);
  const flicker = float(0.75).add(abs(cos(u.clockC.mul(rand(i, 33).mul(5).add(4)).add(rand(i, 34).mul(6.28)))).mul(0.25));
  const vis = quarkAlive(i, s, u).mul(sch.bound).mul(boxFade(head, view.centre, box)).mul(st.fade);
  const gold = mix(float(1), float(0.5), u.survivor.mul(sch.extra));
  void anti;
  const intensity = float(s.stringIntensity * gain).mul(u.bright).mul(vis).mul(flicker).mul(gold);
  return { head, tail, width: float(s.stringWidth), color: tint.mul(intensity), tailGlow: 0.5 };
}

/** Instance = slot·3 + k: hadron glows (k = 0 baryon, 1 antibaryon, or meson k) and the annihilation flash (k = 2). */
export const BAGS_PER_SLOT = 3;

export function bagLayer(s: HadronShape, u: HadronUniforms, view: ViewRig, gain: number): StreakSpec {
  const i = iid();
  const box = view.box;
  const so = slotsOf(s, u, view);
  const slot = i.div(BAGS_PER_SLOT) as U;
  const kU = i.sub(slot.mul(BAGS_PER_SLOT));
  const k = kU.toFloat();
  const sch = schedule(slot, s, u);
  const st = slotStrand(slot, u.clockM, so);
  const isFlash = smoothstep(1.5, 1.6, k).mul(float(1).sub(sch.meson));
  const isAnti = smoothstep(0.5, 0.6, k).mul(float(1).sub(isFlash)).mul(float(1).sub(sch.meson));
  const arcB = hadronArc(isAnti, k, sch);
  const arcMid = hadronArc(float(0), k, sch).add(hadronArc(float(1), k, sch)).mul(0.5);
  const arc = mix(arcB, arcMid, isFlash);
  const headU = strandPoint(st.x0, st.arc0.add(arc.mul(st.du)), so.flow);
  const head = wrapBox(headU, view.centre, box);

  const mesonGone = smoothstep(0, 0.004, u.local.sub(mesonDecayAt(slot, k, s))).mul(sch.meson);
  const mesonFlash = exp(u.local.sub(mesonDecayAt(slot, k, s)).div(0.005).pow(2).negate()).mul(sch.meson);
  const exists = float(1).sub(sch.extra.mul(isAnti)).mul(float(1).sub(sch.annihilated)).mul(float(1).sub(mesonGone));
  const bagK = sch.bound.mul(exists).mul(float(1).sub(isFlash));
  const neutron = smoothstep(0, 1e-4, u.neutron.sub(rand(slot, 46)));
  const survivorCol = mix(v3(s.gold), v3(s.neutronTint), neutron).mul(u.survivor.mul(sch.extra));
  const hadronCol = mix(v3(s.matterTint), v3(s.antiTint), isAnti);
  const col = mix(hadronCol, survivorCol.mul(2.2), u.survivor.mul(sch.extra));
  const glow = float(s.bagIntensity).mul(bagK).mul(float(1).add(u.survivor.mul(sch.extra).mul(1.5)));
  const flash = float(s.flashIntensity).mul(sch.flashAnn.mul(isFlash).add(mesonFlash.mul(0.5)));
  const intensity = float(gain).mul(u.bright).mul(boxFade(head, view.centre, box)).mul(st.fade);
  const colour = col.mul(glow).add(vec3(1, 0.97, 0.92).mul(flash)).mul(intensity);
  const width = mix(mix(float(s.bagWidth), float(s.survivorWidth), u.survivor.mul(sch.extra)), float(s.flashWidth), isFlash);
  return { head, tail: head, width, color: colour, tailGlow: 1 };
}
