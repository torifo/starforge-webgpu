// starforge interaction compute shader.
// Applies a pointer-driven impulse to all bodies within a radius. Runs entirely
// on the GPU (no CPU readback / picking): the CPU only uploads the cursor state.
//
// modes:
//   1 = attract  (grab/hold): pull bodies toward the cursor, carry cursor motion
//   2 = throw    (release):   impart the cursor velocity as a one-shot impulse
//   3 = shock    (explode):   push bodies radially outward from the cursor

struct IParams {
  pos      : vec2<f32>,  // cursor position, world space
  vel      : vec2<f32>,  // cursor velocity, world units / frame
  radius   : f32,        // effect radius, world units
  strength : f32,        // effect magnitude
  mode     : u32,
  count    : u32,        // active body count
};

@group(0) @binding(0) var<uniform>             P         : IParams;
@group(0) @binding(1) var<storage, read>       positions : array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec2<f32>>;

@compute @workgroup_size(64)
fn interact(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.count) {
    return;
  }

  let d = P.pos - positions[i];           // body -> cursor
  let dist2 = d.x * d.x + d.y * d.y;
  let r2 = P.radius * P.radius;
  if (dist2 > r2) {
    return;
  }

  let dist = sqrt(max(dist2, 1.0e-4));
  let falloff = 1.0 - dist / P.radius;    // 1 at center, 0 at edge
  let dir = d / dist;                      // unit body -> cursor

  var dv = vec2<f32>(0.0, 0.0);
  if (P.mode == 1u) {
    // grab/hold: ease toward cursor and inherit a little of its motion
    dv = dir * (P.strength * falloff) + P.vel * (0.18 * falloff);
  } else if (P.mode == 2u) {
    // throw: one-shot impulse along cursor velocity
    dv = P.vel * (P.strength * falloff);
  } else if (P.mode == 3u) {
    // shock: push outward (away from cursor)
    dv = -dir * (P.strength * falloff);
  }

  velocities[i] = velocities[i] + dv;
}
