# Converting a sketch you already have

`before.html` and `after.html` draw exactly the same thing. The `draw()`
function is byte-for-byte identical in both files. Everything that differs is
the audio layer.

## Before

31 lines: an `AudioContext`, an `AnalyserNode`, `getUserMedia` with the three
processing flags that have to be turned off, a hand-rolled fold from linear FFT
bins into 64 log-spaced bands, a broadband level, and an asymmetric smoothing
coefficient tuned by eye.

It works. It is also 31 lines that every sketch in this field rewrites slightly
differently, none of them documented, and none of them portable anywhere.

## After

```js
await installShim({ source: 'microphone' });
const { audio, transport, output } = window.sialk;
```

Two lines of setup and one destructure. The band folding, the smoothing and the
device flags are the host's problem, and they are specified rather than
improvised.

## What is actually gained

Deleting plumbing is the small part. Three things matter more:

1. **It runs on stage unchanged.** Inside Sialk the shim stands down and the
   host writes the same fields. The same file is the laptop version and the
   show version — there is no port.

2. **Things arrive that were not worth building alone.** `after.html` uses
   `audio.onBeat`, which `before.html` leaves at `0` because writing a tempo
   tracker is not a reasonable price for one sketch. `hits`, `bpm`,
   `bpmConfidence` and `levelTrail` come along the same way.

3. **The numbers mean something documented.** `audio.bass` has a stated
   frequency range, a stated 0..1 range and stated smoothing behaviour, and
   those cannot change under you without a major version and a migration path.
   `smoothedLevel` in `before.html` means whatever that line happened to do.

## What is lost

Direct access to raw FFT bins and raw PCM. The contract deliberately does not
expose them (spec §8): a contract is a promise to maintain, and raw buffers
promise an implementation that is going to change. A sketch that genuinely needs
its own FFT can still build one — the contract does not take the Web Audio API
away.
