# GLSL conformance — the shapes, not the pictures

These are not demonstrations. They are the awkward spellings of a fragment
shader that the runtime has to accept, kept as real folders so the claim can be
tested by **dropping them on Sialk Operator** rather than only as strings in a test.

Sialk Operator's own test suite covers the same rules as pure functions, which is
faster. These folders cover what a unit test cannot: that
the shader assembled from them actually compiles, links and paints on a GPU.

| folder | what it is |
| --- | --- |
| `mainimage-alias` | `mainImage` whose output parameter is **not** called `fragColor`. The host must still supply an output and wrap it. |
| `named-output` | Declares `out vec4 myPixel;` of its own **and** uses `mainImage`. The host must leave the declaration alone and pass the right name to the wrapper. |
| `will-not-compile` | Deliberately malformed. The host must report **one** line, at the sketch's own line number, and paint nothing — a failing layer never takes the canvas. |

## Why these exist

`mainimage-alias` found a real defect on 27 Aug. The host decided whether a
sketch declared its own output with `/\bout\s+vec4\b/` over the whole source,
which matches a **function parameter** as readily as a declaration — and the
signature Shadertoy generates is:

```glsl
void mainImage( out vec4 fragColor, in vec2 fragCoord )
```

So the host concluded the sketch had brought its own output, supplied none, and
the wrapper it appended referred to a name that did not exist. Every shader in
that dialect failed with `'fragColor' : undeclared identifier`, and the
repository had been carrying "the Shadertoy wrapper has never compiled
anything" as an open question. It had never compiled anything because it could
not.

Nothing here is copied from anywhere. Shadertoy's library is CC-BY-NC and must
never enter this repository — a standing licensing rule of the project;
these are written to the *shape* Shadertoy uses, which is not the same thing.
