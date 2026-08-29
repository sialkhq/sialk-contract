import {
  CONTRACT_MAJOR,
  UnsupportedContractVersionError,
  createContract,
  installContract,
  readRequestedMajor,
  type SialkGlobal,
} from '@sialk/audio-contract';
import { AudioAnalyser } from '@sialk/audio-engine';
import type { ContractWriter } from '@sialk/audio-contract';
import { connectSource, normaliseSource, type ShimSource } from './source.js';

export interface ShimOptions {
  /** Defaults to the microphone, which is what a sketch author has to hand. */
  source?: ShimSource | 'microphone' | 'silent';
  /** Defaults to the first canvas on the page, else the window. */
  surface?: HTMLCanvasElement | { width: number; height: number };
  fps?: number;
  fftSize?: number;
  /**
   * Frame scheduler. Defaults to `requestAnimationFrame`. Replace it when the
   * sketch is not being driven by a display — an offline render, or a test.
   */
  schedule?: (callback: (timestampMs: number) => void) => void;
  /**
   * Major contract version this sketch expects. Defaults to reading
   * `<meta name="sialk-contract">`, and to v1 when the page carries no tag.
   */
  contractMajor?: number;
}

export interface ShimHandle {
  /** True when a real Sialk host was already present and the shim stood down. */
  readonly passthrough: boolean;
  /** The contract the sketch will read. Identical to `window.sialk`. */
  readonly sialk: SialkGlobal;
  stop(): void;
}

const SHIM_VERSION = '1.0.0';

/**
 * The contract this shim installed, if it already has.
 *
 * Rule 3 of the contract is that object identity is stable for the sketch's
 * whole life. Stopping and restarting the microphone must therefore reconnect
 * the audio source to the *existing* contract rather than build a second one —
 * otherwise every reference a sketch destructured at startup goes stale, and
 * the global itself cannot be redefined in any case.
 */
let installed: ContractWriter | undefined;

/**
 * Makes an existing sketch contract-compliant, and lets it run outside Sialk.
 *
 * The adoption barrier has to be minutes, not hours, so this is the whole
 * integration: one import, one call. Inside Sialk the host has already
 * installed the real contract and this stands down, which is what lets the same
 * file run on a laptop and on stage unchanged.
 */
export async function installShim(options: ShimOptions = {}): Promise<ShimHandle> {
  const existing = (globalThis as { sialk?: SialkGlobal }).sialk;
  if (existing && existing.host?.name === 'sialk') {
    return { passthrough: true, sialk: existing, stop: () => {} };
  }

  // A sketch declares the major version it was written against, and a host
  // never silently substitutes a different one. The shim serves v1 only, so
  // today this can only refuse — but a promise that has never selected anything
  // is not a promise, and this is where the mechanism gets exercised.
  const requestedMajor = options.contractMajor ?? readRequestedMajorFromPage();
  if (requestedMajor !== CONTRACT_MAJOR) {
    throw new UnsupportedContractVersionError(requestedMajor, CONTRACT_MAJOR);
  }

  const fps = options.fps ?? 60;
  const fftSize = options.fftSize ?? 2048;
  const schedule = options.schedule ?? ((callback) => void requestAnimationFrame(callback));

  const writer =
    installed ??
    createContract({
      host: { name: 'shim', version: SHIM_VERSION },
      output: resolveSurface(options.surface, fps),
    });
  if (!installed) {
    installContract(globalThis, writer.global);
    installed = writer;
  }

  const audio = await connectSource(normaliseSource(options.source), fftSize);
  const analyser = new AudioAnalyser({ sampleRate: audio.sampleRate, fftSize, frameRate: fps });
  const samples = new Float32Array(fftSize);

  let running = true;
  let lastTimestamp: number | undefined;

  const frame = (timestampMs: number): void => {
    if (!running) return;
    // The first frame has no previous frame to measure against, so it is given
    // the nominal interval rather than a delta of zero — a zero delta would
    // make the first envelope step and the first silence test meaningless.
    const delta = lastTimestamp === undefined ? 1 / fps : (timestampMs - lastTimestamp) / 1000;
    lastTimestamp = timestampMs;

    writer.writeOutput(resolveSurface(options.surface, fps));
    writer.writeTransport({ time: timestampMs / 1000, delta, running: true });

    audio.read(samples);
    writer.writeAudio(analyser.analyse(samples, delta));

    schedule(frame);
  };
  schedule(frame);

  return {
    passthrough: false,
    sialk: writer.global,
    stop() {
      if (!running) return;
      running = false;
      audio.close();
      // No audio is arriving, so say so rather than leaving the last live
      // values frozen on screen looking current.
      writer.writeAudio({
        level: 0,
        bass: 0,
        mid: 0,
        high: 0,
        spectrum: new Float32Array(0),
        onsetStrength: 0,
        beat: false,
        bpm: 0,
        bpmConfidence: 0,
      });
    },
  };
}

function resolveSurface(
  surface: ShimOptions['surface'],
  fps: number,
): { width: number; height: number; fps: number } {
  if (surface && 'width' in surface && 'height' in surface) {
    return { width: surface.width || 1, height: surface.height || 1, fps };
  }
  const canvas = typeof document === 'undefined' ? null : document.querySelector('canvas');
  if (canvas) return { width: canvas.width || 1, height: canvas.height || 1, fps };
  const width = typeof window === 'undefined' ? 1 : window.innerWidth || 1;
  const height = typeof window === 'undefined' ? 1 : window.innerHeight || 1;
  return { width, height, fps };
}

function readRequestedMajorFromPage(): number {
  if (typeof document === 'undefined') return CONTRACT_MAJOR;
  return readRequestedMajor(document);
}
