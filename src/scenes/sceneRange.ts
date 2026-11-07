import { CHAPTERS } from '../time/chapters.ts';

/** [tStart, tEnd] in seconds of the chapter that shows this scene. */
export function sceneRange(sceneId: string): [number, number] {
  const c = CHAPTERS.find((ch) => ch.sceneId === sceneId);
  if (!c) throw new Error(`no chapter for scene ${sceneId}`);
  return [c.tStart, c.tEnd];
}

/** The chapter id that shows this scene (stills are keyed by chapter id). */
export function chapterForScene(sceneId: string): string {
  return CHAPTERS.find((ch) => ch.sceneId === sceneId)?.id ?? sceneId;
}
