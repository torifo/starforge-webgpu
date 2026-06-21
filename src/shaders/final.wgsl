// starforge final composite.
// Combines: nebula backdrop + accumulated trails + bloom, then tonemaps to the
// swapchain (LDR sRGB-ish output). This is the only pass that writes the canvas.

struct FinalParams {
  bloomStrength : f32, // additive bloom gain
  exposure      : f32, // overall exposure before tonemap
  _pad0         : f32,
  _pad1         : f32,
};

@group(0) @binding(0) var trailTex : texture_2d<f32>;
@group(0) @binding(1) var bloomTex : texture_2d<f32>;
@group(0) @binding(2) var nebulaTex: texture_2d<f32>;
@group(0) @binding(3) var samp     : sampler;
@group(0) @binding(4) var<uniform> params : FinalParams;

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
  out.uv = vec2<f32>(c.x * 0.5 + 0.5, 0.5 - c.y * 0.5);
  return out;
}

// ACES-ish filmic tonemap (Narkowicz approximation).
fn tonemap(x : vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let nebula = textureSample(nebulaTex, samp, in.uv).rgb;
  let trail  = textureSample(trailTex, samp, in.uv).rgb;
  let bloom  = textureSample(bloomTex, samp, in.uv).rgb;

  var hdr = nebula + trail + bloom * params.bloomStrength;
  hdr = hdr * params.exposure;
  let mapped = tonemap(hdr);
  return vec4<f32>(mapped, 1.0);
}
