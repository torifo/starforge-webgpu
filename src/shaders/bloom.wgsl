// starforge bloom passes.
// Three fragment entry points sharing one fullscreen vertex:
//   brightpass  - extract pixels above a luminance threshold (soft knee)
//   blurH       - horizontal gaussian (9-tap)
//   blurV       - vertical gaussian (9-tap)
// All operate on an input texture sampled with a linear sampler.

struct BlurParams {
  texel     : vec2<f32>, // 1/size of the input texture
  threshold : f32,       // bright-pass luminance threshold
  _pad      : f32,
};

@group(0) @binding(0) var src      : texture_2d<f32>;
@group(0) @binding(1) var samp     : sampler;
@group(0) @binding(2) var<uniform> params : BlurParams;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0)       uv  : vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VSOut {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  let c = p[vi];
  var out : VSOut;
  out.pos = vec4<f32>(c, 0.0, 1.0);
  // flip y so uv origin is top-left to match texture space
  out.uv = vec2<f32>(c.x * 0.5 + 0.5, 0.5 - c.y * 0.5);
  return out;
}

fn luma(c : vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

@fragment
fn brightpass(in : VSOut) -> @location(0) vec4<f32> {
  let c = textureSample(src, samp, in.uv).rgb;
  let l = luma(c);
  // soft knee around threshold
  let knee = 0.25;
  let t = clamp((l - params.threshold) / max(knee, 0.001), 0.0, 1.0);
  let factor = t * t;
  return vec4<f32>(c * factor, 1.0);
}

// 9-tap gaussian weights (normalized).
const W0 : f32 = 0.227027;
const W1 : f32 = 0.194595;
const W2 : f32 = 0.121622;
const W3 : f32 = 0.054054;
const W4 : f32 = 0.016216;

@fragment
fn blurH(in : VSOut) -> @location(0) vec4<f32> {
  let tx = params.texel.x;
  var sum = textureSample(src, samp, in.uv).rgb * W0;
  sum = sum + textureSample(src, samp, in.uv + vec2<f32>(tx * 1.0, 0.0)).rgb * W1;
  sum = sum + textureSample(src, samp, in.uv - vec2<f32>(tx * 1.0, 0.0)).rgb * W1;
  sum = sum + textureSample(src, samp, in.uv + vec2<f32>(tx * 2.0, 0.0)).rgb * W2;
  sum = sum + textureSample(src, samp, in.uv - vec2<f32>(tx * 2.0, 0.0)).rgb * W2;
  sum = sum + textureSample(src, samp, in.uv + vec2<f32>(tx * 3.0, 0.0)).rgb * W3;
  sum = sum + textureSample(src, samp, in.uv - vec2<f32>(tx * 3.0, 0.0)).rgb * W3;
  sum = sum + textureSample(src, samp, in.uv + vec2<f32>(tx * 4.0, 0.0)).rgb * W4;
  sum = sum + textureSample(src, samp, in.uv - vec2<f32>(tx * 4.0, 0.0)).rgb * W4;
  return vec4<f32>(sum, 1.0);
}

@fragment
fn blurV(in : VSOut) -> @location(0) vec4<f32> {
  let ty = params.texel.y;
  var sum = textureSample(src, samp, in.uv).rgb * W0;
  sum = sum + textureSample(src, samp, in.uv + vec2<f32>(0.0, ty * 1.0)).rgb * W1;
  sum = sum + textureSample(src, samp, in.uv - vec2<f32>(0.0, ty * 1.0)).rgb * W1;
  sum = sum + textureSample(src, samp, in.uv + vec2<f32>(0.0, ty * 2.0)).rgb * W2;
  sum = sum + textureSample(src, samp, in.uv - vec2<f32>(0.0, ty * 2.0)).rgb * W2;
  sum = sum + textureSample(src, samp, in.uv + vec2<f32>(0.0, ty * 3.0)).rgb * W3;
  sum = sum + textureSample(src, samp, in.uv - vec2<f32>(0.0, ty * 3.0)).rgb * W3;
  sum = sum + textureSample(src, samp, in.uv + vec2<f32>(0.0, ty * 4.0)).rgb * W4;
  sum = sum + textureSample(src, samp, in.uv - vec2<f32>(0.0, ty * 4.0)).rgb * W4;
  return vec4<f32>(sum, 1.0);
}
