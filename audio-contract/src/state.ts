import {
  CONTRACT_VERSION,
  LEVEL_TRAIL_FRAMES,
  MAX_STEMS,
  SILENCE_TIMEOUT_SECONDS,
  SPECTRUM_BINS,
} from './constants.js';
import { ContractEmitter } from './emitter.js';
import { ParameterStore, describeDescriptors, type PlainDescriptors } from './parameters/index.js';
import type {
  SialkAudio,
  SialkGlobal,
  SialkHost,
  SialkOutput,
  SialkParameters,
  SialkStem,
  SialkTransport,
} from './types.js';

/** What a host hands the contract once per composited frame. */
export interface AudioFrameInput {
  /** 0..1 each; clamped on the way in. */
  level: number;
  bass: number;
  mid: number;
  high: number;
  /** SPECTRUM_BINS values, 0..1. Copied in, never retained. */
  spectrum: ArrayLike<number>;
  /**
   * How much of what is being heard is transient rather than sustained —
   * drums against notes. **Not a loudness**: a quiet drum solo reads high and
   * a loud pad reads low. Contract v1.1.
   */
  percussive: number;
  /** The other half of the same split: sustained, tonal energy. 0..1. */
  harmonic: number;
  /** > 0 when an onset landed on this frame. Its magnitude rides the `onset` event. */
  onsetStrength: number;
  /** True on the frame a beat lands. */
  beat: boolean;
  /** 0 when unknown. Never a guess. */
  bpm: number;
  /** 0..1. 0 when unknown. */
  bpmConfidence: number;
  /**
   * Per-stem frames from a multichannel input, in stem order (1.2.0).
   * Optional so every pre-1.2 caller is untouched: absent means no stem
   * input, and the contract reports `stemCount` 0 with every stem at zero.
   * Anything past `MAX_STEMS` is dropped.
   */
  stems?: readonly { level: number; bass: number; mid: number; high: number }[];
}

export interface TransportFrameInput {
  /** Show position in seconds. May jump. */
  time: number;
  /** Seconds since the previous frame. */
  delta: number;
  running: boolean;
}

/** Strips `readonly` so the host can write through to what the sketch reads. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export interface OutputInput {
  width: number;
  height: number;
  fps: number;
}

export interface CreateContractOptions {
  host: SialkHost;
  output: OutputInput;
  onListenerError?: (event: string, error: unknown) => void;
}

/**
 * The host's handle on a live contract. The sketch only ever sees `global`,
 * whose object identities never change; the host writes through here.
 *
 * Call order per composited frame is `writeTransport()` then `writeAudio()`.
 * Audio derives silence and beat decay from `transport.delta`, so writing it
 * first measures them against the previous frame's interval.
 */
export interface ContractWriter {
  readonly global: SialkGlobal;
  writeAudio(frame: AudioFrameInput): void;
  writeTransport(frame: TransportFrameInput): void;
  writeOutput(output: OutputInput): void;
  /** Host-side write. Emits `parameter` only when the value actually changed. */
  setParameter(name: string, value: unknown): void;
  /** Host-side trigger. Always emits, because every fire is an event. */
  fireParameter(name: string): void;
  /** Called with each descriptor a sketch declared that could not be used. */
  onParameterProblem?: (message: string) => void;
  /**
   * Called with the whole declared set after any `declare()` that took
   * something up — the whole set, never a delta, because the host caches a set
   * and two views of it would drift.
   *
   * This is how a declaration leaves the sketch's own renderer at all. Without
   * it the store fills up where nothing else can see it, and the main process
   * cannot bind a parameter it does not know exists.
   */
  onParameterDeclared?: (declared: PlainDescriptors) => void;
  /** Level below which a frame counts as silence for the `silent` flag. */
  silenceThreshold: number;
}

const clamp01 = (value: number): number => {
  // NaN must land on 0, so test the in-range case rather than the out-of-range one.
  if (!(value > 0)) return 0;
  return value > 1 ? 1 : value;
};

const finite = (value: number): number => (Number.isFinite(value) ? value : 0);

/**
 * Creates a contract instance and the host-side writer for it.
 *
 * Identity stability is the whole point of this function: `global`,
 * `global.audio`, `.transport`, `.output`, `.audio.spectrum` and
 * `.audio.levelTrail` are allocated once here and mutated in place forever
 * after, so a sketch may destructure them at startup and never look again.
 */
export function createContract(options: CreateContractOptions): ContractWriter {
  const emitter = new ContractEmitter(
    options.onListenerError ? (event, error) => options.onListenerError?.(event, error) : undefined,
  );

  const spectrum = new Float32Array(SPECTRUM_BINS);
  const levelTrail = new Float32Array(LEVEL_TRAIL_FRAMES);

  // Always MAX_STEMS objects, allocated once — the identity rule again. A
  // sketch holds `stems[3]` from its first line; the host refills it in place.
  const stems = Array.from({ length: MAX_STEMS }, (): Mutable<SialkStem> => ({
    level: 0,
    bass: 0,
    mid: 0,
    high: 0,
  }));

  const audio: Mutable<SialkAudio> = {
    level: 0,
    bass: 0,
    mid: 0,
    high: 0,
    spectrum,
    levelTrail,
    percussive: 0,
    harmonic: 0,
    hits: 0,
    onBeat: 0,
    beatPhase: 0,
    bpm: 0,
    bpmConfidence: 0,
    silent: true,
    stems,
    stemCount: 0,
  };

  const transport: Mutable<SialkTransport> = {
    time: 0,
    elapsed: 0,
    delta: 0,
    frame: 0,
    running: false,
  };

  const output: Mutable<SialkOutput> = {
    width: Math.max(1, Math.trunc(finite(options.output.width))),
    height: Math.max(1, Math.trunc(finite(options.output.height))),
    fps: Math.max(1, finite(options.output.fps)),
  };

  const parameterStore = new ParameterStore();

  // Rule 7: the host never throws into the sketch. A descriptor it cannot use
  // comes back as a message for the host to report, and the sketch runs on
  // without that parameter — which is also how a v1 host meets a sketch written
  // against a later version that has types it does not know.
  const parameters: SialkParameters = {
    declare(descriptors) {
      const before = parameterStore.adopted;
      for (const message of parameterStore.declare(descriptors)) {
        writer.onParameterProblem?.(message);
      }
      if (parameterStore.adopted > before) {
        writer.onParameterDeclared?.(describeDescriptors(parameterStore.declared));
      }
    },
    values: parameterStore.values,
    declared: parameterStore.declared,
  };

  const global: SialkGlobal = {
    contractVersion: CONTRACT_VERSION,
    host: { name: options.host.name, version: options.host.version },
    audio,
    transport,
    output,
    parameters,
    on: emitter.on,
    off: emitter.off,
  };

  let silentFor = SILENCE_TIMEOUT_SECONDS;
  let secondsSinceBeat = Number.POSITIVE_INFINITY;

  const writer: ContractWriter = {
    global,
    silenceThreshold: 0.001,

    writeAudio(frame) {
      audio.level = clamp01(frame.level);
      audio.bass = clamp01(frame.bass);
      audio.mid = clamp01(frame.mid);
      audio.high = clamp01(frame.high);
      audio.percussive = clamp01(frame.percussive);
      audio.harmonic = clamp01(frame.harmonic);
      audio.bpm = Math.max(0, finite(frame.bpm));
      audio.bpmConfidence = clamp01(frame.bpmConfidence);

      // Stems, refilled in place; the tail zeroed rather than left at last
      // frame's values, exactly as the spectrum's tail is.
      const incoming = frame.stems ?? [];
      audio.stemCount = Math.min(incoming.length, MAX_STEMS);
      for (let i = 0; i < MAX_STEMS; i += 1) {
        const stem = stems[i]!;
        const from = i < audio.stemCount ? incoming[i] : undefined;
        stem.level = clamp01(from?.level ?? 0);
        stem.bass = clamp01(from?.bass ?? 0);
        stem.mid = clamp01(from?.mid ?? 0);
        stem.high = clamp01(from?.high ?? 0);
      }

      const bins = Math.min(frame.spectrum.length, SPECTRUM_BINS);
      for (let i = 0; i < bins; i += 1) {
        spectrum[i] = clamp01(frame.spectrum[i] ?? 0);
      }
      // A short input leaves the tail at zero rather than at last frame's values.
      for (let i = bins; i < SPECTRUM_BINS; i += 1) spectrum[i] = 0;

      // [0] is newest, so the trail shifts back one slot each frame.
      levelTrail.copyWithin(1, 0, LEVEL_TRAIL_FRAMES - 1);
      levelTrail[0] = audio.level;

      silentFor = audio.level > writer.silenceThreshold ? 0 : silentFor + transport.delta;
      audio.silent = silentFor >= SILENCE_TIMEOUT_SECONDS;

      if (frame.onsetStrength > 0) {
        audio.hits += 1;
        emitter.emit('onset', { hits: audio.hits, strength: clamp01(frame.onsetStrength) });
      }

      if (frame.beat) {
        secondsSinceBeat = 0;
        audio.onBeat = 1;
        emitter.emit('beat', { bpm: audio.bpm, confidence: audio.bpmConfidence });
      } else {
        secondsSinceBeat += transport.delta;
        // Decay linearly across the interval to the next expected beat. With no
        // usable tempo there is no interval to decay across, so onBeat is a
        // single-frame flag and drops straight to 0.
        const beatInterval = audio.bpm > 0 ? 60 / audio.bpm : 0;
        audio.onBeat = beatInterval > 0 ? clamp01(1 - secondsSinceBeat / beatInterval) : 0;
      }

      // The beat clock, derived after the beat is settled for this frame.
      // Needed by anything tempo-synced, and approximating it from `hits`
      // and `bpm` inside a sketch does it worse.
      const beatSeconds = audio.bpm > 0 ? 60 / audio.bpm : 0;
      audio.beatPhase =
        beatSeconds > 0 && Number.isFinite(secondsSinceBeat)
          ? Math.min(1, secondsSinceBeat / beatSeconds)
          : 0;
    },

    writeTransport(frame) {
      const delta = Math.max(0, finite(frame.delta));
      transport.delta = delta;
      transport.time = finite(frame.time);
      transport.elapsed += delta;
      transport.frame += 1;
      const wasRunning = transport.running;
      transport.running = frame.running;
      if (wasRunning !== frame.running) {
        emitter.emit('transport', { time: transport.time, running: transport.running });
      }
    },

    setParameter(name, value) {
      if (parameterStore.set(name, value)) {
        emitter.emit('parameter', { name, value: parameterStore.values[name]! });
      }
    },

    fireParameter(name) {
      if (parameterStore.fire(name)) {
        emitter.emit('parameter', { name, value: parameterStore.values[name]! });
      }
    },

    writeOutput(next) {
      const width = Math.max(1, Math.trunc(finite(next.width)));
      const height = Math.max(1, Math.trunc(finite(next.height)));
      output.fps = Math.max(1, finite(next.fps));
      if (width === output.width && height === output.height) return;
      output.width = width;
      output.height = height;
      emitter.emit('resize', { width, height });
    },
  };

  return writer;
}
