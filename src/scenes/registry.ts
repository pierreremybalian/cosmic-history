// Scene id → lazy module (HANDOFF §10.3). Each module default-exports a SceneFactory.
import type { SceneFactory } from './types.ts';

type Loader = () => Promise<{ default: SceneFactory }>;

export const SCENES: Record<string, Loader> = {
  planck: () => import('./planck/index.ts'),
  inflation: () => import('./inflation/index.ts'),
  qgp: () => import('./qgp/index.ts'),
  hadrons: () => import('./hadrons/index.ts'),
  leptons: () => import('./leptons/index.ts'),
  bbn: () => import('./bbn/index.ts'),
  recombination: () => import('./recombination/index.ts'),
  darkAges: () => import('./darkAges/index.ts'),
  firstStars: () => import('./firstStars/index.ts'),
  reionization: () => import('./reionization/index.ts'),
  cosmicNoon: () => import('./cosmicNoon/index.ts'),
  darkEnergy: () => import('./darkEnergy/index.ts'),
  solarSystem: () => import('./solarSystem/index.ts'),
  life: () => import('./life/index.ts'),
  now: () => import('./now/index.ts'),
  _placeholder: () => import('./_placeholder/index.ts'),
};

export const SCENE_IDS = Object.keys(SCENES).filter((k) => !k.startsWith('_'));
