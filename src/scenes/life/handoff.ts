// The frame shared by the end of `solarSystem` and the start of `life` (they dissolve into each other),
// and by the end of `life` (the `now` scene zooms out from it). Both scenes import these so they match.

export const HANDOFF = {
  /** World direction toward the Sun as seen from Earth (fixed; cameras orbit). */
  sunDir: [-0.85, 0.12, 0.5] as const,
  /**
   * Camera around Earth (radius 1 at the origin of the planet frame): azimuth°, elevation°, distance.
   * Azimuth −30° keeps the lit hemisphere toward the camera (phase ≈ 30°), terminator near the right limb.
   */
  camera: { az: -30, el: 8, dist: 5.6, fov: 30 },
  /** Night-side ambient (sky glow) on the surface. */
  ambient: 0.012,
  /** Weather offset (rad) of the cloud map relative to the ground at the start of `life`. */
  cloudTurnStart: -5,
};
