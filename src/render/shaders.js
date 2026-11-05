// WGSL shaders. Colours arrive in linear space; every fragment shader encodes
// to sRGB at the end because the canvas format (bgra8unorm / rgba8unorm) is not
// an -srgb format. The painting texture IS rgba8unorm-srgb, so sampling it
// decodes to linear for free — together this gives correct sRGB handling.

const common = /* wgsl */ `
struct Camera {
  viewProj : mat4x4f,
  eye      : vec4f,
  light    : vec4f,
};
struct Object {
  model     : mat4x4f,
  normalMat : mat4x4f,
  color     : vec4f,
  params    : vec4f,   // x: 1 = lit, 0 = unlit
};
@group(0) @binding(0) var<uniform> cam : Camera;

fn toSrgb(c : vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}
`;

export const meshShader = /* wgsl */ `
${common}
@group(1) @binding(0) var<uniform> obj : Object;
@group(2) @binding(0) var paintSampler : sampler;
@group(2) @binding(1) var paintTex : texture_2d<f32>;

struct VsIn {
  @location(0) pos    : vec3f,
  @location(1) normal : vec3f,
  @location(2) uv     : vec2f,
};
struct VsOut {
  @builtin(position) clip : vec4f,
  @location(0) worldPos   : vec3f,
  @location(1) normal     : vec3f,
  @location(2) uv         : vec2f,
};

@vertex fn vs(in : VsIn) -> VsOut {
  var o : VsOut;
  let wp = obj.model * vec4f(in.pos, 1.0);
  o.clip = cam.viewProj * wp;              // p_clip = P · V · M · p_object
  o.worldPos = wp.xyz;
  o.normal = (obj.normalMat * vec4f(in.normal, 0.0)).xyz;
  o.uv = in.uv;
  return o;
}

@fragment fn fsLit(in : VsOut) -> @location(0) vec4f {
  let base = obj.color.rgb;
  if (obj.params.x < 0.5) { return vec4f(toSrgb(base), 1.0); }
  var n = normalize(in.normal);
  let v = normalize(cam.eye.xyz - in.worldPos);
  if (dot(n, v) < 0.0) { n = -n; }         // two-sided lighting
  let l = normalize(cam.light.xyz);
  let h = normalize(l + v);
  let diffuse = max(dot(n, l), 0.0);
  let fill = 0.35 * max(dot(n, normalize(vec3f(-0.4, 0.3, 0.8))), 0.0);
  let spec = 0.25 * pow(max(dot(n, h), 0.0), 40.0);
  let c = base * (0.18 + 0.75 * diffuse + fill) + vec3f(spec);
  return vec4f(toSrgb(c), 1.0);
}

@fragment fn fsPainting(in : VsOut) -> @location(0) vec4f {
  let c = textureSample(paintTex, paintSampler, in.uv).rgb;   // sRGB texture → linear
  return vec4f(toSrgb(c * obj.color.rgb), 1.0);
}
`;

export const colorShader = /* wgsl */ `
${common}
struct VsIn {
  @location(0) pos   : vec3f,
  @location(1) color : vec4f,
};
struct VsOut {
  @builtin(position) clip : vec4f,
  @location(0) color      : vec4f,
};
@vertex fn vs(in : VsIn) -> VsOut {
  var o : VsOut;
  o.clip = cam.viewProj * vec4f(in.pos, 1.0);
  o.color = in.color;
  return o;
}
@fragment fn fs(in : VsOut) -> @location(0) vec4f {
  return vec4f(toSrgb(in.color.rgb), in.color.a);
}
`;
