// Dev-only: the shared cosmic web at amplitude = local (0 → 1), slowly orbiting. Validates src/shared/web.ts
// and the "same universe" traceability (compare with inflation's ζ slice using ?debug=field).
import { PerspectiveCamera, Scene, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
import { createCosmicWeb, type CosmicWeb } from '../../shared/web.ts';
import type { CosmicScene, RenderContext } from '../types.ts';

export default (): CosmicScene => {
  let renderer: WebGPURenderer;
  let scene: Scene;
  let camera: PerspectiveCamera;
  let web: CosmicWeb;
  return {
    id: '_web',
    range: [0, 1],
    accuracy: 'simulated',
    accuracyNote: 'Dev view of the shared Zel’dovich web.',
    colourMapped: true,
    async init(ctx: RenderContext) {
      renderer = ctx.renderer;
      await ctx.field.ready;
      scene = new Scene();
      camera = new PerspectiveCamera(45, 1, 0.1, 200);
      web = createCosmicWeb(ctx);
      web.uniforms.colourMap.value = 1;
      scene.add(web.object);
      await renderer.compileAsync(scene, camera);
    },
    update(local, _g, _dt, elapsed) {
      web.uniforms.amplitude.value = local;
      const a = elapsed * 0.05;
      camera.position.set(Math.sin(a) * 15, 4, Math.cos(a) * 15);
      camera.lookAt(0, 0, 0);
    },
    render(target: RenderTarget) {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    },
    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    dispose() {
      web.dispose();
    },
  };
};
