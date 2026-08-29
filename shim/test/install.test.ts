// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { assertConformance } from '@sialk/audio-contract';
import { installShim, type ShimAudioSource, type ShimHandle } from '../src/index.js';

const SAMPLE_RATE = 48_000;
const FFT_SIZE = 2048;

let ticks: ((timestampMs: number) => void)[] = [];
let handle: ShimHandle;
let closed = false;
let phase = 0;

/** A 220 Hz sine, loud enough to be unambiguously audible to the analyser. */
function toneSource(): ShimAudioSource {
  return {
    sampleRate: SAMPLE_RATE,
    read(into) {
      for (let i = 0; i < into.length; i += 1) {
        into[i] = 0.9 * Math.sin((2 * Math.PI * 220 * phase) / SAMPLE_RATE);
        phase += 1;
      }
    },
    close() {
      closed = true;
    },
  };
}

/** Drives the shim's frame loop by hand, at a nominal 60 fps. */
function advance(frames: number): void {
  for (let i = 0; i < frames; i += 1) {
    const next = ticks.shift();
    if (!next) return;
    next(performanceNow());
  }
}

let now = 0;
const performanceNow = (): number => (now += 1000 / 60);

beforeAll(async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  document.body.append(canvas);

  handle = await installShim({
    source: { kind: 'custom', create: toneSource },
    fftSize: FFT_SIZE,
    schedule: (callback) => ticks.push(callback),
  });
});

describe('installShim', () => {
  it('installs a conformant contract on the global before returning', () => {
    expect(handle.passthrough).toBe(false);
    expect((globalThis as { sialk?: unknown }).sialk).toBe(handle.sialk);
    expect(() => assertConformance(handle.sialk)).not.toThrow();
    expect(handle.sialk.host).toEqual({ name: 'shim', version: '1.0.0' });
  });

  it('refuses to be replaced once installed', () => {
    expect(() => {
      (globalThis as unknown as Record<string, unknown>)['sialk'] = { impostor: true };
    }).toThrow();
  });

  it('takes the output surface from the canvas on the page', () => {
    advance(1);
    expect(handle.sialk.output).toEqual({ width: 1280, height: 720, fps: 60 });
  });

  it('advances the transport once per scheduled frame', () => {
    const before = handle.sialk.transport.frame;
    advance(10);
    expect(handle.sialk.transport.frame).toBe(before + 10);
    expect(handle.sialk.transport.elapsed).toBeGreaterThan(0);
    expect(handle.sialk.transport.delta).toBeGreaterThan(0);
  });

  it('drives audio from the source, and stays conformant every frame', () => {
    advance(60);
    expect(handle.sialk.audio.level).toBeGreaterThan(0);
    expect(handle.sialk.audio.silent).toBe(false);
    expect(handle.sialk.audio.levelTrail[0]).toBeCloseTo(handle.sialk.audio.level, 5);
    expect(Math.max(...handle.sialk.audio.spectrum)).toBeGreaterThan(0);
    expect(() => assertConformance(handle.sialk)).not.toThrow();
  });

  it('keeps buffer identity stable, so a sketch can upload them every frame', () => {
    const { spectrum, levelTrail } = handle.sialk.audio;
    advance(30);
    expect(handle.sialk.audio.spectrum).toBe(spectrum);
    expect(handle.sialk.audio.levelTrail).toBe(levelTrail);
  });

  it('stops cleanly, closing the source and leaving the contract readable', () => {
    handle.stop();
    const frame = handle.sialk.transport.frame;

    ticks = [];
    advance(5);

    expect(closed).toBe(true);
    expect(handle.sialk.transport.frame).toBe(frame);
    expect(() => assertConformance(handle.sialk)).not.toThrow();
  });
});

describe('restarting', () => {
  it('reuses the same contract, so references a sketch destructured still work', async () => {
    const first = handle.sialk;
    const { audio: firstAudio, spectrum } = { audio: first.audio, spectrum: first.audio.spectrum };

    const again = await installShim({
      source: { kind: 'custom', create: toneSource },
      fftSize: FFT_SIZE,
      schedule: (callback) => ticks.push(callback),
    });

    expect(again.sialk).toBe(first);
    expect(again.sialk.audio).toBe(firstAudio);
    expect(again.sialk.audio.spectrum).toBe(spectrum);

    advance(30);
    expect(again.sialk.audio.level).toBeGreaterThan(0);
    again.stop();
  });

  it('drops audio to zero on stop rather than leaving stale values on screen', async () => {
    const again = await installShim({
      source: { kind: 'custom', create: toneSource },
      fftSize: FFT_SIZE,
      schedule: (callback) => ticks.push(callback),
    });
    advance(30);
    expect(again.sialk.audio.level).toBeGreaterThan(0);

    again.stop();

    expect(again.sialk.audio.level).toBe(0);
    expect(again.sialk.audio.bass).toBe(0);
    expect(Math.max(...again.sialk.audio.spectrum)).toBe(0);
  });
});
