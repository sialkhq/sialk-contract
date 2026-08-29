// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { installShim } from '../src/index.js';

describe('running inside Sialk', () => {
  it('stands down when the real host has already installed the contract', async () => {
    // The whole point of the shim: the same file runs on a laptop and on stage.
    // On stage it must not touch the contract the host is writing to.
    const host = { contractVersion: '1.0.0', host: { name: 'sialk', version: '0.1.0' } };
    Object.defineProperty(globalThis, 'sialk', { value: host, configurable: true });

    let created = false;
    const handle = await installShim({
      source: {
        kind: 'custom',
        create: () => {
          created = true;
          return { sampleRate: 48_000, read: () => {}, close: () => {} };
        },
      },
      schedule: () => {
        throw new Error('the shim must not schedule frames inside Sialk');
      },
    });

    expect(handle.passthrough).toBe(true);
    expect(handle.sialk).toBe(host);
    expect(created).toBe(false);
    expect(() => handle.stop()).not.toThrow();
  });
});
