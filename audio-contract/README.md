# @sialk/audio-contract

**The versioned `window.sialk` global that sketches are written against.**

A Sialk sketch is an ordinary web page. It does not import a framework, register
a callback, or wait for anything: `window.sialk` is there before the first line
of the sketch runs, and reading it costs nothing.

```js
const { audio, transport } = window.sialk;

function frame() {
  requestAnimationFrame(frame);
  ring.scale = 1 + audio.bass * 0.6;
  ring.spin += audio.level * transport.delta;
}
frame();
```

## What it gives you

| Field                           | What it is                                             |
| ------------------------------- | ------------------------------------------------------ |
| `audio.level`                   | Overall loudness, 0–1                                  |
| `audio.bass` `.mid` `.high`     | Three bands: 20–250, 250–2 000, 2 000–16 000 Hz        |
| `audio.spectrum`                | 64 log-spaced bins, 20 Hz–16 kHz, `Float32Array`       |
| `audio.levelTrail`              | The last 128 frames of `level`, oldest first           |
| `audio.onBeat`                  | `1` on the frame a beat lands, `0` otherwise           |
| `audio.beatPhase`               | 0–1 through the current beat                           |
| `audio.hits` `.onsetStrength`   | Onsets counted, and how hard the last one was          |
| `audio.bpm` `.bpmConfidence`    | Tempo, and how much to trust it                        |
| `audio.silent`                  | True after a second with no signal                     |
| `transport.time` `.delta`       | Seconds since the show started, and since the last frame |
| `output.width` `.height` `.fps` | What you are being rendered at                         |

Every array keeps its identity for the life of the page, so a sketch can
destructure once and upload to a uniform every frame without allocating.

`audio.silent` matters more than it looks: **an audio-driven sketch in a silent
room is correct and still.** Say so on screen rather than looking broken.

## Events, when polling is the wrong shape

```js
const stop = window.sialk.on('beat', ({ bpm, confidence }) => {
  if (confidence > 0.4) flash();
});
```

`on` returns its own unsubscribe function. The events are `beat`, `onset`,
`resize`, `transport` and `parameter`.

## Parameters

Declare what your sketch exposes and the performer gets a control for each one —
plus audio modulators and tempo-synced LFOs on top of it.

```js
window.sialk.parameters.declare({
  rings: { type: 'number', label: 'Rings', default: 14, min: 4, max: 40 },
  palette: { type: 'enum', label: 'Palette', options: ['warm', 'cold'], default: 'warm' },
  flash: { type: 'trigger', label: 'Flash' },
});

// Live values, mutated in place — read them in your frame loop.
const { values } = window.sialk.parameters;
ring.count = values.rings;
```

Declaring is safe at any time. A redeclaration never discards what the performer
has dialled in, so a sketch can be edited between soundcheck and the set.

## Running a sketch outside Sialk Stage

[`@sialk/shim`](https://www.npmjs.com/package/@sialk/shim) provides the same
global in a plain browser, off the microphone or an audio file, so a sketch can
be written and tested without the application.

## Versioning

`window.sialk.contractVersion` is semver and is the only thing a sketch should
branch on. **v1 is frozen**: additions are minor versions; removals, renames and
changed meanings are major, and a major version is served alongside v1 rather
than replacing it.

The full specification is at <https://www.sialk.net/contract>.

MIT licensed.
