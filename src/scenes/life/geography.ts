// Present-day geography (life scene).
//
// Elevation (public domain): NOAA ETOPO1 Ice Surface, resampled to geo/elevation.png by
// scripts/planet/elevation.py; only -150..+360 m is kept (2 m steps), the band that floods or drains with sea level.
//
// Data (both public domain): Natural Earth 1:50m land polygons → 8 per-plate signed-distance masks
// (geo/plates-a.png = Africa, S America, N America, Europe; geo/plates-b.png = India, Australia, Antarctica,
// Asia), and NASA Blue Marble land colour (geo/land-colour.webp, dilated into the sea so coastlines never
// sample ocean). Built offline by scratch/planet/geo.mjs. Plate motions live in plates.ts.

import { LinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from 'three/webgpu';
import colourUrl from './geo/land-colour.webp?url';
import platesAUrl from './geo/plates-a.png?url';
import platesBUrl from './geo/plates-b.png?url';
import cloudsUrl from './geo/clouds.webp?url';
import elevationUrl from './geo/elevation.png?url';
import type { AssetLoader } from '../../render/assets.ts';

export interface Geography {
  colour: Texture;
  platesA: Texture;
  platesB: Texture;
  /** Cloud opacity (NASA Blue Marble 2002 cloud composite minus the cloud-free base). */
  clouds: Texture;
  /** Present-day elevation near sea level: R = (metres + 150) / 510. */
  elevation: Texture;
  release(): void;
}

export async function loadGeography(assets: AssetLoader): Promise<Geography> {
  const [colour, platesA, platesB, clouds, elevation] = await Promise.all([
    assets.texture(colourUrl, { colorSpace: SRGBColorSpace, mipmaps: true }),
    assets.texture(platesAUrl, { colorSpace: NoColorSpace, mipmaps: false }),
    assets.texture(platesBUrl, { colorSpace: NoColorSpace, mipmaps: false }),
    assets.texture(cloudsUrl, { colorSpace: NoColorSpace, mipmaps: true }),
    assets.texture(elevationUrl, { colorSpace: NoColorSpace, mipmaps: false }),
  ]);
  for (const t of [colour, platesA, platesB, clouds, elevation]) {
    t.wrapS = RepeatWrapping;
    t.needsUpdate = true;
  }
  platesA.minFilter = platesB.minFilter = LinearFilter;
  platesA.magFilter = platesB.magFilter = LinearFilter;
  elevation.minFilter = elevation.magFilter = LinearFilter;
  return {
    colour,
    platesA,
    platesB,
    clouds,
    elevation,
    release() {
      assets.release(elevationUrl);
      assets.release(cloudsUrl);
      assets.release(colourUrl);
      assets.release(platesAUrl);
      assets.release(platesBUrl);
    },
  };
}

/** Only the cloud map (the solarSystem scene's young Earth uses it so the handoff to life matches). */
export async function loadCloudMap(assets: AssetLoader): Promise<{ clouds: Texture; release(): void }> {
  const clouds = await assets.texture(cloudsUrl, { colorSpace: NoColorSpace, mipmaps: true });
  clouds.wrapS = RepeatWrapping;
  clouds.needsUpdate = true;
  return { clouds, release: () => assets.release(cloudsUrl) };
}
