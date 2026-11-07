// Dark ages & cosmic web (HANDOFF §9.8) · simulated · colour mapped.
// The afterglow of recombination fades as its blackbody peak slides into the infrared (true colour, CIE luminance);
// then nothing emits visible light, and dark matter is shown through the labelled density colour map while the
// shared primordial field grows by Zel'dovich into sheets, filaments and halos. The brightest halos (the field's
// highest peaks, spherical-collapse rule) begin to glow at the end: the same seeds the first stars will use.
// ?debug=field marks the top peaks, draws their Lagrangian → Eulerian tracks and a slice of the primordial
// field (?debug=zeta: the inflation curvature ζ) so every halo can be traced back to the ripples.

import {
  BufferAttribute,
  BufferGeometry,
  LineBasicNodeMaterial,
  LineSegments,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Sprite,
  Vector3,
  Vector4,
  type MeshBasicNodeMaterial,
  type RenderTarget,
  type SpriteNodeMaterial,
  type WebGPURenderer,
} from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';
import type { CosmicScene, RenderContext } from '../types.ts';
import { globalsAt, type Globals } from '../../physics/cosmology.ts';
import { blackbodyXYZ } from '../../physics/blackbody.ts';
import { webAmplitude } from '../../shared/gaussianField.ts';
import { clamp01, smoothstep } from '../../shared/math.ts';
import { sceneRange } from '../sceneRange.ts';
import {
  HaloSeeds,
  ORDINAL,
  STRUCTURE,
  applyStructureCamera,
  collapseNu,
  createStructureWeb,
  fieldNodes,
  focusShift,
  ramp,
  haloMaterial,
  hazeMaterial,
  type StructureWeb,
} from './structure.ts';
import { afterglowMaterial, markerMaterial, sliceMaterial } from './shaders.ts';

const params = {
  afterglow: {
    /** Linear HDR brightness of the sky at the start of the chapter (photon T ≈ 2900 K). */
    peak: 0.75,
    /**
     * Visible luminance (CIE Y of the blackbody) falls ~10⁷× by T = 1000 K; shown ∝ (Y/Y₀)^γ so the fade spans the
     * first beats instead of one frame (an adapting eye). Stated in the note.
     */
    exposureGamma: 0.25,
    radius: 80,
    tableLog10TMin: 1.0,
    tableLog10TMax: 3.6,
    tableSize: 128,
  },
  web: {
    /** Brightness / contrast keyed on local (piecewise linear). */
    brightness: [
      [0, 0.16],
      [0.14, 0.2],
      [0.3, 0.3],
      [0.44, 0.5],
      [0.6, 0.74],
      [0.75, 0.92],
      [1, 1.0],
    ] as [number, number][],
    contrast: [
      [0, 0.8],
      [0.5, 1.05],
      [1, 1.2],
    ] as [number, number][],
    size: 0.75,
  },
  haze: {
    /** Brightness keyed on local; the integral runs over ~9 world units. */
    brightness: [
      [0, 0.004],
      [0.3, 0.012],
      [0.44, 0.03],
      [0.6, 0.04],
      [1, 0.05],
    ] as [number, number][],
    /** Fraction of the tier's raymarch steps. */
    stepFraction: 0.5,
  },
  halos: {
    maxSeeds: 64,
    /** World size of the brightest halo glow. */
    size: 0.42,
    /** HDR peak (bloom threshold ≈ 0.72). */
    peak: 1.5,
    /** Glow from ν_c − onset (approaching collapse) to ν_c + width (collapsed). */
    onset: 1.8,
    width: 0.12,
  },
  debug: {
    markers: 24,
    markerSize: 0.34,
    sliceRadius: 4.6,
  },
};

export default (): CosmicScene => {
  let renderer: WebGPURenderer;
  let scene: Scene;
  let camera: PerspectiveCamera;
  let web: StructureWeb;
  let seeds: HaloSeeds;
  let sky: Mesh;
  let halos: Sprite;
  let haze: Mesh;
  const uA = uniform(0.1);
  const uHaze = uniform(0);
  const uLogT = uniform(3.4);
  const uGlow = uniform(0);
  const uHaloSize = uniform(params.halos.size);
  const uHaloPeak = uniform(params.halos.peak);
  const haloData: Vector4[] = Array.from({ length: params.halos.maxSeeds }, () => new Vector4());
  const glowTable = new Float32Array(params.afterglow.tableSize);
  let field: RenderContext['field'];

  // Debug overlay (only built with ?debug=field|zeta).
  let debug: { markers: Sprite; tracks: LineSegments; slice: Mesh; data: Vector4[]; trackPos: BufferAttribute } | null = null;

  const self: CosmicScene = {
    id: 'darkAges',
    range: sceneRange('darkAges'),
    accuracy: 'simulated',
    accuracyNote:
      'Nothing here emits visible light, so dark matter is shown through a density colour map: its shapes grow from the measured primordial spectrum (Zel’dovich approximation), but the growth is compressed (shown ∝ D(a)^0.35) so the web is visible this early, and the afterglow’s fade into the infrared is slowed (brightness ∝ luminance^¼).',
    colourMapped: true,

    async init(ctx: RenderContext) {
      renderer = ctx.renderer;
      field = ctx.field;
      await ctx.field.ready;
      scene = new Scene();
      camera = new PerspectiveCamera(STRUCTURE.fov, 1, 0.03, 300);

      // Afterglow luminance table over log T (CPU, once): (Y(T)/Y(T₀))^γ is applied in update.
      const a = params.afterglow;
      for (let i = 0; i < a.tableSize; i++) {
        const l = a.tableLog10TMin + ((a.tableLog10TMax - a.tableLog10TMin) * i) / (a.tableSize - 1);
        glowTable[i] = blackbodyXYZ(Math.pow(10, l))[1];
      }
      const y0 = glowTable[a.tableSize - 1]!;
      for (let i = 0; i < a.tableSize; i++) glowTable[i] = Math.pow(glowTable[i]! / y0, a.exposureGamma);

      sky = new Mesh(new SphereGeometry(a.radius, 32, 16), afterglowMaterial(ctx.globals.lut, uLogT, uGlow));
      sky.renderOrder = -10;
      sky.frustumCulled = false;
      scene.add(sky);

      const shift = focusShift(ctx.field, new Vector3());
      web = createStructureWeb(ctx, shift, {});
      web.uniforms.colourMap.value = 1;
      web.uniforms.size.value = params.web.size;
      scene.add(web.object);

      const steps = Math.max(12, Math.round(ctx.quality.raymarchSteps * params.haze.stepFraction));
      haze = new Mesh(new SphereGeometry(STRUCTURE.ballRadius, 48, 24), hazeMaterial(fieldNodes(ctx.field, shift), uA, uHaze, steps));
      haze.renderOrder = -5;
      haze.frustumCulled = false;
      scene.add(haze);

      seeds = new HaloSeeds(ctx.field, shift, params.halos.maxSeeds);
      halos = new Sprite(haloMaterial(uniformArray(haloData, 'vec4'), uHaloSize, uHaloPeak));
      halos.count = Math.max(1, seeds.count);
      halos.frustumCulled = false;
      halos.renderOrder = 2;
      scene.add(halos);

      const mode = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('debug') : null;
      if (mode === 'field' || mode === 'zeta') {
        const n = Math.min(params.debug.markers, seeds.count);
        const data = Array.from({ length: Math.max(1, n) }, () => new Vector4());
        const markers = new Sprite(markerMaterial(uniformArray(data, 'vec4'), params.debug.markerSize));
        markers.count = Math.max(1, n);
        markers.frustumCulled = false;
        markers.renderOrder = 5;
        const geo = new BufferGeometry();
        const trackPos = new BufferAttribute(new Float32Array(Math.max(1, n) * 6), 3);
        geo.setAttribute('position', trackPos);
        const lineMat = new LineBasicNodeMaterial({ color: 0xbfd8ff, transparent: true, opacity: 0.7, depthWrite: false });
        const tracks = new LineSegments(geo, lineMat);
        tracks.frustumCulled = false;
        tracks.renderOrder = 4;
        const r = params.debug.sliceRadius;
        const slice = new Mesh(new PlaneGeometry(2 * r, 2 * r, 1, 1), sliceMaterial(ctx.field.textures().density, shift, mode === 'zeta' ? 'g' : 'b', r));
        slice.rotation.x = -Math.PI / 2;
        // Through the highest peak's Lagrangian (A = 0) position: its track starts on the slice's hottest spot.
        slice.position.y = seeds.count ? seeds.lagrangian[1]! : 0;
        slice.renderOrder = 1;
        scene.add(slice, tracks, markers);
        debug = { markers, tracks, slice, data, trackPos };
      }

      self.update(0, globalsAt(self.range[0]), 0, 0);
      await renderer.compileAsync(scene, camera);
    },

    update(local: number, g: Globals, _dt: number, elapsed: number) {
      const l = clamp01(local);
      const A = webAmplitude(g.a);

      // Afterglow: true blackbody colour at the photon temperature, visible luminance from the table.
      const pa = params.afterglow;
      const lt = Math.log10(Math.max(g.T, 1));
      const x = clamp01((lt - pa.tableLog10TMin) / (pa.tableLog10TMax - pa.tableLog10TMin)) * (pa.tableSize - 1);
      const i0 = Math.min(Math.floor(x), pa.tableSize - 2);
      const glow = glowTable[i0]! + (glowTable[i0 + 1]! - glowTable[i0]!) * (x - i0);
      uLogT.value = Math.max(lt, 3); // the LUT starts at 10³ K; below that only the (vanishing) brightness matters
      uGlow.value = pa.peak * glow;
      sky.visible = uGlow.value > 1e-4;

      // The web: the same Zel'dovich amplitude every structure scene uses.
      const u = web.uniforms;
      u.amplitude.value = A;
      u.brightness.value = ramp(params.web.brightness, l);
      u.contrast.value = ramp(params.web.contrast, l);
      uA.value = A;
      uHaze.value = ramp(params.haze.brightness, l);

      // Halos approaching / past spherical collapse glow (colour mapped).
      seeds.update(A);
      const nuC = collapseNu(field, A);
      const ph = params.halos;
      for (let k = 0; k < params.halos.maxSeeds; k++) {
        if (k < seeds.count) {
          const nu = seeds.pos[k * 4 + 3]!;
          const w = Math.pow(smoothstep(nuC - ph.onset, nuC + ph.width, nu), 1.5);
          seeds.write(k, haloData[k]!, w);
        } else haloData[k]!.set(0, 0, 0, 0);
      }

      if (debug) {
        const n = debug.markers.count;
        const tp = debug.trackPos.array as Float32Array;
        for (let k = 0; k < n && k < seeds.count; k++) {
          seeds.write(k, debug.data[k]!, k / Math.max(1, n - 1));
          tp[k * 6] = seeds.lagrangian[k * 3]!;
          tp[k * 6 + 1] = seeds.lagrangian[k * 3 + 1]!;
          tp[k * 6 + 2] = seeds.lagrangian[k * 3 + 2]!;
          tp[k * 6 + 3] = seeds.pos[k * 4]!;
          tp[k * 6 + 4] = seeds.pos[k * 4 + 1]!;
          tp[k * 6 + 5] = seeds.pos[k * 4 + 2]!;
        }
        debug.trackPos.needsUpdate = true;
      }

      web.refDist.value = 0.8 * applyStructureCamera(camera, ORDINAL.darkAges + l, elapsed);
    },

    render(target: RenderTarget) {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    },

    resize(w: number, h: number) {
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    },

    dispose() {
      web.dispose();
      haze.geometry.dispose();
      (haze.material as MeshBasicNodeMaterial).dispose();
      sky.geometry.dispose();
      (sky.material as MeshBasicNodeMaterial).dispose();
      (halos.material as SpriteNodeMaterial).dispose();
      if (debug) {
        (debug.markers.material as SpriteNodeMaterial).dispose();
        debug.tracks.geometry.dispose();
        (debug.tracks.material as LineBasicNodeMaterial).dispose();
        debug.slice.geometry.dispose();
        (debug.slice.material as MeshBasicNodeMaterial).dispose();
        debug = null;
      }
    },
  };
  return self;
};
