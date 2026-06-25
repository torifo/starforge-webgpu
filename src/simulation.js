// starforge simulation: owns body buffers, sim params, compute bind group, and the per-frame step.

import { buildScene, DEFAULT_SCENE } from "./scenes.js";

export const MAX_BODIES = 4096;
export const WORKGROUP_SIZE = 64;

// Checkpoint ring depth for lightweight rewind (undo points, not a scrub bar).
export const SNAP_SLOTS = 8;

// SimParams layout: dt(f32), softening2(f32), g(f32), count(u32) = 16 bytes.
const SIM_PARAMS_BYTES = 16;

export class Simulation {
  constructor(device, gpu, sceneId = DEFAULT_SCENE) {
    this.device = device;
    this.computeForcesPipeline = gpu.computeForcesPipeline;
    this.integratePipeline = gpu.integratePipeline;
    this.interactPipeline = gpu.interactPipeline;
    this.findPrefPipeline = gpu.findPrefPipeline;
    this.mergeApplyPipeline = gpu.mergeApplyPipeline;
    this.markDeadPipeline = gpu.markDeadPipeline;

    this.activeCount = 0;
    this.sceneId = sceneId;

    // tunables (defaults; overridden per-scene in seed())
    this.dt = 0.016;
    this.softening = 8.0;   // epsilon (world units)
    this.g = 50.0;          // gravitational scale
    this.collisionMode = 0; // 0 = off, 1 = merge (accretion). Set per-scene.
    this.mergeScale = 2.0;  // collision radius = mergeScale * mass^(1/3)

    const vec2Bytes = MAX_BODIES * 2 * 4;
    const f32Bytes = MAX_BODIES * 4;
    this._vec2Bytes = vec2Bytes;
    this._f32Bytes = f32Bytes;

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
      layout: gpu.computeBGL,
      entries: [
        { binding: 0, resource: { buffer: this.params } },
        { binding: 1, resource: { buffer: this.positions } },
        { binding: 2, resource: { buffer: this.velocities } },
        { binding: 3, resource: { buffer: this.accels } },
        { binding: 4, resource: { buffer: this.masses } },
      ],
    });

    // Interaction (pointer impulse) uniform + bind group. Layout matches IParams
    // in interact.wgsl: pos,vel (vec2 each), radius, strength (f32), mode, count (u32).
    this.interactParams = device.createBuffer({
      label: "interactParams",
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.interactBG = device.createBindGroup({
      label: "interact-bg",
      layout: gpu.interactBGL,
      entries: [
        { binding: 0, resource: { buffer: this.interactParams } },
        { binding: 1, resource: { buffer: this.positions } },
        { binding: 2, resource: { buffer: this.velocities } },
      ],
    });

    // Collision / merge: a per-body "preferred partner" index buffer + params,
    // matching CollideParams in collide.wgsl (count,u32; mode,u32; mergeScale,f32; pad).
    this.pref = device.createBuffer({ label: "pref", size: f32Bytes, usage: usageRW });
    this.collideParams = device.createBuffer({
      label: "collideParams",
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.collideBG = device.createBindGroup({
      label: "collide-bg",
      layout: gpu.collideBGL,
      entries: [
        { binding: 0, resource: { buffer: this.collideParams } },
        { binding: 1, resource: { buffer: this.positions } },
        { binding: 2, resource: { buffer: this.velocities } },
        { binding: 3, resource: { buffer: this.masses } },
        { binding: 4, resource: { buffer: this.pref } },
      ],
    });

    // ---- Checkpoint pool (lightweight rewind) ----
    // A fixed pool of buffer-sets plus a stack of in-use slots. snapshot()
    // pushes the current state (reusing the oldest slot when full); restoreLast()
    // pops the newest. State is copied entirely on the GPU (no CPU readback).
    this._snapPool = [];
    for (let i = 0; i < SNAP_SLOTS; i++) {
      this._snapPool.push({
        positions: device.createBuffer({ label: `snap${i}-pos`, size: vec2Bytes, usage: usageRW }),
        velocities: device.createBuffer({ label: `snap${i}-vel`, size: vec2Bytes, usage: usageRW }),
        masses: device.createBuffer({ label: `snap${i}-mass`, size: f32Bytes, usage: usageRW }),
      });
    }
    this._freeSlots = this._snapPool.map((_, i) => i);
    this._snapStack = []; // [{ slot, count, simTime }], newest last

    this.seed();
  }

  // Capture current GPU state as a checkpoint. `simTime` is stored alongside so
  // the epoch clock can be rewound too. Reuses the oldest slot when the ring is full.
  snapshot(simTime = 0) {
    let slot;
    if (this._freeSlots.length > 0) {
      slot = this._freeSlots.pop();
    } else {
      slot = this._snapStack.shift().slot; // drop oldest, reuse its buffers
    }
    const dst = this._snapPool[slot];
    const enc = this.device.createCommandEncoder({ label: "snapshot" });
    enc.copyBufferToBuffer(this.positions, 0, dst.positions, 0, this._vec2Bytes);
    enc.copyBufferToBuffer(this.velocities, 0, dst.velocities, 0, this._vec2Bytes);
    enc.copyBufferToBuffer(this.masses, 0, dst.masses, 0, this._f32Bytes);
    this.device.queue.submit([enc.finish()]);
    this._snapStack.push({ slot, count: this.activeCount, simTime });
  }

  // Restore the most recent checkpoint. Returns its stored simTime, or null if none.
  restoreLast() {
    if (this._snapStack.length === 0) return null;
    const top = this._snapStack.pop();
    const src = this._snapPool[top.slot];
    const enc = this.device.createCommandEncoder({ label: "restore" });
    enc.copyBufferToBuffer(src.positions, 0, this.positions, 0, this._vec2Bytes);
    enc.copyBufferToBuffer(src.velocities, 0, this.velocities, 0, this._vec2Bytes);
    enc.copyBufferToBuffer(src.masses, 0, this.masses, 0, this._f32Bytes);
    this.device.queue.submit([enc.finish()]);
    // accelerations are recomputed next step; zero them so a paused restore looks right
    this.device.queue.writeBuffer(this.accels, 0, new Float32Array(MAX_BODIES * 2));
    this.activeCount = top.count;
    this.writeParams();
    this._freeSlots.push(top.slot);
    return top.simTime;
  }

  hasSnapshot() {
    return this._snapStack.length > 0;
  }

  clearSnapshots() {
    this._freeSlots = this._snapPool.map((_, i) => i);
    this._snapStack = [];
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
      this.collisionMode = scene.params.collisionMode ?? 0;
      this.mergeScale = scene.params.mergeScale ?? this.mergeScale;
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
    this.clearSnapshots();
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

    // CollideParams: count(u32), mode(u32), mergeScale(f32), pad(f32)
    const cbuf = new ArrayBuffer(16);
    const cf = new Float32Array(cbuf);
    const cu = new Uint32Array(cbuf);
    cu[0] = this.activeCount;
    cu[1] = this.collisionMode;
    cf[2] = this.mergeScale;
    this.device.queue.writeBuffer(this.collideParams, 0, cbuf);
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

    // Collision / merge (per-scene). Three ordered passes share one compute pass;
    // writes from each dispatch are visible to the next within the pass.
    if (this.collisionMode !== 0) {
      const cp = encoder.beginComputePass({ label: "collide" });
      cp.setBindGroup(0, this.collideBG);
      cp.setPipeline(this.findPrefPipeline);
      cp.dispatchWorkgroups(groups);
      cp.setPipeline(this.mergeApplyPipeline);
      cp.dispatchWorkgroups(groups);
      cp.setPipeline(this.markDeadPipeline);
      cp.dispatchWorkgroups(groups);
      cp.end();
    }
  }

  // Encode one pointer-interaction pass. `cmd` = { x, y, vx, vy, radius, strength, mode }.
  // At most one interaction should be applied per frame (the uniform is shared).
  applyInteraction(encoder, cmd) {
    if (this.activeCount <= 0) return;
    const buf = new ArrayBuffer(32);
    const f = new Float32Array(buf);
    const u = new Uint32Array(buf);
    f[0] = cmd.x; f[1] = cmd.y;
    f[2] = cmd.vx ?? 0; f[3] = cmd.vy ?? 0;
    f[4] = cmd.radius; f[5] = cmd.strength;
    u[6] = cmd.mode >>> 0;
    u[7] = this.activeCount;
    this.device.queue.writeBuffer(this.interactParams, 0, buf);

    const groups = Math.ceil(this.activeCount / WORKGROUP_SIZE);
    const pass = encoder.beginComputePass({ label: "interact" });
    pass.setPipeline(this.interactPipeline);
    pass.setBindGroup(0, this.interactBG);
    pass.dispatchWorkgroups(groups);
    pass.end();
  }
}
