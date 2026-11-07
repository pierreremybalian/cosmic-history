// Force strands for the planck scene: many thin light filaments that flow like field lines. They fan in from
// the foam on both sides, converge into one braid through the unified field (pinch at its centre) and fan
// out again. At the beats they unzip: gravity first (drifting away and dimming to a dark violet), then the
// strong force (colour-charge flicker), leaving the electroweak braid that qgp later splits at the Higgs.

import { AdditiveBlending, Color, InstancedMesh, LineCurve3, MeshBasicNodeMaterial, TubeGeometry, Vector3 } from 'three/webgpu';
import {
  abs,
  cameraPosition,
  clamp,
  cos,
  cross,
  dot,
  float,
  floor,
  fract,
  instanceIndex,
  mix,
  normalize,
  positionGeometry,
  positionWorld,
  sin,
  smoothstep,
  uniform,
  varying,
  vec3,
} from 'three/tsl';
import type { Node } from 'three/webgpu';

export const STRANDS = {
  perGroup: 10,
  groups: 3, // 0 gravity, 1 strong, 2 electroweak
  tubularSegments: 200,
  radialSegments: 5,
} as const;

const _mkF = () => uniform(0);
const _mkV3 = () => uniform(new Vector3());
const _mkC = () => uniform(new Color());
type F = ReturnType<typeof _mkF>;
type V3 = ReturnType<typeof _mkV3>;
type C = ReturnType<typeof _mkC>;

export interface StrandUniforms {
  centre: V3;
  /** Braid axis (unit) and two unit vectors perpendicular to it. */
  axis: V3;
  axisN: V3;
  axisB: V3;
  /** Half-length of the braid (world) and its S-shaped bend (world, along axisN / axisB). */
  halfLength: F;
  bendN: F;
  bendB: F;
  /** Radius of the braid at its pinch (field centre) and at the fanned-out ends (world). */
  braidRadius: F;
  fanRadius: F;
  /** Curl-like meander of each filament (world). */
  wobble: F;
  twist: F;
  /** Integrated flow phase. */
  phase: F;
  tubeRadius: F;
  intensity: F;
  /** 0 → 1: how far the strands have grown out from the middle. */
  reveal: F;
  gravitySplit: F;
  strongSplit: F;
  /** Peeled strands move away along these directions (world units at full split). */
  gravityDir: V3;
  strongDir: V3;
  gravitySep: F;
  strongSep: F;
  /** Strands behind the field's centre plane are dimmed by this factor (depth cue). */
  backDim: F;
  flickerPhase: F;
  unified: C;
  gravity: C;
  electroweak: C;
  colourR: C;
  colourG: C;
  colourB: C;
}

export interface ForceStrands {
  mesh: InstancedMesh;
  uniforms: StrandUniforms;
  dispose(): void;
}

export function createForceStrands(): ForceStrands {
  const u: StrandUniforms = {
    centre: uniform(new Vector3()),
    axis: uniform(new Vector3(1, 0, 0)),
    axisN: uniform(new Vector3(0, 1, 0)),
    axisB: uniform(new Vector3(0, 0, 1)),
    halfLength: uniform(2.4),
    bendN: uniform(0.3),
    bendB: uniform(0.2),
    braidRadius: uniform(0.05),
    fanRadius: uniform(0.9),
    wobble: uniform(0.08),
    twist: uniform(5),
    phase: uniform(0),
    tubeRadius: uniform(0.012),
    intensity: uniform(0),
    reveal: uniform(1),
    gravitySplit: uniform(0),
    strongSplit: uniform(0),
    gravityDir: uniform(new Vector3(0, -1, 0)),
    strongDir: uniform(new Vector3(0, 1, 0)),
    gravitySep: uniform(0.8),
    strongSep: uniform(0.5),
    backDim: uniform(0.35),
    flickerPhase: uniform(0),
    unified: uniform(new Color(0.75, 0.85, 1)),
    gravity: uniform(new Color(0.16, 0.08, 0.32)),
    electroweak: uniform(new Color(1, 0.86, 0.66)),
    colourR: uniform(new Color(1, 0.12, 0.08)),
    colourG: uniform(new Color(0.1, 1, 0.25)),
    colourB: uniform(new Color(0.15, 0.3, 1)),
  };

  const per = STRANDS.perGroup;
  const iF = float(instanceIndex);
  const group = floor(iF.div(per));
  const k = iF.sub(group.mul(per)); // index within group
  const seed = fract(sin(iF.mul(12.9898).add(4.1)).mul(43758.5453));
  const isG = float(1).sub(clamp(group, 0, 1)); // group 0
  const isS = clamp(float(1).sub(abs(group.sub(1))), 0, 1); // group 1

  // Strand centreline at parameter s ∈ [0,1]: a field line of a braid that pinches through the field.
  const path = (s: Node<'float'>): Node<'vec3'> => {
    const x = s.mul(2).sub(1);
    const ax = x.abs();
    const bow = float(1).sub(x.mul(x));
    const base = u.centre
      .add(u.axis.mul(x.mul(u.halfLength)))
      .add(u.axisN.mul(sin(x.mul(1.5708)).mul(u.bendN)))
      .add(u.axisB.mul(bow.mul(u.bendB)));
    // Peel: a zipper front runs from the s = 1 end to the s = 0 end as split goes 0 → 1; a peeled strand
    // also stops converging (its pinch opens).
    const gFront = mix(float(1.05), float(-0.5), u.gravitySplit);
    const sFront = mix(float(1.05), float(-0.5), u.strongSplit);
    const gPeel = smoothstep(gFront, gFront.add(0.45), s).mul(isG);
    const sPeel = smoothstep(sFront, sFront.add(0.45), s).mul(isS);
    const peel = gPeel.add(sPeel);
    // Converging braid: tight at the centre, fanned out towards the ends; each filament at its own depth in it.
    const pinch = mix(u.braidRadius, u.fanRadius, ax.pow(1.6).add(peel.mul(0.35)));
    const rad = pinch.mul(float(0.25).add(seed.mul(seed).mul(0.75)).add(k.mul(0.015)));
    const ang = iF.mul(2.39996)
      .add(x.mul(u.twist).mul(float(0.75).add(seed.mul(0.5))))
      .add(u.phase.mul(float(0.5).add(seed.mul(0.6))));
    const braid = u.axisN.mul(cos(ang)).add(u.axisB.mul(sin(ang))).mul(rad);
    // Curl-like meander: two incommensurate waves per filament, stronger away from the pinch.
    const f1 = float(4.3).add(seed.mul(3.1));
    const f2 = float(6.7).add(seed.mul(2.3));
    const meander = u.axisN
      .mul(sin(x.mul(f1).add(u.phase.mul(0.7)).add(seed.mul(9.1))))
      .add(u.axisB.mul(cos(x.mul(f2).sub(u.phase.mul(0.55)).add(seed.mul(4.7)))))
      .mul(u.wobble.mul(float(0.3).add(ax)));
    const lift = bow.mul(0.6).add(0.4);
    const away = u.gravityDir.mul(u.gravitySep.mul(gPeel).mul(lift).mul(float(0.8).add(seed.mul(0.4))))
      .add(u.strongDir.mul(u.strongSep.mul(sPeel).mul(lift).mul(float(0.8).add(seed.mul(0.4)))));
    return base.add(braid).add(meander).add(away);
  };

  const s = positionGeometry.x;
  const ring = positionGeometry.yz;
  const p0 = path(s);
  const p1 = path(s.add(0.003));
  const T = normalize(p1.sub(p0));
  const N = normalize(cross(T, vec3(0, 0, 1)));
  const B = cross(T, N);
  const taper = smoothstep(0, 0.14, s).mul(float(1).sub(smoothstep(0.86, 1, s)));
  const thick = float(1).sub(isG.mul(u.gravitySplit).mul(0.35));
  const nrm = N.mul(ring.x).add(B.mul(ring.y));
  const position = p0.add(nrm.mul(u.tubeRadius.mul(taper.add(0.15)).mul(thick)));

  // Fragment.
  const vS = varying(s);
  const vN = varying(nrm);
  const vI = varying(iF);
  const vSeed = varying(seed);
  const vG = varying(group);
  const fG = float(1).sub(clamp(vG, 0, 1));
  const fS = clamp(float(1).sub(abs(vG.sub(1))), 0, 1);
  const fE = clamp(vG.sub(1), 0, 1);
  const view = normalize(cameraPosition.sub(positionWorld));
  const behind = smoothstep(-0.3, 0.6, dot(positionWorld.sub(u.centre), view.negate()));
  const depthDim = mix(float(1), u.backDim, behind);
  const facing = abs(dot(normalize(vN), view));
  const glow = facing.mul(facing).mul(0.8).add(0.2);
  const xs = vS.mul(2).sub(1).abs();
  const along = smoothstep(0.02, 0.3, vS).mul(float(1).sub(smoothstep(0.7, 0.98, vS)));
  const grown = float(1).sub(smoothstep(u.reveal.sub(0.12), u.reveal, xs));
  const pulse = sin(vS.mul(22).sub(u.phase.mul(2.2)).add(vSeed.mul(6.28))).mul(0.5).add(0.5).pow(3).mul(0.9).add(0.55);

  // Colour charge cycles along the strong strands.
  const hue = fract(vS.mul(1.4).add(vI.div(3)).add(u.flickerPhase));
  const h3 = hue.mul(3);
  const wr = clamp(float(1).sub(abs(h3.sub(0.5)).mul(1.5)), 0, 1).add(clamp(float(1).sub(abs(h3.sub(3.5)).mul(1.5)), 0, 1));
  const wg = clamp(float(1).sub(abs(h3.sub(1.5)).mul(1.5)), 0, 1);
  const wb = clamp(float(1).sub(abs(h3.sub(2.5)).mul(1.5)), 0, 1);
  const charge = u.colourR.mul(wr).add(u.colourG.mul(wg)).add(u.colourB.mul(wb));

  const gCol = mix(u.unified, u.gravity, smoothstep(0.15, 0.85, u.gravitySplit));
  const sCol = mix(u.unified, charge.mul(1.4), smoothstep(0.05, 0.6, u.strongSplit));
  const eCol = mix(u.unified, u.electroweak, smoothstep(0.1, 0.9, u.strongSplit));
  const col = gCol.mul(fG).add(sCol.mul(fS)).add(eCol.mul(fE));

  const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  mat.positionNode = position;
  mat.colorNode = col.mul(glow).mul(along).mul(grown).mul(pulse).mul(depthDim).mul(u.intensity);

  const geo = new TubeGeometry(new LineCurve3(new Vector3(0, 0, 0), new Vector3(1, 0, 0)), STRANDS.tubularSegments, 1, STRANDS.radialSegments, false);
  const mesh = new InstancedMesh(geo, mat, STRANDS.perGroup * STRANDS.groups);
  mesh.frustumCulled = false;

  return {
    mesh,
    uniforms: u,
    dispose() {
      geo.dispose();
      mat.dispose();
      mesh.dispose();
    },
  };
}
