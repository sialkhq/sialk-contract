# @sialk/shim

**Run a Sialk sketch in a plain browser.**

Provides `window.sialk` from the microphone or an audio file, so a sketch can be
written, tested and demonstrated without the Sialk Stage application. Inside Sialk Stage it
does nothing at all — the host has already installed the real contract, and the
shim stands aside rather than fighting it.

```js
import { installShim } from '@sialk/shim';

// From the microphone, once the page has had a gesture.
await installShim();

// Or from a file, which is what a demo page usually wants.
await installShim({ source: { kind: 'url', url: '/audio/track.mp3', loop: true } });

// Or from an element already on the page, so the listener controls playback.
await installShim({ source: { kind: 'element', element: document.querySelector('audio') } });
```

Then write the sketch exactly as you would for Sialk Stage:

```js
const { audio, transport } = window.sialk;
```

`installShim` resolves to a handle whose `passthrough` is `true` when a real
Sialk Stage host was already present and the shim stood aside. That is the normal
case inside the application, and it is not an error.

## Why it exists

The contract's first rule is that the global is simply there — no polling, no
readiness event, no race. That is easy inside Sialk Stage, which installs it in a
preload before the page's first line. In a browser there is no preload, so the
shim does the same job as early as it can and gives you a promise for the point
at which audio is actually flowing.

Analysis is the same DSP the application uses: spectral-flux onsets and
autocorrelation tempo, written from scratch and permissively licensed.

## What it is not

It is not a way to perform. There is no compositing, no layers, no MIDI and no
output — that is the application. This is the development loop.

## Browser drop-in

If you would rather not use a bundler, `dist/sialk-shim.js` is a single ESM file
with everything inlined:

```html
<script type="module">
  import { installShim } from './sialk-shim.js';
  await installShim({ source: { kind: 'url', url: 'track.mp3' } });
</script>
```

See <https://www.sialk.net/contract> for the contract this implements.

MIT licensed.
