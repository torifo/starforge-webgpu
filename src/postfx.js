// starforge post-processing: HDR offscreen targets + bloom + orbit trails + final composite.
//
// Per-frame pass graph (all offscreen targets are HDR rgba16float):
//   1. nebula  -> nebulaTex        (drawn by caller via Nebula, into this target)
//   2. points  -> pointsTex        (bodies, additive, cleared each frame)
//   3. trail   -> trail[next]      = trail[cur] * decay + pointsTex   (ping-pong)
//   4. bloom   -> brightpass(trail[next]) -> blurH -> blurV -> bloomTex
//   5. final   -> swapchain        = nebula + trail[next] + bloom*strength (tonemapped)
//
// Trails persist across frames (history target NOT cleared); call clearTrails()
// on scene switch / reset. Bloom uses half-res blur targets for speed.

import { HDR_FORMAT } from "./gpu.js";

const RT_USAGE =
  GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;

export class PostFX {
  constructor(device, gpu) {
    this.device = device;
    this.gpu = gpu;

    this.sampler = device.createSampler({
      label: "postfx-sampler",
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });

    // uniforms
    this.blurParams = device.createBuffer({
      label: "blur-params",
      size: 16, // texel.xy, threshold, pad
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.trailParams = device.createBuffer({
      label: "trail-params",
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.finalParams = device.createBuffer({
      label: "final-params",
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // tunables
    this.threshold = 0.62;
    this.trailDecay = 0.9;
    this.bloomStrength = 0.8;
    this.exposure = 0.72;

    this.width = 0;
    this.height = 0;
    this.needTrailClear = true;
    this.targets = null;
  }

  setTrailDecay(d) {
    this.trailDecay = d;
  }

  clearTrails() {
    this.needTrailClear = true;
  }

  // (Re)allocate offscreen targets for the given device-pixel size.
  resize(width, height) {
    width = Math.max(1, Math.floor(width));
    height = Math.max(1, Math.floor(height));
    if (this.width === width && this.height === height && this.targets) return;
    this.width = width;
    this.height = height;
    this.destroyTargets();

    const mk = (label, w, h) =>
      this.device.createTexture({
        label,
        size: { width: w, height: h },
        format: HDR_FORMAT,
        usage: RT_USAGE,
      });

    const halfW = Math.max(1, Math.floor(width / 2));
    const halfH = Math.max(1, Math.floor(height / 2));

    const t = {
      nebula: mk("nebulaTex", width, height),
      points: mk("pointsTex", width, height),
      trailA: mk("trailA", width, height),
      trailB: mk("trailB", width, height),
      bright: mk("brightTex", halfW, halfH),
      blurX: mk("blurXTex", halfW, halfH),
      bloom: mk("bloomTex", halfW, halfH),
      halfW,
      halfH,
    };
    t.views = {
      nebula: t.nebula.createView(),
      points: t.points.createView(),
      trailA: t.trailA.createView(),
      trailB: t.trailB.createView(),
      bright: t.bright.createView(),
      blurX: t.blurX.createView(),
      bloom: t.bloom.createView(),
    };
    this.targets = t;
    this.trailCur = "trailA"; // current history target
    this.needTrailClear = true;

    // blur params: half-res texel size + threshold
    this.device.queue.writeBuffer(
      this.blurParams,
      0,
      new Float32Array([1 / halfW, 1 / halfH, this.threshold, 0])
    );
  }

  destroyTargets() {
    if (!this.targets) return;
    for (const k of ["nebula", "points", "trailA", "trailB", "bright", "blurX", "bloom"]) {
      this.targets[k]?.destroy?.();
    }
    this.targets = null;
  }

  get nebulaView() {
    return this.targets.views.nebula;
  }
  get pointsView() {
    return this.targets.views.points;
  }

  // Begin a render pass on the nebula target (clears it). Caller draws nebula into it.
  beginNebulaPass(encoder) {
    return encoder.beginRenderPass({
      label: "nebula-pass",
      colorAttachments: [
        {
          view: this.nebulaView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
  }

  // Begin a render pass on the points target (clears to black each frame).
  beginPointsPass(encoder) {
    return encoder.beginRenderPass({
      label: "points-pass",
      colorAttachments: [
        {
          view: this.pointsView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
  }

  fullscreen(pass) {
    pass.draw(3, 1, 0, 0);
  }

  bgBloom(srcView) {
    return this.device.createBindGroup({
      layout: this.gpu.bloomBGL,
      entries: [
        { binding: 0, resource: srcView },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.blurParams } },
      ],
    });
  }

  // Run trail accumulation, bloom, and final composite to the swapchain view.
  // Assumes nebula + points targets are already rendered this frame.
  composite(encoder, swapchainView) {
    const t = this.targets;
    const v = t.views;

    // ---- 1. trail accumulation (ping-pong) ----
    this.device.queue.writeBuffer(
      this.trailParams,
      0,
      new Float32Array([this.trailDecay, 0, 0, 0])
    );

    const cur = this.trailCur; // history source
    const next = cur === "trailA" ? "trailB" : "trailA";

    if (this.needTrailClear) {
      // clear both trail targets so no stale history remains, then treat history as black
      for (const which of ["trailA", "trailB"]) {
        const p = encoder.beginRenderPass({
          label: "trail-clear",
          colorAttachments: [
            { view: v[which], clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" },
          ],
        });
        p.end();
      }
      this.needTrailClear = false;
    }

    const trailBG = this.device.createBindGroup({
      layout: this.gpu.trailBGL,
      entries: [
        { binding: 0, resource: v[cur] }, // previous trail
        { binding: 1, resource: v.points }, // fresh points
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.trailParams } },
      ],
    });
    {
      const p = encoder.beginRenderPass({
        label: "trail-accumulate",
        colorAttachments: [
          { view: v[next], clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" },
        ],
      });
      p.setPipeline(this.gpu.trailPipeline);
      p.setBindGroup(0, trailBG);
      this.fullscreen(p);
      p.end();
    }
    this.trailCur = next; // accumulated trail now lives in `next`
    const trailView = v[next];

    // ---- 2. bloom: brightpass(trail) -> blurH -> blurV ----
    {
      const p = encoder.beginRenderPass({
        label: "bloom-brightpass",
        colorAttachments: [
          { view: v.bright, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" },
        ],
      });
      p.setPipeline(this.gpu.brightpassPipeline);
      p.setBindGroup(0, this.bgBloom(trailView));
      this.fullscreen(p);
      p.end();
    }
    {
      const p = encoder.beginRenderPass({
        label: "bloom-blurH",
        colorAttachments: [
          { view: v.blurX, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" },
        ],
      });
      p.setPipeline(this.gpu.blurHPipeline);
      p.setBindGroup(0, this.bgBloom(v.bright));
      this.fullscreen(p);
      p.end();
    }
    {
      const p = encoder.beginRenderPass({
        label: "bloom-blurV",
        colorAttachments: [
          { view: v.bloom, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" },
        ],
      });
      p.setPipeline(this.gpu.blurVPipeline);
      p.setBindGroup(0, this.bgBloom(v.blurX));
      this.fullscreen(p);
      p.end();
    }

    // ---- 3. final composite to swapchain ----
    this.device.queue.writeBuffer(
      this.finalParams,
      0,
      new Float32Array([this.bloomStrength, this.exposure, 0, 0])
    );
    const finalBG = this.device.createBindGroup({
      layout: this.gpu.finalBGL,
      entries: [
        { binding: 0, resource: trailView },
        { binding: 1, resource: v.bloom },
        { binding: 2, resource: v.nebula },
        { binding: 3, resource: this.sampler },
        { binding: 4, resource: { buffer: this.finalParams } },
      ],
    });
    {
      const p = encoder.beginRenderPass({
        label: "final-composite",
        colorAttachments: [
          { view: swapchainView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" },
        ],
      });
      p.setPipeline(this.gpu.finalPipeline);
      p.setBindGroup(0, finalBG);
      this.fullscreen(p);
      p.end();
    }
  }
}
