import { describe, expect, it, vi } from 'vitest';
import { createContract } from '../src/index.js';

const contract = () =>
  createContract({
    host: { name: 'test', version: '0' },
    output: { width: 1, height: 1, fps: 60 },
  });

describe('window.sialk.parameters', () => {
  it('is present before a sketch declares anything', () => {
    expect(contract().global.parameters.values).toEqual({});
  });

  it('lets a sketch declare and read its own parameter', () => {
    const writer = contract();
    writer.global.parameters.declare({ speed: { type: 'number', default: 1, min: 0, max: 4 } });

    expect(writer.global.parameters.values['speed']).toBe(1);
    expect(writer.global.parameters.declared['speed']?.label).toBe('speed');
  });

  /** Contract rule 7: the host never throws into the sketch. */
  it('never throws into the sketch when a descriptor is unusable', () => {
    const writer = contract();
    const problems: string[] = [];
    writer.onParameterProblem = (message) => problems.push(message);

    expect(() => writer.global.parameters.declare({ x: { type: 'gradient' } })).not.toThrow();
    expect(problems[0]).toContain('gradient');
  });

  it('emits `parameter` when the host changes a value', () => {
    const writer = contract();
    const seen = vi.fn();
    writer.global.parameters.declare({ speed: { type: 'number', default: 1, min: 0, max: 4 } });
    writer.global.on('parameter', seen);
    writer.setParameter('speed', 2);

    expect(seen).toHaveBeenCalledWith({ name: 'speed', value: 2 });
  });

  it('does not emit when the value did not actually change', () => {
    const writer = contract();
    const seen = vi.fn();
    writer.global.parameters.declare({ speed: { type: 'number', default: 1, min: 0, max: 4 } });
    writer.global.on('parameter', seen);
    writer.setParameter('speed', 1);

    expect(seen).not.toHaveBeenCalled();
  });

  it('emits on every fire of a trigger', () => {
    const writer = contract();
    const seen = vi.fn();
    writer.global.parameters.declare({ burst: { type: 'trigger' } });
    writer.global.on('parameter', seen);
    writer.fireParameter('burst');
    writer.fireParameter('burst');

    expect(seen).toHaveBeenCalledTimes(2);
    expect(seen).toHaveBeenLastCalledWith({ name: 'burst', value: 2 });
  });

  it("keeps the identity of parameters and values for the contract's life", () => {
    const writer = contract();
    const { parameters } = writer.global;
    const { values } = parameters;
    writer.global.parameters.declare({ speed: { type: 'number', default: 1, min: 0, max: 4 } });

    expect(writer.global.parameters).toBe(parameters);
    expect(writer.global.parameters.values).toBe(values);
  });

  it('stays conformant once parameters are declared', async () => {
    const { checkConformance } = await import('../src/index.js');
    const writer = contract();
    writer.global.parameters.declare({ tint: { type: 'colour', default: '#ff8800' } });

    expect(checkConformance(writer.global)).toEqual([]);
  });
});
