import { describe, expect, it } from 'vitest';
import { ParameterStore } from '../src/index.js';

describe('ParameterStore', () => {
  it('exposes a declared parameter at its default', () => {
    const store = new ParameterStore();
    store.declare({ speed: { type: 'number', default: 1, min: 0, max: 4 } });

    expect(store.values['speed']).toBe(1);
  });

  it('keeps the same values object when parameters are added', () => {
    const store = new ParameterStore();
    const values = store.values;
    store.declare({ speed: { type: 'number', default: 1, min: 0, max: 4 } });
    store.declare({ tilt: { type: 'number', default: 0, min: -1, max: 1 } });

    expect(store.values).toBe(values);
    expect(Object.keys(values)).toEqual(['speed', 'tilt']);
  });

  it('reports a rejected descriptor and declares nothing for it', () => {
    const store = new ParameterStore();
    const rejected = store.declare({ thing: { type: 'gradient' } });

    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toContain('gradient');
    expect('thing' in store.values).toBe(false);
  });

  it('clamps a value written outside the declared range', () => {
    const store = new ParameterStore();
    store.declare({ speed: { type: 'number', default: 1, min: 0, max: 4 } });
    store.set('speed', 99);

    expect(store.values['speed']).toBe(4);
  });

  it('quantises to the declared step', () => {
    const store = new ParameterStore();
    store.declare({ speed: { type: 'number', default: 0, min: 0, max: 1, step: 0.25 } });
    store.set('speed', 0.6);

    expect(store.values['speed']).toBe(0.5);
  });

  it('refuses an enum value that is not one of the options', () => {
    const store = new ParameterStore();
    store.declare({ palette: { type: 'enum', default: 'warm', options: ['warm', 'cool'] } });
    store.set('palette', 'chartreuse');

    expect(store.values['palette']).toBe('warm');
  });

  /** Contract rule 4's precedent: a sketch uploads this to a uniform every frame. */
  it('keeps the same Float32Array for a colour and refills it in place', () => {
    const store = new ParameterStore();
    store.declare({ tint: { type: 'colour', default: '#ff8800' } });
    const colour = store.values['tint'] as Float32Array;
    store.set('tint', '#0000ff');

    expect(store.values['tint']).toBe(colour);
    expect(Array.from(colour)).toEqual([0, 0, 1, 1]);
  });

  it('counts a trigger upwards and never resets it', () => {
    const store = new ParameterStore();
    store.declare({ burst: { type: 'trigger' } });
    store.fire('burst');
    store.fire('burst');

    expect(store.values['burst']).toBe(2);
  });

  it('reports whether a write actually changed anything', () => {
    const store = new ParameterStore();
    store.declare({ speed: { type: 'number', default: 1, min: 0, max: 4 } });

    expect(store.set('speed', 2)).toBe(true);
    expect(store.set('speed', 2)).toBe(false);
  });

  /** Guarantee 11: an author widening a slider must not lose the performer's setting. */
  it('keeps a value through a redeclaration that still admits it', () => {
    const store = new ParameterStore();
    store.declare({ speed: { type: 'number', default: 1, min: 0, max: 4 } });
    store.set('speed', 3);
    store.declare({ speed: { type: 'number', default: 1, min: 0, max: 8 } });

    expect(store.values['speed']).toBe(3);
  });

  it('takes the new default when a redeclaration no longer admits the value', () => {
    const store = new ParameterStore();
    store.declare({ speed: { type: 'number', default: 1, min: 0, max: 4 } });
    store.set('speed', 3);
    store.declare({ speed: { type: 'number', default: 0.5, min: 0, max: 1 } });

    expect(store.values['speed']).toBe(0.5);
  });

  it('takes the new default when a redeclaration changes the type', () => {
    const store = new ParameterStore();
    store.declare({ speed: { type: 'number', default: 1, min: 0, max: 4 } });
    store.declare({ speed: { type: 'boolean', default: true } });

    expect(store.values['speed']).toBe(true);
  });

  it('keeps a trigger counter across a redeclaration, so nothing appears to fire', () => {
    const store = new ParameterStore();
    store.declare({ burst: { type: 'trigger' } });
    store.fire('burst');
    store.declare({ burst: { type: 'trigger', label: 'Burst' } });

    expect(store.values['burst']).toBe(1);
  });

  it('ignores a write to something never declared', () => {
    const store = new ParameterStore();

    expect(store.set('nothing', 1)).toBe(false);
  });

  it('ignores a write to a trigger, which only ever fires', () => {
    const store = new ParameterStore();
    store.declare({ burst: { type: 'trigger' } });

    expect(store.set('burst', 5)).toBe(false);
    expect(store.values['burst']).toBe(0);
  });
});
