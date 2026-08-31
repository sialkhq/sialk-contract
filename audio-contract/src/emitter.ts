import type { SialkEventMap, SialkEventName, SialkListener } from './types.js';

/**
 * The contract's event surface. Deliberately tiny: it exists so a sketch can
 * react to a beat without polling, not to become a general message bus.
 *
 * A listener that throws is swallowed and reported, never propagated — contract rule 7
 * of the contract is that the host never throws into the sketch, and the
 * inverse is that a sketch never takes the host down.
 */
export class ContractEmitter {
  readonly #listeners = new Map<SialkEventName, Set<(detail: unknown) => void>>();
  readonly #onListenerError: (event: SialkEventName, error: unknown) => void;

  constructor(onListenerError?: (event: SialkEventName, error: unknown) => void) {
    this.#onListenerError =
      onListenerError ??
      ((event, error) => {
        console.error(`[sialk] listener for "${event}" threw`, error);
      });
  }

  on = <E extends SialkEventName>(event: E, listener: SialkListener<E>): (() => void) => {
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(listener as (detail: unknown) => void);
    return () => this.off(event, listener);
  };

  off = <E extends SialkEventName>(event: E, listener: SialkListener<E>): void => {
    this.#listeners.get(event)?.delete(listener as (detail: unknown) => void);
  };

  emit<E extends SialkEventName>(event: E, detail: SialkEventMap[E]): void {
    const set = this.#listeners.get(event);
    if (!set || set.size === 0) return;
    // Copy: a listener may unsubscribe itself while we are iterating.
    for (const listener of [...set]) {
      try {
        listener(detail);
      } catch (error) {
        this.#onListenerError(event, error);
      }
    }
  }

  listenerCount(event: SialkEventName): number {
    return this.#listeners.get(event)?.size ?? 0;
  }

  clear(): void {
    this.#listeners.clear();
  }
}
