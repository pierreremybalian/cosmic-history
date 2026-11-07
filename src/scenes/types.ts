// Scene contract (HANDOFF §5). Scenes are isolated modules sharing only global uniforms and shared libs.

import type { RenderTarget, WebGPURenderer } from 'three/webgpu';
import type { Globals } from '../physics/cosmology.ts';
import type { GlobalUniforms } from '../render/globals.ts';
import type { QualityTier } from '../render/quality.ts';
import type { AssetLoader } from '../render/assets.ts';
import type { PrimordialField } from '../shared/gaussianField.ts';

export type Accuracy = 'measured' | 'simulated' | 'modelled' | 'metaphor';

export interface RenderContext {
  renderer: WebGPURenderer;
  globals: GlobalUniforms;
  quality: QualityTier;
  assets: AssetLoader;
  field: PrimordialField;
}

export interface CosmicScene {
  id: string;
  range: [tStart: number, tEnd: number];
  accuracy: Accuracy;
  accuracyNote: string;
  /** Contract extension: true when the scene shows non-visible light through a colour map (§13.4). */
  colourMapped?: boolean;
  init(ctx: RenderContext): Promise<void>;
  /** local: 0–1 progress through this scene's range (in the chapter's timeMap) */
  update(local: number, g: Globals, dt: number, elapsed: number): void;
  render(target: RenderTarget): void;
  resize(width: number, height: number, dpr: number): void;
  dispose(): void;
}

export type SceneFactory = () => CosmicScene;
