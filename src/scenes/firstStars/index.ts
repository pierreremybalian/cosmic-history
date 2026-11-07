// First stars & nebulae (HANDOFF §9.9) · modelled.
// Same universe, same camera as the dark ages: the camera dollies into the densest group of halos. Gas spirals into
// the highest peaks (colour mapped), Population III stars ignite there in order of peak height (blackbody ≈ 10⁵ K),
// their UV ionises glowing H II regions (Hα, Hβ, He II), they explode after a few (stretched) million years as
// supernovae whose shells carry new oxygen outward ([O III] teal), and enriched gas forms small clusters of
// second-generation stars with metal-line nebulae — the first small galaxies.

import { Mesh, PerspectiveCamera, Scene, SphereGeometry, Sprite, Vector3, Vector4, type MeshBasicNodeMaterial, type RenderTarget, type SpriteNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';
import type { CosmicScene, RenderContext } from '../types.ts';
import { globalsAt, type Globals } from '../../physics/cosmology.ts';
import { EMISSION_LINES_NM, lineColor } from '../../shared/color.ts';
import { webAmplitude } from '../../shared/gaussianField.ts';
import { clamp01, mulberry32, smoothstep } from '../../shared/math.ts';
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
} from '../darkAges/structure.ts';
import { cloudMaterial, clusterMaterial, ejectaMaterial, gasMaterial, nebulaMaterial, shellMaterial, starMaterial, type SiteNodes } from './shaders.ts';

const params = {
  sites: {
    max: 18,
    /** Only peaks this close to the focus host the full cycle (all in frame while the camera is close). */
    radius: 2.3,
    /**
     * Fraction that explode: 140–260 M☉ (pair-instability) and < 40 M☉ stars do; 40–140 M☉ collapse straight
     * into black holes (Heger & Woosley 2002, ApJ 567, 532). The earliest one always explodes for beat 0.5.
     */
    explodeFraction: 0.5,
    /** Ignition in order of peak height, chapter-local (beat 0.24: "the first stars ignite"). */
    igniteStart: 0.19,
    igniteEnd: 0.37,
    igniteGamma: 0.9,
    /**
     * Pop III lifetime ≈ 2–3 Myr (Schaerer 2002, A&A 382, 28); shown as ≈ 0.22 of the chapter (≈ 77 Myr), i.e.
     * stretched ~30× so the cycle can be seen. Supernovae land on beats 0.5 / 0.64.
     */
    lifetime: 0.22,
    lifetimeJitter: 0.05,
    /** Second generation forms from the enriched gas (beat 0.84). */
    popIIStart: 0.64,
    popIISpread: 0.2,
    popIIDelayAfterSN: 0.14,
    seed: 9,
  },
  popIII: {
    /**
     * Effective temperature of a ~100 M☉ zero-metallicity star on the main sequence: ≈ 10⁵ K
     * (Bromm, Kudritzki & Loeb 2001, ApJ 552, 464; Schaerer 2002). Colour from the blackbody LUT.
     */
    tempK: 1.0e5,
    size: 0.42,
    peak: 7,
    flash: 9,
    flashTau: 0.016,
  },
  gas: {
    /** Particles per site = clamp(tier particles / perSiteDivisor, min, max). */
    perSiteDivisor: 900,
    perSiteMin: 64,
    perSiteMax: 480,
    radius: 0.5,
    size: 0.011,
    infall: 0.13,
    peak: 1.0,
    /** Collapsing cloud impostor (world radius at the start of infall). */
    cloudRadius: 0.26,
    cloudPeak: 0.24,
  },
  nebula: {
    /** World radius (≈ 190 kpc proper at z ≈ 15 vs ~3 kpc real: ~60× larger, stated in the note). */
    radius: 0.2,
    growth: 0.05,
    noiseScale: 3.2,
    peak: 0.55,
  },
  lines: {
    /** Case B recombination Hα/Hβ = 2.86 (Osterbrock & Ferland 2006). */
    balmerDecrement: 2.86,
    /** He II λ468.6 nm relative to Hα: strong only for very hot, metal-free stars (Schaerer 2003, A&A 397, 527). */
    heIINm: 468.6,
    heII: 0.22,
    /** Low-metallicity star-forming regions: [O III] λ500.7 strong, [S II] weak at the front. */
    oIII: 1.1,
    sII: 0.25,
  },
  shell: {
    /** World radius at the end (≈ 280 kpc vs ~1–2 kpc real for a Pop III supernova remnant). */
    rMax: 0.3,
    duration: 0.24,
    /** Sedov–Taylor blast wave R ∝ t^(2/5) (Sedov 1959; Taylor 1950). */
    sedovExponent: 0.4,
    peak: 1.3,
    /** Ejecta knots per supernova = clamp(tier particles / divisor, min, max). */
    ejectaDivisor: 2000,
    ejectaMin: 48,
    ejectaMax: 240,
    ejectaSize: 0.013,
    ejectaPeak: 1.2,
    /** Shocked gas starts hot: blackbody at ~3×10⁴ K for the flash colour. */
    hotTempK: 3.0e4,
  },
  popII: {
    perSite: 14,
    /** Second-generation stars: a spread of main-sequence temperatures, ≈ 5 500–25 000 K. */
    tempMinK: 5500,
    tempMaxK: 25000,
    radius: 0.22,
    size: 0.07,
    peak: 3.2,
  },
  web: {
    brightness: [
      [0, 1.0],
      [0.2, 0.62],
      [0.4, 0.3],
      [1, 0.26],
    ] as [number, number][],
    contrast: 0.72,
    size: 0.55,
  },
  haze: {
    brightness: [
      [0, 0.05],
      [0.4, 0.028],
      [1, 0.024],
    ] as [number, number][],
    stepFraction: 0.5,
  },
  halos: {
    maxSeeds: 64,
    size: 0.42,
    peak: 1.5,
    onset: 1.8,
    width: 0.12,
    /** Halos without a star in view dim as the camera closes in (they are the backdrop now). */
    backdrop: 0.3,
  },
};

export default (): CosmicScene => {
  let renderer: WebGPURenderer;
  let scene: Scene;
  let camera: PerspectiveCamera;
  let web: StructureWeb;
  let haze: Mesh;
  let halos: Sprite;
  let seeds: HaloSeeds;
  let field: RenderContext['field'];
  const sprites: Sprite[] = [];
  const haloData: Vector4[] = Array.from({ length: params.halos.maxSeeds }, () => new Vector4());
  const siteA: Vector4[] = Array.from({ length: params.sites.max }, () => new Vector4());
  const siteB: Vector4[] = Array.from({ length: params.sites.max }, () => new Vector4());
  const siteC: Vector4[] = Array.from({ length: params.sites.max }, () => new Vector4());
  /** For each halo seed, its site index (or −1). */
  let haloSite: Int32Array = new Int32Array(0);
  let sites: HaloSeeds;
  let nSites = 0;

  const uA = uniform(0.36);
  const uHaze = uniform(0);
  const uL = uniform(0);
  const uRef = uniform(3);
  const nodes = {} as SiteNodes;
  const uRight = uniform(new Vector3(1, 0, 0));
  const uUp = uniform(new Vector3(0, 1, 0));
  const uFwd = uniform(new Vector3(0, 0, 1));

  const self: CosmicScene = {
    id: 'firstStars',
    range: sceneRange('firstStars'),
    accuracy: 'modelled',
    accuracyNote:
      'Population III stars (blackbody ≈ 100,000 K) ignite in the densest halos of the same simulated web, but only the 18 highest peaks in view host them, their few-million-year lives are stretched ~30×, nebulae and blast shells are drawn ~50–200× larger than life, dark matter and gas are colour mapped, and the nebula colours are the real emission lines at rest (in reality redshifted into the infrared).',
    colourMapped: true,

    async init(ctx: RenderContext) {
      renderer = ctx.renderer;
      field = ctx.field;
      await ctx.field.ready;
      scene = new Scene();
      camera = new PerspectiveCamera(STRUCTURE.fov, 1, 0.03, 300);

      const shift = focusShift(ctx.field, new Vector3());
      web = createStructureWeb(ctx, shift, {});
      web.uniforms.colourMap.value = 1;
      web.uniforms.size.value = params.web.size;
      web.uniforms.contrast.value = params.web.contrast;
      scene.add(web.object);

      const steps = Math.max(12, Math.round(ctx.quality.raymarchSteps * params.haze.stepFraction));
      haze = new Mesh(new SphereGeometry(STRUCTURE.ballRadius, 48, 24), hazeMaterial(fieldNodes(ctx.field, shift), uA, uHaze, steps));
      haze.renderOrder = -5;
      haze.frustumCulled = false;
      scene.add(haze);

      seeds = new HaloSeeds(ctx.field, shift, params.halos.maxSeeds);
      const hm = params.halos;
      halos = new Sprite(haloMaterial(uniformArray(haloData, 'vec4'), uniform(hm.size), uniform(hm.peak)));
      halos.count = Math.max(1, seeds.count);
      sprites.push(halos);

      // Site schedule (CPU, deterministic): ignition by rank = peak height.
      const ps = params.sites;
      sites = new HaloSeeds(ctx.field, shift, ps.max, ps.radius);
      nSites = sites.count;
      haloSite = new Int32Array(seeds.count).fill(-1);
      for (let k = 0; k < seeds.count; k++) haloSite[k] = sites.peakIndex.indexOf(seeds.peakIndex[k]!);
      const rand = mulberry32(ps.seed);
      let earliest = 0;
      for (let k = 0; k < ps.max; k++) {
        if (k >= nSites) {
          siteB[k]!.set(2, 2, 2, 0);
          siteC[k]!.set(0, 0, 0, 0);
          continue;
        }
        const frac = nSites > 1 ? k / (nSites - 1) : 0;
        const tIgn = ps.igniteStart + (ps.igniteEnd - ps.igniteStart) * Math.pow(frac, ps.igniteGamma);
        const tSn = tIgn + ps.lifetime + (rand() - 0.5) * ps.lifetimeJitter;
        const tPop2 = Math.max(ps.popIIStart + ps.popIISpread * frac, tSn + ps.popIIDelayAfterSN);
        const nu = sites.pos[k * 4 + 3]!;
        const w = clamp01((nu - sites.nuMin) / Math.max(1e-3, sites.nuMax - sites.nuMin));
        siteB[k]!.set(tIgn, tSn, tPop2, w);
        siteC[k]!.set(rand() < ps.explodeFraction ? 1 : 0, rand(), 0, 0);
        if (tSn < siteB[earliest]!.y) earliest = k;
      }
      if (nSites) siteC[earliest]!.x = 1;
      Object.assign(nodes, {
        A: uniformArray(siteA, 'vec4'),
        B: uniformArray(siteB, 'vec4'),
        C: uniformArray(siteC, 'vec4'),
        uRef,
        uL,
        uTime: ctx.globals.uElapsed,
        uRight,
        uUp,
        uFwd,
      });

      const L = params.lines;
      const col = (nm: number, k: number) => uniform(lineColor(nm).multiplyScalar(k));
      const lines = {
        hAlpha: col(EMISSION_LINES_NM.hAlpha, 1),
        hBeta: col(EMISSION_LINES_NM.hBeta, 1 / L.balmerDecrement),
        heII: col(L.heIINm, L.heII),
        oIII: col(EMISSION_LINES_NM.oIII, L.oIII),
        sII: col(EMISSION_LINES_NM.sII, L.sII),
      };

      const g = params.gas;
      const perSite = Math.round(Math.min(g.perSiteMax, Math.max(g.perSiteMin, ctx.quality.particles / g.perSiteDivisor)));
      const gas = new Sprite(gasMaterial(nodes, perSite, { uR: uniform(g.radius), uSize: uniform(g.size), uInfall: uniform(g.infall), uPeak: uniform(g.peak) }));
      gas.count = Math.max(1, nSites * perSite);
      const clouds = new Sprite(cloudMaterial(nodes, { uR: uniform(g.cloudRadius), uInfall: uniform(g.infall), uPeak: uniform(g.cloudPeak) }));
      clouds.count = Math.max(1, nSites);

      const n = params.nebula;
      const nebulae = new Sprite(nebulaMaterial(nodes, lines, { uR: uniform(n.radius), uPeak: uniform(n.peak), uGrow: uniform(n.growth), uNoise: uniform(n.noiseScale) }));
      nebulae.count = Math.max(1, nSites);

      const sh = params.shell;
      const shells = new Sprite(
        shellMaterial(nodes, ctx.globals.lut, lines, {
          uRmax: uniform(sh.rMax),
          uDur: uniform(sh.duration),
          uSedov: uniform(sh.sedovExponent),
          uPeak: uniform(sh.peak),
          uLogTHot: uniform(Math.log10(sh.hotTempK)),
        }),
      );
      shells.count = Math.max(1, nSites);
      const perSN = Math.round(Math.min(sh.ejectaMax, Math.max(sh.ejectaMin, ctx.quality.particles / sh.ejectaDivisor)));
      const ejecta = new Sprite(
        ejectaMaterial(nodes, lines, perSN, {
          uRmax: uniform(sh.rMax),
          uDur: uniform(sh.duration),
          uSedov: uniform(sh.sedovExponent),
          uSize: uniform(sh.ejectaSize),
          uPeak: uniform(sh.ejectaPeak),
        }),
      );
      ejecta.count = Math.max(1, nSites * perSN);

      const p3 = params.popIII;
      const stars = new Sprite(
        starMaterial(nodes, ctx.globals.lut, {
          uLogT: uniform(Math.log10(p3.tempK)),
          uSize: uniform(p3.size),
          uPeak: uniform(p3.peak),
          uFlash: uniform(p3.flash),
          uFlashTau: uniform(p3.flashTau),
        }),
      );
      stars.count = Math.max(1, nSites);

      const p2 = params.popII;
      const clusters = new Sprite(
        clusterMaterial(nodes, ctx.globals.lut, p2.perSite, {
          uLogTMin: uniform(Math.log10(p2.tempMinK)),
          uLogTMax: uniform(Math.log10(p2.tempMaxK)),
          uR: uniform(p2.radius),
          uSize: uniform(p2.size),
          uPeak: uniform(p2.peak),
        }),
      );
      clusters.count = Math.max(1, nSites * p2.perSite);

      sprites.push(clouds, gas, nebulae, shells, ejecta, clusters, stars);
      sprites.forEach((s, i) => {
        s.frustumCulled = false;
        s.renderOrder = 2 + i;
        scene.add(s);
      });

      self.update(0, globalsAt(self.range[0]), 0, 0);
      await renderer.compileAsync(scene, camera);
    },

    update(local: number, g: Globals, _dt: number, elapsed: number) {
      const l = clamp01(local);
      const A = webAmplitude(g.a);
      uL.value = l;
      uA.value = A;
      const u = web.uniforms;
      u.amplitude.value = A;
      u.brightness.value = ramp(params.web.brightness, l);
      uHaze.value = ramp(params.haze.brightness, l);

      seeds.update(A);
      const nuC = collapseNu(field, A);
      const hm = params.halos;
      for (let k = 0; k < hm.maxSeeds; k++) {
        if (k >= seeds.count) {
          haloData[k]!.set(0, 0, 0, 0);
          continue;
        }
        let w = Math.pow(smoothstep(nuC - hm.onset, nuC + hm.width, seeds.pos[k * 4 + 3]!), 1.5);
        // A halo's dark-matter glow hands over to its star.
        const si = haloSite[k]!;
        if (si >= 0) w *= 1 - 0.85 * smoothstep(siteB[si]!.x - 0.06, siteB[si]!.x + 0.04, l);
        else w *= 1 - (1 - hm.backdrop) * smoothstep(0.08, 0.3, l);
        seeds.write(k, haloData[k]!, w);
      }
      sites.update(A);
      for (let k = 0; k < nSites; k++) sites.write(k, siteA[k]!, sites.pos[k * 4 + 3]!);

      const dist = applyStructureCamera(camera, ORDINAL.firstStars + l, elapsed);
      web.refDist.value = 0.8 * dist;
      uRef.value = 0.8 * dist;
      const e = camera.matrixWorld.elements;
      uRight.value.set(e[0]!, e[1]!, e[2]!);
      uUp.value.set(e[4]!, e[5]!, e[6]!);
      uFwd.value.set(e[8]!, e[9]!, e[10]!);
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
      for (const s of sprites) (s.material as SpriteNodeMaterial).dispose();
      sprites.length = 0;
    },
  };
  return self;
};
