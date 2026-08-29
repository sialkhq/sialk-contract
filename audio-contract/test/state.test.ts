import { describe, expect, it } from 'vitest';
import {
  LEVEL_TRAIL_FRAMES,
  SILENCE_TIMEOUT_SECONDS,
  SPECTRUM_BINS,
  assertConformance,
  createContract,
  type AudioFrameInput,
  type ContractWriter,
} from '../src/index.js';

const silentFrame: AudioFrameInput = {
  level: 0,
  bass: 0,
  mid: 0,
  high: 0,
  spectrum: new Float32Array(SPECTRUM_BINS),
  onsetStrength: 0,
  beat: false,
  bpm: 0,
  bpmConfidence: 0,
};

function makeWriter(): ContractWriter {
  return createContract({
    host: { name: 'test', version: '0.0.0' },
    output: { width: 1920, height: 1080, fps: 60 },
  });
}

/** One composited frame: transport first, then audio — the host's required order. */
function tick(writer: ContractWriter, audio: Partial<AudioFrameInput> = {}, delta = 1 / 60): void {
  writer.writeTransport({ time: writer.global.transport.time + delta, delta, running: true });
  writer.writeAudio({ ...silentFrame, ...audio });
}

describe('contract guarantees', () => {
  it('is conformant before a single frame is written', () => {
    expect(() => assertConformance(makeWriter().global)).not.toThrow();
  });

  it('keeps object and buffer identities stable across frames', () => {
    const writer = makeWriter();
    const { audio, transport, output } = writer.global;
    const { spectrum, levelTrail } = audio;

    for (let i = 0; i < 10; i += 1) tick(writer, { level: 0.5 });

    expect(writer.global.audio).toBe(audio);
    expect(writer.global.transport).toBe(transport);
    expect(writer.global.output).toBe(output);
    expect(writer.global.audio.spectrum).toBe(spectrum);
    expect(writer.global.audio.levelTrail).toBe(levelTrail);
  });

  it('clamps out-of-range values and lands NaN on zero', () => {
    const writer = makeWriter();
    tick(writer, { level: 4, bass: -2, mid: Number.NaN, high: Number.POSITIVE_INFINITY });
    const { audio } = writer.global;
    expect(audio.level).toBe(1);
    expect(audio.bass).toBe(0);
    expect(audio.mid).toBe(0);
    expect(audio.high).toBe(1);
    expect(() => assertConformance(writer.global)).not.toThrow();
  });

  it('reports unknown tempo as zero rather than a guess', () => {
    const writer = makeWriter();
    tick(writer, { level: 0.8, bpm: Number.NaN, bpmConfidence: Number.NaN });
    expect(writer.global.audio.bpm).toBe(0);
    expect(writer.global.audio.bpmConfidence).toBe(0);
  });
});

describe('level trail', () => {
  it('puts the newest frame at index 0 and keeps its length', () => {
    const writer = makeWriter();
    tick(writer, { level: 0.25 });
    tick(writer, { level: 0.5 });
    tick(writer, { level: 0.75 });

    const trail = writer.global.audio.levelTrail;
    expect(trail.length).toBe(LEVEL_TRAIL_FRAMES);
    expect(trail[0]).toBeCloseTo(0.75, 5);
    expect(trail[1]).toBeCloseTo(0.5, 5);
    expect(trail[2]).toBeCloseTo(0.25, 5);
  });
});

describe('onsets and beats', () => {
  it('counts onsets monotonically so a dropped frame cannot lose one', () => {
    const writer = makeWriter();
    expect(writer.global.audio.hits).toBe(0);
    tick(writer, { level: 0.9, onsetStrength: 0.7 });
    tick(writer, { level: 0.9, onsetStrength: 0 });
    tick(writer, { level: 0.9, onsetStrength: 0.3 });
    expect(writer.global.audio.hits).toBe(2);
  });

  it('decays onBeat linearly across the interval to the next expected beat', () => {
    const writer = makeWriter();
    // 120 bpm — a beat every 0.5s. Step in quarter-beats.
    tick(writer, { level: 0.9, beat: true, bpm: 120, bpmConfidence: 0.9 }, 0.125);
    expect(writer.global.audio.onBeat).toBe(1);

    tick(writer, { level: 0.9, bpm: 120, bpmConfidence: 0.9 }, 0.125);
    expect(writer.global.audio.onBeat).toBeCloseTo(0.75, 5);

    tick(writer, { level: 0.9, bpm: 120, bpmConfidence: 0.9 }, 0.125);
    expect(writer.global.audio.onBeat).toBeCloseTo(0.5, 5);
  });

  it('drops onBeat to zero after one frame when tempo is unknown', () => {
    const writer = makeWriter();
    tick(writer, { level: 0.9, beat: true, bpm: 0 });
    expect(writer.global.audio.onBeat).toBe(1);
    tick(writer, { level: 0.9, bpm: 0 });
    expect(writer.global.audio.onBeat).toBe(0);
  });

  it('emits beat and onset to listeners, and unsubscribes via the returned function', () => {
    const writer = makeWriter();
    const beats: number[] = [];
    const stop = writer.global.on('beat', (detail) => beats.push(detail.bpm));

    tick(writer, { level: 0.9, beat: true, bpm: 128, bpmConfidence: 0.8 });
    stop();
    tick(writer, { level: 0.9, beat: true, bpm: 128, bpmConfidence: 0.8 });

    expect(beats).toEqual([128]);
  });

  it('survives a listener that throws', () => {
    const writer = makeWriter();
    const seen: string[] = [];
    writer.global.on('onset', () => {
      throw new Error('sketch bug');
    });
    writer.global.on('onset', () => seen.push('second listener still ran'));

    expect(() => writer.writeAudio({ ...silentFrame, level: 0.9, onsetStrength: 1 })).not.toThrow();
    expect(seen).toHaveLength(1);
  });
});

describe('silence', () => {
  it('starts silent, clears on signal, and returns after the timeout', () => {
    const writer = makeWriter();
    expect(writer.global.audio.silent).toBe(true);

    tick(writer, { level: 0.6 });
    expect(writer.global.audio.silent).toBe(false);

    const frames = Math.ceil(SILENCE_TIMEOUT_SECONDS * 60) + 1;
    for (let i = 0; i < frames; i += 1) tick(writer);
    expect(writer.global.audio.silent).toBe(true);
  });
});

describe('transport and output', () => {
  it('advances elapsed monotonically even when show time jumps backwards', () => {
    const writer = makeWriter();
    writer.writeTransport({ time: 10, delta: 1 / 60, running: true });
    writer.writeTransport({ time: 0, delta: 1 / 60, running: true });

    expect(writer.global.transport.time).toBe(0);
    expect(writer.global.transport.elapsed).toBeCloseTo(2 / 60, 6);
    expect(writer.global.transport.frame).toBe(2);
  });

  it('emits resize only when the surface actually changes', () => {
    const writer = makeWriter();
    const sizes: string[] = [];
    writer.global.on('resize', (d) => sizes.push(`${d.width}x${d.height}`));

    writer.writeOutput({ width: 1920, height: 1080, fps: 60 });
    writer.writeOutput({ width: 3840, height: 2160, fps: 60 });
    writer.writeOutput({ width: 3840, height: 2160, fps: 30 });

    expect(sizes).toEqual(['3840x2160']);
    expect(writer.global.output.fps).toBe(30);
  });
});
