// Camera-space sphere lighting shared by standalone and coupled particle views.
// This shades the display surface only; no simulation state or temperature changes.
export const particleLightingGLSL = `
uniform bool particleShading;
vec3 shadeParticle(vec3 base, vec3 normal) {
  if (!particleShading) return base;
  vec3 light = normalize(vec3(-.55, .8, 1.));
  float diffuse = max(0., dot(normal, light));
  float ambient = .24 + .12 * (normal.y * .5 + .5);
  float rim = mix(.68, 1., smoothstep(0., .65, normal.z));
  vec3 shaded = base * (ambient + .70 * diffuse) * rim;
  vec3 halfway = normalize(light + vec3(0., 0., 1.));
  float highlight = .24 * pow(max(0., dot(normal, halfway)), 48.);
  return min(vec3(1.), shaded + vec3(highlight));
}
`;
