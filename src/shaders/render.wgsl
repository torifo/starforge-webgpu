// starforge point-sprite render shader.
// Instanced quad per body (6 vertices), expanded in clip space, round glow in fragment.

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

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  let world = positions[ii];
  let center = world * camera.scale + camera.translate;

  let corner = cornerFor(vi);
  // larger mass -> slightly larger sprite (gentle, log-ish via sqrt)
  let m = masses[ii];
  let sizeScale = clamp(sqrt(max(m, 0.0001)), 0.5, 4.0);
  let offset = corner * camera.pointSize * sizeScale;

  var out: VSOut;
  out.pos = vec4<f32>(center + offset, 0.0, 1.0);
  out.uv = corner;
  out.bright = clamp(0.4 + 0.15 * sizeScale, 0.0, 1.0);
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
  let intensity = clamp(glow * 0.6 + core * 0.8, 0.0, 1.0) * in.bright;
  // warm-white star color
  let col = vec3<f32>(0.85, 0.9, 1.0) * intensity;
  return vec4<f32>(col, intensity);
}
