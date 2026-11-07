// TSL for neutrino decoupling and e⁺e⁻ annihilation. Same flow, strands and streak sprites as qgp/hadrons:
//   neutrinos — faint lilac streams that start on the plasma's curved streamlines and straighten into free,
//               straight flight as they decouple (the strand unbends into its own tangent): they "peel off".
//   pairs     — electrons (warm) and positrons (cool) jostling in the plasma; a pair exists while its rank is below
//               the thermal pair abundance computed on the CPU (Fermi–Dirac, from the photon temperature).
//   electrons — the excess: one per proton, always there, highlighted once the pairs are gone.
//   nucleons  — the hadrons scene's survivors: gold protons and cool neutral neutrons (share from abundances.ts);
//               protons warm toward the bbn scene's proton colour by the end so the zoom hands over cleanly.

import { Color, Vector3 } from 'three/webgpu';
import { abs, float, fract, mix, sin, smoothstep, uniform, vec3 } from 'three/tsl';
import {
  abc,
  below,
  boxFade,
  currents,
  flowDir,
  iid,
  rand,
  rand3,
  strandPoint,
  wrapBox,
  chargeColour,
  ringOffset,
  unitVec,
  type Vec3U,
  type ColorU,
  type F,
  type FloatU,
  type StrandFlow,
  type StreakSpec,
  type U,
  type V3,
  type ViewRig,
} from '../qgp/particles.ts';

export interface LeptonUniforms {
  local: FloatU;
  clockM: FloatU;
  clockC: FloatU;
  trailQ: FloatU;
  trailC: FloatU;
  thermal: ColorU;
  morph: FloatU;
  curScale: FloatU;
  curSharp: FloatU;
  curVoids: FloatU;
  curFloor: FloatU;
  /** Neutrino decoupling progress (0 coupled → 1 free streaming). */
  decouple: FloatU;
  /** Thermal e± pair abundance relative to relativistic (CPU, Fermi–Dirac). */
  pairs: FloatU;
  /** Highlight of the surviving excess electrons (0–1). */
  excess: FloatU;
  /** Neutron share among nucleons (abundances.ts). */
  neutron: FloatU;
  /** Neutron share at the start of the chapter (to know which neutrons decayed). */
  neutron0: FloatU;
  /** Photon brightness: comoving photon energy density ∝ (T·a)⁴, normalised to its pre-annihilation value. */
  photon: FloatU;
  /** Hero nucleon (instance 0): world position, visibility, neutron rank (sets when it decays), decay progress. */
  heroPos: Vec3U;
  heroVis: FloatU;
  heroRank: FloatU;
  decay: FloatU;
  /** 0 → 1 over the chapter's end: proton colour moves toward the bbn scene's. */
  handoff: FloatU;
}

export function createLeptonUniforms(): LeptonUniforms {
  return {
    local: uniform(0),
    clockM: uniform(0),
    clockC: uniform(0),
    trailQ: uniform(0.02),
    trailC: uniform(0.3),
    thermal: uniform(new Color(0.3, 0.44, 1)),
    morph: uniform(0),
    curScale: uniform(0.35),
    curSharp: uniform(3),
    curVoids: uniform(0.95),
    curFloor: uniform(0.2),
    decouple: uniform(0),
    pairs: uniform(1),
    excess: uniform(0),
    neutron: uniform(0.18),
    neutron0: uniform(0.18),
    photon: uniform(1),
    heroPos: uniform(new Vector3()),
    heroVis: uniform(0),
    heroRank: uniform(0),
    decay: uniform(0),
    handoff: uniform(0),
  };
}

export interface LeptonShape {
  c: number;
  flowK: number;
  flowSteps: number;
  neutrinoBeads: number;
  neutrinoLength: number;
  neutrinoWidth: number;
  neutrinoIntensity: number;
  neutrinoTint: readonly [number, number, number];
  /** Neutrino stream speed relative to the photon silk (they are not slowed by scattering). */
  neutrinoSpeed: number;
  pairWidth: number;
  pairIntensity: number;
  pairJitter: number;
  electronTint: readonly [number, number, number];
  positronTint: readonly [number, number, number];
  excessWidth: number;
  excessIntensity: number;
  nucleonWidth: number;
  nucleonIntensity: number;
  nucleonCore: number;
  gold: readonly [number, number, number];
  neutronTint: readonly [number, number, number];
  protonHandoff: readonly [number, number, number];
  nucleonQuarkRadius: number;
  nucleonQuarkWidth: number;
  nucleonQuarkIntensity: number;
  decayFlight: number;
  colourCharge: readonly (readonly [number, number, number])[];
}

const v3 = (c: readonly [number, number, number]) => vec3(c[0], c[1], c[2]);

export function heat(p: V3, u: LeptonUniforms): F {
  return mix(u.curFloor, float(1), currents(p, u.clockM, u.curScale, u.curSharp, u.curVoids));
}

export function flowOf(s: LeptonShape, u: LeptonUniforms, length: number): StrandFlow {
  return { k: s.flowK, length, steps: s.flowSteps, morph: u.morph };
}

/** Coupled: a bead on a curved streamline. Free: the same strand straightened along its starting tangent. */
function neutrinoPoint(x0: V3, arc: F, f: StrandFlow, d: F): V3 {
  const curved = strandPoint(x0, arc, f);
  const straight = x0.add(flowDir(x0, f).mul(arc.mul(f.length)));
  return mix(curved, straight, d);
}

export function neutrinoLayer(s: LeptonShape, u: LeptonUniforms, view: ViewRig, gain: number): StreakSpec {
  const i = iid();
  const box = view.box;
  const strand = i.div(s.neutrinoBeads) as U;
  const x0 = rand3(strand, 0).mul(box);
  const f = flowOf(s, u, s.neutrinoLength);
  // Each stream decouples at its own moment around the chapter's decoupling time.
  const d = smoothstep(0, 1, u.decouple.mul(1.6).sub(rand(strand, 11).mul(0.6)).clamp(0, 1));
  const v = mix(float(1), float(s.neutrinoSpeed), d);
  const speed = rand(strand, 6).mul(0.3).add(0.85).mul(s.c / s.neutrinoLength).mul(v);
  const arc = fract(rand(i, 7).add(u.clockC.mul(speed)));
  const headU = neutrinoPoint(x0, arc, f, d);
  const tailU = neutrinoPoint(x0, arc.sub(u.trailC.mul(speed).mul(0.8)).max(0), f, d);
  const head = wrapBox(headU, view.centre, box);
  const tail = head.sub(headU.sub(tailU));
  const ends = sin(arc.mul(Math.PI)).sqrt();
  const vis = boxFade(head, view.centre, box).mul(ends).mul(rand(i, 8).mul(0.6).add(0.4));
  const intensity = float(s.neutrinoIntensity * gain).mul(vis);
  return { head, tail, width: float(s.neutrinoWidth), color: v3(s.neutrinoTint).mul(intensity), tailGlow: 0.05 };
}

export function pairLayer(s: LeptonShape, u: LeptonUniforms, view: ViewRig, gain: number): StreakSpec {
  const i = iid();
  const box = view.box;
  const pair = i.shiftRight(1) as U;
  const positron = i.bitAnd(1).toFloat();
  const base = rand3(i, 0).mul(box);
  // Scattering in the plasma: swirl with the flow plus a fast jostle.
  const pos = (t: F): V3 => {
    const ph = t.mul(0.35);
    const swirl = abc(base.mul(s.flowK).add(vec3(ph, ph.mul(0.8), ph.mul(-0.6)))).mul(0.45);
    const jost = abc(rand3(i, 3).mul(6.28).add(vec3(t.mul(4.1), t.mul(3.7), t.mul(4.6)))).mul(s.pairJitter);
    return base.add(swirl).add(jost);
  };
  const headU = pos(u.clockM);
  const tailU = pos(u.clockM.sub(u.trailQ));
  const head = wrapBox(headU, view.centre, box);
  const tail = head.sub(headU.sub(tailU));
  const alive = below(rand(pair, 5), u.pairs, 0.02);
  const col = mix(v3(s.electronTint), v3(s.positronTint), positron);
  const twinkle = sin(u.clockC.mul(rand(i, 9).mul(2).add(2)).add(rand(i, 10).mul(6.28))).mul(0.25).add(0.75);
  const vis = alive.mul(boxFade(head, view.centre, box)).mul(twinkle).mul(float(1).sub(u.excess.mul(0.3)));
  const intensity = float(s.pairIntensity * gain).mul(vis).mul(heat(head, u));
  return { head, tail, width: float(s.pairWidth), color: col.mul(intensity), tailGlow: 0.3 };
}

export function excessLayer(s: LeptonShape, u: LeptonUniforms, view: ViewRig, gain: number): StreakSpec {
  const i = iid();
  const box = view.box;
  const base = rand3(i, 40).mul(box);
  const pos = (t: F): V3 => {
    const ph = t.mul(0.35);
    const swirl = abc(base.mul(s.flowK).add(vec3(ph, ph.mul(0.8), ph.mul(-0.6)))).mul(0.45);
    const jost = abc(rand3(i, 43).mul(6.28).add(vec3(t.mul(4.1), t.mul(3.7), t.mul(4.6)))).mul(s.pairJitter * 1.3);
    return base.add(swirl).add(jost);
  };
  const headU = pos(u.clockM);
  const tailU = pos(u.clockM.sub(u.trailQ.mul(2)));
  const head = wrapBox(headU, view.centre, box);
  const tail = head.sub(headU.sub(tailU));
  const lift = mix(float(1), float(2.6), u.excess);
  const vis = boxFade(head, view.centre, box);
  const intensity = float(s.excessIntensity * gain).mul(vis).mul(lift);
  const width = float(s.excessWidth).mul(mix(float(1), float(1.4), u.excess));
  return { head, tail, width, color: v3(s.electronTint).mul(intensity), tailGlow: 0.2 };
}

/**
 * Seven sprites per nucleon: soft glow, hot core, three quarks (colour charge, as in the hadrons scene) and, for
 * the hero only, the electron and antineutrino of its β decay.
 */
export const NUCLEON_PARTS = 7;

export function nucleonLayer(s: LeptonShape, u: LeptonUniforms, view: ViewRig, gain: number): StreakSpec {
  const i = iid();
  const box = view.box;
  const n = i.div(NUCLEON_PARTS) as U;
  const part = i.sub(n.mul(NUCLEON_PARTS)).toFloat();
  const hero = float(1).sub(smoothstep(0.25, 0.5, n.toFloat()));
  const base = rand3(n, 50).mul(box);
  const ph = u.clockM.mul(0.2);
  const roam = base.add(abc(base.mul(s.flowK * 0.7).add(vec3(ph, ph.mul(0.7), ph.mul(-0.5)))).mul(0.35));
  const centreU = mix(roam, u.heroPos, hero);
  const rank = mix(rand(n, 51), u.heroRank, hero);
  // Which nucleons are neutrons now; those above the current share but below the starting share have decayed.
  const isNeutron = smoothstep(0, 1e-4, u.neutron.sub(rank));
  const decayed = smoothstep(0, 1e-4, u.neutron0.sub(rank)).mul(float(1).sub(isNeutron));
  // Protons hand over from the survivors' gold to the warm proton colour of the nucleosynthesis scene.
  const col = mix(mix(v3(s.gold), v3(s.protonHandoff), u.handoff), v3(s.neutronTint), isNeutron);
  const pulse = sin(u.clockC.mul(0.7).add(rank.mul(40))).mul(0.08).add(1);

  const isGlow = float(1).sub(smoothstep(0.5, 0.6, part));
  const isCore = smoothstep(0.5, 0.6, part).mul(float(1).sub(smoothstep(1.5, 1.6, part)));
  const isQuark = smoothstep(1.5, 1.6, part).mul(float(1).sub(smoothstep(4.5, 4.6, part)));
  const isLepton = smoothstep(4.5, 4.6, part);
  const k = part.sub(2).clamp(0, 2);
  // Quarks: a slow spinning triangle inside the glow.
  const axis = unitVec(rand(n, 52), rand(n, 53));
  const ring = ringOffset(axis, u.clockC.mul(0.25), s.nucleonQuarkRadius, 1, k.mul(Math.PI * 2 / 3));
  // β decay of the hero: the electron (warm) and antineutrino (lilac) fly apart over the decay window.
  const isNu = smoothstep(5.5, 5.6, part);
  const dir = mix(unitVec(float(0.62), float(0.12)), unitVec(float(0.35), float(0.64)), isNu);
  const flight = u.decay.mul(s.decayFlight);
  const leptonPos = dir.mul(flight);
  const offset = ring.mul(isQuark).add(leptonPos.mul(isLepton));
  const headU = centreU.add(offset);
  const head = wrapBox(headU, view.centre, box);
  const tail = head.sub(dir.mul(isLepton).mul(flight.min(0.12)));

  const qCol = chargeColour(k, s.colourCharge);
  const leptonCol = mix(v3(s.electronTint), v3(s.neutrinoTint), isNu).mul(3);
  const leptonVis = isLepton.mul(hero).mul(smoothstep(0, 0.05, u.decay)).mul(float(1).sub(smoothstep(0.7, 1, u.decay)));
  const colour = col
    .mul(isGlow.add(isCore.mul(s.nucleonCore)))
    .add(qCol.mul(isQuark.mul(s.nucleonQuarkIntensity)))
    .add(leptonCol.mul(leptonVis));
  const width = float(s.nucleonWidth)
    .mul(isGlow)
    .add(float(s.nucleonWidth * 0.22).mul(isCore))
    .add(float(s.nucleonQuarkWidth).mul(isQuark))
    .add(float(0.008).mul(isLepton));
  const sparkle = decayed.mul(float(1).sub(hero)).mul(abs(sin(u.clockC.mul(3).add(rank.mul(17)))).pow(8)).mul(0.6);
  const vis = mix(float(1), u.heroVis, hero).mul(boxFade(head, view.centre, box));
  const intensity = float(s.nucleonIntensity * gain).mul(vis).mul(pulse).mul(float(1).add(sparkle));
  return { head, tail, width, color: colour.mul(intensity), tailGlow: 0.2 };
}
