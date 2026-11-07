// bbn — the first nuclei (HANDOFF §9.6). Chapter `bbn`, log map 180 → 1200 s.
//
// Protons (warm) and neutrons (cool) jostle in the photon bath. While the bottleneck holds, p–n pairs keep
// bonding into deuterium and being blasted apart by gamma photons (flash). As it breaks (~180–360 s), deuterons
// survive, pair up and become helium-4; one free neutron in ~12 β-decays into a proton; a single lithium-7 token
// forms; one deuteron is left over. Every count follows abundancesAt(t) — see population.ts — so the scene
// agrees with the HUD gauge, which settles on Yₚ ≈ 0.247. Space expands (a ∝ t^½) and the nucleons spread out
// and slow as the bath cools; the chapter ends calm, in a brightening haze that dissolves into the photon-era fog.
//
// Beats (bbn.mdx): 0.00–0.12 bottleneck flicker → 0.08–0.35 helium forms (flashes) → 0.40 lithium token →
// 0.56 leftover deuteron → 0.80 fusion stops: motion slows, nuclei drift apart → 0.92 final mix, calm.

import {
  DynamicDrawUsage,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshBasicNodeMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
  SphereGeometry,
  Sprite,
  type SpriteNodeMaterial,
  type WebGPURenderer,
} from 'three/webgpu';
import { aAt, globalsAt } from '../../physics/cosmology.ts';
import { lerp, mulberry32, smoothstep } from '../../shared/math.ts';
import { chapterById } from '../../time/chapters.ts';
import { sceneRange } from '../sceneRange.ts';
import type { Globals } from '../../physics/cosmology.ts';
import type { CosmicScene, RenderContext } from '../types.ts';
import { buildPopulation, Kind, Role, SLOTS, type Population } from './population.ts';
import { createBathMaterial, createBathUniforms, createFlashMaterial, createNucleonMaterial } from './shaders.ts';
import { createPhotonMaterial, createPhotonUniforms, type PhotonUniforms } from '../recombination/shaders.ts';
import { blackbodyRGB } from '../../physics/blackbody.ts';
import { texture, uv } from 'three/tsl';

const fract = (x: number) => x - Math.floor(x);

const chapter = chapterById('bbn')!;

export const params = {
  /** Nucleons drawn (all fractions scale with this). */
  count: { low: 900, medium: 1800, high: 3000 },
  /** Ball the nucleons fill, world units; nucleon radius. */
  radius: 8.5,
  nucleonRadius: 0.15,
  sphereDetail: [24, 16] as const,
  /** Thermal jitter amplitude (world units) and base angular speed (rad/s), × √(T/T₀). */
  jitter: 0.32,
  jitterSpeed: 0.9,
  /** Space expands with a(t); positions scale by (a/a₀)^expansionPower (1 = true ratio, ×2.6 over the chapter). */
  expansionPower: 0.5,
  /** Members drift together over this many dex of log t before they bond. */
  approachDex: 0.06,
  /** Two deuterons merge into helium over this many dex. */
  mergeDex: 0.02,
  /** Bottleneck flicker: rate (Hz per pair), bonded fraction of each cycle. */
  flirtRate: 0.32,
  flirtDuty: 0.3,
  /** Hero zone: groups forming between these chapter locals are placed in front of the camera. */
  heroLocal: [0.07, 0.3] as const,
  heroCentre: [0.35, 0.15, 2.6] as const,
  heroRadius: 1.6,
  heroCount: 5,
  lithiumAt: 0.5,
  /** Colours (sRGB hex): protons warm, neutrons cool neutral. */
  protonHex: 0xe35b3a,
  neutronHex: 0xb3bcc8,
  keyIntensity: 1.15,
  /** Bath brightness: same compressed T-scaling as the photon-era fog (∝ T^0.09), times an exposure ramp. */
  bathRef: 0.42,
  bathPower: 0.09,
  bathExposure: [0.16, 0.75] as const,
  /** Bath light on the nucleons' limbs (Fresnel rim), independent of exposure. */
  rim: 0.9,
  haze: [0.045, 0.11] as const,
  flash: 2.5,
  flashDecay: 0.45,
  /** Camera. */
  camStart: [0, 0.55, 6.6] as const,
  camEnd: [0.0, 0.35, 5.7] as const,
  fov: 50,
  /** Gamma photons: count, trail segments, step (world units), speed (world units/s), brightness. */
  photonCount: { low: 60, medium: 110, high: 180 },
  photonTrail: 2,
  photonStep: 1.1,
  photonSpeed: 3.2,
  photonGain: 1.6,
  /** No nucleon homes within this distance of the camera path (keeps the lens clear). */
  cameraClear: 1.4,
  sway: 0.05,
};

const NOTE =
  'Mass fractions follow the measured abundances (Yₚ ≈ 0.247); nucleon counts, motion and the single lithium-7 and leftover-deuterium nuclei are illustrative tokens (real: about 1 lithium per 2 billion and 25 deuterium per million hydrogen; old stars show ~3× less lithium than predicted).';

const T_REF_K = 2932; // normalisation shared with the recombination fog's brightness law

export default (): CosmicScene => {
  let renderer: WebGPURenderer;
  let scene: Scene;
  let camera: PerspectiveCamera;
  let pop: Population;
  let mesh: InstancedMesh;
  let geo: SphereGeometry;
  let mat: MeshBasicNodeMaterial;
  let bath: Mesh;
  let bathMat: MeshBasicNodeMaterial;
  let flashes: Sprite;
  let flashMat: SpriteNodeMaterial;
  let info: InstancedBufferAttribute;
  let flashAttr: InstancedBufferAttribute;
  let flashAt: Float32Array;
  let prevU = NaN;
  let msaa: RenderTarget | null = null;
  let blitScene: Scene;
  let blitQuad: Mesh | undefined;
  let blitMat: MeshBasicNodeMaterial | undefined;
  const blitCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let photonGeo: PlaneGeometry | undefined;
  let photonMat: MeshBasicNodeMaterial | undefined;
  let photonSeeds: InstancedBufferAttribute;
  const pu: PhotonUniforms = createPhotonUniforms();
  let photonClock = 0;
  const rgb: [number, number, number] = [0, 0, 0];
  let thermal = 0;
  const u = createBathUniforms();
  const u0 = Math.log10(chapter.tStart);
  const u1 = Math.log10(chapter.tEnd);
  const a0 = aAt(chapter.tStart);
  let T0 = 1;
  const tmp = [0, 0, 0];

  // Rotate v by angle θ about unit axis k (Rodrigues), into out[0..2].
  const rot = (vx: number, vy: number, vz: number, kx: number, ky: number, kz: number, th: number, out: number[]) => {
    const c = Math.cos(th);
    const s = Math.sin(th);
    const d = (kx * vx + ky * vy + kz * vz) * (1 - c);
    out[0] = vx * c + (ky * vz - kz * vy) * s + kx * d;
    out[1] = vy * c + (kz * vx - kx * vz) * s + ky * d;
    out[2] = vz * c + (kx * vy - ky * vx) * s + kz * d;
  };

  const self: CosmicScene = {
    id: 'bbn',
    range: sceneRange('bbn'),
    accuracy: 'measured',
    accuracyNote: NOTE,
    colourMapped: false,

    async init(ctx: RenderContext) {
      renderer = ctx.renderer;
      scene = new Scene();
      camera = new PerspectiveCamera(params.fov, 1, 0.05, 200);
      const lu = (l: number) => u0 + (u1 - u0) * l;
      pop = buildPopulation({
        count: params.count[ctx.quality.name],
        tStart: chapter.tStart,
        tEnd: chapter.tEnd,
        radius: params.radius,
        heroLogT: [lu(params.heroLocal[0]), lu(params.heroLocal[1])],
        heroCentre: [...params.heroCentre],
        heroRadius: params.heroRadius,
        heroCount: params.heroCount,
        lithiumAt: params.lithiumAt,
        seed: 247,
        avoid: { a: [...params.camStart], b: [...params.camEnd], clear: params.cameraClear },
      });
      const n = pop.nucleons.length;

      geo = new SphereGeometry(1, params.sphereDetail[0], params.sphereDetail[1]);
      info = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
      info.setUsage(DynamicDrawUsage);
      mat = createNucleonMaterial(ctx.globals.lut, u, info);
      mesh = new InstancedMesh(geo, mat, n);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      scene.add(mesh);

      bathMat = createBathMaterial(ctx.globals.lut, u);
      bath = new Mesh(new SphereGeometry(60, 48, 32), bathMat);
      bath.frustumCulled = false;
      bath.renderOrder = -1;
      scene.add(bath);

      flashAttr = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
      flashAttr.setUsage(DynamicDrawUsage);
      flashMat = createFlashMaterial(ctx.globals.lut, u, flashAttr);
      flashes = new Sprite(flashMat);
      flashes.count = n;
      flashes.frustumCulled = false;
      flashes.renderOrder = 2;
      scene.add(flashes);
      flashAt = new Float32Array(n).fill(-1e9);

      // Gamma photons darting through the bath (the ones that split young deuterons).
      const nP = params.photonCount[ctx.quality.name];
      const prand = mulberry32(511);
      const segs = new Float32Array(nP * params.photonTrail * 4);
      for (let i = 0; i < nP; i++) {
        const r0 = Math.cbrt(prand() * 0.95 + 0.05) * params.radius * 0.8;
        const th = Math.acos(2 * fract(i * 0.618034 + 0.11) - 1);
        const ph = i * 2.39996;
        for (let m = 0; m < params.photonTrail; m++) {
          const o = (i * params.photonTrail + m) * 4;
          segs[o] = Math.sin(th) * Math.cos(ph) * r0;
          segs[o + 1] = Math.cos(th) * r0;
          segs[o + 2] = Math.sin(th) * Math.sin(ph) * r0;
          segs[o + 3] = m + fract(i * 0.7548776662 + 0.31) * 0.999;
        }
      }
      photonSeeds = new InstancedBufferAttribute(segs, 4);
      photonMat = createPhotonMaterial(pu, photonSeeds, params.photonTrail);
      photonGeo = new PlaneGeometry(1, 1);
      const photons = new Mesh(photonGeo, photonMat);
      photons.count = nP * params.photonTrail;
      photons.frustumCulled = false;
      photons.renderOrder = 3;
      scene.add(photons);

      if (ctx.quality.name !== 'low') {
        msaa = new RenderTarget(1, 1, { samples: 4, type: HalfFloatType, depthBuffer: true });
        blitMat = new MeshBasicNodeMaterial();
        blitMat.colorNode = texture(msaa.texture, uv());
        blitQuad = new Mesh(new PlaneGeometry(2, 2), blitMat);
        blitQuad.frustumCulled = false;
        blitScene = new Scene();
        blitScene.add(blitQuad);
      }

      const c = (hex: number) => {
        const r = ((hex >> 16) & 255) / 255;
        const g = ((hex >> 8) & 255) / 255;
        const b = (hex & 255) / 255;
        const lin = (x: number) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
        return [lin(r), lin(g), lin(b)] as const;
      };
      u.proton.value.set(...c(params.protonHex));
      u.neutron.value.set(...c(params.neutronHex));
      u.key.value.set(params.keyIntensity, params.keyIntensity * 0.95, params.keyIntensity * 0.88);
      u.flash.value = params.flash;
      T0 = 0;
      self.update(0, globalsAt(chapter.tStart), 0, 0); // fill the instance buffers before compiling
      await renderer.compileAsync(scene, camera);
    },

    update(_local: number, g: Globals, dt: number, elapsed: number) {
      const P = params;
      const uT = Math.min(u1, Math.max(u0, g.log10t));
      const local = (uT - u0) / (u1 - u0); // from g, so the outgoing frame (g at 1200 s) is exactly the end
      if (!T0) T0 = g.T;
      const vth = Math.sqrt(Math.max(g.T, 1) / T0);
      thermal += dt * P.jitterSpeed * vth;
      const tt = thermal;
      const s = Math.pow(aAt(10 ** uT) / a0, P.expansionPower);
      const r = P.nucleonRadius;
      const forward = Number.isFinite(prevU) && uT > prevU;

      // Bottleneck: transient bonds fade out as deuterium starts to survive (bound fraction from the model).
      const flirtW = 1 - smoothstep(0.03, 0.22, local);

      const m = mesh.instanceMatrix.array as Float32Array;
      const inf = info.array as Float32Array;
      const fl = flashAttr.array as Float32Array;
      const nucs = pop.nucleons;

      // Free-state position of nucleon i (expanded home + thermal jitter).
      const freePos = (i: number, out: number[]) => {
        const q = nucs[i]!;
        out[0] = q.hx * s + P.jitter * Math.sin(q.fr[0] * tt + q.ph[0]);
        out[1] = q.hy * s + P.jitter * Math.sin(q.fr[1] * tt + q.ph[1]);
        out[2] = q.hz * s + P.jitter * Math.sin(q.fr[2] * tt + q.ph[2]);
      };
      const write = (i: number, x: number, y: number, z: number, neutron: number, flash: number, bond: number) => {
        const o = i * 16;
        m[o] = r;
        m[o + 5] = r;
        m[o + 10] = r;
        m[o + 12] = x;
        m[o + 13] = y;
        m[o + 14] = z;
        m[o + 15] = 1;
        inf[i * 4] = neutron;
        inf[i * 4 + 1] = flash;
        inf[i * 4 + 2] = bond;
        fl[i * 4] = x;
        fl[i * 4 + 1] = y;
        fl[i * 4 + 2] = z;
        fl[i * 4 + 3] = flash;
      };
      const flashOf = (i: number) => {
        const e = elapsed - flashAt[i]!;
        return e >= 0 && e < 4 ? Math.exp(-e / P.flashDecay) : 0;
      };
      const trigger = (i: number) => {
        flashAt[i] = elapsed;
      };
      const crossed = (at: number) => forward && prevU < at && uT >= at;

      // Groups.
      const p = [0, 0, 0];
      for (const grp of pop.groups) {
        const gx = grp.cx * s + 0.12 * Math.sin(0.4 * tt + grp.flirt * 6.3);
        const gy = grp.cy * s + 0.12 * Math.sin(0.33 * tt + grp.flirt * 4.1);
        const gz = grp.cz * s + 0.12 * Math.sin(0.37 * tt + grp.flirt * 2.7);
        const approach = smoothstep(grp.logBond - P.approachDex, grp.logBond, uT);
        const bonded = uT >= grp.logBond ? 1 : 0;
        const merge = grp.kind === 'helium' ? smoothstep(grp.logForm - P.mergeDex, grp.logForm, uT) : bonded;
        const th = grp.spin * tt;
        if (crossed(grp.logBond) || (grp.kind === 'helium' && crossed(grp.logForm))) for (const i of grp.members) trigger(i);
        const slots = SLOTS[grp.kind];
        grp.members.forEach((i, slot) => {
          freePos(i, p);
          let x = p[0]!;
          let y = p[1]!;
          let z = p[2]!;
          // Deuteron stage (helium groups): pairs (0,1) and (2,3) sit side by side, 3.2 r apart.
          if (grp.kind === 'helium') {
            const pair = slot < 2 ? 0 : 1;
            const side = slot % 2 === 0 ? -1 : 1;
            rot((pair ? -1.6 : 1.6) + side * 0.92 * 0.35, side * 0.92 * 0.94, 0, grp.ax, grp.ay, grp.az, th * 0.6, tmp);
            const dx = gx + tmp[0]! * r;
            const dy = gy + tmp[1]! * r;
            const dz = gz + tmp[2]! * r;
            // Bottleneck flicker: before bonding, each p–n pair keeps meeting and being split by a gamma ray.
            if (approach < 1 && flirtW > 0) {
              const ph = (elapsed * P.flirtRate + grp.flirt + pair * 0.5) % 1;
              const pulse = ph < P.flirtDuty ? Math.sin((ph / P.flirtDuty) * Math.PI) : 0;
              const k = pulse * flirtW * (1 - approach) * 0.85;
              x += (dx - x) * k;
              y += (dy - y) * k;
              z += (dz - z) * k;
              const hit = ph > P.flirtDuty * 0.82 && ph < P.flirtDuty ? flirtW * (1 - approach) : 0;
              if (hit > 0 && flashAt[i]! < elapsed - 1) flashAt[i] = elapsed - 0.12;
            }
            x += (dx - x) * approach;
            y += (dy - y) * approach;
            z += (dz - z) * approach;
          } else {
            const o = slots[slot]!;
            rot(o[0] * 1.8, o[1] * 1.8, o[2] * 1.8, grp.ax, grp.ay, grp.az, th, tmp);
            x += (gx + tmp[0]! * r - x) * approach * 0.6;
            y += (gy + tmp[1]! * r - y) * approach * 0.6;
            z += (gz + tmp[2]! * r - z) * approach * 0.6;
          }
          // Bound nucleus: compact cluster, tumbling.
          if (merge > 0) {
            const o = slots[slot]!;
            rot(o[0], o[1], o[2], grp.ax, grp.ay, grp.az, th, tmp);
            const k = merge;
            x += (gx + tmp[0]! * r - x) * k;
            y += (gy + tmp[1]! * r - y) * k;
            z += (gz + tmp[2]! * r - z) * k;
          }
          const q = nucs[i]!;
          write(i, x, y, z, q.kind === Kind.Neutron ? 1 : 0, flashOf(i), 0);
        });
      }

      // Free protons and β-decaying neutrons.
      for (let i = 0; i < nucs.length; i++) {
        const q = nucs[i]!;
        if (q.group >= 0) continue;
        freePos(i, p);
        let neutron = q.kind === Kind.Neutron ? 1 : 0;
        if (q.role === Role.Decayer) {
          neutron = 1 - smoothstep(q.logDecay - 0.004, q.logDecay + 0.004, uT);
          if (crossed(q.logDecay)) trigger(i);
        }
        write(i, p[0]!, p[1]!, p[2]!, neutron, flashOf(i), 0);
      }
      mesh.instanceMatrix.needsUpdate = true;
      info.needsUpdate = true;
      flashAttr.needsUpdate = true;
      prevU = uT;

      // Bath: blackbody colour of T, brightness on the same law as the photon-era fog, exposure ramps up at the
      // end so the last frame hands over to the fog; haze thickens with it.
      const endK = smoothstep(0.7, 1, local);
      u.logT.value = Math.log10(Math.max(g.T, 1));
      u.glow.value = P.bathRef * Math.pow(Math.max(g.T, 1) / T_REF_K, P.bathPower) * lerp(P.bathExposure[0], P.bathExposure[1], endK);
      u.haze.value = lerp(P.haze[0], P.haze[1], endK);
      u.time.value = elapsed;
      u.rim.value = P.rim;
      u.spec.value = 1;

      // Gamma photons: blackbody colour of the bath, slowing a little as it cools.
      photonClock += (dt * P.photonSpeed * Math.sqrt(vth)) / P.photonStep;
      pu.clock.value = photonClock;
      pu.step.value = P.photonStep * s;
      pu.width.value = 0.024;
      pu.sigma.value = 0.04;
      blackbodyRGB(Math.max(g.T, 1), rgb);
      const pI = P.photonGain * (1 - 0.5 * endK);
      pu.colour.value.set(rgb[0] * pI, rgb[1] * pI, rgb[2] * pI);

      // Camera: slow dolly through the cloud, scaled with the expansion so the nuclei visibly drift apart.
      const e = smoothstep(0, 1, local);
      const calm = 1 - smoothstep(0.75, 1, local);
      const sx = lerp(P.camStart[0], P.camEnd[0], e) + P.sway * calm * Math.sin(elapsed * 0.05);
      const sy = lerp(P.camStart[1], P.camEnd[1], e) + P.sway * calm * Math.sin(elapsed * 0.043 + 1);
      const sz = lerp(P.camStart[2], P.camEnd[2], e);
      camera.position.set(sx * s, sy * s, sz * s);
      const orbit = 0.18 * e;
      camera.lookAt(Math.sin(orbit) * 2 * s, 0.05 * s, (P.heroCentre[2] - 3) * s);
    },

    render(target: RenderTarget) {
      if (msaa) {
        // Many small sphere silhouettes: render multisampled, then resolve into the scene target.
        renderer.setRenderTarget(msaa);
        renderer.render(scene, camera);
        renderer.setRenderTarget(target);
        renderer.render(blitScene, blitCam);
      } else {
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
      }
    },

    resize(width: number, height: number) {
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      msaa?.setSize(Math.max(1, width), Math.max(1, height));
    },

    dispose() {
      geo?.dispose();
      mat?.dispose();
      bath?.geometry.dispose();
      bathMat?.dispose();
      flashMat?.dispose();
      mesh?.dispose();
      photonGeo?.dispose();
      photonMat?.dispose();
      msaa?.dispose();
      blitQuad?.geometry.dispose();
      blitMat?.dispose();
    },
  };
  return self;
};
