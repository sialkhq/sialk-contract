import { LEVEL_TRAIL_FRAMES, MAX_STEMS, SPECTRUM_BINS } from './constants.js';

/**
 * Runtime conformance check for a `window.sialk` candidate.
 *
 * This exists because the contract is the asset. Anything claiming to host
 * Sialk content — the application, the shim, a third party — can be held to the
 * same check, and the tests hold every one of them to it.
 */
export function checkConformance(candidate: unknown): string[] {
  const problems: string[] = [];
  const fail = (message: string): void => {
    problems.push(message);
  };

  if (typeof candidate !== 'object' || candidate === null) {
    return ['window.sialk is not an object'];
  }
  const sialk = candidate as Record<string, unknown>;

  if (typeof sialk['contractVersion'] !== 'string') fail('contractVersion is not a string');
  if (typeof sialk['on'] !== 'function') fail('on() is missing');
  if (typeof sialk['off'] !== 'function') fail('off() is missing');

  const host = sialk['host'] as Record<string, unknown> | undefined;
  if (!host || typeof host['name'] !== 'string' || typeof host['version'] !== 'string') {
    fail('host must carry string name and version');
  }

  const audio = sialk['audio'] as Record<string, unknown> | undefined;
  if (!audio) {
    fail('audio is missing');
  } else {
    for (const key of [
      'level',
      'bass',
      'mid',
      'high',
      'hits',
      'onBeat',
      'beatPhase',
      'bpm',
      'bpmConfidence',
    ]) {
      const value = audio[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        fail(`audio.${key} must be a finite number, got ${String(value)}`);
      }
    }
    for (const key of ['level', 'bass', 'mid', 'high', 'onBeat', 'beatPhase', 'bpmConfidence']) {
      const value = audio[key];
      if (typeof value === 'number' && (value < 0 || value > 1)) {
        fail(`audio.${key} must be within 0..1, got ${value}`);
      }
    }
    if (typeof audio['silent'] !== 'boolean') fail('audio.silent must be a boolean');
    const spectrum = audio['spectrum'];
    if (!(spectrum instanceof Float32Array) || spectrum.length !== SPECTRUM_BINS) {
      fail(`audio.spectrum must be a Float32Array of ${SPECTRUM_BINS}`);
    }
    const trail = audio['levelTrail'];
    if (!(trail instanceof Float32Array) || trail.length !== LEVEL_TRAIL_FRAMES) {
      fail(`audio.levelTrail must be a Float32Array of ${LEVEL_TRAIL_FRAMES}`);
    }
    // 1.2.0: always MAX_STEMS entries, zeros past stemCount — the identity rule.
    const stems = audio['stems'];
    if (!Array.isArray(stems) || stems.length !== MAX_STEMS) {
      fail(`audio.stems must be an array of ${MAX_STEMS}`);
    } else {
      for (const [index, stem] of stems.entries()) {
        for (const key of ['level', 'bass', 'mid', 'high']) {
          const value = (stem as Record<string, unknown>)[key];
          if (typeof value !== 'number' || !(value >= 0) || value > 1) {
            fail(`audio.stems[${index}].${key} must be within 0..1, got ${String(value)}`);
          }
        }
      }
    }
    const stemCount = audio['stemCount'];
    if (
      typeof stemCount !== 'number' ||
      !Number.isInteger(stemCount) ||
      stemCount < 0 ||
      stemCount > MAX_STEMS
    ) {
      fail(`audio.stemCount must be an integer within 0..${MAX_STEMS}`);
    }
  }

  const parameters = sialk['parameters'] as Record<string, unknown> | undefined;
  if (!parameters) {
    fail('parameters is missing');
  } else {
    if (typeof parameters['declare'] !== 'function') fail('parameters.declare() is missing');
    for (const key of ['values', 'declared']) {
      if (typeof parameters[key] !== 'object' || parameters[key] === null) {
        fail(`parameters.${key} must be an object`);
      }
    }
  }

  const transport = sialk['transport'] as Record<string, unknown> | undefined;
  if (!transport) {
    fail('transport is missing');
  } else {
    for (const key of ['time', 'elapsed', 'delta', 'frame']) {
      const value = transport[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        fail(`transport.${key} must be a finite number, got ${String(value)}`);
      }
    }
    if (typeof transport['running'] !== 'boolean') fail('transport.running must be a boolean');
  }

  const output = sialk['output'] as Record<string, unknown> | undefined;
  if (!output) {
    fail('output is missing');
  } else {
    for (const key of ['width', 'height', 'fps']) {
      const value = output[key];
      if (typeof value !== 'number' || !(value > 0)) {
        fail(`output.${key} must be a positive number, got ${String(value)}`);
      }
    }
  }

  return problems;
}

export function assertConformance(candidate: unknown): void {
  const problems = checkConformance(candidate);
  if (problems.length > 0) {
    throw new Error(`sialk contract violation:\n  - ${problems.join('\n  - ')}`);
  }
}
