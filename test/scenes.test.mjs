// Unit tests for scene initial-condition generators. Run: node test/scenes.test.mjs
// Validates: capacity, body count, total mass > 0, finite (no NaN/Inf), and that
// velocity dispersion falls in a plausible per-scene range. No GPU involved.

import { SCENES, buildScene } from "../src/scenes.js";

const MAX_BODIES = 4096; // mirror of simulation.js capacity

let pass = 0;
let fail = 0;
const log = (ok, msg) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${msg}`);
  } else {
    fail++;
    console.log(`  FAIL ${msg}`);
  }
};

function stats(arr) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let nonFinite = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (!Number.isFinite(v)) {
      nonFinite++;
      continue;
    }
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, max, sum, mean: sum / arr.length, nonFinite };
}

function speedStats(vel, count) {
  let sum = 0;
  let sum2 = 0;
  let nonFinite = 0;
  for (let i = 0; i < count; i++) {
    const vx = vel[i * 2];
    const vy = vel[i * 2 + 1];
    if (!Number.isFinite(vx) || !Number.isFinite(vy)) {
      nonFinite++;
      continue;
    }
    const s = Math.hypot(vx, vy);
    sum += s;
    sum2 += s * s;
  }
  const mean = sum / count;
  const variance = sum2 / count - mean * mean;
  return { mean, std: Math.sqrt(Math.max(0, variance)), nonFinite };
}

// Expected speed range [meanMin, meanMax] per scene for the mean body speed.
const expected = {
  solar: [5, 80],
  galaxy: [8, 90],
  accretion: [10, 90],
  collapse: [0, 6],
  slingshot: [5, 90],
  cluster: [0, 60],
};

console.log("scene generators\n");

for (const s of SCENES) {
  console.log(`[${s.id}]`);
  const sc = buildScene(s.id);
  log(sc !== null, `builds (${s.id})`);

  const n = sc.count;
  log(n > 0 && n <= MAX_BODIES, `count ${n} within (0, ${MAX_BODIES}]`);
  log(sc.positions.length === n * 2, `positions length = ${n * 2}`);
  log(sc.velocities.length === n * 2, `velocities length = ${n * 2}`);
  log(sc.masses.length === n, `masses length = ${n}`);

  const ps = stats(sc.positions.subarray(0, n * 2));
  const vs = stats(sc.velocities.subarray(0, n * 2));
  const ms = stats(sc.masses.subarray(0, n));

  log(ps.nonFinite === 0, `positions all finite (nonFinite=${ps.nonFinite})`);
  log(vs.nonFinite === 0, `velocities all finite (nonFinite=${vs.nonFinite})`);
  log(ms.nonFinite === 0, `masses all finite (nonFinite=${ms.nonFinite})`);

  log(ms.min >= 0, `masses non-negative (min=${ms.min.toFixed(3)})`);
  log(ms.sum > 0, `total mass > 0 (sum=${ms.sum.toFixed(1)})`);

  // positions should be bounded (no runaway init)
  const posMag = Math.max(Math.abs(ps.min), Math.abs(ps.max));
  log(posMag < 5000, `positions bounded (maxAbs=${posMag.toFixed(0)})`);

  const ss = speedStats(sc.velocities, n);
  log(ss.nonFinite === 0, `speeds all finite`);
  const [lo, hi] = expected[s.id];
  log(
    ss.mean >= lo && ss.mean <= hi,
    `mean speed ${ss.mean.toFixed(2)} in [${lo}, ${hi}] (std=${ss.std.toFixed(2)})`
  );
  console.log("");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
