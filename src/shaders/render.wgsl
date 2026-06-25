// starforge point-sprite render shader.
// Instanced quad per body (6 vertices), expanded in clip space, round glow in fragment.
// Bodies are coloured by a stellar-temperature ramp (red -> yellow-white -> blue-white):
// more massive bodies skew hotter/bluer and brighter; the smallest read as dim planets.

struct Camera {
  scale    : vec2<f32>,  // clip units per world unit (x, y)
  translate: vec2<f32>,  // clip-space offset
  pointSize: f32,        // half-size of the sprite quad in clip units
  _pad0    : f32,
  _pad1    : f32,
  _pad2    : f32,
};

@group(0) @binding(0) var<uniform>       camera    : Camera;
@group(0) @binding(1) var<storage, read> positions : array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> masses    : array<f32>;

struct VSOut {
  @builtin(position) pos    : vec4<f32>,
  @location(0)       uv     : vec2<f32>,   // [-1,1] within the sprite
  @location(1)       bright : f32,
  @location(2)       color  : vec3<f32>,   // per-body stellar colour
};

// Unit quad corners as two triangles (vertex_index 0..5).
fn cornerFor(vi: u32) -> vec2<f32> {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
  );
  return corners[vi];
}

// Cheap per-body hash in [0,1] for colour variety.
fn hash11(p: f32) -> f32 {
  var h = fract(p * 0.1031);
  h = h * (h + 33.33);
  h = h * (h + h);
  return fract(h);
}

// Stellar-temperature ramp: t=0 cool red, 0.5 yellow-white, 1 hot blue-white.
fn starColor(t: f32) -> vec3<f32> {
  // Saturated so the colour survives bloom + the ACES tonemap's highlight whitening.
  let red = vec3<f32>(1.00, 0.26, 0.12);  // cool dwarf / Mars-ish
  let yel = vec3<f32>(1.00, 0.74, 0.34);  // sun-like gold
  let blu = vec3<f32>(0.42, 0.64, 1.00);  // hot blue-white
  if (t < 0.5) {
    return mix(red, yel, t * 2.0);
  }
  return mix(yel, blu, (t - 0.5) * 2.0);
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  let world = positions[ii];
  let center = world * camera.scale + camera.translate;

  let corner = cornerFor(vi);
  // larger mass -> slightly larger sprite (gentle, log-ish via sqrt)
  let m = masses[ii];
  let sizeScale = clamp(sqrt(max(m, 0.0001)), 0.5, 4.0);
  let offset = corner * camera.pointSize * sizeScale;

  // colour: random spread per body, biased hotter/bluer for more massive bodies.
  let h = hash11(f32(ii) + 1.7);
  let massBias = (sizeScale - 0.5) / 3.5;            // 0 (lightest) .. 1 (heaviest)
  // hash drives the full spread of star colours; mass nudges toward hot blue.
  let temp = clamp(h * 0.9 + massBias * 0.3, 0.0, 1.0);
  var color = starColor(temp);
  // the smallest bodies read as planets: cooler, a touch desaturated, dimmer.
  let planetish = 1.0 - smoothstep(0.55, 1.1, sizeScale);   // 1 tiny .. 0 large
  color = mix(color, mix(color, vec3<f32>(0.55, 0.62, 0.72), 0.55), planetish * 0.6);

  var out: VSOut;
  out.pos = vec4<f32>(center + offset, 0.0, 1.0);
  out.uv = corner;
  out.color = color;
  out.bright = clamp(0.4 + 0.15 * sizeScale, 0.0, 1.0) * (1.0 - planetish * 0.4);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let r = length(in.uv);
  if (r > 1.0) {
    discard;
  }
  // soft radial falloff
  let glow = smoothstep(1.0, 0.0, r);
  let core = smoothstep(0.5, 0.0, r);
  let intensity = clamp(glow * 0.45 + core * 0.55, 0.0, 1.0) * in.bright;
  let col = in.color * intensity;
  return vec4<f32>(col, intensity);
}
