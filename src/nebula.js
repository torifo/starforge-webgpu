// starforge nebula backdrop pass.
// Renders procedural colored gas into the HDR scene target before the bodies, so
// it sits at the very back. Owns its uniform buffer and bind group.

export class Nebula {
  constructor(device, pipeline, bgl) {
    this.device = device;
    this.pipeline = pipeline;
    // NebulaParams: resolution.xy (2 f32), time (f32), intensity (f32) = 16 bytes
    this.uniform = device.createBuffer({
      label: "nebula-params",
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.bindGroup = device.createBindGroup({
      label: "nebula-bg",
      layout: bgl,
      entries: [{ binding: 0, resource: { buffer: this.uniform } }],
    });
    this.intensity = 0.6;
    this.width = 1;
    this.height = 1;
  }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  // Encode the nebula fullscreen draw into an already-begun render pass.
  encode(pass, timeSeconds) {
    const buf = new Float32Array([this.width, this.height, timeSeconds, this.intensity]);
    this.device.queue.writeBuffer(this.uniform, 0, buf);
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3, 1, 0, 0);
  }
}
