import { describe, expect, it } from 'vitest';
import {
  MAX_STEMS,
  SPECTRUM_BINS,
  assertConformance,
  createContract,
  type AudioFrameInput,
  type ContractWriter,
} from '../src/index.js';

/**
 * The 1.2.0 addition, held to the same three promises every field makes:
 * present before the first frame, identity-stable forever, and zeros when the
 * input it describes is not there.
 */

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

function tick(writer: ContractWriter, audio: Partial<AudioFrameInput> = {}): void {
  const delta = 1 / 60;
  writer.writeTransport({ time: writer.global.transport.time + delta, delta, running: true });
  writer.writeAudio({ ...silentFrame, ...audio });
}

const stem = (level: number) => ({ level, bass: level, mid: level, high: level });

describe('stems (contract 1.2.0)', () => {
  it('exist before a single frame is written: MAX_STEMS entries, all zeros, count 0', () => {
    const { audio } = makeWriter().global;
    expect(audio.stems).toHaveLength(MAX_STEMS);
    expect(audio.stemCount).toBe(0);
    for (const each of audio.stems) {
      expect(each.level).toBe(0);
      expect(each.bass).toBe(0);
      expect(each.mid).toBe(0);
      expect(each.high).toBe(0);
    }
  });

  it('a frame without stems is a 1.0.0 frame — nothing changes, nothing throws', () => {
    const writer = makeWriter();
    tick(writer, { level: 0.5 });
    expect(writer.global.audio.stemCount).toBe(0);
    expect(() => assertConformance(writer.global)).not.toThrow();
  });

  it('keeps array and per-stem object identities across frames', () => {
    const writer = makeWriter();
    const stems = writer.global.audio.stems;
    const third = stems[3];
    tick(writer, { stems: [stem(0.2), stem(0.4), stem(0.6), stem(0.8)] });
    tick(writer, { stems: [stem(0.9)] });
    expect(writer.global.audio.stems).toBe(stems);
    expect(writer.global.audio.stems[3]).toBe(third);
  });

  it('writes each stem in place and zeros the tail rather than leaving last frame behind', () => {
    const writer = makeWriter();
    tick(writer, { stems: [stem(0.2), stem(0.4), stem(0.6), stem(0.8)] });
    expect(writer.global.audio.stemCount).toBe(4);
    expect(writer.global.audio.stems[1]!.level).toBeCloseTo(0.4);

    tick(writer, { stems: [stem(0.9)] });
    expect(writer.global.audio.stemCount).toBe(1);
    expect(writer.global.audio.stems[0]!.level).toBeCloseTo(0.9);
    // Stem 3 carried 0.8 one frame ago; a shorter input must not leave it there.
    expect(writer.global.audio.stems[3]!.level).toBe(0);
  });

  it('clamps to 0..1 and lands NaN on zero, like every other field', () => {
    const writer = makeWriter();
    tick(writer, { stems: [{ level: 4, bass: -2, mid: Number.NaN, high: 0.5 }] });
    const first = writer.global.audio.stems[0]!;
    expect(first.level).toBe(1);
    expect(first.bass).toBe(0);
    expect(first.mid).toBe(0);
    expect(first.high).toBe(0.5);
  });

  it('drops anything past MAX_STEMS rather than growing the array', () => {
    const writer = makeWriter();
    tick(writer, { stems: Array.from({ length: 12 }, () => stem(0.5)) });
    expect(writer.global.audio.stems).toHaveLength(MAX_STEMS);
    expect(writer.global.audio.stemCount).toBe(MAX_STEMS);
  });

  it('stays conformant while stems are live', () => {
    const writer = makeWriter();
    tick(writer, { stems: [stem(0.3), stem(0.7)] });
    expect(() => assertConformance(writer.global)).not.toThrow();
  });
});
