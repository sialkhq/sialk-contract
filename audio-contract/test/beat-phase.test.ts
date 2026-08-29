import { describe, expect, it } from 'vitest';
import { createContract, type AudioFrameInput } from '../src/index.js';

const contract = () =>
  createContract({
    host: { name: 'test', version: '0' },
    output: { width: 1, height: 1, fps: 60 },
  });

const frame = (over: Partial<AudioFrameInput> = {}): AudioFrameInput => ({
  level: 0.5,
  bass: 0,
  mid: 0,
  high: 0,
  spectrum: new Float32Array(64),
  onsetStrength: 0,
  beat: false,
  bpm: 120,
  bpmConfidence: 1,
  ...over,
});

describe('audio.beatPhase', () => {
  it('is zero before any tempo is known', () => {
    const writer = contract();
    writer.writeTransport({ time: 0, delta: 1 / 60, running: true });
    writer.writeAudio(frame({ bpm: 0, bpmConfidence: 0 }));

    expect(writer.global.audio.beatPhase).toBe(0);
  });

  it('resets to zero on the frame a beat lands', () => {
    const writer = contract();
    writer.writeTransport({ time: 0, delta: 1 / 60, running: true });
    writer.writeAudio(frame({ beat: true }));

    expect(writer.global.audio.beatPhase).toBe(0);
  });

  /** At 120 bpm a beat is half a second. Half a beat later the ramp is halfway. */
  it('ramps from zero to one across the interval between beats', () => {
    const writer = contract();
    writer.writeTransport({ time: 0, delta: 0, running: true });
    writer.writeAudio(frame({ beat: true }));

    writer.writeTransport({ time: 0.25, delta: 0.25, running: true });
    writer.writeAudio(frame());

    expect(writer.global.audio.beatPhase).toBeCloseTo(0.5, 5);
  });

  /**
   * A phase that wrapped without a beat would step backwards, and anything
   * driven from it would stutter every time the detector missed one.
   */
  it('holds at one rather than wrapping when the next beat is late', () => {
    const writer = contract();
    writer.writeTransport({ time: 0, delta: 0, running: true });
    writer.writeAudio(frame({ beat: true }));

    writer.writeTransport({ time: 2, delta: 2, running: true });
    writer.writeAudio(frame());

    expect(writer.global.audio.beatPhase).toBe(1);
  });
});
