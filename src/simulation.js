// starforge simulation: owns body buffers, sim params, compute bind group, and the per-frame step.

import { buildScene, DEFAULT_SCENE } from "./scenes.js";

export const MAX_BODIES = 4096;
export const WORKGROUP_SIZE = 64;

// SimParams layout: dt(f32), softening2(f32), g(f32), count(u32) = 16 bytes.
const SIM_PARAMS_BYTES = 16;

export class Simulation {
  constructor(device, computeForcesPipeline, integratePipeline, computeBGL, sceneId = DEFAULT_SCENE) {
    this.device = device;
    this.computeForcesPipeline = computeForcesPipeline;
    this.integratePipeline = integratePipeline;

    this.activeCount = 0;
    this.sceneId = sceneId;

    // tunables (defaults; overridden per-scene in seed())
    this.dt = 0.016;
    this.softening = 8.0;   // epsilon (world units)
    this.g = 50.0;          // gravitational scale

    const vec2Bytes = MAX_BODIES * 2 * 4;
    const f32Bytes = MAX_BODIES * 4;

    const usageRW =
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;

    this.positions = device.createBuffer({ label: "positions", size: vec2Bytes, usage: usageRW });
    this.velocities = device.createBuffer({ label: "velocities", size: vec2Bytes, usage: usageRW });
    this.accels = device.createBuffer({ label: "accels", size: vec2Bytes, usage: usageRW });
    this.masses = device.createBuffer({ label: "masses", size: f32Bytes, usage: usageRW });

    this.params = device.createBuffer({
      label: "simParams",
      size: SIM_PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = device.createBindGroup({
      label: "compute-bg",
      layout: computeBGL,
      entries: [
        { binding: 0, resource: { buffer: this.params } },
        { binding: 1, resource: { buffer: this.positions } },
        { binding: 2, resource: { buffer: this.velocities } },
        { binding: 3, resource: { buffer: this.accels } },
        { binding: 4, resource: { buffer: this.masses } },
      ],
    });

    this.seed();
  }

  // Load a scene's initial conditions into the GPU buffers. Clamps to MAX_BODIES.
  // Sets per-scene sim params (g/softening/dt). Returns the scene metadata.
  seed() {
    const scene = buildScene(this.sceneId) || buildScene(DEFAULT_SCENE);
    const n = Math.min(scene.count, MAX_BODIES);

    if (scene.params) {
      this.dt = scene.params.dt ?? this.dt;
      this.softening = scene.params.softening ?? this.softening;
      this.g = scene.params.g ?? this.g;
    }

    const acc = new Float32Array(n * 2); // zeros
    this.activeCount = n;
    this.device.queue.writeBuffer(this.positions, 0, scene.positions, 0, n * 2);
    this.device.queue.writeBuffer(this.velocities, 0, scene.velocities, 0, n * 2);
    this.device.queue.writeBuffer(this.accels, 0, acc);
    this.device.queue.writeBuffer(this.masses, 0, scene.masses, 0, n);
    this.writeParams();
    this.lastScene = scene;
    return scene;
  }

  reset() {
    this.zeroFill();
    return this.seed();
  }

  // Switch to a different scene and re-seed. Caller should clear postfx trails.
  loadScene(sceneId) {
    this.sceneId = sceneId;
    return this.reset();
  }

  zeroFill() {
    // zero-fill the whole buffers first so stale tail bodies cannot reappear
    const vec2Zero = new Float32Array(MAX_BODIES * 2);
    const f32Zero = new Float32Array(MAX_BODIES);
    this.device.queue.writeBuffer(this.positions, 0, vec2Zero);
    this.device.queue.writeBuffer(this.velocities, 0, vec2Zero);
    this.device.queue.writeBuffer(this.accels, 0, vec2Zero);
    this.device.queue.writeBuffer(this.masses, 0, f32Zero);
  }

  writeParams() {
    const buf = new ArrayBuffer(SIM_PARAMS_BYTES);
    const f = new Float32Array(buf);
    const u = new Uint32Array(buf);
    f[0] = this.dt;
    f[1] = this.softening * this.softening;
    f[2] = this.g;
    u[3] = this.activeCount;
    this.device.queue.writeBuffer(this.params, 0, buf);
  }

  // Add a single body. Returns true if added, false if at capacity.
  appendBody(x, y, vx, vy, mass = 30) {
    if (this.activeCount >= MAX_BODIES) {
      return false;
    }
    const idx = this.activeCount;
    this.device.queue.writeBuffer(this.positions, idx * 8, new Float32Array([x, y]));
    this.device.queue.writeBuffer(this.velocities, idx * 8, new Float32Array([vx, vy]));
    this.device.queue.writeBuffer(this.accels, idx * 8, new Float32Array([0, 0]));
    this.device.queue.writeBuffer(this.masses, idx * 4, new Float32Array([mass]));
    this.activeCount = idx + 1;
    this.writeParams();
    return true;
  }

  // Encode one physics step: forces then integrate.
  step(encoder) {
    const groups = Math.ceil(this.activeCount / WORKGROUP_SIZE);
    if (groups <= 0) return;

    const pass = encoder.beginComputePass({ label: "physics" });
    pass.setBindGroup(0, this.bindGroup);

    pass.setPipeline(this.computeForcesPipeline);
    pass.dispatchWorkgroups(groups);

    pass.setPipeline(this.integratePipeline);
    pass.dispatchWorkgroups(groups);

    pass.end();
  }
}
