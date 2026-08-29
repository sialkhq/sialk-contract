// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { assertConformance } from '@sialk/audio-contract';
import { installShim, type ShimAudioSource, type ShimHandle } from '../src/index.js';

/**
 * The shim inherits `parameters` from `createContract`, so this passes by
 * construction. It is written anyway: the shim is a separate delivery path with
 * its own install sequence, and "it works by construction" is the reasoning
 * that produced three separate defects on 25 Aug.
 */

const silence = (): ShimAudioSource => ({
  sampleRate: 48_000,
  read(into) {
    into.fill(0);
  },
  close() {},
});

let handle: ShimHandle;

beforeAll(async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  document.body.append(canvas);

  handle = await installShim({
    source: { kind: 'custom', create: silence },
    fftSize: 2048,
    schedule: () => {},
  });
});

describe('parameters under the shim', () => {
  it('offers the surface a sketch declares against', () => {
    expect(typeof handle.sialk.parameters.declare).toBe('function');
  });

  it('holds a declared number at its default rather than crashing', () => {
    handle.sialk.parameters.declare({ speed: { type: 'number', default: 2, min: 0, max: 4 } });

    expect(handle.sialk.parameters.values['speed']).toBe(2);
  });

  it('gives a colour the same array shape the application would', () => {
    handle.sialk.parameters.declare({ tint: { type: 'colour', default: '#ff0000' } });

    expect(Array.from(handle.sialk.parameters.values['tint'] as Float32Array)).toEqual([
      1, 0, 0, 1,
    ]);
  });

  it('starts a trigger at zero', () => {
    handle.sialk.parameters.declare({ burst: { type: 'trigger' } });

    expect(handle.sialk.parameters.values['burst']).toBe(0);
  });

  it('stays conformant with parameters declared', () => {
    expect(() => assertConformance(handle.sialk)).not.toThrow();
  });
});
