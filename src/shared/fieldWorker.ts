// Web Worker: builds the primordial field once at boot (HANDOFF §8, decision in DECISIONS.md).
import { DEFAULT_FIELD, generateField, zeldovichParticles, type FieldData, type ParticleData } from './fieldCore.ts';

export interface FieldRequest {
  n: number;
  particleSide: number;
}
export interface FieldResponse {
  field: FieldData;
  particles: ParticleData;
  ms: number;
}

self.onmessage = (e: MessageEvent<FieldRequest>) => {
  const t0 = performance.now();
  const field = generateField({ ...DEFAULT_FIELD, n: e.data.n });
  const particles = zeldovichParticles(field, e.data.particleSide);
  const msg: FieldResponse = { field, particles, ms: performance.now() - t0 };
  const transfer = [
    field.delta.buffer,
    field.zeta.buffer,
    field.deltaSmooth.buffer,
    field.psi.buffer,
    field.peaks.buffer,
    particles.q.buffer,
    particles.psi.buffer,
    particles.lambda.buffer,
  ] as ArrayBuffer[];
  (self as unknown as Worker).postMessage(msg, transfer);
};
