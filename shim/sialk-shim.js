// ../audio-contract/dist/constants.js
var CONTRACT_VERSION = "1.0.0";
var CONTRACT_MAJOR = 1;
var SPECTRUM_BINS = 64;
var LEVEL_TRAIL_FRAMES = 128;
var SPECTRUM_MIN_HZ = 20;
var SPECTRUM_MAX_HZ = 16e3;
var BAND_EDGES = {
  bass: [20, 250],
  mid: [250, 2e3],
  high: [2e3, 16e3]
};
var SILENCE_TIMEOUT_SECONDS = 1;

// ../audio-contract/dist/emitter.js
var ContractEmitter = class {
  #listeners = /* @__PURE__ */ new Map();
  #onListenerError;
  constructor(onListenerError) {
    this.#onListenerError = onListenerError ?? ((event, error) => {
      console.error(`[sialk] listener for "${event}" threw`, error);
    });
  }
  on = (event, listener) => {
    let set = this.#listeners.get(event);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.#listeners.set(event, set);
    }
    set.add(listener);
    return () => this.off(event, listener);
  };
  off = (event, listener) => {
    this.#listeners.get(event)?.delete(listener);
  };
  emit(event, detail) {
    const set = this.#listeners.get(event);
    if (!set || set.size === 0)
      return;
    for (const listener of [...set]) {
      try {
        listener(detail);
      } catch (error) {
        this.#onListenerError(event, error);
      }
    }
  }
  listenerCount(event) {
    return this.#listeners.get(event)?.size ?? 0;
  }
  clear() {
    this.#listeners.clear();
  }
};

// ../audio-contract/dist/parameters/descriptor.js
var finite = (value, fallback) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
function parseColour(input) {
  if (Array.isArray(input) && input.length === 4 && input.every((v) => typeof v === "number")) {
    return Float32Array.from(input.map((v) => Math.min(1, Math.max(0, v))));
  }
  if (typeof input !== "string")
    return void 0;
  const hex = input.trim().replace(/^#/, "");
  const expanded = hex.length === 3 || hex.length === 4 ? [...hex].map((c) => c + c).join("") : hex;
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(expanded))
    return void 0;
  const byte = (at) => parseInt(expanded.slice(at, at + 2), 16) / 255;
  return Float32Array.from([byte(0), byte(2), byte(4), expanded.length === 8 ? byte(6) : 1]);
}
function normaliseDescriptor(name, input) {
  if (typeof input !== "object" || input === null) {
    return { rejected: `parameter "${name}": a descriptor must be an object` };
  }
  const raw = input;
  const common = {
    label: typeof raw["label"] === "string" && raw["label"] !== "" ? raw["label"] : name,
    ...typeof raw["description"] === "string" ? { description: raw["description"] } : {},
    ...typeof raw["group"] === "string" ? { group: raw["group"] } : {}
  };
  switch (raw["type"]) {
    case "number": {
      const min = finite(raw["min"], 0);
      const max = finite(raw["max"], 1);
      if (!(max > min)) {
        return { rejected: `parameter "${name}": max (${max}) must be greater than min (${min})` };
      }
      const step = finite(raw["step"], 0);
      return {
        descriptor: {
          ...common,
          type: "number",
          min,
          max,
          default: Math.min(max, Math.max(min, finite(raw["default"], min))),
          ...step > 0 ? { step } : {},
          ...typeof raw["unit"] === "string" ? { unit: raw["unit"] } : {}
        }
      };
    }
    case "boolean":
      return { descriptor: { ...common, type: "boolean", default: raw["default"] === true } };
    case "enum": {
      const options = Array.isArray(raw["options"]) ? raw["options"].filter((option) => typeof option === "string") : [];
      const first = options[0];
      if (first === void 0) {
        return { rejected: `parameter "${name}": an enum needs at least one option` };
      }
      const chosen = typeof raw["default"] === "string" ? raw["default"] : first;
      return {
        descriptor: {
          ...common,
          type: "enum",
          options,
          default: options.includes(chosen) ? chosen : first
        }
      };
    }
    case "colour": {
      const colour = parseColour(raw["default"]) ?? Float32Array.from([1, 1, 1, 1]);
      return { descriptor: { ...common, type: "colour", default: colour } };
    }
    case "trigger":
      return { descriptor: { ...common, type: "trigger" } };
    default:
      return {
        rejected: `parameter "${name}": unknown type "${String(raw["type"])}". This host does not understand it, so the parameter is ignored and the sketch runs on.`
      };
  }
}
function formatColour(colour) {
  const byte = (at) => Math.round(Math.min(1, Math.max(0, colour[at] ?? 0)) * 255).toString(16).padStart(2, "0");
  return `#${byte(0)}${byte(1)}${byte(2)}${byte(3)}`;
}
function describeDescriptors(declared) {
  const plain = {};
  for (const [name, descriptor] of Object.entries(declared)) {
    plain[name] = descriptor.type === "colour" ? { ...descriptor, default: formatColour(descriptor.default) } : { ...descriptor };
  }
  return plain;
}

// ../audio-contract/dist/parameters/store.js
var ParameterStore = class {
  values = {};
  #descriptors = {};
  #adopted = 0;
  /**
   * How many descriptors have ever been taken up. Monotonic.
   *
   * The host publishes the declared set upstream whenever this moves. It counts
   * rather than compares because a redeclaration that changes nothing is still
   * a declaration, and the alternative — diffing two descriptor sets on every
   * call — is more code to be wrong in for no gain on a set this small.
   */
  get adopted() {
    return this.#adopted;
  }
  get declared() {
    return this.#descriptors;
  }
  /** Returns a message for each descriptor that could not be used. */
  declare(input) {
    if (typeof input !== "object" || input === null) {
      return ["parameters.declare() expects an object of descriptors"];
    }
    const rejected = [];
    for (const [name, raw] of Object.entries(input)) {
      const result = normaliseDescriptor(name, raw);
      if ("rejected" in result) {
        rejected.push(result.rejected);
        continue;
      }
      this.#adopt(name, result.descriptor);
    }
    return rejected;
  }
  /** Host-side write. Returns whether the value actually changed. */
  set(name, value) {
    const descriptor = this.#descriptors[name];
    if (!descriptor || descriptor.type === "trigger")
      return false;
    if (descriptor.type === "colour") {
      const parsed = parseColour(value);
      if (!parsed)
        return false;
      const held = this.values[name];
      if (held.every((component, at) => component === parsed[at]))
        return false;
      held.set(parsed);
      return true;
    }
    const coerced = coerce(descriptor, value);
    if (coerced === void 0 || this.values[name] === coerced)
      return false;
    this.values[name] = coerced;
    return true;
  }
  fire(name) {
    if (this.#descriptors[name]?.type !== "trigger")
      return false;
    this.values[name] = this.values[name] + 1;
    return true;
  }
  /**
   * Guarantee 11. A redeclaration is an author editing their sketch between
   * sound check and the set as often as it is a fresh load, and it must not
   * discard what the performer has already dialled in. A value survives a
   * widened range and not a narrowed one, because a value outside the range the
   * author now declares is a value they have said is not valid.
   */
  #adopt(name, descriptor) {
    const previous = this.#descriptors[name];
    this.#descriptors[name] = descriptor;
    this.#adopted += 1;
    if (descriptor.type === "colour") {
      const held2 = this.values[name];
      if (previous?.type === "colour" && held2 instanceof Float32Array)
        return;
      this.values[name] = Float32Array.from(descriptor.default);
      return;
    }
    if (descriptor.type === "trigger") {
      if (previous?.type !== "trigger")
        this.values[name] = 0;
      return;
    }
    const held = this.values[name];
    const keep = previous?.type === descriptor.type && admits(descriptor, held);
    this.values[name] = keep ? coerce(descriptor, held) ?? descriptor.default : descriptor.default;
  }
};
function admits(descriptor, value) {
  switch (descriptor.type) {
    case "number":
      return typeof value === "number" && Number.isFinite(value) && value >= descriptor.min && value <= descriptor.max;
    case "boolean":
      return typeof value === "boolean";
    case "enum":
      return typeof value === "string" && descriptor.options.includes(value);
    default:
      return false;
  }
}
function coerce(descriptor, value) {
  switch (descriptor.type) {
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value))
        return void 0;
      const clamped = Math.min(descriptor.max, Math.max(descriptor.min, value));
      if (descriptor.step === void 0)
        return clamped;
      const stepped = Math.round((clamped - descriptor.min) / descriptor.step) * descriptor.step;
      return Math.min(descriptor.max, descriptor.min + stepped);
    }
    case "boolean":
      return typeof value === "boolean" ? value : void 0;
    case "enum":
      return typeof value === "string" && descriptor.options.includes(value) ? value : void 0;
    default:
      return void 0;
  }
}

// ../audio-contract/dist/state.js
var clamp01 = (value) => {
  if (!(value > 0))
    return 0;
  return value > 1 ? 1 : value;
};
var finite2 = (value) => Number.isFinite(value) ? value : 0;
function createContract(options) {
  const emitter = new ContractEmitter(options.onListenerError ? (event, error) => options.onListenerError?.(event, error) : void 0);
  const spectrum = new Float32Array(SPECTRUM_BINS);
  const levelTrail = new Float32Array(LEVEL_TRAIL_FRAMES);
  const audio = {
    level: 0,
    bass: 0,
    mid: 0,
    high: 0,
    spectrum,
    levelTrail,
    hits: 0,
    onBeat: 0,
    beatPhase: 0,
    bpm: 0,
    bpmConfidence: 0,
    silent: true
  };
  const transport = {
    time: 0,
    elapsed: 0,
    delta: 0,
    frame: 0,
    running: false
  };
  const output = {
    width: Math.max(1, Math.trunc(finite2(options.output.width))),
    height: Math.max(1, Math.trunc(finite2(options.output.height))),
    fps: Math.max(1, finite2(options.output.fps))
  };
  const parameterStore = new ParameterStore();
  const parameters = {
    declare(descriptors) {
      const before = parameterStore.adopted;
      for (const message of parameterStore.declare(descriptors)) {
        writer.onParameterProblem?.(message);
      }
      if (parameterStore.adopted > before) {
        writer.onParameterDeclared?.(describeDescriptors(parameterStore.declared));
      }
    },
    values: parameterStore.values,
    declared: parameterStore.declared
  };
  const global = {
    contractVersion: CONTRACT_VERSION,
    host: { name: options.host.name, version: options.host.version },
    audio,
    transport,
    output,
    parameters,
    on: emitter.on,
    off: emitter.off
  };
  let silentFor = SILENCE_TIMEOUT_SECONDS;
  let secondsSinceBeat = Number.POSITIVE_INFINITY;
  const writer = {
    global,
    silenceThreshold: 1e-3,
    writeAudio(frame) {
      audio.level = clamp01(frame.level);
      audio.bass = clamp01(frame.bass);
      audio.mid = clamp01(frame.mid);
      audio.high = clamp01(frame.high);
      audio.bpm = Math.max(0, finite2(frame.bpm));
      audio.bpmConfidence = clamp01(frame.bpmConfidence);
      const bins = Math.min(frame.spectrum.length, SPECTRUM_BINS);
      for (let i = 0; i < bins; i += 1) {
        spectrum[i] = clamp01(frame.spectrum[i] ?? 0);
      }
      for (let i = bins; i < SPECTRUM_BINS; i += 1)
        spectrum[i] = 0;
      levelTrail.copyWithin(1, 0, LEVEL_TRAIL_FRAMES - 1);
      levelTrail[0] = audio.level;
      silentFor = audio.level > writer.silenceThreshold ? 0 : silentFor + transport.delta;
      audio.silent = silentFor >= SILENCE_TIMEOUT_SECONDS;
      if (frame.onsetStrength > 0) {
        audio.hits += 1;
        emitter.emit("onset", { hits: audio.hits, strength: clamp01(frame.onsetStrength) });
      }
      if (frame.beat) {
        secondsSinceBeat = 0;
        audio.onBeat = 1;
        emitter.emit("beat", { bpm: audio.bpm, confidence: audio.bpmConfidence });
      } else {
        secondsSinceBeat += transport.delta;
        const beatInterval = audio.bpm > 0 ? 60 / audio.bpm : 0;
        audio.onBeat = beatInterval > 0 ? clamp01(1 - secondsSinceBeat / beatInterval) : 0;
      }
      const beatSeconds = audio.bpm > 0 ? 60 / audio.bpm : 0;
      audio.beatPhase = beatSeconds > 0 && Number.isFinite(secondsSinceBeat) ? Math.min(1, secondsSinceBeat / beatSeconds) : 0;
    },
    writeTransport(frame) {
      const delta = Math.max(0, finite2(frame.delta));
      transport.delta = delta;
      transport.time = finite2(frame.time);
      transport.elapsed += delta;
      transport.frame += 1;
      const wasRunning = transport.running;
      transport.running = frame.running;
      if (wasRunning !== frame.running) {
        emitter.emit("transport", { time: transport.time, running: transport.running });
      }
    },
    setParameter(name, value) {
      if (parameterStore.set(name, value)) {
        emitter.emit("parameter", { name, value: parameterStore.values[name] });
      }
    },
    fireParameter(name) {
      if (parameterStore.fire(name)) {
        emitter.emit("parameter", { name, value: parameterStore.values[name] });
      }
    },
    writeOutput(next) {
      const width = Math.max(1, Math.trunc(finite2(next.width)));
      const height = Math.max(1, Math.trunc(finite2(next.height)));
      output.fps = Math.max(1, finite2(next.fps));
      if (width === output.width && height === output.height)
        return;
      output.width = width;
      output.height = height;
      emitter.emit("resize", { width, height });
    }
  };
  return writer;
}

// ../audio-contract/dist/install.js
function readRequestedMajor(doc) {
  const meta = doc.querySelector('meta[name="sialk-contract"]');
  const content = meta?.getAttribute("content")?.trim();
  if (!content)
    return CONTRACT_MAJOR;
  const major = Number.parseInt(content, 10);
  return Number.isInteger(major) && major > 0 ? major : CONTRACT_MAJOR;
}
var UnsupportedContractVersionError = class extends Error {
  constructor(requested, served) {
    super(`This sketch asks for Sialk contract v${requested}; this host serves v${served}. A major version is never silently substituted.`);
    this.name = "UnsupportedContractVersionError";
  }
};
function installContract(scope, contract) {
  Object.defineProperty(scope, "sialk", {
    value: contract,
    writable: false,
    configurable: false,
    enumerable: true
  });
}

// ../audio-engine/dist/fft.js
var Fft = class {
  size;
  #cos;
  #sin;
  #reverse;
  #real;
  #imag;
  constructor(size) {
    if (size < 2 || (size & size - 1) !== 0) {
      throw new Error(`FFT size must be a power of two of at least 2, got ${size}`);
    }
    this.size = size;
    this.#real = new Float32Array(size);
    this.#imag = new Float32Array(size);
    this.#cos = new Float32Array(size / 2);
    this.#sin = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i += 1) {
      const angle = -2 * Math.PI * i / size;
      this.#cos[i] = Math.cos(angle);
      this.#sin[i] = Math.sin(angle);
    }
    const bits = Math.log2(size);
    this.#reverse = new Uint32Array(size);
    for (let i = 0; i < size; i += 1) {
      let reversed = 0;
      for (let bit = 0; bit < bits; bit += 1) {
        reversed = reversed << 1 | i >>> bit & 1;
      }
      this.#reverse[i] = reversed;
    }
  }
  /**
   * Magnitude spectrum of a real signal, into `out` (length `size / 2`).
   * Magnitudes are normalised by `size / 2`, so a full-scale sine reads ~1.
   */
  magnitudes(input, out) {
    const n = this.size;
    if (out.length < n / 2) {
      throw new Error(`output needs ${n / 2} bins, got ${out.length}`);
    }
    const re = this.#real;
    const im = this.#imag;
    for (let i = 0; i < n; i += 1) {
      re[i] = i < input.length ? input[i] ?? 0 : 0;
      im[i] = 0;
    }
    this.#transform(re, im);
    const scale = 2 / n;
    for (let i = 0; i < n / 2; i += 1) {
      const r = re[i] ?? 0;
      const j = im[i] ?? 0;
      out[i] = Math.hypot(r, j) * scale;
    }
  }
  #transform(re, im) {
    const n = this.size;
    const rev = this.#reverse;
    for (let i = 0; i < n; i += 1) {
      const j = rev[i] ?? 0;
      if (j > i) {
        const tr = re[i] ?? 0;
        re[i] = re[j] ?? 0;
        re[j] = tr;
        const ti = im[i] ?? 0;
        im[i] = im[j] ?? 0;
        im[j] = ti;
      }
    }
    for (let span = 2; span <= n; span <<= 1) {
      const half = span >> 1;
      const step = n / span;
      for (let start = 0; start < n; start += span) {
        for (let k = 0; k < half; k += 1) {
          const twiddle = k * step;
          const wr = this.#cos[twiddle] ?? 0;
          const wi = this.#sin[twiddle] ?? 0;
          const a = start + k;
          const b = a + half;
          const br = re[b] ?? 0;
          const bi = im[b] ?? 0;
          const tr = br * wr - bi * wi;
          const ti = br * wi + bi * wr;
          re[b] = (re[a] ?? 0) - tr;
          im[b] = (im[a] ?? 0) - ti;
          re[a] = (re[a] ?? 0) + tr;
          im[a] = (im[a] ?? 0) + ti;
        }
      }
    }
  }
};
function hannWindow(size) {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / size));
  }
  return w;
}

// ../audio-engine/dist/bands.js
var BandMapper = class {
  #binStart;
  #binEnd;
  #bassRange;
  #midRange;
  #highRange;
  constructor(fftSize, sampleRate) {
    const bins = fftSize / 2;
    const hzPerBin = sampleRate / fftSize;
    const toBin = (hz) => Math.min(bins - 1, Math.max(0, Math.round(hz / hzPerBin)));
    this.#binStart = new Uint16Array(SPECTRUM_BINS);
    this.#binEnd = new Uint16Array(SPECTRUM_BINS);
    const logMin = Math.log(SPECTRUM_MIN_HZ);
    const logMax = Math.log(Math.min(SPECTRUM_MAX_HZ, sampleRate / 2));
    for (let i = 0; i < SPECTRUM_BINS; i += 1) {
      const lo = Math.exp(logMin + (logMax - logMin) * i / SPECTRUM_BINS);
      const hi = Math.exp(logMin + (logMax - logMin) * (i + 1) / SPECTRUM_BINS);
      const start = toBin(lo);
      this.#binStart[i] = start;
      this.#binEnd[i] = Math.max(start + 1, toBin(hi));
    }
    const range = (edges) => [
      toBin(edges[0]),
      Math.max(toBin(edges[0]) + 1, toBin(edges[1]))
    ];
    this.#bassRange = range(BAND_EDGES.bass);
    this.#midRange = range(BAND_EDGES.mid);
    this.#highRange = range(BAND_EDGES.high);
  }
  /**
   * Fills `out` (length SPECTRUM_BINS) with the signal *density* in each log
   * bin — RMS, not total energy.
   *
   * The bands and the display spectrum are asking different questions, and
   * they need different estimators. A band asks **how much sound is in
   * 2–16 kHz**, and a tone must read the same whichever band it lands in, so
   * that is total energy. A display bin asks **how tall should this bar be**
   * next to the bar beside it — and the 64 log bins cover between **1 and 68**
   * FFT bins each, a 68× spread. Totalling energy over that tilts the top of
   * the spectrum up by √68, which is **18 dB**, and every bar above the middle
   * pins against the top of the frame on ordinary music. Measured, 27 Aug:
   * a shader drawing bars filled solid from the mid frequencies rightward
   * while the bass still showed steps — backwards for music, and the
   * signature of the bandwidth tilt rather than of the sound.
   *
   * Dividing by the width restores density, which is the quantity a spectrum
   * display has always shown. It is **not** the mean this replaced (`0052`):
   * the mean divides the *sum of magnitudes* by the width, which loses a tone
   * entirely in a wide bin; this divides the *energy* by the width and takes
   * the root, which keeps it.
   */
  fillSpectrum(magnitudes, out) {
    for (let i = 0; i < SPECTRUM_BINS; i += 1) {
      const start = this.#binStart[i] ?? 0;
      const end = this.#binEnd[i] ?? 1;
      const width = Math.max(1, Math.min(end, magnitudes.length) - start);
      out[i] = amplitude(magnitudes, start, end) / Math.sqrt(width);
    }
  }
  bandLevels(magnitudes) {
    return {
      bass: amplitude(magnitudes, this.#bassRange[0], this.#bassRange[1]),
      mid: amplitude(magnitudes, this.#midRange[0], this.#midRange[1]),
      high: amplitude(magnitudes, this.#highRange[0], this.#highRange[1])
    };
  }
};
function amplitude(values, start, end) {
  const to = Math.min(end, values.length);
  if (to <= start)
    return 0;
  let sum = 0;
  for (let i = start; i < to; i += 1) {
    const value = values[i] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum);
}

// ../audio-engine/dist/loudness.js
var EnvelopeFollower = class {
  #value = 0;
  #attackSeconds;
  #releaseSeconds;
  constructor(attackSeconds = 0.01, releaseSeconds = 0.25) {
    this.#attackSeconds = attackSeconds;
    this.#releaseSeconds = releaseSeconds;
  }
  get value() {
    return this.#value;
  }
  process(target, deltaSeconds) {
    const tau = target > this.#value ? this.#attackSeconds : this.#releaseSeconds;
    const coefficient = tau <= 0 ? 1 : 1 - Math.exp(-deltaSeconds / tau);
    this.#value += (target - this.#value) * Math.min(1, Math.max(0, coefficient));
    return this.#value;
  }
  reset() {
    this.#value = 0;
  }
};
var DB_FLOOR = -60;
function amplitudeToUnit(amplitude2, floorDb = DB_FLOOR) {
  if (!(amplitude2 > 0))
    return 0;
  const db = 20 * Math.log10(amplitude2);
  if (db <= floorDb)
    return 0;
  return Math.min(1, db / -floorDb + 1);
}
function rms(samples) {
  const n = samples.length;
  if (n === 0)
    return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const s = samples[i] ?? 0;
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}

// ../audio-engine/dist/onset.js
var OnsetDetector = class {
  #previous;
  #history;
  #scratch;
  #historyCount = 0;
  #writeIndex = 0;
  #sinceOnset = Number.POSITIVE_INFINITY;
  #primed = false;
  #multiplier;
  #bias;
  #refractory;
  constructor(spectrumBins, options = {}) {
    const historyFrames = options.historyFrames ?? 60;
    this.#previous = new Float32Array(spectrumBins);
    this.#history = new Float32Array(historyFrames);
    this.#scratch = new Float32Array(historyFrames);
    this.#multiplier = options.multiplier ?? 1.6;
    this.#bias = options.bias ?? 2e-3;
    this.#refractory = options.refractorySeconds ?? 0.05;
  }
  process(magnitudes, deltaSeconds) {
    let flux = 0;
    const bins = Math.min(magnitudes.length, this.#previous.length);
    for (let i = 0; i < bins; i += 1) {
      const diff = (magnitudes[i] ?? 0) - (this.#previous[i] ?? 0);
      if (diff > 0)
        flux += diff;
      this.#previous[i] = magnitudes[i] ?? 0;
    }
    flux /= Math.max(1, bins);
    this.#sinceOnset += deltaSeconds;
    if (!this.#primed) {
      this.#primed = true;
      this.#push(flux);
      return { strength: 0, flux: 0 };
    }
    const threshold = this.#threshold();
    this.#push(flux);
    if (this.#historyCount < this.#history.length / 4)
      return { strength: 0, flux };
    if (flux <= threshold)
      return { strength: 0, flux };
    if (this.#sinceOnset < this.#refractory)
      return { strength: 0, flux };
    this.#sinceOnset = 0;
    const strength = threshold > 0 ? Math.min(1, (flux - threshold) / threshold) : 1;
    return { strength: Math.max(strength, 0.01), flux };
  }
  reset() {
    this.#previous.fill(0);
    this.#history.fill(0);
    this.#historyCount = 0;
    this.#writeIndex = 0;
    this.#sinceOnset = Number.POSITIVE_INFINITY;
    this.#primed = false;
  }
  #push(flux) {
    this.#history[this.#writeIndex] = flux;
    this.#writeIndex = (this.#writeIndex + 1) % this.#history.length;
    if (this.#historyCount < this.#history.length)
      this.#historyCount += 1;
  }
  #threshold() {
    const count = this.#historyCount;
    if (count === 0)
      return Number.POSITIVE_INFINITY;
    const scratch = this.#scratch.subarray(0, count);
    scratch.set(this.#history.subarray(0, count));
    scratch.sort();
    const median = scratch[count >> 1] ?? 0;
    return median * this.#multiplier + this.#bias;
  }
};

// ../audio-engine/dist/tempo.js
var TempoTracker = class {
  #envelope;
  #frameRate;
  #minLag;
  #maxLag;
  #estimateEvery;
  #confidenceFloor;
  #writeIndex = 0;
  #filled = 0;
  #framesSinceEstimate = 0;
  #bpm = 0;
  #confidence = 0;
  #secondsToNextBeat = Number.POSITIVE_INFINITY;
  constructor(frameRate, options = {}) {
    const minBpm = options.minBpm ?? 60;
    const maxBpm = options.maxBpm ?? 200;
    const historySeconds = options.historySeconds ?? 6;
    this.#frameRate = frameRate;
    this.#envelope = new Float32Array(Math.ceil(historySeconds * frameRate));
    this.#minLag = Math.max(2, Math.floor(frameRate * 60 / maxBpm));
    this.#maxLag = Math.min(this.#envelope.length - 1, Math.ceil(frameRate * 60 / minBpm));
    this.#estimateEvery = options.estimateEveryFrames ?? Math.max(1, Math.round(frameRate / 4));
    this.#confidenceFloor = options.confidenceFloor ?? 0.25;
  }
  /**
   * @param flux         this frame's onset-envelope value
   * @param onsetStrength > 0 when an onset landed, used to align beat phase
   * @param deltaSeconds  time since the previous frame
   */
  process(flux, onsetStrength, deltaSeconds) {
    this.#envelope[this.#writeIndex] = flux;
    this.#writeIndex = (this.#writeIndex + 1) % this.#envelope.length;
    if (this.#filled < this.#envelope.length)
      this.#filled += 1;
    this.#framesSinceEstimate += 1;
    if (this.#framesSinceEstimate >= this.#estimateEvery && this.#filled > this.#maxLag * 2) {
      this.#framesSinceEstimate = 0;
      this.#estimate();
    }
    return {
      bpm: this.#bpm,
      confidence: this.#confidence,
      beat: this.#advancePhase(onsetStrength, deltaSeconds)
    };
  }
  reset() {
    this.#envelope.fill(0);
    this.#writeIndex = 0;
    this.#filled = 0;
    this.#bpm = 0;
    this.#confidence = 0;
    this.#secondsToNextBeat = Number.POSITIVE_INFINITY;
  }
  /** Beat phase: predict beats from the period, and nudge toward onsets that land near one. */
  #advancePhase(onsetStrength, deltaSeconds) {
    if (this.#bpm <= 0) {
      this.#secondsToNextBeat = Number.POSITIVE_INFINITY;
      return false;
    }
    const period = 60 / this.#bpm;
    if (!Number.isFinite(this.#secondsToNextBeat))
      this.#secondsToNextBeat = 0;
    this.#secondsToNextBeat -= deltaSeconds;
    if (onsetStrength > 0) {
      const offset = this.#secondsToNextBeat;
      const wrapped = offset > period / 2 ? offset - period : offset;
      if (Math.abs(wrapped) < period / 4) {
        this.#secondsToNextBeat -= wrapped * 0.25;
      }
    }
    if (this.#secondsToNextBeat > 0)
      return false;
    do {
      this.#secondsToNextBeat += period;
    } while (this.#secondsToNextBeat <= 0);
    return true;
  }
  #estimate() {
    const n = this.#filled;
    const buffer = this.#envelope;
    const size = buffer.length;
    const oldest = (this.#writeIndex - n + size) % size;
    let mean = 0;
    for (let i = 0; i < n; i += 1)
      mean += buffer[(oldest + i) % size] ?? 0;
    mean /= n;
    let energy = 0;
    for (let i = 0; i < n; i += 1) {
      const v = (buffer[(oldest + i) % size] ?? 0) - mean;
      energy += v * v;
    }
    if (energy <= 0) {
      this.#bpm = 0;
      this.#confidence = 0;
      return;
    }
    let bestLag = 0;
    let bestScore = 0;
    let scoreSum = 0;
    let scoreCount = 0;
    for (let lag = this.#minLag; lag <= this.#maxLag; lag += 1) {
      let sum = 0;
      for (let i = lag; i < n; i += 1) {
        const a = (buffer[(oldest + i) % size] ?? 0) - mean;
        const b = (buffer[(oldest + i - lag) % size] ?? 0) - mean;
        sum += a * b;
      }
      const correlation = sum / ((n - lag) * (energy / n));
      const bpm = this.#frameRate * 60 / lag;
      const score = correlation * octavePreference(bpm);
      scoreSum += score;
      scoreCount += 1;
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }
    const meanScore = scoreCount > 0 ? scoreSum / scoreCount : 0;
    const confidence = bestScore > 0 ? clamp012((bestScore - meanScore) / bestScore) : 0;
    if (bestLag === 0 || confidence < this.#confidenceFloor) {
      this.#bpm = 0;
      this.#confidence = 0;
      return;
    }
    this.#bpm = this.#frameRate * 60 / bestLag;
    this.#confidence = confidence;
  }
};
function octavePreference(bpm) {
  const octaves = Math.log2(bpm / 120);
  return Math.exp(-(octaves * octaves) / (2 * 0.9 * 0.9));
}
var clamp012 = (v) => v > 1 ? 1 : v > 0 ? v : 0;

// ../audio-engine/dist/analyser.js
var AudioAnalyser = class {
  #fft;
  #window;
  #clamped;
  #windowed;
  #magnitudes;
  #spectrum;
  #bands;
  #onset;
  #tempo;
  #levelEnv = new EnvelopeFollower();
  #bassEnv = new EnvelopeFollower();
  #midEnv = new EnvelopeFollower();
  #highEnv = new EnvelopeFollower(8e-3, 0.18);
  constructor(options) {
    const fftSize = options.fftSize ?? 2048;
    const frameRate = options.frameRate ?? 60;
    this.#fft = new Fft(fftSize);
    this.#window = hannWindow(fftSize);
    this.#clamped = new Float32Array(fftSize);
    this.#windowed = new Float32Array(fftSize);
    this.#magnitudes = new Float32Array(fftSize / 2);
    this.#spectrum = new Float32Array(SPECTRUM_BINS);
    this.#bands = new BandMapper(fftSize, options.sampleRate);
    this.#onset = new OnsetDetector(fftSize / 2);
    this.#tempo = new TempoTracker(frameRate);
  }
  /**
   * @param samples mono samples. Anything past ±1 is clamped to it, and
   *   shorter than the FFT size is zero-padded.
   * @returns a frame ready for `ContractWriter.writeAudio`. The returned
   *   `spectrum` is reused between calls — the contract copies it.
   */
  analyse(samples, deltaSeconds) {
    const size = this.#window.length;
    for (let i = 0; i < size; i += 1) {
      const sample = i < samples.length ? samples[i] ?? 0 : 0;
      this.#clamped[i] = sample > 1 ? 1 : sample < -1 ? -1 : sample;
    }
    for (let i = 0; i < size; i += 1) {
      this.#windowed[i] = (this.#clamped[i] ?? 0) * (this.#window[i] ?? 0);
    }
    this.#fft.magnitudes(this.#windowed, this.#magnitudes);
    this.#bands.fillSpectrum(this.#magnitudes, this.#spectrum);
    for (let i = 0; i < SPECTRUM_BINS; i += 1) {
      this.#spectrum[i] = amplitudeToUnit(this.#spectrum[i] ?? 0);
    }
    const raw = this.#bands.bandLevels(this.#magnitudes);
    const level = this.#levelEnv.process(amplitudeToUnit(rms(this.#clamped)), deltaSeconds);
    const bass = this.#bassEnv.process(amplitudeToUnit(raw.bass), deltaSeconds);
    const mid = this.#midEnv.process(amplitudeToUnit(raw.mid), deltaSeconds);
    const high = this.#highEnv.process(amplitudeToUnit(raw.high), deltaSeconds);
    const onset = this.#onset.process(this.#magnitudes, deltaSeconds);
    const tempo = this.#tempo.process(onset.flux, onset.strength, deltaSeconds);
    return {
      level,
      bass,
      mid,
      high,
      spectrum: this.#spectrum,
      onsetStrength: onset.strength,
      beat: tempo.beat,
      bpm: tempo.bpm,
      bpmConfidence: tempo.confidence
    };
  }
  reset() {
    this.#onset.reset();
    this.#tempo.reset();
    this.#levelEnv.reset();
    this.#bassEnv.reset();
    this.#midEnv.reset();
    this.#highEnv.reset();
  }
};

// src/source.ts
function normaliseSource(source) {
  if (source === void 0) return { kind: "microphone" };
  if (typeof source === "string") return { kind: source };
  return source;
}
function createSilentSource(sampleRate = 48e3) {
  return {
    sampleRate,
    read: (into) => into.fill(0),
    close: () => {
    }
  };
}
async function connectSource(source, fftSize) {
  if (source.kind === "silent") return createSilentSource();
  if (source.kind === "custom") return source.create();
  const context = new AudioContext();
  const analyserNode = context.createAnalyser();
  analyserNode.fftSize = fftSize;
  analyserNode.smoothingTimeConstant = 0;
  let cleanup = () => {
  };
  if (source.kind === "microphone") {
    const stream = await navigator.mediaDevices.getUserMedia({
      // Every one of these fights the analysis: they are built to make speech
      // intelligible, not to leave music intact.
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    context.createMediaStreamSource(stream).connect(analyserNode);
    cleanup = () => stream.getTracks().forEach((track) => track.stop());
  } else if (source.kind === "element") {
    const node = context.createMediaElementSource(source.element);
    node.connect(analyserNode);
    node.connect(context.destination);
  } else {
    const element = new Audio(source.url);
    element.crossOrigin = "anonymous";
    element.loop = source.loop ?? true;
    const node = context.createMediaElementSource(element);
    node.connect(analyserNode);
    node.connect(context.destination);
    await element.play();
    cleanup = () => element.pause();
  }
  void context.resume().catch(() => {
  });
  return {
    sampleRate: context.sampleRate,
    read: (into) => analyserNode.getFloatTimeDomainData(into),
    close: () => {
      cleanup();
      void context.close().catch(() => {
      });
    }
  };
}

// src/install.ts
var SHIM_VERSION = "1.0.0";
var installed;
async function installShim(options = {}) {
  const existing = globalThis.sialk;
  if (existing && existing.host?.name === "sialk") {
    return { passthrough: true, sialk: existing, stop: () => {
    } };
  }
  const requestedMajor = options.contractMajor ?? readRequestedMajorFromPage();
  if (requestedMajor !== CONTRACT_MAJOR) {
    throw new UnsupportedContractVersionError(requestedMajor, CONTRACT_MAJOR);
  }
  const fps = options.fps ?? 60;
  const fftSize = options.fftSize ?? 2048;
  const schedule = options.schedule ?? ((callback) => void requestAnimationFrame(callback));
  const writer = installed ?? createContract({
    host: { name: "shim", version: SHIM_VERSION },
    output: resolveSurface(options.surface, fps)
  });
  if (!installed) {
    installContract(globalThis, writer.global);
    installed = writer;
  }
  const audio = await connectSource(normaliseSource(options.source), fftSize);
  const analyser = new AudioAnalyser({ sampleRate: audio.sampleRate, fftSize, frameRate: fps });
  const samples = new Float32Array(fftSize);
  let running = true;
  let lastTimestamp;
  const frame = (timestampMs) => {
    if (!running) return;
    const delta = lastTimestamp === void 0 ? 1 / fps : (timestampMs - lastTimestamp) / 1e3;
    lastTimestamp = timestampMs;
    writer.writeOutput(resolveSurface(options.surface, fps));
    writer.writeTransport({ time: timestampMs / 1e3, delta, running: true });
    audio.read(samples);
    writer.writeAudio(analyser.analyse(samples, delta));
    schedule(frame);
  };
  schedule(frame);
  return {
    passthrough: false,
    sialk: writer.global,
    stop() {
      if (!running) return;
      running = false;
      audio.close();
      writer.writeAudio({
        level: 0,
        bass: 0,
        mid: 0,
        high: 0,
        spectrum: new Float32Array(0),
        onsetStrength: 0,
        beat: false,
        bpm: 0,
        bpmConfidence: 0
      });
    }
  };
}
function resolveSurface(surface, fps) {
  if (surface && "width" in surface && "height" in surface) {
    return { width: surface.width || 1, height: surface.height || 1, fps };
  }
  const canvas = typeof document === "undefined" ? null : document.querySelector("canvas");
  if (canvas) return { width: canvas.width || 1, height: canvas.height || 1, fps };
  const width = typeof window === "undefined" ? 1 : window.innerWidth || 1;
  const height = typeof window === "undefined" ? 1 : window.innerHeight || 1;
  return { width, height, fps };
}
function readRequestedMajorFromPage() {
  if (typeof document === "undefined") return CONTRACT_MAJOR;
  return readRequestedMajor(document);
}
export {
  connectSource,
  createSilentSource,
  installShim,
  normaliseSource
};
