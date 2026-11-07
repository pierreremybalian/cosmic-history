// Placeholder scene (HANDOFF Phase 2): a slowly breathing plane coloured by the blackbody LUT of T,
// or by a labelled colour map when T < 1000 K. Also used as the quality probe and the stub for unbuilt scenes.

import { Mesh, MeshBasicNodeMaterial, PerspectiveCamera, PlaneGeometry, Scene, type RenderTarget, type WebGPURenderer } from 'three/webgpu';
import { float, mix, mx_noise_float, smoothstep, uniform, uv, vec3 } from 'three/tsl';
import { blackbodyNode } from '../../render/globals.ts';
import { densityColorNode } from '../../shared/color.ts';
import { fbm } from '../../shared/noise.ts';
import type { Accuracy, CosmicScene, RenderContext } from '../types.ts';
import type { Globals } from '../../physics/cosmology.ts';

export interface PlaceholderOptions {
  id: string;
  range: [number, number];
  accuracy?: Accuracy;
  accuracyNote?: string;
  /** Heavier shader for the quality probe. */
  probe?: boolean;
}

export function makePlaceholder(o: PlaceholderOptions): CosmicScene {
  let renderer: WebGPURenderer;
  let scene: Scene;
  let camera: PerspectiveCamera;
  let mesh: Mesh;
  const uLocal = uniform(0);
  const self: CosmicScene = {
    id: o.id,
    range: o.range,
    accuracy: o.accuracy ?? 'metaphor',
    accuracyNote: o.accuracyNote ?? 'Placeholder visual while this scene is built.',
    colourMapped: false,
    async init(ctx: RenderContext) {
      renderer = ctx.renderer;
      scene = new Scene();
      camera = new PerspectiveCamera(40, 1, 0.1, 100);
      camera.position.set(0, 0, 6);
      const g = ctx.globals;
      const p = vec3(uv().mul(3), g.uElapsed.mul(0.05));
      const n = o.probe ? fbm(p, 8) : mx_noise_float(p).mul(0.5);
      const visible = blackbodyNode(g.lut, g.uLogTemp);
      const mapped = densityColorNode(g.uLogTemp.div(3).mul(0.8).add(n.mul(0.2)).add(0.1));
      const base = mix(mapped, visible, smoothstep(2.9, 3.1, g.uLogTemp));
      const r = uv().sub(0.5).length();
      const glow = float(1).sub(smoothstep(0.0, 0.75, r)).mul(float(0.6).add(n.mul(0.6))).add(uLocal.mul(0.15));
      const mat = new MeshBasicNodeMaterial();
      mat.colorNode = base.mul(glow).mul(1.4);
      mesh = new Mesh(new PlaneGeometry(16, 9), mat);
      scene.add(mesh);
      await renderer.compileAsync(scene, camera);
    },
    update(local: number, gl: Globals) {
      uLocal.value = local;
      self.colourMapped = gl.T < 1000;
      mesh.rotation.z = local * 0.2;
    },
    render(target: RenderTarget) {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    },
    resize(width: number, height: number) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    dispose() {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicNodeMaterial).dispose();
    },
  };
  return self;
}

export default () => makePlaceholder({ id: '_placeholder', range: [0, 1] });
