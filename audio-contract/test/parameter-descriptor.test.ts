import { describe, expect, it } from 'vitest';
import { normaliseDescriptor, parseColour } from '../src/index.js';

const ok = (input: unknown) => {
  const result = normaliseDescriptor('speed', input);
  if ('rejected' in result) throw new Error(`unexpectedly rejected: ${result.rejected}`);
  return result.descriptor;
};

describe('normaliseDescriptor', () => {
  it('keeps a number descriptor and its bounds', () => {
    expect(ok({ type: 'number', default: 1, min: 0, max: 4 })).toMatchObject({
      type: 'number',
      default: 1,
      min: 0,
      max: 4,
    });
  });

  it('clamps a default that sits outside its own range', () => {
    const descriptor = ok({ type: 'number', default: 9, min: 0, max: 4 });
    expect(descriptor.type === 'number' && descriptor.default).toBe(4);
  });

  it('rejects a number whose range is inverted, naming the parameter', () => {
    const result = normaliseDescriptor('speed', { type: 'number', default: 1, min: 4, max: 0 });

    expect('rejected' in result && result.rejected).toContain('speed');
  });

  it('rejects an enum with no options', () => {
    const result = normaliseDescriptor('palette', { type: 'enum', default: 'warm', options: [] });

    expect('rejected' in result).toBe(true);
  });

  it('takes the first option when an enum default is not one of them', () => {
    const descriptor = ok({ type: 'enum', default: 'nope', options: ['warm', 'cool'] });
    expect(descriptor.type === 'enum' && descriptor.default).toBe('warm');
  });

  /**
   * Contract rule 7: the host never throws into the sketch. An unknown type is
   * how a v1 host meets a sketch written for a later one, so it comes back as a
   * message and the sketch keeps running without that parameter.
   */
  it('rejects a type it does not recognise, naming the type', () => {
    const result = normaliseDescriptor('thing', { type: 'gradient', default: 0 });

    expect('rejected' in result && result.rejected).toContain('gradient');
  });

  it('defaults a label to the parameter name', () => {
    expect(ok({ type: 'boolean', default: false }).label).toBe('speed');
  });

  it('accepts a trigger, which has no value of its own', () => {
    expect(ok({ type: 'trigger' }).type).toBe('trigger');
  });

  it('rejects something that is not a descriptor at all', () => {
    expect('rejected' in normaliseDescriptor('speed', 42)).toBe(true);
  });
});

describe('parseColour', () => {
  it('reads six-digit hex as full-alpha rgba', () => {
    const colour = parseColour('#ff8800');

    expect(colour?.[0]).toBe(1);
    expect(colour?.[1]).toBeCloseTo(0.533, 3);
    expect(colour?.[2]).toBe(0);
    expect(colour?.[3]).toBe(1);
  });

  it('reads eight-digit hex including alpha', () => {
    expect(parseColour('#00000080')?.[3]).toBeCloseTo(0.502, 3);
  });

  it('expands three-digit shorthand', () => {
    expect(Array.from(parseColour('#f00') ?? [])).toEqual([1, 0, 0, 1]);
  });

  it('reads a four-number array as given', () => {
    expect(Array.from(parseColour([1, 0, 0, 0.5]) ?? [])).toEqual([1, 0, 0, 0.5]);
  });

  it('returns nothing for something that is not a colour', () => {
    expect(parseColour('teal')).toBeUndefined();
  });
});
