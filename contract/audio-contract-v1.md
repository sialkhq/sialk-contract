# The Sialk Audio Contract — v1.0.0

**Status:** DRAFT. Not yet published. Freezes at publication.
**Global:** `window.sialk`
**Applies to:** any web content hosted by Sialk, and any content using `@sialk/shim` outside it.

## 1. What this is

A documented, versioned global object that a sketch is written against. It carries the audio Sialk hears, the show's transport position, and the surface the sketch is drawn on.

It exists because compositing a Three.js sketch does not make it audio-reactive. Audio has to reach the page, and the page has to know what it is receiving. Everywhere else in this field, audio reaches a page only through an OSC or WebSocket bridge the creator wires up themselves.

Two prior arts shape it. OBS ships `window.obsstudio` — a documented JavaScript global carrying version, state, control functions and DOM events — which proves the _shape_ is accepted and used, but puts no audio in it. Synesthesia ships a rich named audio vocabulary — `syn_Level`, `syn_BassLevel`, `syn_Hits`, `syn_OnBeat`, `syn_BPM`, `syn_BPMConfidence`, plus spectrum and level-trail textures — which proves that is what creators want, but binds it to GLSL shaders rather than web pages, and does not version it.

The names below borrow deliberately from Synesthesia's vocabulary. It is field-tested naming, and creators moving across already know it. Being versioned is the part nobody else does.

## 2. The whole surface

Everything in v1.0.0. Nothing else is in the contract; anything not listed here is not guaranteed to exist.

```ts
window.sialk = {
  contractVersion: '1.0.0',
  host: { name: 'sialk' | 'shim' | string, version: string },

  audio: {
    level:         number,        // 0..1  broadband loudness, smoothed
    bass:          number,        // 0..1  ~20–250 Hz
    mid:           number,        // 0..1  ~250–2000 Hz
    high:          number,        // 0..1  ~2000–16000 Hz
    spectrum:      Float32Array,  // 64 bins, 0..1, log-spaced across 20 Hz–16 kHz
    levelTrail:    Float32Array,  // 128 frames of `level`, [0] is newest
    hits:          number,        // monotonic onset counter, never resets mid-show
    onBeat:        number,        // 1 on the frame a beat lands, decaying to 0 before the next
    beatPhase:     number,        // 0..1, ramps from 0 at each beat towards the next; 0 when bpm is 0
    bpm:           number,        // 0 when unknown
    bpmConfidence: number,        // 0..1, 0 when unknown
    silent:        boolean,       // true when no signal has been present for 1s
  },

  transport: {
    time:    number,   // seconds — show transport position, may be scrubbed or reset
    elapsed: number,   // seconds since this sketch loaded, monotonic
    delta:   number,   // seconds since the previous frame
    frame:   number,   // monotonic frame counter since load
    running: boolean,
  },

  output: {
    width:  number,    // px, the surface actually being composited
    height: number,
    fps:    number,    // target frame rate, not measured rate
  },

  parameters: {
    // What this sketch exposes for the performer to play. Declare once at startup.
    declare(descriptors: Record<string, ParameterDescriptor>): void,
    // Live values, mutated in place. Same object for the sketch's whole life.
    values: Record<string, number | boolean | string | Float32Array>,
    declared: Record<string, ParameterDescriptor>,
  },

  on(event, listener): () => void,
  off(event, listener): void,
};

type ParameterDescriptor =
  | { type: 'number',  default: number,  min: number, max: number, step?: number, unit?: string }
  | { type: 'boolean', default: boolean }
  | { type: 'enum',    default: string,  options: string[] }
  | { type: 'colour',  default: string | [number, number, number, number] }   // '#rrggbb' or rgba 0..1
  | { type: 'trigger' };
// All of them also take: label?, description?, group?
```

A declared parameter reads back as: a `number` within its range; a `boolean`; the chosen `string` for an enum; a stable `Float32Array` of RGBA in `0..1` for a colour; and for a trigger, a monotonic counter that increments on each fire — never a flag that is true for one frame, because a dropped frame would miss it.

Events: `'beat'`, `'onset'`, `'resize'`, `'transport'`, `'parameter'`. `on()` returns its own unsubscribe function, so a sketch can clean up without holding the listener reference.

## 3. Rules the host guarantees

1. **`window.sialk` exists before the sketch's first line runs.** No polling, no readiness event, no race.
2. **Every field is always readable and always a number of the stated type.** Silence is `0`, not `undefined`, `null` or `NaN`. Unknown tempo is `bpm: 0`, never a guess.
3. **The object identity is stable.** `window.sialk`, `window.sialk.audio`, `.transport` and `.output` are the same objects for the sketch's whole life. Fields are mutated in place, so destructuring `const { audio } = window.sialk` once at startup is correct and cheap.
4. **`spectrum` and `levelTrail` are the same `Float32Array` instances for the sketch's whole life,** refilled in place. Never reallocated. A sketch may upload them straight to a GPU texture every frame.
5. **Values update once per composited frame, before the sketch's `requestAnimationFrame` callback.** Reading twice in one frame gives the same answer.
6. **Ranges are honoured.** Everything documented `0..1` is clamped to `0..1`. `spectrum` bins are `0..1`.
7. **The host never throws into the sketch,** and a sketch that throws never takes the host down.
8. **A declared parameter is always readable and always of its declared type.** Never `undefined`, never outside its range, never an enum value that is not one of the options.
9. **Parameter values update once per composited frame, before the sketch's `requestAnimationFrame` callback** — the same instant as `audio`, so one frame sees one coherent state.
10. **`parameters.values`, and each colour's `Float32Array`, keep their identity for the sketch's whole life.** Refilled in place, like `spectrum`.
11. **Declaring is safe at any time and never discards a performer's work.** Redeclaring keeps a value the new descriptor still admits; a value it no longer admits takes the new default rather than being quietly clamped to the edge.
12. **A type the host does not recognise is ignored and reported, never fatal.** That is how a host serving v1 meets a sketch written against a later version: it loses that parameter and nothing else.

## 4. Versioning policy

`contractVersion` is semver, and it is the only thing a sketch should branch on.

| Change                                                                                       | Version             | Guarantee                                                                                     |
| -------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------- |
| New field, new event, new host name                                                          | **Minor** — `1.1.0` | Every v1.0.0 sketch keeps working, untouched, forever.                                        |
| Bug fix, tightened range, corrected units within the documented meaning                      | **Patch** — `1.0.1` | Same.                                                                                         |
| Removing or renaming a field, changing a documented range or meaning, changing update timing | **Major** — `2.0.0` | Only with a published migration path, and only after v1 has proven inadequate under real use. |

The commitments attached to that table:

- **A published version never changes.** Once v1.0.0 ships, its surface is frozen. Corrections go to 1.0.1; additions to 1.1.0.
- **A major version never silently replaces a minor one.** If v2 ever ships, the host serves v1 to v1 sketches. A sketch declares its expectation with `<meta name="sialk-contract" content="1">`; absent that meta tag, the host serves the highest v1.
- **Deprecation is announced at least one major version ahead,** in this document, with the replacement named.

This is why the contract is built before any user interface code. It is the only part of Sialk a competitor cannot copy by adding a feature, and the only part that breaks every existing user's work if it changes carelessly.

## 5. Field notes

**`level`, `bass`, `mid`, `high`** — perceptual, not physical. Loudness is measured, then smoothed with an asymmetric envelope: fast attack, slow release. The result tracks what a listener hears rather than what a meter reads, and it does not flicker on a quiet passage.

**`spectrum`** — 64 log-spaced bins, because linear FFT bins waste three-quarters of their resolution above 5 kHz where almost nothing musical distinguishes itself. 64 is a texture width that costs nothing to upload.

**`levelTrail`** — `[0]` is this frame, `[127]` is 128 frames ago. At 60 fps that is about two seconds of history, which is the range in which a trail is legible as motion.

**`hits`** — a counter, not a flag, so a sketch that misses a frame still sees the onset. Compare against last frame's value: `if (audio.hits !== last) { ... }`.

**`onBeat`** — `1` on the beat frame, then decaying linearly toward `0` over the interval to the next expected beat. A sketch wanting a boolean uses `onBeat > 0.99`; a sketch wanting a pulse uses the value directly.

**`bpm` and `bpmConfidence`** — tempo estimation is honest about not knowing. Below roughly 0.4 confidence, treat `bpm` as decorative. On unpitched or arrhythmic material the correct output is `bpm: 0, bpmConfidence: 0`, and that is what the host reports.

**`transport.time` versus `transport.elapsed`** — `elapsed` only ever increases and is what animation should be driven by. `time` is the show's position and can jump when a performer scrubs, cues or restarts. Driving animation from `time` means animation that jumps too, which is sometimes exactly what is wanted.

## 6. Minimum sketch

```html
<meta name="sialk-contract" content="1" />
<script>
  const { audio, transport, output } = window.sialk;
  let lastHits = audio.hits;

  function frame() {
    if (audio.hits !== lastHits) {
      lastHits = audio.hits;
      // an onset landed since the previous frame
    }
    render(audio.level, audio.bass, audio.onBeat, transport.elapsed, output.width, output.height);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
</script>
```

### A hosted sketch must start without a gesture

This is the one rule that catches people, and it costs a whole performance when
it is missed. A host runs your sketch in an off-screen browser. **There is
nothing to click.** A sketch that waits for a click before it starts will paint
one frame and then stop, and the stage will show that one frame all night.

Outside a host you still need a gesture, because browsers will not open a
microphone without one. So branch on whether the contract is already there:

```js
if (window.sialk) {
  // Hosted. The contract is installed, the audio is the host's problem, start now.
  run();
} else {
  // Standalone. The browser needs a gesture before it will open an input.
  button.addEventListener('click', async () => {
    await installShim({ source: 'microphone' });
    run();
  });
}
```

`window.sialk` is present before your first line runs when hosted, and absent
until `installShim()` resolves when not — which is what makes this check
reliable rather than a race.

Note the **dynamic** import of the shim. A host serves your sketch from its own
origin and does not serve the shim alongside it, so a static
`import { installShim } from '…'` fails there and takes your whole module down
with it — the page paints once and freezes. Import it inside the branch that
needs it.

## 7. Making an existing sketch contract-compliant

The adoption barrier is minutes, not hours. An existing sketch already driven by an `AnalyserNode` changes its source, not its structure:

```js
import { installShim } from '@sialk/shim';

// Outside Sialk: provides window.sialk from the microphone or an audio file.
// Inside Sialk: detects the real host and does nothing.
await installShim({ source: 'microphone' });
```

The same file then runs on a laptop in a browser and on stage in Sialk, unchanged.

## 8. Not in v1, and why

| Left out                                       | Reason                                                                                                                                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sketch parameters exposed to MIDI and keyboard | Planned. Additive when it lands — a `1.1.0`, breaking nothing.                                                                                                                                     |
| Raw FFT, raw PCM, per-channel audio            | A contract is a promise to maintain. Raw buffers promise an implementation, and the implementation is going to change.                                                                             |
| Scene state, layer state, other layers' output | Further out. Adding it now would freeze decisions not yet made.                                                                                                                  |
| Control functions — play, stop, cue            | The sketch is an instrument being played, not the thing playing it. `window.obsstudio` carries control functions because OBS content is a source in a broadcast; Sialk content is the performance. |
| MIDI clock, external sync                      | Further out, and it belongs in `transport`, additively.                                                                                                                                |
