import { normaliseDescriptor, parseColour, type ParameterDescriptor } from './descriptor.js';

export type ParameterValue = number | boolean | string | Float32Array;

/**
 * What the sketch reads and what the host writes.
 *
 * `values` is allocated once and mutated in place forever after, and a colour
 * keeps its `Float32Array` for life — the same guarantee `spectrum` and
 * `levelTrail` already make, for the same reason: a sketch destructures once at
 * startup and uploads straight to a uniform every frame, allocating nothing.
 */
export class ParameterStore {
  readonly values: Record<string, ParameterValue> = {};
  readonly #descriptors: Record<string, ParameterDescriptor> = {};
  #adopted = 0;

  /**
   * How many descriptors have ever been taken up. Monotonic.
   *
   * The host publishes the declared set upstream whenever this moves. It counts
   * rather than compares because a redeclaration that changes nothing is still
   * a declaration, and the alternative — diffing two descriptor sets on every
   * call — is more code to be wrong in for no gain on a set this small.
   */
  get adopted(): number {
    return this.#adopted;
  }

  get declared(): Readonly<Record<string, ParameterDescriptor>> {
    return this.#descriptors;
  }

  /** Returns a message for each descriptor that could not be used. */
  declare(input: unknown): string[] {
    if (typeof input !== 'object' || input === null) {
      return ['parameters.declare() expects an object of descriptors'];
    }

    const rejected: string[] = [];
    for (const [name, raw] of Object.entries(input as Record<string, unknown>)) {
      const result = normaliseDescriptor(name, raw);
      if ('rejected' in result) {
        rejected.push(result.rejected);
        continue;
      }
      this.#adopt(name, result.descriptor);
    }
    return rejected;
  }

  /** Host-side write. Returns whether the value actually changed. */
  set(name: string, value: unknown): boolean {
    const descriptor = this.#descriptors[name];
    if (!descriptor || descriptor.type === 'trigger') return false;

    if (descriptor.type === 'colour') {
      const parsed = parseColour(value);
      if (!parsed) return false;
      const held = this.values[name] as Float32Array;
      if (held.every((component, at) => component === parsed[at])) return false;
      held.set(parsed);
      return true;
    }

    const coerced = coerce(descriptor, value);
    if (coerced === undefined || this.values[name] === coerced) return false;
    this.values[name] = coerced;
    return true;
  }

  fire(name: string): boolean {
    if (this.#descriptors[name]?.type !== 'trigger') return false;
    this.values[name] = (this.values[name] as number) + 1;
    return true;
  }

  /**
   * Guarantee 11. A redeclaration is an author editing their sketch between
   * sound check and the set as often as it is a fresh load, and it must not
   * discard what the performer has already dialled in. A value survives a
   * widened range and not a narrowed one, because a value outside the range the
   * author now declares is a value they have said is not valid.
   */
  #adopt(name: string, descriptor: ParameterDescriptor): void {
    const previous = this.#descriptors[name];
    this.#descriptors[name] = descriptor;
    this.#adopted += 1;

    if (descriptor.type === 'colour') {
      // The array's identity outlives the descriptor: a sketch may already hold it.
      const held = this.values[name];
      if (previous?.type === 'colour' && held instanceof Float32Array) return;
      this.values[name] = Float32Array.from(descriptor.default);
      return;
    }
    if (descriptor.type === 'trigger') {
      // Never restarted, or a redeclaration would read as a fire.
      if (previous?.type !== 'trigger') this.values[name] = 0;
      return;
    }

    const held = this.values[name];
    const keep = previous?.type === descriptor.type && admits(descriptor, held);
    this.values[name] = keep
      ? (coerce(descriptor, held) ?? descriptor.default)
      : descriptor.default;
  }
}

/**
 * Whether the descriptor still admits this value **as it stands** — no clamping.
 *
 * Deliberately not `coerce`. Clamping here would pin a performer's 3 to the new
 * maximum of 1 and call it kept, which reads as a deliberate setting and is not
 * one. A value the author no longer declares valid takes the new default, and
 * that is a visible change rather than a quiet one.
 */
function admits(descriptor: ParameterDescriptor, value: unknown): boolean {
  switch (descriptor.type) {
    case 'number':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= descriptor.min &&
        value <= descriptor.max
      );
    case 'boolean':
      return typeof value === 'boolean';
    case 'enum':
      return typeof value === 'string' && descriptor.options.includes(value);
    default:
      return false;
  }
}

/** Returns `undefined` when the value cannot be made to fit the descriptor. */
function coerce(descriptor: ParameterDescriptor, value: unknown): ParameterValue | undefined {
  switch (descriptor.type) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
      const clamped = Math.min(descriptor.max, Math.max(descriptor.min, value));
      if (descriptor.step === undefined) return clamped;
      const stepped = Math.round((clamped - descriptor.min) / descriptor.step) * descriptor.step;
      return Math.min(descriptor.max, descriptor.min + stepped);
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'enum':
      return typeof value === 'string' && descriptor.options.includes(value) ? value : undefined;
    default:
      return undefined;
  }
}
