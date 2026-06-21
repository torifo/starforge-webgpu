// starforge N-body compute shader.
// SoA storage buffers; naive O(n^2) gravity with softening; leapfrog (kick-drift) integration.

struct SimParams {
  dt        : f32,   // fixed timestep
  softening2: f32,   // epsilon^2 (softening length squared)
  g         : f32,   // gravitational constant (tunable scale)
  count     : u32,   // active body count
};

@group(0) @binding(0) var<uniform>             params    : SimParams;
@group(0) @binding(1) var<storage, read_write> positions : array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> accels    : array<vec2<f32>>;
@group(0) @binding(4) var<storage, read>       masses    : array<f32>;

// Accumulate gravitational acceleration on each body from all others.
// a_i = G * sum_j m_j * (p_j - p_i) / (|p_j - p_i|^2 + eps^2)^(3/2)
@compute @workgroup_size(64)
fn computeForces(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.count) {
    return;
  }

  let pi = positions[i];
  var acc = vec2<f32>(0.0, 0.0);
  let eps2 = params.softening2;
  let n = params.count;

  for (var j: u32 = 0u; j < n; j = j + 1u) {
    if (j == i) {
      continue;
    }
    let d = positions[j] - pi;
    let dist2 = d.x * d.x + d.y * d.y + eps2;
    // inv_dist3 = 1 / (dist2)^(3/2)
    let inv_dist = inverseSqrt(dist2);
    let inv_dist3 = inv_dist * inv_dist * inv_dist;
    acc = acc + masses[j] * d * inv_dist3;
  }

  accels[i] = params.g * acc;
}

// Leapfrog kick-drift integration using the acceleration computed this frame.
// v_half = v + 0.5*a*dt ; p' = p + v_half*dt ; v' = v_half + 0.5*a*dt
@compute @workgroup_size(64)
fn integrate(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.count) {
    return;
  }

  let a = accels[i];
  let dt = params.dt;
  var v = velocities[i];
  var p = positions[i];

  let v_half = v + 0.5 * a * dt;
  p = p + v_half * dt;
  v = v_half + 0.5 * a * dt;

  positions[i] = p;
  velocities[i] = v;
}
