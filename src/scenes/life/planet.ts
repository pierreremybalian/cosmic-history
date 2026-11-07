// A rocky planet with an ocean, continents, ice, clouds, a lava/crust mode and a single-scattering atmosphere
// (Rayleigh + Mie + an absorbing haze), all in TSL. Shared by the solarSystem and life scenes (and usable by
// `now`). Every physical number arrives through uniforms set from the scenes' params objects (§13.2).
//
// Frames: the planet group sits at `centre` (world) with radius `radius`. Surface patterns live in the
// planet's local frame (positionLocal on a unit sphere) so rotating the surface mesh spins the world.
// The atmosphere is spherically symmetric and lives in world space.

import {
  AdditiveBlending,
  Color,
  CustomBlending,
  FrontSide,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  SphereGeometry,
  Sprite,
  SpriteNodeMaterial,
  Vector3,
  Vector4,
  InstancedBufferAttribute,
  type DataTexture,
  type Texture,
} from 'three/webgpu';
import {
  Fn,
  If,
  Loop,
  abs,
  asin,
  atan,
  cameraPosition,
  clamp,
  cross,
  dot,
  exp,
  exp2,
  float,
  fract,
  fwidth,
  instancedBufferAttribute,
  length,
  log2,
  max,
  min,
  mix,
  mx_noise_float,
  mx_worley_noise_vec2,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  screenCoordinate,
  select,
  smoothstep,
  sqrt,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { blackbodyNode } from '../../render/globals.ts';
import { fbm } from '../../shared/noise.ts';
import { mulberry32 } from '../../shared/math.ts';
import { blackbodyRGB } from '../../physics/blackbody.ts';
import type { QualityTier } from '../../render/quality.ts';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;
type V4 = Node<'vec4'>;

const mkF = (v = 0) => uniform(v);
const mkV3 = (x = 0, y = 0, z = 0) => uniform(new Vector3(x, y, z));
const mkV4 = () => uniform(new Vector4(0, 0, 0, 1));
const mkC = (r = 0, g = 0, b = 0) => uniform(new Color(r, g, b));
type FU = ReturnType<typeof mkF>;
type V3U = ReturnType<typeof mkV3>;
type V4U = ReturnType<typeof mkV4>;
type CU = ReturnType<typeof mkC>;

/** Earth's mean radius, m (sets the physical scale of the atmosphere). */
export const EARTH_RADIUS_M = 6.371e6;

/** Physical inputs for the atmosphere, in SI. The scene converts with `atmosphereUniformValues`. */
export interface AtmosphereSpec {
  /** Rayleigh scattering at sea level (1/m) at 680, 550, 440 nm. */
  rayleigh: [number, number, number];
  rayleighScaleHeightM: number;
  /** Mie (aerosol) scattering at sea level (1/m); extinction = 1.11 × scattering. */
  mie: number;
  mieScaleHeightM: number;
  mieG: number;
  /** Absorbing haze (organic haze, soot, dust): extinction per channel (1/m) and single-scattering albedo. */
  haze: [number, number, number];
  hazeAlbedo: number;
  hazeScaleHeightM: number;
  /** Ozone-like absorption (1/m at sea-level density), following the Rayleigh profile. */
  ozone: [number, number, number];
  /** Visual exaggeration of scale heights (column optical depth is preserved). */
  exaggeration: number;
}

const NOISE_PLATES = 5;
/** Cloud deck height (radius units), exaggerated ~10× so the layer reads from orbit. */
export const CLOUD_ALTITUDE = 0.008;
const REAL_PLATES = 8;

export interface PlanetUniforms {
  centre: V3U;
  radius: FU;
  sunDir: V3U; // world, unit, planet → sun
  sunColour: CU;
  sunIntensity: FU;
  time: FU; // idle seconds (clouds, waves)
  // Atmosphere (per world unit; see atmosphereUniformValues)
  betaR: V3U;
  hR: FU;
  betaM: FU;
  hM: FU;
  mieG: FU;
  haze: V3U;
  hazeAlbedo: FU;
  hH: FU;
  ozone: V3U;
  atmoTop: FU; // atmosphere thickness / radius
  atmoGain: FU; // overall in-scatter multiplier (1 = physical)
  // Surface: oceans and land
  seaLevel: FU; // added to the land threshold (positive floods land)
  crust: FU; // continental crust: 0 = a few islands, 1 = modern continents (noise plates)
  realPlates: FU; // 0 = noise plates, 1 = real geography
  oceanDeep: CU;
  oceanShallow: CU;
  oceanLife: FU; // microbial bloom tint amount
  bloomColour: CU;
  shelfTint: FU; // turquoise carbonate shelves (reefs)
  rockA: CU;
  rockB: CU;
  rust: FU; // red beds after oxygenation
  rustColour: CU;
  landLife: FU; // 0 barren → 1 modern vegetation
  greenColour: CU; // early land plants, noise plates
  // Ice
  iceEdge: FU; // |sin(lat)| above which permanent ice sits (1 = none)
  iceEdgeNorthLand: FU; // extra NH land ice sheets (glacials); 1 = none
  snowball: FU; // 0..1 global ice
  photoIce: FU; // Antarctic ice sheet (real geography) 0..1
  northIce: FU; // photo ice elsewhere: Greenland, high mountains 0..1
  // Clouds
  cloudCover: FU;
  cloudOpacity: FU;
  cloudColour: CU;
  cloudShadow: FU;
  cloudRel: V4U; // rotation surface-local → cloud-local
  cloudScale: FU;
  // Lava / crust (molten young Earth)
  lava: FU; // 0 off → 1 on (gates the cost)
  lavaLogT: FU; // log10 K of the hottest exposed melt
  crustCover: FU; // 0 fully molten → 1 solid crust
  crackWidth: FU;
  glowGain: FU;
  lavaRefK: FU; // temperature (K) whose glow is ≈ 1 (exposure)
  displace: FU; // vertex displacement amplitude (radius units)
  hotspots: FU; // scattered volcanic glows (Hadean)
  // Events
  impactDir: V3U; // planet-local unit vector
  impactFlash: FU;
  impactAge: FU; // 0..1 after impact (ring expansion)
  soot: FU; // global darkening of sky + surface
  ambient: FU;
  // Plate rotations (quaternions: current-frame position → plate's present-day frame)
  noisePlates: V4U[];
  plates: V4U[];
}

export interface PlanetOptions {
  quality: QualityTier;
  lut: DataTexture;
  /** Real geography (life scene): land colour + two RGBA plate masks. Omit for a noise-only planet. */
  geography?: { colour?: Texture; platesA?: Texture; platesB?: Texture; clouds?: Texture } | null;
  atmosphere?: boolean;
  clouds?: boolean;
}

export interface Planet {
  group: Group;
  surface: Mesh;
  clouds: Mesh | null;
  atmosphere: Mesh | null;
  u: PlanetUniforms;
  setAtmosphere(spec: AtmosphereSpec): void;
  dispose(): void;
}

// ── TSL helpers ─────────────────────────────────────────────────────────────────

/** Rotate v by unit quaternion q (xyz, w). */
export function qrot(q: V4, v: V3): V3 {
  const t = cross(q.xyz, v).mul(2);
  return v.add(t.mul(q.w)).add(cross(q.xyz, t));
}

/**
 * Schüler's approximation of the Chapman grazing-incidence function (GPU Pro 3), in units of the 50 % height:
 * the column ∫ 2^(−alt/H50) ds / H50 from altitude h along a ray with zenith cosine c. X = R / H50.
 */
function chapman(X: F, h: F, c: F): F {
  const cc = sqrt(X.add(h));
  const up = cc.div(cc.mul(c).add(1)).mul(exp2(h.negate()));
  const x0 = sqrt(max(float(1).sub(c.mul(c)), 0)).mul(X.add(h));
  const c0 = sqrt(x0);
  const down = c0.mul(2).mul(exp2(min(X.sub(x0), 80))).sub(cc.div(float(1).sub(cc.mul(c))).mul(exp2(h.negate())));
  return select(c.greaterThanEqual(0), up, down);
}

/** Equirectangular uv for a unit direction (lon = atan2(x, z), lat = asin(y)); v = 1 at the north pole. */
function dirToUv(q: V3): V2 {
  const lon = atan(q.x, q.z);
  const lat = asin(clamp(q.y, -1, 1));
  return vec2(lon.div(Math.PI * 2).add(0.5), lat.div(Math.PI).add(0.5));
}

const LN2 = Math.LN2;

// ── Atmosphere unit conversion ─────────────────────────────────────────────────

/** Convert an SI atmosphere spec into per-world-unit uniform values for a planet of radius `radius` world units. */
export function setAtmosphereUniforms(u: PlanetUniforms, spec: AtmosphereSpec, radiusWorld: number): void {
  const k = (EARTH_RADIUS_M / radiusWorld) / spec.exaggeration; // (1/m) → (1/world unit), column-preserving
  const h = (m: number) => (m / EARTH_RADIUS_M) * radiusWorld * spec.exaggeration;
  u.betaR.value.set(spec.rayleigh[0] * k, spec.rayleigh[1] * k, spec.rayleigh[2] * k);
  u.hR.value = h(spec.rayleighScaleHeightM);
  u.betaM.value = spec.mie * k;
  u.hM.value = h(spec.mieScaleHeightM);
  u.mieG.value = spec.mieG;
  u.haze.value.set(spec.haze[0] * k, spec.haze[1] * k, spec.haze[2] * k);
  u.hazeAlbedo.value = spec.hazeAlbedo;
  u.hH.value = h(spec.hazeScaleHeightM);
  u.ozone.value.set(spec.ozone[0] * k, spec.ozone[1] * k, spec.ozone[2] * k);
  // Top of the atmosphere: ~7 Rayleigh scale heights (relative to the radius).
  u.atmoTop.value = Math.max(u.hR.value * 7, u.hH.value * 5) / radiusWorld;
}

// ── The planet ──────────────────────────────────────────────────────────────────

export function createPlanet(o: PlanetOptions): Planet {
  const q = o.quality;
  const lowQ = q.name === 'low';
  const u: PlanetUniforms = {
    centre: mkV3(),
    radius: mkF(1),
    sunDir: mkV3(1, 0, 0),
    sunColour: mkC(1, 1, 1),
    sunIntensity: mkF(1),
    time: mkF(0),
    betaR: mkV3(),
    hR: mkF(0.003),
    betaM: mkF(0),
    hM: mkF(0.0005),
    mieG: mkF(0.76),
    haze: mkV3(),
    hazeAlbedo: mkF(0.8),
    hH: mkF(0.004),
    ozone: mkV3(),
    atmoTop: mkF(0.025),
    atmoGain: mkF(1),
    seaLevel: mkF(0),
    crust: mkF(1),
    realPlates: mkF(0),
    oceanDeep: mkC(0.005, 0.02, 0.06),
    oceanShallow: mkC(0.02, 0.1, 0.14),
    oceanLife: mkF(0),
    bloomColour: mkC(0.03, 0.12, 0.06),
    shelfTint: mkF(0),
    rockA: mkC(0.09, 0.085, 0.08),
    rockB: mkC(0.2, 0.17, 0.14),
    rust: mkF(0),
    rustColour: mkC(0.32, 0.14, 0.07),
    landLife: mkF(0),
    greenColour: mkC(0.06, 0.12, 0.04),
    iceEdge: mkF(1),
    iceEdgeNorthLand: mkF(1),
    snowball: mkF(0),
    photoIce: mkF(1),
    northIce: mkF(1),
    cloudCover: mkF(0.5),
    cloudOpacity: mkF(1),
    cloudColour: mkC(1, 1, 1),
    cloudShadow: mkF(0.5),
    cloudRel: mkV4(),
    cloudScale: mkF(1),
    lava: mkF(0),
    lavaLogT: mkF(3.3),
    crustCover: mkF(0),
    crackWidth: mkF(0.08),
    glowGain: mkF(1),
    lavaRefK: mkF(1500),
    displace: mkF(0),
    hotspots: mkF(0),
    impactDir: mkV3(0, 0, 1),
    impactFlash: mkF(0),
    impactAge: mkF(0),
    soot: mkF(0),
    ambient: mkF(0.02),
    noisePlates: Array.from({ length: NOISE_PLATES }, mkV4),
    plates: Array.from({ length: REAL_PLATES }, mkV4),
  };

  const group = new Group();
  const segW = lowQ ? 128 : q.name === 'medium' ? 192 : 256;
  const surfaceGeo = new SphereGeometry(1, segW, segW / 2);

  // ── shared field functions ──
  const coastOct = lowQ ? 2 : 3;
  const plateOct = lowQ ? 2 : q.name === 'high' ? 4 : 3;

  /** Signed "elevation" of noise-plate continents at local direction p (> 0 above sea level). */
  const noiseLand = (p: V3): F => {
    const rand = mulberry32(7);
    let h: F = float(-1);
    for (let k = 0; k < NOISE_PLATES; k++) {
      const qk = qrot(u.noisePlates[k]!, p);
      const cx = rand() * 2 - 1;
      const cy = (rand() * 2 - 1) * 0.7;
      const cz = rand() * 2 - 1;
      const cl = Math.hypot(cx, cy, cz);
      const capDir = vec3(cx / cl, cy / cl, cz / cl);
      const capCos = Math.cos(0.42 + rand() * 0.28);
      const n = fbm(qk.mul(1.7 + rand() * 0.6).add(vec3(k * 7.1, k * 3.3, k * 5.7)), plateOct);
      const cap = dot(qk, capDir).sub(capCos).mul(2.2);
      h = max(h, n.mul(0.9).add(cap));
    }
    // Crust growth: few islands early, broad continents late.
    return h.sub(mix(float(0.55), float(0.05), u.crust));
  };

  /** Procedural cloud density (0..1) at cloud-local direction c (used without a cloud map). */
  const proceduralClouds = (c: V3, octaves: number): F => {
    const t = u.time;
    const lat = c.y;
    // Zonal structure: ITCZ, subtropical clear belts, mid-latitude storm tracks.
    const band = float(0.62)
      .add(exp(lat.mul(lat).mul(-180)).mul(0.22))
      .sub(exp(lat.sub(0.45).mul(lat.sub(0.45)).mul(-40)).mul(0.22))
      .sub(exp(lat.add(0.45).mul(lat.add(0.45)).mul(-40)).mul(0.22))
      .add(exp(lat.abs().sub(0.8).mul(lat.abs().sub(0.8)).mul(-30)).mul(0.12));
    // Zonal shear: features stretch east–west (higher frequency across latitude).
    const p = c.mul(u.cloudScale.mul(2.6)).mul(vec3(1, 1.4, 1));
    const w1 = vec3(
      mx_noise_float(p.add(vec3(0, t.mul(0.012), 0))),
      mx_noise_float(p.add(vec3(5.2, 1.3, t.mul(0.01)))),
      mx_noise_float(p.add(vec3(t.mul(0.009), 9.1, 2.7))),
    );
    const qq = p.add(w1.mul(0.35));
    const base = fbm(qq.mul(1.6).add(vec3(t.mul(0.003), 0, 0)), octaves, 2.1, 0.55);
    const detail = fbm(qq.mul(11.0).add(vec3(3.3, t.mul(0.01), 1.1)), lowQ ? 2 : 3);
    const v = base.mul(1.4).add(detail.mul(0.3)).add(0.5);
    const cov = u.cloudCover.mul(band.mul(1.4));
    const th = float(1).sub(cov);
    return smoothstep(th, th.add(0.4), v).pow(1.6);
  };

  /** Cloud density (0..1) at cloud-local direction c: the NASA Blue Marble cloud map when given. */
  const cloudMap = o.geography?.clouds ?? null;
  const cloudField = (c: V3, octaves: number): F => {
    if (!cloudMap) return proceduralClouds(c, octaves);
    const t = u.time;
    // Slow boiling: a small, time-varying warp of the lookup.
    const wob = vec3(mx_noise_float(c.mul(5.0).add(vec3(0, t.mul(0.02), 0))), mx_noise_float(c.mul(5.0).add(vec3(7.1, 0, t.mul(0.02)))), float(0)).mul(0.004);
    const st = dirToUv(normalize(c.add(wob)));
    const lod = log2(max(length(fwidth(c)).mul(2048 / (Math.PI * 2)), 1e-4)).sub(0.5);
    const raw = texture(cloudMap).sample(st).level(lod).r.toVar();
    // Poles are blank in the map: break them up procedurally.
    const polar = smoothstep(0.88, 0.95, abs(c.y));
    If(polar.greaterThan(0.001), () => {
      raw.assign(mix(raw, proceduralClouds(c, 3).mul(0.8), polar));
    });
    // Coverage: 0.56 ≈ the map as observed; more → thicker, fewer → only the densest systems remain.
    const k = u.cloudCover.sub(0.56).mul(1.6);
    const lo = k.negate().max(-0.9).add(0.07); // 0.07: drop the faint veil left by differencing two products
    const d = clamp(raw.sub(lo).div(float(1).sub(lo).max(0.05)), 0, 1);
    return d.pow(float(1.15).sub(k.mul(0.3)).max(0.4));
  };

  // ── Surface material ──
  const surfaceMat = new MeshBasicNodeMaterial();
  const geo = o.geography ?? null;
  const tColour = geo?.colour ? texture(geo.colour) : null;
  const tA = geo?.platesA ? texture(geo.platesA) : null;
  const tB = geo?.platesB ? texture(geo.platesB) : null;

  // Vertex displacement (molten / cratered young Earth). Pattern frame = local unit sphere.
  const pLocal = positionLocal.normalize();
  const dispN = fbm(pLocal.mul(3.5), 3).mul(u.displace);
  surfaceMat.positionNode = positionLocal.mul(float(1).add(dispN));

  surfaceMat.colorNode = Fn(() => {
    const P = positionLocal.normalize().toVar();
    const Nw = normalize(positionWorld.sub(u.centre)).toVar();
    const S = u.sunDir;
    const V = normalize(cameraPosition.sub(positionWorld));

    // ── continents ──
    const hN = float(-1).toVar();
    If(u.realPlates.lessThan(0.999), () => {
      hN.assign(noiseLand(P));
    });
    const hR = float(-1).toVar();
    const photo = vec3(0).toVar();
    const antarctic = float(0).toVar();
    if (tColour && tA && tB) {
      If(u.realPlates.greaterThan(0.001), () => {
        const sum = float(0).toVar();
        const wsum = float(0).toVar();
        const colAcc = vec3(0).toVar();
        // Mip level from the continuous direction derivative (avoids the atan seam).
        const lod = log2(max(length(fwidth(P)).mul(2048 / (Math.PI * 2)), 1e-4));
        for (let i = 0; i < REAL_PLATES; i++) {
          const qp = qrot(u.plates[i]!, P);
          const st = dirToUv(qp);
          const m = (i < 4 ? tA : tB).sample(st).level(float(0));
          const c = i % 4 === 0 ? m.r : i % 4 === 1 ? m.g : i % 4 === 2 ? m.b : m.a;
          sum.addAssign(c);
          const w = smoothstep(0.25, 0.6, c).add(1e-4);
          wsum.addAssign(w);
          colAcc.addAssign(tColour.sample(st).level(lod).rgb.mul(w));
          if (i === 6) antarctic.assign(smoothstep(0.45, 0.6, c));
        }
        hR.assign(sum.sub(0.5).mul(0.9));
        photo.assign(colAcc.div(wsum));
      });
    }
    const coast = fbm(P.mul(9.0).add(vec3(3.1, 7.7, 1.3)), coastOct).mul(0.07);
    const h = mix(hN, hR, u.realPlates).add(coast).sub(u.seaLevel).toVar();
    const land = smoothstep(-0.006, 0.006, h).toVar();

    // ── ocean ──
    const shelf = smoothstep(-0.12, 0.0, h);
    const bloomN = float(0).toVar();
    If(u.oceanLife.greaterThan(0.001), () => {
      bloomN.assign(smoothstep(0.1, 0.6, fbm(P.mul(5.0).add(vec3(u.time.mul(0.003), 0, 0)), 3).add(0.3).mul(shelf.add(0.35))));
    });
    let ocean: V3 = mix(u.oceanDeep, u.oceanShallow, shelf.mul(shelf));
    ocean = mix(ocean, u.bloomColour, bloomN.mul(u.oceanLife));
    ocean = mix(ocean, vec3(0.05, 0.32, 0.36), shelf.mul(shelf).mul(shelf).mul(u.shelfTint));

    // ── land ──
    const rn = fbm(P.mul(14.0).add(vec3(1.7, 3.9, 8.2)), 3);
    const elev = clamp(h.mul(4.0), 0, 1);
    let rock: V3 = mix(u.rockA, u.rockB, smoothstep(-0.4, 0.4, rn.add(elev.mul(0.4))));
    rock = mix(rock, u.rustColour, u.rust.mul(smoothstep(-0.3, 0.5, rn.negate().add(0.2))));
    // Noise plates: barren rock, then green with life.
    const greenN = mix(rock, u.greenColour.mul(float(0.75).add(rn.mul(0.5))), u.landLife.mul(float(1).sub(elev.mul(0.7))));
    // Real plates: the present-day photo with its vegetation removed before land plants.
    const lum = dot(photo, vec3(0.2126, 0.7152, 0.0722));
    const veg = smoothstep(0.0, 0.06, photo.g.sub(photo.r.mul(0.85).max(photo.b)));
    const barrenPhoto = mix(photo, rock.mul(lum.div(0.12).clamp(0.4, 2.2)), veg);
    const landReal = mix(barrenPhoto, photo, u.landLife);
    const landCol = mix(greenN, landReal, u.realPlates).toVar();

    // ── ice ──
    const lat = abs(P.y);
    const iceNoise = fbm(P.mul(6.0).add(vec3(9.1, 2.2, 4.4)), 3).mul(0.06);
    const polar = smoothstep(u.iceEdge.sub(0.02), u.iceEdge.add(0.02), lat.add(iceNoise).add(land.mul(0.04)));
    const nhSheet = smoothstep(u.iceEdgeNorthLand.sub(0.012), u.iceEdgeNorthLand.add(0.012), P.y.add(iceNoise.mul(1.2))).mul(land);
    const pIce = smoothstep(0.55, 0.72, min(photo.r, min(photo.g, photo.b))).mul(u.northIce).mul(u.realPlates).mul(land);
    const ant = antarctic.mul(u.photoIce).mul(u.realPlates);
    const snow = float(0).toVar();
    If(u.snowball.greaterThan(0.001), () => {
      snow.assign(smoothstep(0.2, 0.9, u.snowball.mul(1.25).sub(fbm(P.mul(3.0).add(vec3(4.0, 0, 0)), 3).mul(0.25)).sub(float(1).sub(lat).mul(0.18))));
    });
    const ice = clamp(max(max(polar, nhSheet), max(max(pIce, ant), snow)), 0, 1).toVar();
    const iceCol = mix(vec3(0.7, 0.77, 0.84), vec3(0.93, 0.95, 0.98), smoothstep(-0.25, 0.25, rn));

    // ── lava / crust ──
    const emission = vec3(0).toVar();
    const crustDark = float(0).toVar();
    If(u.lava.greaterThan(0.001), () => {
      const drift = vec3(u.time.mul(0.01), 0, u.time.mul(-0.007));
      // Organic plate shapes: strongly warped cellular noise.
      const wv = vec3(
        fbm(P.mul(1.7).add(drift), 3),
        fbm(P.mul(1.9).add(vec3(5.1, 1.7, 3.3)).add(drift), 3),
        fbm(P.mul(2.1).add(vec3(2.4, 7.2, 4.1)), 3),
      );
      const pw = P.mul(3.4).add(wv.mul(0.7));
      const cells = mx_worley_noise_vec2(pw);
      const edge = cells.y.sub(cells.x); // 0 on plate boundaries
      const fine = mx_worley_noise_vec2(pw.mul(3.7).add(vec3(1.3, 0, 0)));
      const fineEdge = fine.y.sub(fine.x);
      const wN = fbm(P.mul(5.0).add(vec3(3, 1, 2)), 2).mul(0.5).add(0.5);
      const crackW = u.crackWidth.mul(float(0.25).add(wN.mul(0.9)));
      const cover = u.crustCover;
      // Which regions have solidified: a slowly varying field compared against the cover fraction.
      const solid = smoothstep(-0.12, 0.12, cover.mul(2.2).sub(1.1).add(fbm(P.mul(2.3).add(vec3(9, 2, 6)), 3).mul(0.9)));
      const plate = smoothstep(crackW, crackW.add(0.05), edge);
      const fineCrack = float(1).sub(smoothstep(0.0, 0.03, fineEdge)).mul(float(1).sub(cover).mul(0.7).add(0.3));
      const crustMask = plate.mul(solid).mul(float(1).sub(fineCrack.mul(0.85))).toVar();
      // Melt temperature: convective churn, cooler skins drifting on it, hottest along open cracks.
      const flow = fbm(P.mul(6.0).add(drift.mul(3)), 4);
      const skin = smoothstep(0.05, 0.35, fbm(P.mul(11.0).add(drift.mul(5)).add(vec3(4, 4, 4)), 3));
      const crack = float(1).sub(crustMask);
      // Open melt convects in cells: hot upwelling centres, cooler dark lanes where it sinks.
      const gran = smoothstep(0.0, 0.4, edge);
      const lane = float(1).sub(smoothstep(0.0, 0.07, edge));
      const molten = float(1).sub(cover);
      const logT = u.lavaLogT.add(flow.mul(0.07))
        .sub(skin.mul(0.04))
        .add(gran.sub(0.5).mul(0.16).mul(molten))
        .sub(lane.mul(0.14).mul(molten))
        .sub(crustMask.mul(0.3));
      const T = pow(float(10), logT);
      const radiance = pow(T.div(u.lavaRefK), 4).mul(u.glowGain);
      // Blackbody colour, saturated ×1.6 about its luminance: AgX tone mapping desaturates bright emitters,
      // and molten rock should still read as orange on screen.
      const bb = blackbodyNode(o.lut, logT);
      const bbL = dot(bb, vec3(0.2126, 0.7152, 0.0722));
      const glow = mix(vec3(bbL), bb, 1.6).max(0).mul(radiance).mul(crack.mul(0.97).add(0.03));
      // Lava only where there is land: the first oceans quench it.
      emission.addAssign(glow.mul(u.lava).mul(land));
      crustDark.assign(crustMask.mul(u.lava).mul(land));
    });
    // Hadean hotspots: scattered volcanic glows.
    If(u.hotspots.greaterThan(0.001), () => {
      const hs = mx_worley_noise_vec2(P.mul(7.0).add(vec3(11.0, 3.0, 5.0)));
      const spot = float(1).sub(smoothstep(0.0, 0.12, hs.x)).mul(smoothstep(0.35, 0.6, mx_noise_float(P.mul(3.0).add(vec3(2.0, 8.0, 1.0)))));
      emission.addAssign(blackbodyNode(o.lut, float(3.15)).mul(spot.mul(u.hotspots).mul(1.4).mul(land.mul(0.85).add(0.15))));
    });

    // ── impact (flash, glowing scar, expanding ejecta ring) ──
    const cosA = dot(P, u.impactDir);
    const ang = clamp(float(1).sub(cosA), 0, 2);
    const flash = exp(ang.mul(-700)).mul(12).add(exp(ang.mul(-50)).mul(1.2)).mul(u.impactFlash);
    const ringR = u.impactAge.mul(0.3);
    const fadeR = float(1).sub(u.impactAge);
    const ring = exp(ang.sub(ringR).mul(ang.sub(ringR)).mul(-3500)).mul(smoothstep(0.0, 0.05, u.impactAge)).mul(fadeR.mul(fadeR));
    const scar = exp(ang.mul(-400)).mul(smoothstep(0.0, 0.02, u.impactAge)).mul(float(1).sub(smoothstep(0.1, 0.8, u.impactAge)));
    emission.addAssign(blackbodyNode(o.lut, float(3.6)).mul(flash.add(scar.mul(4.0))));
    // The ejecta curtain: re-entering debris heats the sky orange-red as it spreads around the globe.
    emission.addAssign(blackbodyNode(o.lut, float(3.3)).mul(ring.mul(0.9)));

    // ── albedo ──
    const albedo = mix(ocean, landCol, land).toVar();
    albedo.assign(mix(albedo, iceCol, ice));
    albedo.assign(mix(albedo, mix(vec3(0.05, 0.045, 0.042), vec3(0.11, 0.1, 0.095), smoothstep(-0.3, 0.3, rn)), crustDark));
    albedo.mulAssign(float(1).sub(u.soot.mul(0.6)));

    // ── lighting ──
    // Bump: slope of the land field (cheap: only the coast noise derivative via screen derivatives).
    const NdotL = dot(Nw, S);
    const X = u.radius.div(u.hR.mul(LN2));
    const XM = u.radius.div(u.hM.mul(LN2));
    const XH = u.radius.div(u.hH.mul(LN2));
    const odR = chapman(X, float(0), NdotL).mul(u.hR.mul(LN2));
    const odM = chapman(XM, float(0), NdotL).mul(u.hM.mul(LN2));
    const odH = chapman(XH, float(0), NdotL).mul(u.hH.mul(LN2));
    const tau = u.betaR.add(u.ozone).mul(odR).add(vec3(u.betaM.mul(1.11)).mul(odM)).add(u.haze.mul(odH));
    const sunT = exp(tau.negate().max(-60)).toVar();
    const sunLight = u.sunColour.mul(u.sunIntensity).mul(sunT);

    // Cloud shadow (sample cloud density slightly sunward).
    const cs = float(1).toVar();
    If(u.cloudShadow.greaterThan(0.001), () => {
      const pc = qrot(u.cloudRel, normalize(P.add(qrot(vec4(u.cloudRel.xyz.negate(), u.cloudRel.w), S).mul(0.012))));
      cs.assign(float(1).sub(cloudField(pc, lowQ ? 3 : 4).mul(u.cloudShadow).mul(u.cloudOpacity)));
    });

    const diff = max(NdotL, 0);
    // Ocean glint (GGX, roughness ~0.25, Schlick Fresnel).
    const Hh = normalize(S.add(V));
    const NdotH = max(dot(Nw, Hh), 0);
    const a2 = float(0.06);
    const dd = NdotH.mul(NdotH).mul(a2.sub(1)).add(1);
    const D = a2.div(dd.mul(dd).mul(Math.PI));
    const NdotV = max(dot(Nw, V), 1e-3);
    const fres = float(0.02).add(float(0.98).mul(pow(float(1).sub(max(dot(V, Hh), 0)), 5)));
    const spec = D.mul(fres).mul(diff).div(NdotV.mul(4).max(0.25)).mul(float(1).sub(land)).mul(float(1).sub(ice)).mul(float(1).sub(crustDark));
    const twilight = smoothstep(-0.18, 0.12, NdotL).mul(u.ambient);
    const col = albedo.mul(diff).add(spec).mul(sunLight).mul(cs).add(albedo.mul(twilight)).add(emission);
    return col;
  })();

  const surface = new Mesh(surfaceGeo, surfaceMat);
  surface.frustumCulled = false;
  group.add(surface);

  // ── Clouds ──
  let clouds: Mesh | null = null;
  let cloudMat: MeshBasicNodeMaterial | null = null;
  if (o.clouds !== false) {
    cloudMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    cloudMat.blending = CustomBlending;
    cloudMat.blendSrc = OneFactor;
    cloudMat.blendDst = OneMinusSrcAlphaFactor;
    const out = Fn(() => {
      const c = positionLocal.normalize();
      const d = cloudField(c, lowQ ? 4 : 5).mul(u.cloudOpacity).toVar();
      const Nw = normalize(positionWorld.sub(u.centre));
      const NdotL = dot(Nw, u.sunDir);
      const X = u.radius.div(u.hR.mul(LN2));
      const XH = u.radius.div(u.hH.mul(LN2));
      const odR = chapman(X, float(0.3), NdotL).mul(u.hR.mul(LN2));
      const odH = chapman(XH, float(0.3), NdotL).mul(u.hH.mul(LN2));
      const tau = u.betaR.add(u.ozone).mul(odR).add(u.haze.mul(odH));
      const sunT = exp(tau.negate().max(-60));
      // Thickness shading: denser clouds are brighter on top and darker at the terminator.
      const lit = smoothstep(-0.08, 0.35, NdotL).mul(float(0.75).add(d.mul(0.25)));
      // Colour uniforms are typed 'color'; colour × colour is valid TSL but not in @types/three.
      const cloudCol = u.cloudColour as unknown as V3;
      const col = cloudCol.mul(u.sunColour.mul(lit.mul(u.sunIntensity).mul(float(1).sub(u.soot.mul(0.75))))).mul(sunT);
      const amb = u.cloudColour.mul(smoothstep(-0.2, 0.1, NdotL).mul(u.ambient));
      return vec4(col.add(amb).mul(d), d) as V4;
    })();
    cloudMat.colorNode = out.xyz;
    cloudMat.opacityNode = out.w;
    clouds = new Mesh(new SphereGeometry(1, segW / 2, segW / 4), cloudMat);
    clouds.scale.setScalar(1 + CLOUD_ALTITUDE);
    clouds.frustumCulled = false;
    clouds.renderOrder = 1;
    group.add(clouds);
  }

  // ── Atmosphere ──
  let atmosphere: Mesh | null = null;
  let atmoMat: MeshBasicNodeMaterial | null = null;
  if (o.atmosphere !== false) {
    atmoMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: FrontSide });
    atmoMat.blending = CustomBlending;
    atmoMat.blendSrc = OneFactor;
    atmoMat.blendDst = OneMinusSrcAlphaFactor;
    const steps = lowQ ? 10 : q.name === 'medium' ? 14 : 20;
    const out = Fn(() => {
      const R = u.radius;
      const Ra = R.mul(float(1).add(u.atmoTop));
      const ro = cameraPosition.sub(u.centre);
      const rd = normalize(positionWorld.sub(cameraPosition));
      const b = dot(ro, rd);
      const c = dot(ro, ro).sub(Ra.mul(Ra));
      const disc = b.mul(b).sub(c);
      const sq = sqrt(max(disc, 0));
      const t0 = max(b.negate().sub(sq), 0);
      const t1 = b.negate().add(sq);
      const cP = dot(ro, ro).sub(R.mul(R));
      const discP = b.mul(b).sub(cP);
      const tP = b.negate().sub(sqrt(max(discP, 0)));
      const hitP = discP.greaterThan(0).and(tP.greaterThan(0));
      const tEnd = select(hitP, tP, t1);
      const seg = max(tEnd.sub(t0), 0).div(steps);
      const S = u.sunDir;
      const mu = dot(rd, S);
      const X = R.div(u.hR.mul(LN2));
      const XM = R.div(u.hM.mul(LN2));
      const XH = R.div(u.hH.mul(LN2));
      const jitter = fract(float(52.9829189).mul(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715)))));
      const odR = float(0).toVar();
      const odM = float(0).toVar();
      const odH = float(0).toVar();
      const sumR = vec3(0).toVar();
      const sumM = vec3(0).toVar();
      const sumH = vec3(0).toVar();
      const betaMe = u.betaM.mul(1.11);
      Loop(steps, ({ i }) => {
        const t = t0.add(seg.mul(float(i).add(jitter)));
        const p = ro.add(rd.mul(t));
        const r = length(p);
        const alt = max(r.sub(R), 0);
        const dR = exp(alt.div(u.hR).negate()).mul(seg);
        const dM = exp(alt.div(u.hM).negate()).mul(seg);
        const dH = exp(alt.div(u.hH).negate()).mul(seg);
        odR.addAssign(dR.mul(0.5));
        odM.addAssign(dM.mul(0.5));
        odH.addAssign(dH.mul(0.5));
        const cz = dot(p, S).div(r);
        const lR = chapman(X, alt.div(u.hR.mul(LN2)), cz).mul(u.hR.mul(LN2));
        const lM = chapman(XM, alt.div(u.hM.mul(LN2)), cz).mul(u.hM.mul(LN2));
        const lH = chapman(XH, alt.div(u.hH.mul(LN2)), cz).mul(u.hH.mul(LN2));
        const tau = u.betaR.add(u.ozone).mul(odR.add(lR)).add(vec3(betaMe).mul(odM.add(lM))).add(u.haze.mul(odH.add(lH)));
        const att = exp(tau.negate().max(-60));
        sumR.addAssign(att.mul(dR));
        sumM.addAssign(att.mul(dM));
        sumH.addAssign(att.mul(dH));
        odR.addAssign(dR.mul(0.5));
        odM.addAssign(dM.mul(0.5));
        odH.addAssign(dH.mul(0.5));
      });
      const phaseR = float(3 / (16 * Math.PI)).mul(mu.mul(mu).add(1));
      const g = u.mieG;
      const g2 = g.mul(g);
      const phaseM = float(3 / (8 * Math.PI))
        .mul(float(1).sub(g2).mul(mu.mul(mu).add(1)))
        .div(g2.add(2).mul(pow(float(1).add(g2).sub(g.mul(mu).mul(2)), 1.5)));
      const gh = float(0.68);
      const phaseH = float(1 / (4 * Math.PI)).mul(float(1).sub(gh.mul(gh))).div(pow(float(1).add(gh.mul(gh)).sub(gh.mul(mu).mul(2)), 1.5));
      const sun = u.sunColour.mul(u.sunIntensity).mul(u.atmoGain);
      const ins = sumR
        .mul(u.betaR)
        .mul(phaseR)
        .add(sumM.mul(u.betaM).mul(phaseM))
        .add(sumH.mul(u.haze).mul(u.hazeAlbedo).mul(phaseH))
        .mul(sun)
        .mul(float(1).sub(u.soot.mul(0.85)));
      const trans = exp(u.betaR.add(u.ozone).mul(odR).add(vec3(betaMe).mul(odM)).add(u.haze.mul(odH)).negate().max(-60));
      const alpha = clamp(float(1).sub(trans.x.add(trans.y).add(trans.z).div(3)), 0, 1);
      const valid = disc.greaterThan(0).and(t1.greaterThan(0));
      return select(valid, vec4(ins, alpha), vec4(0));
    })();
    atmoMat.colorNode = out.xyz;
    atmoMat.opacityNode = out.w;
    atmosphere = new Mesh(new SphereGeometry(1, 96, 48), atmoMat);
    atmosphere.frustumCulled = false;
    atmosphere.renderOrder = 2;
    group.add(atmosphere);
  }

  const self: Planet = {
    group,
    surface,
    clouds,
    atmosphere,
    u,
    setAtmosphere(spec) {
      setAtmosphereUniforms(u, spec, u.radius.value);
      if (atmosphere) atmosphere.scale.setScalar(1 + u.atmoTop.value);
    },
    dispose() {
      surfaceGeo.dispose();
      surfaceMat.dispose();
      clouds?.geometry.dispose();
      cloudMat?.dispose();
      atmosphere?.geometry.dispose();
      atmoMat?.dispose();
    },
  };
  return self;
}

// ── Sun and stars ───────────────────────────────────────────────────────────────

export interface SunSprite {
  object: Sprite;
  halo: Sprite;
  colour: CU;
  intensity: FU;
  dispose(): void;
}

/** A bright, round sun disc plus a soft halo (both additive; the planet occludes them through depth). */
export function createSun(): SunSprite {
  const colour = mkC(1, 1, 1);
  const intensity = mkF(40);
  const discMat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  const r = uv().sub(0.5).length().mul(2);
  const limb = sqrt(max(float(1).sub(r.mul(r)), 0)); // limb darkening ~ μ^0.5
  discMat.colorNode = colour.mul(intensity).mul(pow(limb, 0.5)).mul(float(1).sub(smoothstep(0.96, 1.0, r)));
  discMat.opacityNode = float(1).sub(smoothstep(0.96, 1.0, r));
  const object = new Sprite(discMat);
  const haloMat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  const rh = uv().sub(0.5).length().mul(2);
  const halo = float(0.02).div(rh.mul(rh).add(0.002)).mul(float(1).sub(smoothstep(0.4, 1.0, rh)));
  haloMat.colorNode = colour.mul(halo).mul(intensity.div(40));
  haloMat.opacityNode = float(1);
  const haloSprite = new Sprite(haloMat);
  return {
    object,
    halo: haloSprite,
    colour,
    intensity,
    dispose() {
      discMat.dispose();
      haloMat.dispose();
    },
  };
}

export interface Starfield {
  object: Sprite;
  brightness: FU;
  dispose(): void;
}

/** Background stars on a sphere: blackbody colours, power-law brightness, instanced sprites. */
export function createStarfield(count: number, radius: number, seed: number, lut: DataTexture): Starfield {
  const rand = mulberry32(seed);
  const pos = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const z = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    pos[i * 4] = Math.cos(a) * s * radius;
    pos[i * 4 + 1] = z * radius;
    pos[i * 4 + 2] = Math.sin(a) * s * radius;
    // w: packs brightness (power law) and log10 temperature
    const b = Math.pow(rand(), 6);
    const logT = 3.45 + rand() * rand() * 0.9;
    pos[i * 4 + 3] = Math.floor(b * 1000) + (logT - 3) / 2;
  }
  const attr = new InstancedBufferAttribute(pos, 4);
  const brightness = mkF(1);
  const mat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  const a = instancedBufferAttribute<'vec4'>(attr, 'vec4');
  const b = a.w.floor().div(1000);
  const logT = fract(a.w).mul(2).add(3);
  mat.positionNode = a.xyz;
  mat.scaleNode = float(radius * 0.0022).mul(float(0.6).add(b.mul(1.6)));
  const r = uv().sub(0.5).length().mul(2);
  const disc = float(1).sub(smoothstep(0.0, 1.0, r)).pow(2.5);
  mat.colorNode = blackbodyNode(lut, logT).mul(float(0.25).add(b.mul(3.5))).mul(brightness).mul(disc);
  mat.opacityNode = disc;
  const object = new Sprite(mat);
  object.count = count;
  object.frustumCulled = false;
  return {
    object,
    brightness,
    dispose() {
      mat.dispose();
    },
  };
}

// ── CPU helpers ────────────────────────────────────────────────────────────────

/** Linear sRGB of a blackbody at T (K), into a Color. */
export function blackbodyColour(tempK: number, out: Color): Color {
  const [r, g, b] = blackbodyRGB(tempK);
  return out.setRGB(r, g, b);
}

/** Unit vector for latitude/longitude (degrees) in the planet frame used by the geography. */
export function latLonToDir(latDeg: number, lonDeg: number, out: Vector3): Vector3 {
  const la = (latDeg * Math.PI) / 180;
  const lo = (lonDeg * Math.PI) / 180;
  return out.set(Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo));
}
