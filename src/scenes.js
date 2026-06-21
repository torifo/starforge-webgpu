// starforge scene presets.
// Each scene is a pure generator producing initial-condition typed arrays plus a
// camera initial state and human-readable metadata. No GPU dependency, so the
// generators are unit-testable in plain Node.
//
// Physics contract (must match nbody.wgsl + simulation.js defaults):
//   a_i = G * sum_j m_j * d / (|d|^2 + eps^2)^(3/2),  d = p_j - p_i
//   circular orbital speed about a central mass M at radius r:  v = sqrt(G*M/r)
// The default sim constants are G = 50, softening (eps) = 8. Scenes may override
// G / softening / dt via the returned `params` so each is legible and stable.

export const SIM_G = 50.0;
export const SIM_SOFTENING = 8.0;
export const SIM_DT = 0.016;

// Small deterministic PRNG (mulberry32) so scenes are reproducible and tests are
// stable. Each scene seeds its own stream.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller standard normal from a uniform rng.
function gaussian(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Allocate empty arrays for n bodies.
function alloc(n) {
  return {
    positions: new Float32Array(n * 2),
    velocities: new Float32Array(n * 2),
    masses: new Float32Array(n),
    count: n,
  };
}

// ---- solar: real-ish solar system, planets on near-circular orbits ----
function buildSolar() {
  // A central star + a handful of planets at increasing radii. Masses are scaled
  // for legibility, not realism. Circular speed v = sqrt(G*M/r).
  const M = 6000;
  const planets = [
    { r: 70, m: 6 },
    { r: 120, m: 10 },
    { r: 185, m: 12 },
    { r: 260, m: 8 },
    { r: 380, m: 26 }, // a "jupiter"
    { r: 500, m: 20 },
    { r: 640, m: 14 },
  ];
  const out = alloc(1 + planets.length);
  // star
  out.masses[0] = M;
  // planets, phases spread around so they don't line up
  for (let k = 0; k < planets.length; k++) {
    const i = k + 1;
    const { r, m } = planets[k];
    const a = (k / planets.length) * Math.PI * 2 + 0.3;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    out.positions[i * 2] = x;
    out.positions[i * 2 + 1] = y;
    out.masses[i] = m;
    const speed = Math.sqrt((SIM_G * M) / r);
    // tangential, counter-clockwise
    out.velocities[i * 2] = -Math.sin(a) * speed;
    out.velocities[i * 2 + 1] = Math.cos(a) * speed;
  }
  return {
    ...out,
    params: { g: SIM_G, softening: SIM_SOFTENING, dt: SIM_DT },
    camera: { center: { x: 0, y: 0 }, halfWorldHeight: 760 },
  };
}

// ---- galaxy: two rotating disks on a collision course ----
function makeDisk(rng, out, base, count, cx, cy, bulkVx, bulkVy, spin, centerMass) {
  // central mass for the disk
  out.positions[base * 2] = cx;
  out.positions[base * 2 + 1] = cy;
  out.velocities[base * 2] = bulkVx;
  out.velocities[base * 2 + 1] = bulkVy;
  out.masses[base] = centerMass;
  for (let k = 1; k < count; k++) {
    const i = base + k;
    const r = 18 + Math.pow(rng(), 0.7) * 230;
    const a = rng() * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    out.positions[i * 2] = x;
    out.positions[i * 2 + 1] = y;
    out.masses[i] = 0.6 + rng() * 1.0;
    const speed = Math.sqrt((SIM_G * centerMass) / r) * (0.9 + rng() * 0.15);
    out.velocities[i * 2] = bulkVx + spin * -Math.sin(a) * speed;
    out.velocities[i * 2 + 1] = bulkVy + spin * Math.cos(a) * speed;
  }
}

function buildGalaxy() {
  const rng = mulberry32(0x9a71);
  const perDisk = 700;
  const n = perDisk * 2;
  const out = alloc(n);
  const Mc = 4000;
  // two disks offset on x, moving toward each other, counter-rotating for tidal drama
  makeDisk(rng, out, 0, perDisk, -340, -90, 26, 6, 1, Mc);
  makeDisk(rng, out, perDisk, perDisk, 340, 90, -26, -6, -1, Mc);
  return {
    ...out,
    params: { g: SIM_G, softening: 10.0, dt: SIM_DT },
    camera: { center: { x: 0, y: 0 }, halfWorldHeight: 820 },
  };
}

// ---- accretion: central mass + angular-momentum cloud spiraling in ----
function buildAccretion() {
  const rng = mulberry32(0x1c0d);
  const n = 1400;
  const out = alloc(n);
  const M = 9000;
  out.masses[0] = M;
  for (let i = 1; i < n; i++) {
    const r = 60 + Math.pow(rng(), 0.6) * 460;
    const a = rng() * Math.PI * 2;
    out.positions[i * 2] = Math.cos(a) * r;
    out.positions[i * 2 + 1] = Math.sin(a) * r;
    out.masses[i] = 0.4 + rng() * 0.8;
    // sub-circular speed (0.7x) so material loses balance and spirals inward
    const vc = Math.sqrt((SIM_G * M) / r);
    const speed = vc * (0.62 + rng() * 0.16);
    out.velocities[i * 2] = -Math.sin(a) * speed;
    out.velocities[i * 2 + 1] = Math.cos(a) * speed;
  }
  return {
    ...out,
    params: { g: SIM_G, softening: SIM_SOFTENING, dt: SIM_DT },
    camera: { center: { x: 0, y: 0 }, halfWorldHeight: 700 },
  };
}

// ---- collapse: diffuse near-zero-velocity cloud self-gravitating ----
function buildCollapse() {
  const rng = mulberry32(0x5eed);
  const n = 1600;
  const out = alloc(n);
  for (let i = 0; i < n; i++) {
    // uniform-ish disk of comparable masses, tiny random velocities
    const r = Math.sqrt(rng()) * 560;
    const a = rng() * Math.PI * 2;
    out.positions[i * 2] = Math.cos(a) * r;
    out.positions[i * 2 + 1] = Math.sin(a) * r;
    out.masses[i] = 1.5 + rng() * 1.5;
    // near zero: small thermal jitter only
    out.velocities[i * 2] = gaussian(rng) * 1.2;
    out.velocities[i * 2 + 1] = gaussian(rng) * 1.2;
  }
  return {
    ...out,
    params: { g: SIM_G, softening: 12.0, dt: SIM_DT },
    camera: { center: { x: 0, y: 0 }, halfWorldHeight: 760 },
  };
}

// ---- slingshot: stable system + one fast intruder ----
function buildSlingshot() {
  const rng = mulberry32(0xa11c);
  const ring = 240;
  const n = ring + 2;
  const out = alloc(n);
  const M = 7000;
  // central mass
  out.masses[0] = M;
  // a tidy disk
  for (let k = 1; k <= ring; k++) {
    const i = k;
    const r = 70 + Math.pow(rng(), 0.7) * 300;
    const a = rng() * Math.PI * 2;
    out.positions[i * 2] = Math.cos(a) * r;
    out.positions[i * 2 + 1] = Math.sin(a) * r;
    out.masses[i] = 0.6 + rng() * 0.8;
    const speed = Math.sqrt((SIM_G * M) / r);
    out.velocities[i * 2] = -Math.sin(a) * speed;
    out.velocities[i * 2 + 1] = Math.cos(a) * speed;
  }
  // the intruder: massive, fast, entering from lower-left aimed past the core
  const j = n - 1;
  out.positions[j * 2] = -780;
  out.positions[j * 2 + 1] = -360;
  out.masses[j] = 220;
  out.velocities[j * 2] = 70;
  out.velocities[j * 2 + 1] = 34;
  return {
    ...out,
    params: { g: SIM_G, softening: SIM_SOFTENING, dt: SIM_DT },
    camera: { center: { x: -120, y: -60 }, halfWorldHeight: 900 },
  };
}

// ---- cluster: globular, thousands of bodies near virial equilibrium ----
function buildCluster() {
  const rng = mulberry32(0xc105);
  const n = 3000;
  const out = alloc(n);
  // Plummer-like sphere projected to 2D. Total mass distributed across bodies.
  const totalMass = n * 1.0;
  const scale = 220; // Plummer radius (world units)
  for (let i = 0; i < n; i++) {
    out.masses[i] = 1.0;
    // Plummer radius sampling: r = a / sqrt(X^(-2/3) - 1)
    let X = rng();
    if (X < 1e-4) X = 1e-4;
    const r = scale / Math.sqrt(Math.pow(X, -2 / 3) - 1);
    const a = rng() * Math.PI * 2;
    const rr = Math.min(r, 1200); // clamp the long tail
    out.positions[i * 2] = Math.cos(a) * rr;
    out.positions[i * 2 + 1] = Math.sin(a) * rr;
    // Velocity dispersion ~ sqrt(G*Menc/r) scaled to ~virial; isotropic Gaussian.
    const sigma =
      0.42 * Math.sqrt((SIM_G * totalMass) / Math.sqrt(rr * rr + scale * scale));
    out.velocities[i * 2] = gaussian(rng) * sigma;
    out.velocities[i * 2 + 1] = gaussian(rng) * sigma;
  }
  return {
    ...out,
    params: { g: SIM_G, softening: 14.0, dt: SIM_DT },
    camera: { center: { x: 0, y: 0 }, halfWorldHeight: 700 },
  };
}

// Registry: id -> { name, description, build }. Order defines gallery layout.
export const SCENES = [
  {
    id: "solar",
    name: "Solar System",
    nameJa: "実太陽系",
    description: "A central star and planets on near-circular Kepler orbits. Stable, rhythmic.",
    build: buildSolar,
  },
  {
    id: "galaxy",
    name: "Galaxy Collision",
    nameJa: "銀河衝突",
    description: "Two counter-rotating disks on a collision course. Watch the tidal tails fling out.",
    build: buildGalaxy,
  },
  {
    id: "accretion",
    name: "Accretion Disk",
    nameJa: "降着円盤",
    description: "A central mass with a sub-orbital particle cloud spiraling inward into a glowing ring.",
    build: buildAccretion,
  },
  {
    id: "collapse",
    name: "Gravitational Collapse",
    nameJa: "重力崩壊",
    description: "A diffuse, nearly motionless cloud self-gravitates into knots and filaments.",
    build: buildCollapse,
  },
  {
    id: "slingshot",
    name: "Gravitational Slingshot",
    nameJa: "スリングショット",
    description: "A stable system meets one fast, heavy intruder. Acceleration and scattering drama.",
    build: buildSlingshot,
  },
  {
    id: "cluster",
    name: "Globular Cluster",
    nameJa: "球状星団",
    description: "Thousands of bodies near virial equilibrium. The many-body regime the GPU is built for.",
    build: buildCluster,
  },
];

export const DEFAULT_SCENE = "galaxy";

export function getScene(id) {
  return SCENES.find((s) => s.id === id) || null;
}

// Build a scene's initial conditions by id. Returns null for unknown ids.
export function buildScene(id) {
  const s = getScene(id);
  if (!s) return null;
  const data = s.build();
  return { id: s.id, name: s.name, description: s.description, ...data };
}
