// starforge collision / merge compute shader.
// Real accretion: nearby bodies merge into the heavier one, conserving mass and
// momentum. Done in three passes with no float atomics (a "pull" model): each
// surviving body gathers everyone who chose it.
//
//   findPref   : every body picks its single preferred partner (heaviest neighbor
//                within the combined collision radius; ties break to lower index).
//                pref[i] == i means "no preferred partner" -> i is a sink (survivor).
//   mergeApply : each sink scans for bodies that chose it and folds in their mass,
//                momentum, and mass-weighted position. Only sinks write themselves.
//   markDead   : a body absorbed into a sink sets its own mass to 0 (it is then
//                skipped by the integrator and culled by the renderer; a later
//                compaction pass reclaims the slot).
//
// Chains are avoided by absorbing only into sinks: a body whose preferred partner
// is itself absorbed simply waits for the next step (clusters collapse over a few
// steps, which is instant under hyperlapse).

struct CollideParams {
  count      : u32,
  mode       : u32,   // 0 = off, 1 = merge
  mergeScale : f32,   // collision radius = mergeScale * mass^(1/3)
  _pad       : f32,
};

@group(0) @binding(0) var<uniform>             P         : CollideParams;
@group(0) @binding(1) var<storage, read_write> positions : array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> masses    : array<f32>;
@group(0) @binding(4) var<storage, read_write> pref      : array<u32>;

fn radiusOf(m: f32) -> f32 {
  return P.mergeScale * pow(max(m, 1.0), 0.3333333);
}

@compute @workgroup_size(64)
fn findPref(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.count) { return; }
  let mi = masses[i];
  if (mi == 0.0) { pref[i] = i; return; }

  let pi = positions[i];
  let ri = radiusOf(mi);
  var best: u32 = i;       // start as self (sink unless something is preferred)
  var bestMass: f32 = mi;

  for (var j: u32 = 0u; j < P.count; j = j + 1u) {
    if (j == i) { continue; }
    let mj = masses[j];
    if (mj == 0.0) { continue; }
    let d = positions[j] - pi;
    let rsum = ri + radiusOf(mj);
    if (dot(d, d) <= rsum * rsum) {
      // prefer the heavier neighbor; on a tie prefer the lower index
      if (mj > bestMass || (mj == bestMass && j < best)) {
        best = j;
        bestMass = mj;
      }
    }
  }
  pref[i] = best;
}

@compute @workgroup_size(64)
fn mergeApply(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.count) { return; }
  let mi = masses[i];
  if (mi == 0.0) { return; }
  if (pref[i] != i) { return; }   // only sinks finalize

  var mSum: f32 = mi;
  var mom: vec2<f32> = mi * velocities[i];
  var cen: vec2<f32> = mi * positions[i];

  for (var j: u32 = 0u; j < P.count; j = j + 1u) {
    if (j == i) { continue; }
    let mj = masses[j];
    if (mj == 0.0) { continue; }
    if (pref[j] == i) {
      mSum = mSum + mj;
      mom = mom + mj * velocities[j];
      cen = cen + mj * positions[j];
    }
  }

  if (mSum > mi) {
    positions[i] = cen / mSum;
    velocities[i] = mom / mSum;
    masses[i] = mSum;
  }
}

@compute @workgroup_size(64)
fn markDead(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.count) { return; }
  if (masses[i] == 0.0) { return; }
  let p = pref[i];
  if (p != i && pref[p] == p) {   // absorbed into a sink this step
    masses[i] = 0.0;
  }
}
