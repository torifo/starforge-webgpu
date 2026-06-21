// starforge trail accumulation pass.
// Output = previousTrail * decay + freshPoints. Written to a target that is the
// ping-pong partner of `prevTrail`. The fresh-points texture holds this frame's
// body render (nebula NOT included, so the backdrop never trails).

struct TrailParams {
  decay : f32, // 0..1 per-frame multiplier on history (e.g. 0.92)
  _pad0 : f32,
  _pad1 : f32,
  _pad2 : f32,
};

@group(0) @binding(0) var prevTrail : texture_2d<f32>;
@group(0) @binding(1) var points    : texture_2d<f32>;
@group(0) @binding(2) var samp      : sampler;
@group(0) @binding(3) var<uniform> params : TrailParams;

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

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let hist = textureSample(prevTrail, samp, in.uv).rgb * params.decay;
  let fresh = textureSample(points, samp, in.uv).rgb;
  return vec4<f32>(hist + fresh, 1.0);
}
