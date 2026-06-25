// starforge stream-compaction compute shader.
// Packs live bodies (mass > 0) to the front of scratch buffers using an atomic
// counter, so merged-away (mass 0) slots can be reclaimed. Output order is not
// preserved — irrelevant for an N-body sim. The CPU reads the final counter to
// shrink the active body count (which tightens the O(n^2) force loop).

struct CParams {
  count : u32,   // current active count (upper bound to scan)
  _a    : u32,
  _b    : f32,
  _c    : f32,
};

@group(0) @binding(0) var<uniform>             P       : CParams;
@group(0) @binding(1) var<storage, read>       srcPos  : array<vec2<f32>>;
@group(0) @binding(2) var<storage, read>       srcVel  : array<vec2<f32>>;
@group(0) @binding(3) var<storage, read>       srcMass : array<f32>;
@group(0) @binding(4) var<storage, read_write> dstPos  : array<vec2<f32>>;
@group(0) @binding(5) var<storage, read_write> dstVel  : array<vec2<f32>>;
@group(0) @binding(6) var<storage, read_write> dstMass : array<f32>;
@group(0) @binding(7) var<storage, read_write> counter : atomic<u32>;

@compute @workgroup_size(64)
fn compact(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.count) { return; }
  let m = srcMass[i];
  if (m == 0.0) { return; }
  let idx = atomicAdd(&counter, 1u);
  dstPos[idx] = srcPos[i];
  dstVel[idx] = srcVel[i];
  dstMass[idx] = m;
}
