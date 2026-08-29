/**
 * The declaration format, and the only place that decides whether a sketch's
 * declaration is usable.
 *
 * Rejection is never an exception. Contract rule 7 says the host never throws
 * into the sketch, and an unknown type is precisely how a v1 host meets a sketch
 * written for a later one — so a bad descriptor comes back as a message for the
 * host to report, and the sketch runs on without that parameter.
 */

export interface DescriptorCommon {
  /** What the performer sees. Defaults to the parameter's own name. */
  readonly label: string;
  readonly description?: string;
  /** For organising a surface with forty parameters on it. */
  readonly group?: string;
}

export type ParameterDescriptor =
  | (DescriptorCommon & {
      readonly type: 'number';
      readonly default: number;
      readonly min: number;
      readonly max: number;
      readonly step?: number;
      readonly unit?: string;
    })
  | (DescriptorCommon & { readonly type: 'boolean'; readonly default: boolean })
  | (DescriptorCommon & {
      readonly type: 'enum';
      readonly default: string;
      readonly options: readonly string[];
    })
  | (DescriptorCommon & { readonly type: 'colour'; readonly default: Float32Array })
  | (DescriptorCommon & { readonly type: 'trigger' });

export type DescriptorResult = { descriptor: ParameterDescriptor } | { rejected: string };

const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * `'#rgb'`, `'#rrggbb'`, `'#rrggbbaa'`, or four numbers already in 0..1.
 *
 * Authors write colours as hex; the contract carries them as floats, because
 * that is what goes into a uniform without conversion every frame.
 */
export function parseColour(input: unknown): Float32Array | undefined {
  if (Array.isArray(input) && input.length === 4 && input.every((v) => typeof v === 'number')) {
    return Float32Array.from(input.map((v) => Math.min(1, Math.max(0, v))));
  }
  if (typeof input !== 'string') return undefined;

  const hex = input.trim().replace(/^#/, '');
  const expanded = hex.length === 3 || hex.length === 4 ? [...hex].map((c) => c + c).join('') : hex;
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(expanded)) return undefined;

  const byte = (at: number): number => parseInt(expanded.slice(at, at + 2), 16) / 255;
  return Float32Array.from([byte(0), byte(2), byte(4), expanded.length === 8 ? byte(6) : 1]);
}

export function normaliseDescriptor(name: string, input: unknown): DescriptorResult {
  if (typeof input !== 'object' || input === null) {
    return { rejected: `parameter "${name}": a descriptor must be an object` };
  }
  const raw = input as Record<string, unknown>;
  const common: DescriptorCommon = {
    label: typeof raw['label'] === 'string' && raw['label'] !== '' ? raw['label'] : name,
    ...(typeof raw['description'] === 'string' ? { description: raw['description'] } : {}),
    ...(typeof raw['group'] === 'string' ? { group: raw['group'] } : {}),
  };

  switch (raw['type']) {
    case 'number': {
      const min = finite(raw['min'], 0);
      const max = finite(raw['max'], 1);
      if (!(max > min)) {
        return { rejected: `parameter "${name}": max (${max}) must be greater than min (${min})` };
      }
      const step = finite(raw['step'], 0);
      return {
        descriptor: {
          ...common,
          type: 'number',
          min,
          max,
          default: Math.min(max, Math.max(min, finite(raw['default'], min))),
          ...(step > 0 ? { step } : {}),
          ...(typeof raw['unit'] === 'string' ? { unit: raw['unit'] } : {}),
        },
      };
    }
    case 'boolean':
      return { descriptor: { ...common, type: 'boolean', default: raw['default'] === true } };
    case 'enum': {
      const options = Array.isArray(raw['options'])
        ? raw['options'].filter((option): option is string => typeof option === 'string')
        : [];
      const first = options[0];
      if (first === undefined) {
        return { rejected: `parameter "${name}": an enum needs at least one option` };
      }
      const chosen = typeof raw['default'] === 'string' ? raw['default'] : first;
      return {
        descriptor: {
          ...common,
          type: 'enum',
          options,
          default: options.includes(chosen) ? chosen : first,
        },
      };
    }
    case 'colour': {
      // White rather than a rejection: a colour with an unreadable default is an
      // author's typo, and losing the whole parameter over it helps nobody.
      const colour = parseColour(raw['default']) ?? Float32Array.from([1, 1, 1, 1]);
      return { descriptor: { ...common, type: 'colour', default: colour } };
    }
    case 'trigger':
      return { descriptor: { ...common, type: 'trigger' } };
    default:
      return {
        rejected:
          `parameter "${name}": unknown type "${String(raw['type'])}". ` +
          'This host does not understand it, so the parameter is ignored and the sketch runs on.',
      };
  }
}

/**
 * The JSON-safe form of a declared set.
 *
 * A descriptor crosses IPC and then goes into a show file, and a colour default
 * is a `Float32Array`. `JSON.stringify` turns one into `{"0":1,"1":0,…}`, which
 * parses back as an object and not an array, so the colour would be silently
 * lost between the sketch declaring it and the show restoring it. Hex is what
 * authors write anyway, so this is the form that survives the round trip.
 */
export type PlainDescriptor = Record<string, unknown> & { type: string };
export type PlainDescriptors = Readonly<Record<string, PlainDescriptor>>;

/** `'#rrggbbaa'`. Alpha is always written, so the form has one shape. */
export function formatColour(colour: ArrayLike<number>): string {
  const byte = (at: number): string =>
    Math.round(Math.min(1, Math.max(0, colour[at] ?? 0)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${byte(0)}${byte(1)}${byte(2)}${byte(3)}`;
}

export function describeDescriptors(
  declared: Readonly<Record<string, ParameterDescriptor>>,
): PlainDescriptors {
  const plain: Record<string, PlainDescriptor> = {};
  for (const [name, descriptor] of Object.entries(declared)) {
    plain[name] =
      descriptor.type === 'colour'
        ? { ...descriptor, default: formatColour(descriptor.default) }
        : { ...descriptor };
  }
  return plain;
}

/**
 * The inverse, back through `normaliseDescriptor` — so there is exactly one
 * place in the codebase that decides whether a descriptor is usable, and a set
 * arriving from a file written by a newer Sialk is treated the same as one a
 * sketch has just declared.
 */
export function adoptDescriptors(plain: PlainDescriptors | undefined): {
  declared: Record<string, ParameterDescriptor>;
  problems: string[];
} {
  const declared: Record<string, ParameterDescriptor> = {};
  const problems: string[] = [];
  if (typeof plain !== 'object' || plain === null) return { declared, problems };

  for (const [name, raw] of Object.entries(plain)) {
    const result = normaliseDescriptor(name, raw);
    if ('rejected' in result) problems.push(result.rejected);
    else declared[name] = result.descriptor;
  }
  return { declared, problems };
}
