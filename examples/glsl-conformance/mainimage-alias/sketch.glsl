// The Shadertoy entry point and its uniform names, with no `main()` at all —
// the shape the host wraps. Written here; nothing is copied.
#define TAU 6.2831853

vec3 palette(float t) {
  return 0.5 + 0.5 * cos(TAU * (vec3(0.0, 0.33, 0.67) + t));
}

void mainImage(out vec4 outColour, in vec2 fragPos) {
  vec2 uv = (fragPos - 0.5 * iResolution.xy) / iResolution.y;
  vec2 seed = uv;
  vec3 accumulated = vec3(0.0);

  for (int i = 0; i < 5; i++) {
    uv = fract(uv * (1.4 + 0.25 * sialkBass)) - 0.5;
    float d = length(uv) * exp(-length(seed));
    vec3 tint = palette(length(seed) + float(i) * 0.4 + iTime * 0.35);
    d = sin(d * 9.0 + iTime * 1.5) / 9.0;
    d = abs(d);
    d = pow(0.012 / max(d, 1e-4), 1.35);
    accumulated += tint * d;
  }

  float energy = 0.35 + 0.65 * sialkLevel;
  vec3 colour = accumulated * energy;
  float alpha = clamp(max(colour.r, max(colour.g, colour.b)), 0.0, 1.0);
  outColour = vec4(colour * alpha, alpha);
}
