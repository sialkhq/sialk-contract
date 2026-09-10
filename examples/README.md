# Examples

Working sketches for the Sialk audio contract.

**Two kinds of thing live here, and they are not interchangeable.**

**Sketch folders** are what you drop on Sialk Stage. Sialk Stage plays these kinds
today and refuses anything else by name:

| Folder | Kind | What it is |
| --- | --- | --- |
| `glsl-bands/` | **GLSL** | one `sketch.glsl`, no page and no loop. Sialk Stage supplies both, and the audio as uniforms. |
| `p5-rings/` | **p5** | one `sketch.js` in global mode. Sialk Stage supplies p5 itself, so it needs no library and no network. |
| `glsl-raymarch/` | **GLSL** | raymarched 3D — 96 steps, analytic normals, soft shadows. |
| `glsl-points/` | **GLSL** | a point field with no geometry: every pixel against every point. |
| `p5-3d/` | **p5** | `WEBGL` mode, 600 lit boxes — 3D the way p5 does it. |
| `p5-points/` | **p5** | a 60,000-point cloud in one `beginShape(POINTS)`. |

## What heavy content costs, and where each kind breaks

The last four exist to answer *"will my sketch run"* with numbers instead of a
shrug. **The two kinds fail on opposite axes**, and knowing which one you are
writing is most of the answer.

Measured on an Apple M3 Max, one layer, 20 s a row, output rate beside it:

| Sketch | 1280×720 | 3840×2160 | Breaks on |
| --- | --- | --- | --- |
| `p5-3d`, 600 boxes | 60 fps | 60 fps | — |
| `p5-3d`, 2,000 boxes | 59.8 fps | 59.9 fps | shape count |
| `p5-points`, 60,000 | 60 fps | 60 fps | — |
| `p5-points`, 250,000 | **27.8 fps** | **27.2 fps** | count, *not* pixels |
| `glsl-points`, 220 | 60 fps | **36.8 fps** | pixels |
| `glsl-points`, 600 | 60 fps | **12.4–13.4 fps** | pixels |
| `glsl-raymarch`, 96 steps | 60 fps | 60 fps | — |

**p5 does not care about resolution.** 250,000 points cost the same at 4K as at
720p, because the work is per-vertex and per-JavaScript-statement. Four times
the pixels are free.

**GLSL cares about nothing else.** `glsl-points` does far *less* work per pixel
than `glsl-raymarch` and collapses where the raymarcher does not, because its
loop cannot exit early — 600 iterations happen at every one of 8.3 million
pixels. A distance field that converges is cheap; a loop that always runs to
the end is not. Step count is not the thing to look at.

**A slow sketch does not slow the show.** At 12.4 fps the output still held
~120/s: the compositor draws what it last received, so a heavy layer updates
less often and everything else keeps moving. Three layers together —
`p5-points` + `glsl-raymarch` + `glsl-bands` — held 60 fps each at 4K.

To see it yourself, add the three folders to Sialk Stage as layers — drop them on
the window together, or one at a time.

**Contract pages** are the documentation: every one reads `window.sialk` and
nothing else, and runs in a plain browser through `@sialk/shim`. They are how
the contract is shown and tested. **They are not layers** — Sialk Stage will list one
and refuse to start it, naming the version its runtime arrives in, because a
page is a platform rather than a kind.

```
npx serve examples     # any static server works; then open /inspector/
```

The pages are served rather than opened directly because microphone access
needs `localhost` or HTTPS — a local server qualifies; `file://` does not.
Everything they load ships in this folder: the shim (`sialk-shim.js`) and the
stylesheet sit beside the pages.

| Page               | What it is for                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `inspector/`       | Every field of the contract, live. Start here — confirm audio is arriving before writing a sketch. |
| `minimal/`         | Raw WebGL2, no libraries. The contract integration is four lines.                                  |
| `three/`           | A Three.js scene driven by bands, onsets and beats. Loads Three.js from a CDN. The page runs in any browser today. Sialk Stage plays Three.js since 0.2.0, as a folder with a `scene.js` that exports a function: https://www.sialk.net/stage/docs/writing-three |
| `existing-sketch/` | The same sketch before and after conversion, with the `draw()` function identical in both.         |

## Writing your own

```html
<meta name="sialk-contract" content="1" />
<script type="module">
  import { installShim } from '/sialk-shim.js';

  await installShim({ source: 'microphone' });
  const { audio, transport, output } = window.sialk;

  requestAnimationFrame(function frame() {
    // audio.level, audio.bass, audio.spectrum, audio.onBeat, audio.hits …
    // transport.elapsed drives animation; output.width is the real surface.
    requestAnimationFrame(frame);
  });
</script>
```

**A hosted sketch must start without a gesture.** Inside Sialk Stage your sketch runs
in an off-screen browser and there is nothing to click. Branch on whether the
contract is already there:

```js
if (window.sialk)
  run(); // hosted — start now
else
  button.onclick = async () => {
    // standalone — browsers need a gesture
    await installShim({ source: 'microphone' });
    run();
  };
```

Three more things that are easy to get wrong:

- **Destructure once, at startup.** The contract guarantees `audio`, `transport`
  and `output` are the same objects for the sketch's whole life, mutated in
  place. Re-reading `window.sialk.audio` every frame is not wrong, just pointless.
- **Drive animation from `transport.elapsed`, not `transport.time`.** `elapsed`
  only ever increases. `time` is the show's position and jumps when a performer
  scrubs or cues — which is sometimes exactly what you want, deliberately.
- **Size to `output.width` and `output.height`, not to the window.** Inside
  Sialk Stage the surface being composited is the projector, and it is not this window.

The full specification is `contract/audio-contract-v1.md`. Read §3 for the
guarantees a host makes you, and §4 before assuming anything can change.

## The GLSL shaders

`glsl-bands` is the one the application bundles and falls back to. The rest are
here to be dropped on it — and to keep the runtime honest about what it claims
to play.

| folder | dialect | what it is for |
| --- | --- | --- |
| `glsl-bands` | ES 3.00 | The bundled one. A spectrum, drawn with headroom so a loud room does not fill the frame solid. |
| `glsl-raymarch` | ES 3.00 | Deliberately expensive: 96 march steps, analytic normals, a 24-step soft shadow. **119.1/s with one dropped frame in 422** at 1280×720 on an M3 Max, 27 Aug. It is the answer to "will it keep up". |
| `glsl-shadertoy` | ES 3.00, `mainImage` | The exact signature Shadertoy generates, so "a shader you wrote in that dialect simply runs" is a claim with a file behind it. |
| `glsl-legacy` | ES 1.00 | `gl_FragColor`, `texture2D`, constant loop bounds — what most shaders on the internet still are. |
| `glsl-conformance/` | mixed | Not demonstrations: the awkward spellings the runtime has to accept, including one that must fail cleanly. See its own README. |

**None of them is copied.** Shadertoy's library is CC-BY-NC, and this
project's licensing rule keeps copyleft and non-commercial code out entirely —
so these are written to the shapes those dialects use, which is not the same as
taking the shaders.
