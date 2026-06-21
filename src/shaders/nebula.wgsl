// starforge nebula backdrop.
// Fullscreen procedural colored gas drawn at the very back (before bodies).
// Value-noise fbm tinted toward a cool blue/violet palette. Cheap, no textures.

struct NebulaParams {
  resolution : vec2<f32>, // target size in px
  time       : f32,       // seconds, for very slow drift
  intensity  : f32,       // overall brightness (0..1)
};

@group(0) @binding(0) var<uniform> params : NebulaParams;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0)       uv  : vec2<f32>,
};

// Fullscreen triangle (3 verts) covering clip space.
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
  // uv in [0,1], y down
  out.uv = c * 0.5 + vec2<f32>(0.5, 0.5);
  return out;
}

fn hash(p : vec2<f32>) -> f32 {
  let h = dot(p, vec2<f32>(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

fn valueNoise(p : vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash(i + vec2<f32>(0.0, 0.0));
  let b = hash(i + vec2<f32>(1.0, 0.0));
  let c = hash(i + vec2<f32>(0.0, 1.0));
  let d = hash(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p0 : vec2<f32>) -> f32 {
  var p = p0;
  var amp = 0.5;
  var sum = 0.0;
  for (var i = 0; i < 5; i = i + 1) {
    sum = sum + amp * valueNoise(p);
    p = p * 2.02 + vec2<f32>(11.3, 7.7);
    amp = amp * 0.5;
  }
  return sum;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  // aspect-correct coordinates, slow drift
  let aspect = params.resolution.x / max(params.resolution.y, 1.0);
  var uv = in.uv;
  uv.x = uv.x * aspect;
  let t = params.time * 0.012;
  let warp = vec2<f32>(fbm(uv * 1.7 + t), fbm(uv * 1.7 - t + 4.2));
  let n = fbm(uv * 2.4 + warp * 0.9);
  let n2 = fbm(uv * 5.0 + warp * 0.4 + 2.0);

  // density: sparse clouds, biased dark
  let density = pow(clamp(n * 0.85 + n2 * 0.25, 0.0, 1.0), 2.2);

  // palette: deep blue -> violet -> faint teal
  let blue = vec3<f32>(0.05, 0.10, 0.28);
  let violet = vec3<f32>(0.16, 0.06, 0.26);
  let teal = vec3<f32>(0.03, 0.16, 0.20);
  var col = mix(blue, violet, clamp(n2, 0.0, 1.0));
  col = mix(col, teal, clamp(warp.x, 0.0, 1.0) * 0.5);

  let rgb = col * density * params.intensity;
  return vec4<f32>(rgb, 1.0);
}
