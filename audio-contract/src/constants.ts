/**
 * Contract constants. These are part of the frozen v1 surface: changing any of
 * them is a major version bump, not a tuning decision.
 */

/** Semver, and the only thing a sketch should branch on. */
/*
 * **1.1.0 — `audio.percussive` and `audio.harmonic`, added 30 Aug 2026.**
 *
 * A minor version, because the specification's versioning policy says so and because it is true: nothing was
 * removed, renamed or given a new meaning, so every sketch written against
 * 1.0.0 sees exactly what it saw. A sketch that wants the new fields can check
 * `contractVersion`, and one that does not never learns they exist.
 *
 * **1.2.0 — `audio.stems` and `audio.stemCount`, added 30 August 2026.**
 *
 * Real per-stem input: a multichannel device carries one instrument per
 * channel pair, captured outside Chromium by a native helper. Additive for
 * the same reasons as 1.1.0 — with no stem input configured, `stemCount` is 0
 * and every stem reads zeros, which is a true statement about an input that
 * is not there.
 */
export const CONTRACT_VERSION = '1.2.0';

/** Major version served when a sketch declares no `<meta name="sialk-contract">`. */
export const CONTRACT_MAJOR = 1;

/**
 * 64 log-spaced bins across 20 Hz–16 kHz. Linear FFT bins waste three-quarters
 * of their resolution above 5 kHz where almost nothing musical distinguishes
 * itself; 64 is also a texture width that costs nothing to upload.
 */
export const SPECTRUM_BINS = 64;

/** 128 frames — about two seconds at 60 fps, the range in which a trail reads as motion. */
export const LEVEL_TRAIL_FRAMES = 128;

export const SPECTRUM_MIN_HZ = 20;
export const SPECTRUM_MAX_HZ = 16_000;

/** Band edges in Hz, as documented in the spec. */
export const BAND_EDGES = {
  bass: [20, 250],
  mid: [250, 2_000],
  high: [2_000, 16_000],
} as const satisfies Record<'bass' | 'mid' | 'high', readonly [number, number]>;

/**
 * The stems array is always this long, whatever the input carries (1.2.0).
 *
 * Fixed rather than sized to the device, for the same reason `spectrum` is
 * always 64 bins: identity stability. A sketch destructures `stems[3]` once
 * at startup and holds it for life; entries past `stemCount` read all zeros.
 * Eight is a 16-channel device in stereo pairs — the largest loopback layout
 * in common use, and a GLSL uniform array has to pick a number.
 */
export const MAX_STEMS = 8;

/** No signal for this long and `audio.silent` goes true. */
export const SILENCE_TIMEOUT_SECONDS = 1;

/** Below this, `bpm` is decorative and a sketch should say so. */
export const BPM_CONFIDENCE_FLOOR = 0.4;
