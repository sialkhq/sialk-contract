import { describe, expect, it, vi } from 'vitest';
import {
  adoptDescriptors,
  createContract,
  describeDescriptors,
  type PlainDescriptors,
} from '../src/index.js';

/**
 * A declaration has to leave the sketch's own renderer.
 *
 * Until this existed, `declare()` filled a store inside the layer's preload and
 * nobody else ever learned of it — so the main process could not bind what it
 * did not know was there, and a show file could not cache it.
 */

const writer = (): ReturnType<typeof createContract> =>
  createContract({ host: { name: 'sialk', version: '0.1.0' }, output: { width: 16, height: 9, fps: 60 } });

describe('onParameterDeclared', () => {
  it('fires with everything declared so far, not only the new ones', () => {
    const contract = writer();
    const seen = vi.fn();
    contract.onParameterDeclared = seen;

    contract.global.parameters.declare({ speed: { type: 'number', default: 1, min: 0, max: 4 } });
    contract.global.parameters.declare({ lit: { type: 'boolean', default: true } });

    expect(seen).toHaveBeenCalledTimes(2);
    // The host caches a set. Handing it a delta would leave the two to drift.
    expect(Object.keys(seen.mock.calls[1]![0] as PlainDescriptors).sort()).toEqual(['lit', 'speed']);
  });

  it('leaves a rejected descriptor out, and still reports it as a problem', () => {
    const contract = writer();
    const declared = vi.fn();
    const problems: string[] = [];
    contract.onParameterDeclared = declared;
    contract.onParameterProblem = (message) => problems.push(message);

    contract.global.parameters.declare({
      good: { type: 'number', default: 0, min: 0, max: 1 },
      bad: { type: 'sausage' },
    });

    expect(Object.keys(declared.mock.calls[0]![0] as PlainDescriptors)).toEqual(['good']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('sausage');
  });

  it('fires on a redeclaration that changes nothing', () => {
    // The host cannot tell without comparing, and the set is small. Firing
    // twice costs nothing; missing a change costs a parameter that never binds.
    const contract = writer();
    const seen = vi.fn();
    contract.onParameterDeclared = seen;
    const descriptor = { size: { type: 'number', default: 1, min: 0, max: 2 } };
    contract.global.parameters.declare(descriptor);
    contract.global.parameters.declare(descriptor);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('says nothing when the whole declaration was refused', () => {
    const contract = writer();
    const seen = vi.fn();
    contract.onParameterDeclared = seen;
    contract.global.parameters.declare('not an object');
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('describeDescriptors', () => {
  it('writes a colour as hex, because JSON cannot carry a Float32Array', () => {
    const contract = writer();
    contract.global.parameters.declare({ tint: { type: 'colour', default: '#ff8800' } });
    const plain = describeDescriptors(contract.global.parameters.declared);
    // JSON.stringify(new Float32Array([1,0,0,1])) is {"0":1,…} — an object on
    // the way back, and not an array. Hex is what authors write anyway.
    expect(plain['tint']).toMatchObject({ type: 'colour', default: '#ff8800ff' });
    expect(JSON.parse(JSON.stringify(plain))).toEqual(plain);
  });

  it('round-trips every type unchanged', () => {
    const contract = writer();
    contract.global.parameters.declare({
      speed: { type: 'number', default: 2, min: 0, max: 4, step: 0.5, unit: 'x', label: 'Speed' },
      lit: { type: 'boolean', default: true, description: 'the lamp' },
      mode: { type: 'enum', default: 'b', options: ['a', 'b', 'c'], group: 'look' },
      tint: { type: 'colour', default: '#102030' },
      burst: { type: 'trigger', label: 'Burst' },
    });

    const plain = describeDescriptors(contract.global.parameters.declared);
    const { declared, problems } = adoptDescriptors(JSON.parse(JSON.stringify(plain)));

    expect(problems).toEqual([]);
    expect(declared['speed']).toEqual(contract.global.parameters.declared['speed']);
    expect(declared['lit']).toEqual(contract.global.parameters.declared['lit']);
    expect(declared['mode']).toEqual(contract.global.parameters.declared['mode']);
    expect(declared['burst']).toEqual(contract.global.parameters.declared['burst']);
    const tint = declared['tint'];
    const original = contract.global.parameters.declared['tint'];
    if (tint?.type !== 'colour' || original?.type !== 'colour') throw new Error('not a colour');
    for (let i = 0; i < 4; i += 1) {
      expect(tint.default[i]).toBeCloseTo(original.default[i]!, 2);
    }
  });
});

describe('adoptDescriptors', () => {
  it('drops an unknown type by name and keeps the rest of the set', () => {
    // A v1 host meeting a show written by a later one. Contract rule 7: the
    // sketch runs on without that parameter rather than not running.
    const { declared, problems } = adoptDescriptors({
      speed: { type: 'number', default: 1, min: 0, max: 2 },
      curve: { type: 'bezier', default: [0, 1] },
    } as unknown as PlainDescriptors);

    expect(Object.keys(declared)).toEqual(['speed']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('curve');
    expect(problems[0]).toContain('bezier');
  });

  it('survives a set that is not an object at all', () => {
    expect(adoptDescriptors(undefined as unknown as PlainDescriptors).declared).toEqual({});
  });
});
