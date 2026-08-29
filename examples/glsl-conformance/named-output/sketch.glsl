// Declares its own output under a name of its choosing, and uses mainImage.
out vec4 myPixel;

void mainImage(out vec4 o, in vec2 f) {
  vec2 uv = f / sialkResolution;
  o = vec4(uv.x, uv.y, 0.5 + 0.5 * sin(sialkTime), 1.0);
}
