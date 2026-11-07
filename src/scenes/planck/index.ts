// planck — the Planck epoch & unification (HANDOFF §9.1). Accuracy: metaphor.
//
// Beats (local; captions in content/chapters/planck.mdx at 0.14, 0.26, 0.42, 0.60, 0.92):
//   0.00–0.30  churning quantum foam: a raymarched 4D froth of glowing bubble edges, centre-right
//   0.28–0.48  the foam calms and merges into one bright bubble, the single unified field; a braided ring of
//              force strands grows around it (all strands one colour)
//   0.52–0.80  gravity peels away: a dark, lacy absorbing layer lifts off the bubble and drifts outward; the
//              gravity strands unzip from the braid, drop out of the ring and dim to a dark violet
//   0.83–0.95  the strong force separates: colour-charge flicker (red/green/blue patches cycle over the field)
//              and the strong strands unzip in colour, leaving the electroweak braid
//   0.90–1.00  the bubble breaks back into a calm, bright, centred foam patch (handed to inflation by the
//              'stretch' transition; inflation starts on the same patch and camera, see FOAM_HANDOFF)

import { Color, PerspectiveCamera, Scene, Vector3, type Data3DTexture, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
import { blackbodyRGB } from '../../physics/blackbody.ts';
import { globalsAt, type Globals } from '../../physics/cosmology.ts';
import { bump, lerp, smootherstep, smoothstep } from '../../shared/math.ts';
import type { CosmicScene, RenderContext } from '../types.ts';
import { sceneRange } from '../sceneRange.ts';
import {
  FOAM_HANDOFF,
  applyLook,
  createFoamNoiseTexture,
  createFoamVolume,
  lerpLook,
  type FoamLook,
  type FoamVolume,
} from './foam.ts';
import { createForceStrands, type ForceStrands } from './shaders.ts';

const LOOK_OPEN: FoamLook = {
  radius: 3.4,
  bound: 3.5,
  zSquash: 1.7,
  cellsWorld: 0.95,
  warp: 0.4,
  seedJitter: 0.9,
  breathe: 0.12,
  skin: 0.35,
  skinWidth: 0.16,
  edge: 7,
  edgeWidth: 0.026,
  node: 30,
  haze: 0.1,
  bubbling: 0.7,
  edgeSoft: 0.75,
  core: 0,
  coreRadiusWorld: 1.0,
  focusGain: 0.65,
  focusRadius: 0.5,
  absorb: 0.6,
  churn: 0.6,
  exposure: 1,
};
/** One bubble: the foam inside fades to a faint, calm glow; the shell itself is driven separately. */
const LOOK_UNIFIED: FoamLook = {
  radius: 1.3,
  bound: 2.9,
  zSquash: 1,
  cellsWorld: 1.6,
  warp: 0.15,
  seedJitter: 0.9,
  breathe: 0.02,
  skin: 0.05,
  skinWidth: 0.2,
  edge: 0.7,
  edgeWidth: 0.07,
  node: 2,
  haze: 0.15,
  bubbling: 0.2,
  edgeSoft: 0.5,
  core: 0.35,
  coreRadiusWorld: 0.9,
  focusGain: 0,
  focusRadius: 0.5,
  absorb: 0.6,
  churn: 0.2,
  exposure: 1,
};
const LOOK_GRAVITY: FoamLook = { ...LOOK_UNIFIED, edge: 1.8, node: 6, churn: 0.3, bubbling: 0.35, breathe: 0.05 };
const LOOK_STRONG: FoamLook = { ...LOOK_GRAVITY, churn: 0.9, edge: 3, node: 12, warp: 0.25, breathe: 0.1 };
const LOOK_END: FoamLook = { ...FOAM_HANDOFF.look };

export const params = {
  noiseSize: { low: 48, medium: 64, high: 64 } as Record<string, number>,
  /** Raymarch at this fraction of the scene target (the volume is soft; bloom hides the rest). */
  volumeScale: { low: 0.5, medium: 0.6, high: 0.75 } as Record<string, number>,
  camera: {
    fov: FOAM_HANDOFF.fov,
    distOpen: 7.6,
    distUnified: 7.3,
    distGravity: 7.8,
    distEnd: FOAM_HANDOFF.cameraDistance,
    /** Idle orbit amplitude (radians) and rate (rad/s). */
    orbitYaw: 0.07,
    orbitPitch: 0.035,
    orbitRate: 0.045,
  },
  /** Field centre as a fraction of the visible half-width (keeps the action right of the title). */
  rightBias: 0.36,
  rightBiasMaxWorld: 1.5,
  liftY: 0.1,
  /** Brightest region of the opening foam, in local units of the volume. */
  focusOpen: new Vector3(-0.05, 0.08, 0.25),
  bubble: { radiusWorld: 1.15, widthWorld: 0.012, gain: 10, wobble: 0.015, corona: 0.7, coronaWorld: 0.28 },
  colours: {
    /** Haze tint; edges use the blackbody colour at the (clamped) temperature, depth sinks to `far`. */
    deep: new Color(0.03, 0.04, 0.3),
    far: new Color(0.16, 0.035, 0.42),
    coreWhite: 0.55,
    gravityGlow: new Color(0.03, 0.01, 0.08),
    chargeR: new Color(1.0, 0.1, 0.06),
    chargeG: new Color(0.08, 1.0, 0.2),
    chargeB: new Color(0.12, 0.28, 1.0),
    strandUnified: new Color(0.8, 0.88, 1.0),
    strandGravity: new Color(0.16, 0.07, 0.34),
    strandElectroweak: new Color(1.0, 0.84, 0.62),
  },
  beats: {
    unify: [0.28, 0.46] as const,
    bubble: [0.3, 0.45, 0.88, 0.97] as const, // in, full, out start, gone
    gravity: [0.52, 0.8] as const,
    gravityVeil: [0.5, 0.58, 0.7, 0.84] as const,
    strong: [0.83, 0.94] as const,
    flicker: { centre: 0.895, halfWidth: 0.075, rate: 0.45 },
    toCentre: [0.85, 1.0] as const,
    calm: [0.9, 1.0] as const,
    strandsIn: [0.3, 0.44] as const,
    strandsOut: [0.91, 0.97] as const,
  },
  /** Gravity veil radius (local units of the bounding radius), width, strength and absorption. */
  gravityVeil: { radiusFrom: 0.41, radiusTo: 0.72, width: 0.035, strength: 1.0, absorb: 14, offset: new Vector3(-0.12, -0.1, 0.06), noiseScale: 0.9 },
  strands: {
    ringRadius: 1.9,
    arcStart: -0.6,
    arcSpan: 4.6,
    spin: 0.05,
    /** Ring plane normal (tilted towards the camera so the ring reads as an open ellipse). */
    normal: new Vector3(-0.22, 0.86, 0.46),
    braidRadius: 0.1,
    braidRadiusUnified: 0.055,
    twist: 18,
    tubeRadius: 0.0075,
    intensity: 0.9,
    flow: 0.9,
    gravitySep: 0.75,
    gravityLift: 0.45,
    strongSep: 0.35,
    strongLift: 0.3,
    backDim: 0.3,
  },
};

const ACCURACY_NOTE = 'No tested physics describes this era; this is an artistic metaphor.';

export default (): CosmicScene => {
  let renderer: WebGPURenderer;
  let scene: Scene;
  let volScene: Scene;
  let camera: PerspectiveCamera;
  let noise: Data3DTexture;
  let foam: FoamVolume;
  let strands: ForceStrands;
  let churnPhase = 0;
  let flowPhase = 0;
  const look: FoamLook = { ...LOOK_OPEN };
  const target = new Vector3();
  const centre = new Vector3();
  const P = params;
  const B = P.beats;

  return {
    id: 'planck',
    range: sceneRange('planck'),
    accuracy: 'metaphor',
    accuracyNote: ACCURACY_NOTE,
    colourMapped: false,

    async init(ctx: RenderContext) {
      renderer = ctx.renderer;
      const tierName = ctx.quality.name;
      scene = new Scene();
      volScene = new Scene();
      camera = new PerspectiveCamera(P.camera.fov, 1, 0.05, 100);
      camera.position.set(0, 0, P.camera.distOpen);

      noise = createFoamNoiseTexture(P.noiseSize[tierName] ?? 64);
      foam = createFoamVolume({
        steps: ctx.quality.raymarchSteps,
        noise,
        resolutionScale: P.volumeScale[tierName] ?? 0.5,
        gravity: true,
        flicker: true,
        bubble: true,
      });
      const fu = foam.uniforms;
      fu.deep.value.copy(P.colours.deep);
      fu.far.value.copy(P.colours.far);
      fu.gravityGlow.value.copy(P.colours.gravityGlow);
      fu.gravityAbsorb.value = P.gravityVeil.absorb;
      fu.colourR.value.copy(P.colours.chargeR);
      fu.colourG.value.copy(P.colours.chargeG);
      fu.colourB.value.copy(P.colours.chargeB);
      volScene.add(foam.mesh);
      scene.add(foam.quad);

      strands = createForceStrands();
      const su = strands.uniforms;
      const S = P.strands;
      su.unified.value.copy(P.colours.strandUnified);
      su.gravity.value.copy(P.colours.strandGravity);
      su.electroweak.value.copy(P.colours.strandElectroweak);
      su.colourR.value.copy(P.colours.chargeR);
      su.colourG.value.copy(P.colours.chargeG);
      su.colourB.value.copy(P.colours.chargeB);
      su.twist.value = S.twist;
      su.tubeRadius.value = S.tubeRadius;
      su.ringRadius.value = S.ringRadius;
      su.arcStart.value = S.arcStart;
      su.arcSpan.value = S.arcSpan;
      su.spin.value = S.spin;
      su.gravitySep.value = S.gravitySep;
      su.gravityLift.value = S.gravityLift;
      su.strongSep.value = S.strongSep;
      su.strongLift.value = S.strongLift;
      su.backDim.value = S.backDim;
      // Orthonormal ring frame from the plane normal.
      const n = su.axisB.value.copy(S.normal).normalize();
      su.axis.value.set(1, 0, 0).addScaledVector(n, -n.x).normalize();
      su.axisN.value.crossVectors(n, su.axis.value).normalize();
      scene.add(strands.mesh);

      this.update(0, globalsAt(this.range[0]), 0, 0);
      await renderer.compileAsync(volScene, camera);
      await renderer.compileAsync(scene, camera);
    },

    update(local: number, g: Globals, dt: number, elapsed: number) {
      const s = local;
      const fu = foam.uniforms;
      const su = strands.uniforms;

      // ── Beat envelopes ──
      const unify = smoothstep(B.unify[0], B.unify[1], s);
      const bubbleOn = smoothstep(B.bubble[0], B.bubble[1], s) * (1 - smoothstep(B.bubble[2], B.bubble[3], s));
      const grav = smoothstep(B.gravity[0], B.gravity[1], s);
      const veil = smoothstep(B.gravityVeil[0], B.gravityVeil[1], s) * (1 - smoothstep(B.gravityVeil[2], B.gravityVeil[3], s));
      const strong = smoothstep(B.strong[0], B.strong[1], s);
      const flick = bump(s, B.flicker.centre, B.flicker.halfWidth);
      const toCentre = smootherstep(B.toCentre[0], B.toCentre[1], s);
      const calm = smootherstep(B.calm[0], B.calm[1], s);
      const strandsOn = smoothstep(B.strandsIn[0], B.strandsIn[1], s) * (1 - smoothstep(B.strandsOut[0], B.strandsOut[1], s));

      // ── Foam look: open → unified → gravity → strong → end ──
      lerpLook(LOOK_OPEN, LOOK_UNIFIED, unify, look);
      lerpLook(look, LOOK_GRAVITY, grav, look);
      lerpLook(look, LOOK_STRONG, flick, look);
      lerpLook(look, LOOK_END, calm, look);

      // ── Camera ──
      let dist = lerp(P.camera.distOpen, P.camera.distUnified, unify);
      dist = lerp(dist, P.camera.distGravity, grav);
      dist = lerp(dist, P.camera.distEnd, toCentre);
      const halfW = dist * Math.tan(((P.camera.fov * Math.PI) / 180) * 0.5) * camera.aspect;
      const right = Math.min(halfW * P.rightBias, P.rightBiasMaxWorld);
      centre.set(right * (1 - toCentre), P.liftY * (1 - toCentre), 0);
      const orbit = 1 - toCentre;
      const yaw = Math.sin(elapsed * P.camera.orbitRate) * P.camera.orbitYaw * orbit;
      const pitch = Math.sin(elapsed * P.camera.orbitRate * 0.71 + 1.3) * P.camera.orbitPitch * orbit;
      target.set(0, 0, 0);
      camera.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
      camera.lookAt(target);

      // ── Foam volume ──
      churnPhase += dt * look.churn;
      fu.phase.value = churnPhase;
      applyLook(fu, look, centre);
      fu.stretch.value = 1;
      fu.focus.value.copy(P.focusOpen).multiplyScalar(1 - unify);

      // The single bubble (unified field), in local units of the bounding radius.
      fu.shellRadius.value = P.bubble.radiusWorld / look.bound;
      fu.shellWidth.value = P.bubble.widthWorld / look.bound;
      fu.shellGain.value = P.bubble.gain * bubbleOn;
      fu.shellWobble.value = P.bubble.wobble;
      fu.coronaGain.value = P.bubble.corona * bubbleOn;
      fu.coronaLength.value = P.bubble.coronaWorld / look.bound;

      // Colour: the blackbody colour at the era's temperature (clamped LUT: the Rayleigh–Jeans blue-white).
      const [r, gg, b] = blackbodyRGB(g.T);
      fu.hot.value.setRGB(r, gg, b);
      const w = P.colours.coreWhite;
      fu.core.value.setRGB(lerp(r, 1, w), lerp(gg, 1, w), lerp(b, 1, w));

      // Gravity veil (local units of the bounding radius).
      const gv = P.gravityVeil;
      fu.gravityRadius.value = lerp(gv.radiusFrom, gv.radiusTo, grav);
      fu.gravityWidth.value = gv.width * (1 + grav * 0.6);
      fu.gravityStrength.value = gv.strength * veil;
      fu.gravityOffset.value.copy(gv.offset).multiplyScalar(grav);
      fu.layerNoiseScale.value = gv.noiseScale;

      // Colour-charge flicker.
      fu.flicker.value = flick;
      fu.flickerPhase.value = elapsed * B.flicker.rate + s * 6;
      foam.sync();

      // ── Strands ──
      flowPhase += dt * P.strands.flow;
      su.phase.value = flowPhase;
      su.centre.value.copy(centre);
      su.intensity.value = P.strands.intensity * strandsOn;
      su.reveal.value = smoothstep(B.strandsIn[0], B.strandsIn[1] + 0.06, s) * 1.15;
      su.braidRadius.value = lerp(P.strands.braidRadius, P.strands.braidRadiusUnified, unify);
      su.gravitySplit.value = grav;
      su.strongSplit.value = strong;
      su.flickerPhase.value = elapsed * B.flicker.rate * 1.3;
      strands.mesh.visible = strandsOn > 0.001;
    },

    render(rt: RenderTarget) {
      renderer.setRenderTarget(foam.target);
      renderer.render(volScene, camera);
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
    },

    resize(w: number, h: number) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      foam.setSize(w, h);
    },

    dispose() {
      foam.dispose();
      strands.dispose();
      noise.dispose();
    },
  };
};
