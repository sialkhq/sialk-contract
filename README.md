# The Sialk audio contract

[Sialk](https://www.sialk.app) turns browser-made sketches — GLSL, p5, and
more to come — into live, audio-reactive instruments for the stage. It speaks
to a sketch through one thing: `window.sialk`, an object that is present
before your first line runs and carries the music as ordinary numbers —
loudness, three bands, a spectrum, onsets, tempo, and the phase of the beat.

This repository is everything you need to **write against that contract**,
with or without Sialk installed. All of it is MIT.

## What is here

| Folder | What it is |
| --- | --- |
| `contract/` | **The specification** — frozen at v1. A published version never changes: additions are minor versions; anything else is a new major, served alongside v1, never replacing it. |
| `audio-contract/` | The TypeScript source of the contract surface, with its conformance checker and the tests that freeze it. |
| `shim/` | The browser shim. Load `shim/sialk-shim.js` in any page and `window.sialk` appears, fed by the page's own microphone or an `<audio>` element — so the same sketch runs on the web and on stage, unchanged. |
| `examples/` | Working sketches — GLSL and p5 — including `existing-sketch/`, the same sketch before and after adopting the contract, with a byte-identical `draw()`. |

## The fastest start

```html
<script type="module">
  import { installShim } from './shim/sialk-shim.js';
  await installShim(); // asks for the microphone; window.sialk is now live
</script>
```

Then read `window.sialk.audio.level`, `.bands`, `.onBeat` — the spec in
`contract/` names every field and the twelve guarantees a host makes.

The contract is also published at https://www.sialk.app/contract, and Sialk's
free public beta — where these sketches become layers you mix on a wall — is
at https://www.sialk.app/beta.

## Licence

MIT, throughout — each folder carries its own LICENCE. The Sialk application
itself is separate and not open source; a contract is the part that only
works published.
