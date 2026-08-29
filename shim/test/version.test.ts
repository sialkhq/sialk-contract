// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { UnsupportedContractVersionError, readRequestedMajor } from '@sialk/audio-contract';
import { installShim } from '../src/index.js';

describe('contract version selection', () => {
  it('reads the major version a page declares', () => {
    document.head.innerHTML = '<meta name="sialk-contract" content="2" />';
    expect(readRequestedMajor(document)).toBe(2);
  });

  it('serves v1 to a page with no meta tag, which is every sketch written before it existed', () => {
    document.head.innerHTML = '';
    expect(readRequestedMajor(document)).toBe(1);
  });

  it('ignores a malformed tag rather than failing on it', () => {
    document.head.innerHTML = '<meta name="sialk-contract" content="banana" />';
    expect(readRequestedMajor(document)).toBe(1);
  });

  it('refuses a sketch asking for a major version this host does not serve', async () => {
    document.head.innerHTML = '<meta name="sialk-contract" content="2" />';

    await expect(
      installShim({
        source: 'silent',
        schedule: () => {
          throw new Error('must not start a frame loop it cannot serve');
        },
      }),
    ).rejects.toThrow(UnsupportedContractVersionError);
  });

  it('refuses before touching the global, so a failed install leaves nothing behind', async () => {
    document.head.innerHTML = '<meta name="sialk-contract" content="3" />';
    await expect(installShim({ source: 'silent' })).rejects.toThrow(/asks for Sialk contract v3/);
    expect((globalThis as { sialk?: unknown }).sialk).toBeUndefined();
  });
});
