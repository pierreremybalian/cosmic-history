import { CHAPTERS } from '../time/chapters.ts';

/** [tStart, tEnd] in seconds of the chapter that shows this scene. */
export function sceneRange(sceneId: string): [number, number] {
  const cs = CHAPTERS.filter((ch) => ch.sceneId === sceneId);
  if (!cs.length) throw new Error(`no chapter for scene ${sceneId}`);
  return [cs[0]!.tStart, cs.at(-1)!.tEnd];
}

/** All chapters that show this scene (recombination and life span two). */
export function chaptersForScene(sceneId: string) {
  return CHAPTERS.filter((ch) => ch.sceneId === sceneId);
}

/** The chapter id that shows this scene (stills are keyed by chapter id). */
export function chapterForScene(sceneId: string): string {
  return CHAPTERS.find((ch) => ch.sceneId === sceneId)?.id ?? sceneId;
}
