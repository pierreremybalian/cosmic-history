// inflation — cosmic inflation (HANDOFF §9.2). Accuracy: modelled.
//
// Beats (local; captions in content/chapters/inflation.mdx at 0.14, 0.30, 0.46, 0.64, 0.82):
//   0.00–0.18  a tiny patch of foam (planck's last frame, same camera framing) settles into a uniform glow:
//              the inflaton's energy
//   0.18–0.50  violent exponential stretch: the patch balloons past the frame, its foam smoothed away; the
//              camera dollies in; ripples of the primordial field stream outward from the centre
//   0.50–0.80  steady exponential expansion; a soft spherical horizon of fixed size marks how far light can
//              reach; inside it quantum jitter still flickers, outside it ripples are frozen and keep growing
//   0.75–1.00  the stretch settles, jitter and horizon fade; the frozen ripples are the shared primordial ζ
//              field on the box slice z = 0.5, filling the view (the seeds of the cosmic web, same seed)
//
// Scale: a(local) = inflationScaleFactor(local) (60 e-folds, §6.5). The field's visible scale is a(t)
// raised to a compression power with eased onset and settling (the display shows ~7.5 e-folds): see zoom.

import { Color, Mesh, PerspectiveCamera, PlaneGeometry, Scene, SphereGeometry, Vector3, type Data3DTexture, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { blackbodyRGB } from '../../physics/blackbody.ts';
import { INFLATION_EFOLDS } from '../../physics/constants.ts';
import { globalsAt, inflationScaleFactor, type Globals } from '../../physics/cosmology.ts';
import { WORLD_BOX } from '../../shared/gaussianField.ts';
import { lerp, smootherstep, smoothstep } from '../../shared/math.ts';
import { FOAM_HANDOFF, applyLook, aspectPullback, createFoamNoiseTexture, createFoamVolume, lerpLook, type FoamLook, type FoamVolume } from '../planck/foam.ts';
import type { CosmicScene, RenderContext } from '../types.ts';
import { sceneRange } from '../sceneRange.ts';
import { SLOTS, createFieldMaterial, createFieldUniforms, createHorizonMaterial, type FieldUniforms } from './shaders.ts';

export const params = {
  camera: {
    fov: FOAM_HANDOFF.fov,
    /** Dolly-in during the violent stretch (fraction of the final distance) and its timing. */
    dolly: 0.22,
    dollyIn: [0.2, 0.42] as const,
    dollyOut: [0.5, 0.92] as const,
    /** Pan so the horizon sits right of the captions (fraction of the visible half-width, capped in world). */
    pan: 0.3,
    panMaxWorld: 1.5,
    panIn: [0.16, 0.34] as const,
    panOut: [0.7, 0.96] as const,
    /** Slight downward look during the dolly (radians). */
    tilt: 0.12,
    orbit: 0.025,
    orbitRate: 0.05,
  },
  zoom: {
    /** e-folds of magnification actually shown (the real 60 are compressed into these). */
    visibleEfolds: 7.5,
    /** Relative zoom rate: a small base drift, the onset of the stretch, and its settling. */
    base: 0.03,
    onset: [0.17, 0.3] as const,
    settle: [0.66, 0.97] as const,
    /** Ratio between successive copies of the field, and the window (in box/screen widths) where each shows. */
    ratio: 2.5,
    copies: 12,
    window: [0.5, 0.95, 1.6, 2.5] as const,
    /** Only the real box (copy 0) remains over this final stretch. */
    endPure: [0.9, 0.995] as const,
    /** Radial blur at full stretch rate (fraction of radius); taps per tier. */
    blur: 0.09,
    blurTaps: { low: 1, medium: 2, high: 3 } as Record<string, number>,
  },
  foam: {
    noiseSize: { low: 48, medium: 64, high: 64 } as Record<string, number>,
    volumeScale: { low: 0.45, medium: 0.5, high: 0.5 } as Record<string, number>,
    maxSteps: 64,
    /** The patch calms into a uniform inflaton glow, then is stretched away. */
    calm: [0.04, 0.18] as const,
    fade: [0.24, 0.38] as const,
    /** Stretch factors over which the foam's cell structure dissolves into a smooth glow. */
    dissolve: [1.3, 3.5] as const,
  },
  field: {
    bright: [0.24, 0.36] as const,
    brightPeak: 0.8,
    brightEnd: 0.3,
    brightEndAt: [0.72, 0.98] as const,
    contrastPeak: 1.1,
    contrastEnd: 0.85,
    mapTopPeak: 0.7,
    mapTopEnd: 0.62,
    energy: 0.012,
    energyOn: [0.12, 0.3] as const,
    energyOff: [0.7, 0.95] as const,
    jitter: 0.75,
    jitterOn: [0.2, 0.32] as const,
    jitterOff: [0.7, 0.88] as const,
    jitterRate: 2.2,
    idle: 0.35,
    idleRate: 0.06,
    cool: new Color(0.015, 0.045, 0.2),
    warm: new Color(0.62, 0.72, 0.95),
  },
  horizon: {
    on: [0.22, 0.36] as const,
    off: [0.76, 0.93] as const,
    ring: 1.0,
    sphere: 0.45,
    colour: new Color(0.55, 0.7, 1.0),
  },
};

/** The patch calms into a smooth, uniform glow before it is stretched (beat 0.14: the inflaton's energy). */
const LOOK_INFLATON: Partial<FoamLook> = { edge: 1.6, node: 6, haze: 0.5, core: 0.55, churn: 0.12, bubbling: 0.15, breathe: 0.02, warp: 0.1 };

const ACCURACY_NOTE =
  'Inflation is strongly supported indirectly; its mechanism is unknown. Ripples follow the measured spectrum; their contrast (really about 1 part in 100,000) is exaggerated and the 10²⁶-fold stretch is shown on a compressed scale.';

export default (): CosmicScene => {
  let renderer: WebGPURenderer;
  let scene: Scene;
  let volScene: Scene;
  let camera: PerspectiveCamera;
  let noise: Data3DTexture;
  let foam: FoamVolume;
  let plane: Mesh;
  let horizon: Mesh;
  let fu: FieldUniforms;
  let debugField = false;
  let churnPhase = 0;
  const horizonGain = uniform(0);
  const horizonColour = uniform(new Color());
  const look: FoamLook = { ...FOAM_HANDOFF.look };
  const lookCalm: FoamLook = { ...FOAM_HANDOFF.look, ...LOOK_INFLATON };
  const scaled: FoamLook = { ...FOAM_HANDOFF.look };
  const origin = new Vector3();
  const target = new Vector3();
  const rgb: [number, number, number] = [0, 0, 0];
  const P = params;
  const Z = P.zoom;

  // Cumulative zoom: lnM(s) = −E·(1 − F(s)), F = normalised integral of the rate profile.
  const TABLE = 1024;
  const F = new Float64Array(TABLE + 1);
  const rate = (s: number) => Z.base + smoothstep(Z.onset[0], Z.onset[1], s) * (1 - smoothstep(Z.settle[0], Z.settle[1], s));
  {
    let acc = 0;
    F[0] = 0;
    for (let i = 1; i <= TABLE; i++) {
      acc += 0.5 * (rate((i - 1) / TABLE) + rate(i / TABLE)) / TABLE;
      F[i] = acc;
    }
    for (let i = 0; i <= TABLE; i++) F[i] = F[i]! / acc;
  }
  let rateMax = 0;
  for (let i = 0; i <= 64; i++) rateMax = Math.max(rateMax, rate(i / 64));
  const progress = (s: number) => {
    const x = Math.min(Math.max(s, 0), 1) * TABLE;
    const i = Math.min(Math.floor(x), TABLE - 1);
    return F[i]! + (F[i + 1]! - F[i]!) * (x - i);
  };
  /**
   * ln of the field's visible magnification relative to the final box (0 at local = 1):
   * M = (a(s′)/a_end)^(visible/60), with a from inflationScaleFactor (60 e-folds, §6.5) and s′ = F(s) the
   * eased progress (exponential rate eased in at the onset and out as inflation ends). The display thus
   * shows `visibleEfolds` of the 60 e-folds, on a compressed scale.
   */
  const lnMag = (s: number) => (Z.visibleEfolds / INFLATION_EFOLDS) * Math.log(inflationScaleFactor(progress(s)) / inflationScaleFactor(1));

  const windowW = (S: number) => smoothstep(Z.window[0], Z.window[1], S) * (1 - smoothstep(Z.window[2], Z.window[3], S));

  return {
    id: 'inflation',
    range: sceneRange('inflation'),
    accuracy: 'modelled',
    accuracyNote: ACCURACY_NOTE,
    colourMapped: false,

    async init(ctx: RenderContext) {
      renderer = ctx.renderer;
      const tierName = ctx.quality.name;
      debugField = typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === 'field';
      await ctx.field.ready;
      const density = ctx.field.textures().density; // shared: never dispose
      const n = ctx.field.n;

      scene = new Scene();
      volScene = new Scene();
      camera = new PerspectiveCamera(P.camera.fov, 1, 0.05, 400);

      fu = createFieldUniforms();
      fu.cool.value.copy(P.field.cool);
      fu.warm.value.copy(P.field.warm);
      fu.debug.value = debugField ? 1 : 0;
      plane = new Mesh(new PlaneGeometry(80, 80), createFieldMaterial(density, n, WORLD_BOX, fu, P.zoom.blurTaps[tierName] ?? 2));
      plane.frustumCulled = false;
      scene.add(plane);

      horizon = new Mesh(new SphereGeometry(1, 64, 32), createHorizonMaterial(horizonGain, horizonColour));
      horizon.renderOrder = 2;
      scene.add(horizon);

      noise = createFoamNoiseTexture(P.foam.noiseSize[tierName] ?? 64);
      foam = createFoamVolume({
        // The patch is on screen only briefly and dissolves as it stretches: the tier's steps, capped.
        steps: Math.min(ctx.quality.raymarchSteps, P.foam.maxSteps),
        noise,
        resolutionScale: P.foam.volumeScale[tierName] ?? 0.5,
        additive: true,
      });
      foam.uniforms.deep.value.setRGB(0.03, 0.04, 0.3);
      foam.uniforms.far.value.setRGB(0.16, 0.035, 0.42);
      foam.quad.renderOrder = 5;
      volScene.add(foam.mesh);
      scene.add(foam.quad);

      this.update(0, globalsAt(this.range[0]), 0, 0);
      await renderer.compileAsync(volScene, camera);
      await renderer.compileAsync(scene, camera);
    },

    update(local: number, g: Globals, dt: number, elapsed: number) {
      const s = debugField ? 1 : local;
      const C = P.camera;

      // ── Zoom: magnification of the comoving field, and the copies in their windows ──
      const lnM = lnMag(s);
      const M = Math.exp(lnM);
      const lnM0 = lnMag(0);
      const stretch = Math.exp(lnM - lnM0); // growth of everything comoving since the start
      const endPure = smoothstep(Z.endPure[0], Z.endPure[1], s);
      let slot = 0;
      let sumW2 = 0;
      for (let j = 0; j < Z.copies && slot < SLOTS; j++) {
        const S = M * Math.pow(Z.ratio, j);
        let w = windowW(S);
        if (j === 0) w = Math.max(w, endPure);
        else w *= 1 - endPure;
        if (w <= 1e-4) continue;
        const sl = fu.slot[slot]!.value;
        sl.set(WORLD_BOX * S, j === 0 ? 0.5 : (0.5 + j * 0.6180339) % 1, j === 0 ? 0 : j * 2.39996, w);
        sumW2 += w * w;
        slot++;
      }
      for (; slot < SLOTS; slot++) fu.slot[slot]!.value.w = 0;
      fu.norm.value = 1 / Math.sqrt(Math.max(sumW2, 0.25));
      const r = rate(s) / rateMax;
      fu.blur.value = Z.blur * smoothstep(0.3, 0.9, r);

      // ── Camera: final framing = the box filling the view (cover) ──
      const tanV = Math.tan(((C.fov * Math.PI) / 180) * 0.5);
      const half = WORLD_BOX / 2;
      const dFinal = Math.min(half / (tanV * camera.aspect), half / tanV);
      const dolly = smoothstep(C.dollyIn[0], C.dollyIn[1], s) * (1 - smootherstep(C.dollyOut[0], C.dollyOut[1], s));
      const dist = dFinal * (1 - C.dolly * dolly);
      const halfW = dist * tanV * camera.aspect;
      const pan = Math.min(halfW * C.pan, C.panMaxWorld) * smootherstep(C.panIn[0], C.panIn[1], s) * (1 - smootherstep(C.panOut[0], C.panOut[1], s));
      const settle = smootherstep(0.8, 1.0, s);
      const yaw = Math.sin(elapsed * C.orbitRate) * C.orbit * (1 - settle) * (debugField ? 0 : 1);
      const tilt = C.tilt * dolly;
      target.set(-pan, 0, 0);
      camera.position.set(target.x + Math.sin(yaw) * dist, -Math.sin(tilt) * dist, Math.cos(yaw) * Math.cos(tilt) * dist);
      camera.lookAt(target);

      // ── Foam patch (planck's last frame), scaled so it has the same size on screen ──
      const k = dFinal / (FOAM_HANDOFF.cameraDistance * aspectPullback(camera.aspect));
      lerpLook(FOAM_HANDOFF.look, lookCalm, smoothstep(P.foam.calm[0], P.foam.calm[1], s), look);
      const fade = 1 - smoothstep(P.foam.fade[0], P.foam.fade[1], s);
      Object.assign(scaled, look);
      scaled.radius = look.radius * k * stretch;
      scaled.bound = look.bound * k * stretch;
      scaled.cellsWorld = look.cellsWorld / k; // per world unit at stretch 1 (stretch divides below)
      scaled.coreRadiusWorld = look.coreRadiusWorld * k * stretch;
      scaled.exposure = (look.exposure * fade) / Math.sqrt(stretch);
      // Stretched bubbles grow far larger than the view: their edges dissolve into the smooth glow (and the
      // cell search is skipped, which keeps the camera-inside phase cheap).
      const smooth = 1 - smoothstep(P.foam.dissolve[0], P.foam.dissolve[1], stretch);
      scaled.edge = look.edge * smooth;
      scaled.node = look.node * smooth;
      scaled.skin = look.skin * smooth;
      // Haze alone is smooth: far fewer, longer steps (the loop exits early), over a bounded distance.
      foam.uniforms.maxStepMul.value = lerp(8, 2, smooth);
      foam.uniforms.maxChord.value = dFinal * 3;
      churnPhase += dt * look.churn;
      applyLook(foam.uniforms, scaled, origin);
      foam.uniforms.stretch.value = stretch;
      foam.uniforms.phase.value = churnPhase;
      const [br, bg, bb] = blackbodyRGB(g.T, rgb);
      foam.uniforms.hot.value.setRGB(br, bg, bb);
      foam.uniforms.core.value.setRGB(lerp(br, 1, 0.55), lerp(bg, 1, 0.55), lerp(bb, 1, 0.55));
      foam.sync();
      foam.mesh.visible = foam.quad.visible = fade > 0.002 && !debugField;

      // ── The field ──
      const Fp = P.field;
      const on = smoothstep(Fp.bright[0], Fp.bright[1], s);
      const toEnd = smootherstep(Fp.brightEndAt[0], Fp.brightEndAt[1], s);
      fu.bright.value = on * lerp(Fp.brightPeak, Fp.brightEnd, toEnd);
      fu.contrast.value = lerp(Fp.contrastPeak, Fp.contrastEnd, toEnd);
      fu.mapTop.value = lerp(Fp.mapTopPeak, Fp.mapTopEnd, toEnd);
      fu.energy.value = Fp.energy * smoothstep(Fp.energyOn[0], Fp.energyOn[1], s) * (1 - smoothstep(Fp.energyOff[0], Fp.energyOff[1], s));
      fu.jitter.value = Fp.jitter * smoothstep(Fp.jitterOn[0], Fp.jitterOn[1], s) * (1 - smoothstep(Fp.jitterOff[0], Fp.jitterOff[1], s));
      fu.jitterPhase.value += dt * Fp.jitterRate;
      fu.idle.value = Fp.idle * smoothstep(0.6, 0.9, s);
      fu.idlePhase.value = elapsed * Fp.idleRate;
      // The field exists where the stretched patch has reached (it grows out of the foam).
      fu.extent.value = look.radius * k * stretch * 0.9;
      fu.glow.value.setRGB(br, bg, bb);

      // ── Horizon: fixed physical size = the initial patch ──
      const H = P.horizon;
      const hz = smoothstep(H.on[0], H.on[1], s) * (1 - smoothstep(H.off[0], H.off[1], s));
      const RH = FOAM_HANDOFF.look.radius * k;
      fu.horizonR.value = RH;
      fu.ring.value = H.ring * hz;
      horizonGain.value = H.sphere * hz;
      horizonColour.value.copy(H.colour);
      horizon.scale.setScalar(RH);
      horizon.visible = hz > 0.002 && !debugField;

      plane.visible = fu.bright.value > 1e-4 || fu.energy.value > 1e-4 || fu.ring.value > 1e-4 || debugField;
      this.colourMapped = on > 0.05 || debugField;
    },

    render(rt: RenderTarget) {
      if (foam.mesh.visible) {
        renderer.setRenderTarget(foam.target);
        renderer.render(volScene, camera);
      }
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
    },

    resize(w: number, h: number) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      foam.setSize(w, h);
    },

    dispose() {
      plane.geometry.dispose();
      (plane.material as { dispose(): void }).dispose();
      horizon.geometry.dispose();
      (horizon.material as { dispose(): void }).dispose();
      foam.dispose();
      noise.dispose();
    },
  };
};
