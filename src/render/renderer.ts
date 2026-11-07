// Boot, loop, resize, visibility (HANDOFF §10.1). One GPU context for the life of the page.

import { AgXToneMapping, WebGPURenderer } from 'three/webgpu';
import { createGlobals, globalsAt, type Globals } from '../physics/cosmology.ts';
import { CHAPTERS, progressToTime, timeInChapter, type TimePoint } from '../time/chapters.ts';
import {
  $progress,
  $quality,
  $qualityOverride,
  $reducedMotion,
  $rendererStatus,
  $sceneInfo,
  $stats,
} from '../state/store.ts';
import { createAssetLoader, type AssetLoader } from './assets.ts';
import { Compositor } from './Compositor.ts';
import { createGlobalUniforms, type GlobalUniforms } from './globals.ts';
import { FrameMonitor, guessTier, lowerTier, tier, tierFromProbe, type Backend, type QualityTier, type TierName } from './quality.ts';
import { SceneManager, type SceneEntry } from './SceneManager.ts';
import { createPrimordialField, type PrimordialField } from '../shared/gaussianField.ts';
import { makePlaceholder } from '../scenes/_placeholder/index.ts';
import type { RenderContext } from '../scenes/types.ts';

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  /** Force the WebGL2 backend (also via ?webgl=1). */
  forceWebGL?: boolean;
  /** Dev: render one scene at a fixed local instead of following the scroll. */
  single?: { sceneId: string; local: number; paused?: boolean };
  /** Skip the 1 s probe (dev, screenshots). */
  skipProbe?: boolean;
  tier?: TierName;
}

export interface Engine {
  renderer: WebGPURenderer;
  backend: Backend;
  quality: QualityTier;
  manager: SceneManager;
  globals: GlobalUniforms;
  field: PrimordialField;
  assets: AssetLoader;
  /** Dev: change the single-scene target. */
  setSingle(single: EngineOptions['single']): void;
  /** Number of frames rendered (screenshots wait on this). */
  frames(): number;
  setTier(name: TierName, auto: boolean): Promise<void>;
  dispose(): void;
}

const smooth = (x: number) => x * x * (3 - 2 * x);

export async function createEngine(opts: EngineOptions): Promise<Engine | null> {
  const { canvas } = opts;
  const params = new URLSearchParams(location.search);
  const forceWebGL = opts.forceWebGL ?? params.get('webgl') === '1';
  const renderer = new WebGPURenderer({
    canvas,
    antialias: false,
    alpha: false,
    forceWebGL,
    powerPreference: 'high-performance',
  });
  try {
    await renderer.init();
  } catch (err) {
    console.warn('[renderer] no WebGPU or WebGL2; using stills', err);
    $rendererStatus.set('fallback');
    return null;
  }
  // three falls back to WebGL2 when WebGPU is unavailable; if that fails init() throws above.
  const backend: Backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  renderer.toneMapping = AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 1);

  const globals = createGlobalUniforms();
  const assets = createAssetLoader();
  const override = $qualityOverride.get();
  const tierParam = (params.get('tier') as TierName | null) ?? opts.tier ?? (override !== 'auto' ? override : null);
  let quality = tier(tierParam ?? guessTier(backend), backend, !tierParam);

  // Size first so the probe measures the real resolution.
  let width = 1;
  let height = 1;
  let dpr = 1;
  const applySize = () => {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, quality.maxDpr);
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    width = Math.max(1, Math.floor(w * dpr * quality.renderScale));
    height = Math.max(1, Math.floor(h * dpr * quality.renderScale));
    globals.setResolution(width, height);
    compositor?.setSize(width, height);
    manager?.resize(width, height, dpr);
  };
  let compositor: Compositor | null = null;
  let manager: SceneManager | null = null;
  applySize();

  let field = createPrimordialField(quality.fieldGrid, quality.particles);
  const ctx: RenderContext = { renderer, globals, quality, assets, field };
  compositor = new Compositor(renderer, globals);
  manager = new SceneManager(ctx);
  applySize();

  // ── Quality probe (§10.5): 1 s of a heavy placeholder at the chosen resolution.
  if (quality.auto && !opts.skipProbe && !opts.single && params.get('probe') !== '0') {
    const probe = makePlaceholder({ id: '_probe', range: [0, 1], probe: true });
    const probeEntry = { target: null as unknown as SceneEntry['target'] };
    const tmp = manager.load('_placeholder');
    await tmp.promise;
    await probe.init(ctx);
    probe.resize(width, height, dpr);
    probeEntry.target = tmp.target;
    const g = globalsAt(1e-20);
    globals.update(g, 0.5, 0);
    const times: number[] = [];
    const t0 = performance.now();
    let last = t0;
    await new Promise<void>((resolve) => {
      renderer.setAnimationLoop(() => {
        const now = performance.now();
        times.push(now - last);
        last = now;
        probe.update(0.5, g, 0.016, (now - t0) / 1000);
        probe.render(probeEntry.target);
        compositor!.render(tmp.target.texture, null, 1, 'none', 0);
        if (now - t0 > 1000) {
          renderer.setAnimationLoop(null);
          resolve();
        }
      });
    });
    probe.dispose();
    manager.unload('_placeholder');
    const sorted = times.slice(5).sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1] ?? 16;
    const next = tierFromProbe(quality.name, median);
    console.info(`[quality] backend ${backend}, guess ${quality.name}, probe median ${median.toFixed(1)} ms → ${next}`);
    if (next !== quality.name) {
      quality = tier(next, backend, true);
      field = createPrimordialField(quality.fieldGrid, quality.particles);
      manager.setContext({ quality, field });
      applySize();
    }
  }
  $quality.set(quality);

  // ── Loop ──────────────────────────────────────────────────────────────────
  const g: Globals = createGlobals();
  const gOut: Globals = createGlobals();
  const tp: TimePoint = progressToTime(0);
  const monitor = new FrameMonitor();
  let single = opts.single ?? null;
  let lastNow = performance.now();
  let elapsed = 0;
  let prevProgress = $progress.get();
  let direction = 1;
  let frames = 0;
  let statsAt = 0;
  let statFrames = 0;
  let lastSceneId = '';
  let lastColourMapped: boolean | undefined;
  let changingTier = false;

  const publishInfo = (e: SceneEntry | null) => {
    const s = e?.scene;
    if (!s) return;
    if (s.id !== lastSceneId || s.colourMapped !== lastColourMapped) {
      lastSceneId = s.id;
      lastColourMapped = s.colourMapped;
      $sceneInfo.set({ sceneId: s.id, accuracy: s.accuracy, accuracyNote: s.accuracyNote, colourMapped: !!s.colourMapped });
    }
  };

  const fadeFor = (e: SceneEntry | null, nowS: number) => (e ? smooth(Math.min(1, (nowS - e.readyAt) / 0.6)) : 0);

  const frame = () => {
    const now = performance.now();
    const dtMs = Math.min(100, now - lastNow);
    lastNow = now;
    const dt = dtMs / 1000;
    const nowS = now / 1000;
    const reduced = $reducedMotion.get();
    if (!reduced) elapsed += dt;
    frames++;

    if (single) {
      const entry = manager!.only(single.sceneId);
      const chapter = CHAPTERS.find((c) => c.sceneId === single!.sceneId) ?? CHAPTERS[0]!;
      const { t } = timeInChapter(chapter, single.local);
      globalsAt(t, g);
      globals.update(g, single.local, elapsed);
      if (entry.scene && entry.status !== 'loading') {
        entry.scene.update(single.local, g, single.paused ? 0 : dt, elapsed);
        entry.scene.render(entry.target);
        publishInfo(entry);
      }
      compositor!.render(entry.scene ? entry.target.texture : null, null, 1, 'none', entry.scene ? 1 : 0);
    } else {
      const p = $progress.get();
      if (p !== prevProgress) direction = p > prevProgress ? 1 : -1;
      prevProgress = p;
      progressToTime(p, tp);
      const i = tp.chapterIndex;
      const ch = tp.chapter;
      manager!.sync(i, tp.local, direction);

      const prev = CHAPTERS[i - 1];
      const inTransition = !!prev && prev.sceneId !== ch.sceneId && tp.local < ch.transitionSpan;
      const mixT = inTransition ? smooth(tp.local / ch.transitionSpan) : 1;

      const incoming = manager!.ready(ch.sceneId);
      const outgoing = inTransition ? manager!.ready(prev!.sceneId) : null;

      if (reduced) {
        // §10.6: one still per chapter at local = 0.5, held; transitions are plain crossfades.
        for (const [e, c] of [
          [incoming, ch],
          [outgoing, prev],
        ] as const) {
          if (!e?.scene || !c) continue;
          const key = `${c.id}:${e.target.width}x${e.target.height}`;
          if (e.heldKey === key) continue;
          const { t } = timeInChapter(c, 0.5);
          globalsAt(t, gOut);
          globals.update(gOut, 0.5, 0);
          e.scene.update(0.5, gOut, 0, 0);
          e.scene.render(e.target);
          e.heldKey = key;
        }
        globalsAt(tp.t, g);
        globals.update(g, tp.local, 0);
      } else {
        globalsAt(tp.t, g);
        globals.update(g, tp.local, elapsed);
        if (outgoing?.scene) {
          // The outgoing scene holds its final, calm frame.
          globalsAt(prev!.tEnd, gOut);
          outgoing.scene.update(1, gOut, dt, elapsed);
          outgoing.scene.render(outgoing.target);
        }
        if (incoming?.scene) {
          incoming.scene.update(tp.local, g, dt, elapsed);
          incoming.scene.render(incoming.target);
        }
      }
      publishInfo(mixT > 0.5 || !outgoing ? incoming : outgoing);
      const fade = Math.max(fadeFor(incoming, nowS), outgoing ? 1 : 0);
      compositor!.render(
        incoming?.scene ? incoming.target.texture : null,
        outgoing?.scene ? outgoing.target.texture : null,
        incoming?.scene ? mixT : 0,
        reduced ? 'fade' : ch.transitionIn,
        incoming?.scene ? fade : outgoing ? 1 : 0,
      );
    }

    // Stats + dynamic quality.
    statFrames++;
    if (now - statsAt > 500) {
      const info = renderer.info as unknown as { memory: { geometries: number; textures: number }; programs?: unknown[] };
      $stats.set({
        fps: (statFrames * 1000) / (now - statsAt),
        frameMs: monitor.median(),
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: Array.isArray(info.programs) ? info.programs.length : 0,
      });
      statsAt = now;
      statFrames = 0;
    }
    if (quality.auto && !single && !changingTier && monitor.push(dtMs, nowS)) {
      const lower = lowerTier(quality.name);
      if (lower) {
        console.info(`[quality] median frame > 22 ms for 3 s: ${quality.name} → ${lower}`);
        void engine.setTier(lower, true);
      }
    }
  };

  // ── Resize + visibility ─────────────────────────────────────────────────────
  const ro = new ResizeObserver(() => applySize());
  ro.observe(canvas);
  let visible = !document.hidden;
  let intersecting = true;
  const updateLoop = () => {
    if (visible && intersecting) {
      lastNow = performance.now();
      renderer.setAnimationLoop(frame);
    } else renderer.setAnimationLoop(null);
  };
  const onVis = () => {
    visible = !document.hidden;
    updateLoop();
  };
  document.addEventListener('visibilitychange', onVis);
  const io = new IntersectionObserver((entries) => {
    intersecting = entries.some((e) => e.isIntersecting);
    updateLoop();
  });
  io.observe(canvas);

  const unsubOverride = $qualityOverride.listen((v) => {
    void engine.setTier(v === 'auto' ? guessTier(backend) : v, v === 'auto');
  });

  const engine: Engine = {
    renderer,
    backend,
    get quality() {
      return quality;
    },
    manager: manager!,
    globals,
    get field() {
      return field;
    },
    assets,
    setSingle(s) {
      single = s ?? null;
    },
    frames: () => frames,
    async setTier(name, auto) {
      if (name === quality.name && auto === quality.auto) return;
      changingTier = true;
      const old = quality;
      quality = tier(name, backend, auto);
      if (quality.fieldGrid !== old.fieldGrid || quality.particles > (field.particles?.side ?? 0) ** 3) {
        field.dispose();
        field = createPrimordialField(quality.fieldGrid, quality.particles);
      }
      manager!.disposeAll();
      manager!.setContext({ quality, field });
      applySize();
      $quality.set(quality);
      monitor.reset();
      changingTier = false;
    },
    dispose() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      unsubOverride();
      manager!.dispose();
      compositor!.dispose();
      field.dispose();
      globals.dispose();
      assets.dispose();
      renderer.dispose();
    },
  };

  $rendererStatus.set('ready');
  updateLoop();
  return engine;
}
