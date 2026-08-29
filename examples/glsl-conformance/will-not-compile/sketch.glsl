// Deliberately wrong: a missing semicolon and an undeclared name. The host
// must report one clean line and paint nothing (beta rule 3).
void main() {
  vec2 uv = gl_FragCoord.xy / sialkResolution
  float d = undeclaredThing(uv);
  fragColor = vec4(d, d, d, 1.0);
}
