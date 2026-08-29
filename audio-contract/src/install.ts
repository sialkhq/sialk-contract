import { CONTRACT_MAJOR } from './constants.js';
import type { SialkGlobal } from './types.js';

/**
 * Reads `<meta name="sialk-contract" content="1">`.
 *
 * A sketch declares the major version it was written against. Absent the tag,
 * the host serves the highest v1 — which is what every sketch written before
 * the tag existed expects, and why the tag can be introduced without breaking
 * anything.
 */
export function readRequestedMajor(doc: Pick<Document, 'querySelector'>): number {
  const meta = doc.querySelector('meta[name="sialk-contract"]');
  const content = meta?.getAttribute('content')?.trim();
  if (!content) return CONTRACT_MAJOR;
  const major = Number.parseInt(content, 10);
  return Number.isInteger(major) && major > 0 ? major : CONTRACT_MAJOR;
}

export class UnsupportedContractVersionError extends Error {
  constructor(requested: number, served: number) {
    super(
      `This sketch asks for Sialk contract v${requested}; this host serves v${served}. ` +
        `A major version is never silently substituted.`,
    );
    this.name = 'UnsupportedContractVersionError';
  }
}

/**
 * Attaches the contract to a global scope.
 *
 * Rule 1 of the contract is that `window.sialk` exists before the sketch's
 * first line runs — so this is called from a preload script, never from page
 * script, and never lazily.
 */
export function installContract(scope: typeof globalThis, contract: SialkGlobal): void {
  Object.defineProperty(scope, 'sialk', {
    value: contract,
    writable: false,
    configurable: false,
    enumerable: true,
  });
}
