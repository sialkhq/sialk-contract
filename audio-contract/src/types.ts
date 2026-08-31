import type { ParameterDescriptor, ParameterValue } from './parameters/index.js';

/**
 * The v1.0.0 surface of `window.sialk`, verbatim.
 *
 * Everything here is guaranteed present and of the stated type from before the
 * sketch's first line runs. Silence is 0, never undefined, null or NaN.
 */

/**
 * One stem — one instrument's worth of the mix, from a multichannel input.
 * Added in v1.2. The same estimators as the master fields, so `stems[i].bass`
 * and `audio.bass` are the same kind of number.
 */
export interface SialkStem {
  /** 0..1 broadband loudness of this stem alone, perceptual, asymmetrically smoothed. */
  readonly level: number;
  /** 0..1, ~20–250 Hz. */
  readonly bass: number;
  /** 0..1, ~250–2000 Hz. */
  readonly mid: number;
  /** 0..1, ~2000–16000 Hz. */
  readonly high: number;
}

export interface SialkAudio {
  /** 0..1 broadband loudness, perceptual, asymmetrically smoothed. */
  readonly level: number;
  /** 0..1, ~20–250 Hz. */
  readonly bass: number;
  /** 0..1, ~250–2000 Hz. */
  readonly mid: number;
  /** 0..1, ~2000–16000 Hz. */
  readonly high: number;
  /**
   * 64 bins, 0..1, log-spaced across 20 Hz–16 kHz.
   * The same Float32Array instance for the sketch's whole life, refilled in
   * place — safe to upload straight to a GPU texture every frame.
   */
  readonly spectrum: Float32Array;
  /** 128 frames of `level`, `[0]` newest. Same instance for life, refilled in place. */
  readonly levelTrail: Float32Array;
  /**
   * 0..1 — how much of what is being heard is **transient** rather than
   * sustained. Drums, and the attack of everything else. Added in v1.1.
   *
   * **This is a proportion, not a loudness.** A quiet drum solo reads near 1
   * and a wall of loud pads reads near 0; multiply by `level` if you want
   * "how hard is the kick" rather than "how percussive is this passage".
   *
   * It is not stem separation and does not claim to be — it is a harmonic /
   * percussive split, which answers *react to the drums, not the melody*
   * without a model, without weights to licence, and without the lookahead
   * that would put the picture behind the music.
   */
  readonly percussive: number;
  /**
   * 0..1 — the other half: sustained, tonal energy. Bass notes, pads, held
   * vocals. `percussive` and `harmonic` are shares of the same frame, so they
   * fall together in silence rather than summing to 1.
   */
  readonly harmonic: number;
  /** Monotonic onset counter. Never resets mid-show; compare against last frame's value. */
  readonly hits: number;
  /** 1 on the frame a beat lands, decaying linearly to 0 before the next expected beat. */
  readonly onBeat: number;
  /**
   * 0..1, ramping from 0 at each detected beat towards 1 just before the next.
   * 0 when `bpm` is 0.
   *
   * `onBeat` decays for a flash; this ramps for a whole cycle, so anything that
   * moves *in* time reads this rather than integrating its own clock. Held at 1
   * rather than wrapping when a beat is late — a phase that stepped backwards
   * without a beat would stutter every time the detector missed one.
   */
  readonly beatPhase: number;
  /** 0 when unknown. Never a guess. */
  readonly bpm: number;
  /** 0..1. 0 when unknown. Below ~0.4, treat `bpm` as decorative. */
  readonly bpmConfidence: number;
  /** True when no signal has been present for one second. */
  readonly silent: boolean;
  /**
   * Per-stem analysis, when a multichannel input is configured. Added in v1.2.
   *
   * **Always `MAX_STEMS` (8) entries, whatever the input carries** — the same
   * identity rule as `spectrum`: the array and every object in it exist from
   * before the sketch's first line and are refilled in place, so
   * `const drums = sialk.audio.stems[0]` at startup stays live for the whole
   * show. Entries at index `stemCount` and beyond read all zeros.
   *
   * Stems are **ordered, not named**: stem *n* is channels 2n and 2n+1 of the
   * configured device, so the DAW's routing is the mapping and there is no
   * second one to disagree with it. Which instrument is stem 0 is a fact about
   * tonight's session, and the sketch author documents their own assumption.
   */
  readonly stems: readonly SialkStem[];
  /**
   * How many entries of `stems` are real — 0 when no multichannel input is
   * configured, which is every machine until the operator sets one up.
   * A sketch that wants stems should degrade to the master fields when this
   * is 0, and say so, rather than drawing eight flat bars.
   */
  readonly stemCount: number;
}

export interface SialkTransport {
  /** Seconds. Show position — may be scrubbed, cued or reset. */
  readonly time: number;
  /** Seconds since this sketch loaded. Monotonic. Drive animation from this. */
  readonly elapsed: number;
  /** Seconds since the previous frame. */
  readonly delta: number;
  /** Monotonic frame counter since load. */
  readonly frame: number;
  readonly running: boolean;
}

export interface SialkOutput {
  /** Pixels of the surface actually being composited. */
  readonly width: number;
  readonly height: number;
  /** Target frame rate, not measured rate. */
  readonly fps: number;
}

export interface SialkHost {
  /** `'sialk'` in the application, `'shim'` under @sialk/shim, or a third-party host's own name. */
  readonly name: string;
  readonly version: string;
}

export interface SialkParameters {
  /**
   * Declares what this sketch exposes. Idempotent, and safe to call again to
   * add a parameter or change a descriptor — a value that the new descriptor
   * still admits is kept, so editing a sketch between soundcheck and the set
   * does not discard what the performer dialled in.
   */
  declare(descriptors: Record<string, unknown>): void;
  /** Live values. The same object for the sketch's whole life, mutated in place. */
  readonly values: Readonly<Record<string, ParameterValue>>;
  readonly declared: Readonly<Record<string, ParameterDescriptor>>;
}

export type SialkEventName = 'beat' | 'onset' | 'resize' | 'transport' | 'parameter';

export interface SialkEventMap {
  beat: { bpm: number; confidence: number };
  onset: { hits: number; strength: number };
  resize: { width: number; height: number };
  transport: { time: number; running: boolean };
  parameter: { name: string; value: ParameterValue };
}

export type SialkListener<E extends SialkEventName> = (detail: SialkEventMap[E]) => void;

export interface SialkGlobal {
  /** Semver. The only thing a sketch should branch on. */
  readonly contractVersion: string;
  readonly host: SialkHost;
  readonly audio: SialkAudio;
  readonly transport: SialkTransport;
  readonly output: SialkOutput;
  readonly parameters: SialkParameters;
  /** Returns its own unsubscribe function, so a sketch need not keep the listener reference. */
  on<E extends SialkEventName>(event: E, listener: SialkListener<E>): () => void;
  off<E extends SialkEventName>(event: E, listener: SialkListener<E>): void;
}

declare global {
  var sialk: SialkGlobal | undefined;
}
