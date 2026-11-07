// Force strands for the planck scene: instanced glowing tubes braided into one bundle (the unified force)
// that peel apart: gravity first (dimming to a dark violet), then the strong force (colour-charge flicker),
// leaving the electroweak bundle that the qgp chapter later splits at the Higgs moment.

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
  perGroup: 4,
  groups: 3, // 0 gravity, 1 strong, 2 electroweak
  tubularSegments: 160,
  radialSegments: 6,
} as const;

const _mkF = () => uniform(0);
const _mkV3 = () => uniform(new Vector3());
const _mkC = () => uniform(new Color());
type F = ReturnType<typeof _mkF>;
type V3 = ReturnType<typeof _mkV3>;
type C = ReturnType<typeof _mkC>;

export interface StrandUniforms {
  centre: V3;
  /** Ring plane: two orthonormal in-plane axes and its normal. */
  axis: V3;
  axisN: V3;
  axisB: V3;
  ringRadius: F;
  /** Arc start angle and angular span (radians); spin = rotation per unit phase. */
  arcStart: F;
  arcSpan: F;
  spin: F;
  braidRadius: F;
  twist: F;
  /** Integrated flow phase. */
  phase: F;
  tubeRadius: F;
  intensity: F;
  /** 0 → 1: how far the strands have grown out from the middle. */
  reveal: F;
  gravitySplit: F;
  strongSplit: F;
  /** Peeled strands move outward (sep, world) and out of the ring plane (lift, world). */
  gravitySep: F;
  strongSep: F;
  gravityLift: F;
  strongLift: F;
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
    ringRadius: uniform(1.5),
    arcStart: uniform(0),
    arcSpan: uniform(4),
    spin: uniform(0.05),
    braidRadius: uniform(0.05),
    twist: uniform(5),
    phase: uniform(0),
    tubeRadius: uniform(0.012),
    intensity: uniform(0),
    reveal: uniform(1),
    gravitySplit: uniform(0),
    strongSplit: uniform(0),
    gravitySep: uniform(0.8),
    strongSep: uniform(0.4),
    gravityLift: uniform(0.3),
    strongLift: uniform(0.3),
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

  // Strand centreline at parameter s ∈ [0,1]: an arc of a ring around the field, braided.
  const path = (s: Node<'float'>): Node<'vec3'> => {
    const x = s.mul(2).sub(1);
    const phi = u.arcStart.add(u.arcSpan.mul(s)).add(u.phase.mul(u.spin));
    const radial = u.axis.mul(cos(phi)).add(u.axisN.mul(sin(phi)));
    // Peel: a zipper front runs from the s = 1 end to the s = 0 end as split goes 0 → 1.
    const gFront = mix(float(1.05), float(-0.5), u.gravitySplit);
    const sFront = mix(float(1.05), float(-0.5), u.strongSplit);
    const gPeel = smoothstep(gFront, gFront.add(0.45), s).mul(isG);
    const sPeel = smoothstep(sFront, sFront.add(0.45), s).mul(isS);
    const wobble = sin(x.mul(3.1).add(u.phase.mul(0.35)).add(seed.mul(6.28))).mul(0.08);
    const ringR = u.ringRadius
      .add(u.gravitySep.mul(gPeel).mul(float(1).add(wobble).add(k.mul(0.04))))
      .add(u.strongSep.mul(sPeel).mul(float(1).add(wobble)));
    const lift = u.axisB.mul(u.gravityLift.mul(gPeel).negate().add(u.strongLift.mul(sPeel)));
    const base = u.centre.add(radial.mul(ringR)).add(lift);
    // Braid: every strand winds round the arc; each group sits at its own third of the circle.
    // Loose, organic braid: each strand has its own twist rate, radius and a slow meander.
    const ang = iF.mul(2.39996)
      .add(group.mul(2.0944))
      .add(x.mul(u.twist).mul(float(0.8).add(seed.mul(0.4))))
      .add(u.phase.mul(float(0.6).add(seed.mul(0.5))));
    const meander = sin(x.mul(float(5).add(seed.mul(4))).add(u.phase.mul(0.5)).add(seed.mul(9))).mul(0.25);
    const rb = u.braidRadius.mul(float(0.65).add(seed.mul(0.5)).add(meander));
    const braid = radial.mul(cos(ang)).add(u.axisB.mul(sin(ang))).mul(rb);
    return base.add(braid);
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
  const behind = smoothstep(-0.15, 0.25, dot(positionWorld.sub(u.centre), view.negate()));
  const depthDim = mix(float(1), u.backDim, behind);
  const facing = abs(dot(normalize(vN), view));
  const glow = facing.mul(facing).mul(0.8).add(0.2);
  const xs = vS.mul(2).sub(1).abs();
  const along = smoothstep(0, 0.2, vS).mul(float(1).sub(smoothstep(0.8, 1, vS)));
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
