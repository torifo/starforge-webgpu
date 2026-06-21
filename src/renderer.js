// starforge renderer: multi-pass cinematic pipeline.
//   nebula -> nebulaTex ; bodies -> pointsTex ; postfx (trails + bloom) -> swapchain.
// Also owns the camera uniform and the 2D drag-indicator overlay.

import { Nebula } from "./nebula.js";
import { PostFX } from "./postfx.js";

// Camera uniform layout (render.wgsl):
// scale.xy (2*f32), translate.xy (2*f32), pointSize(f32), 3 pad f32 = 8 floats = 32 bytes.
const CAMERA_BYTES = 32;

export class Renderer {
  constructor(gpu, simulation, overlayCtx) {
    this.device = gpu.device;
    this.context = gpu.context;
    this.format = gpu.format;
    this.gpu = gpu;
    this.renderPipeline = gpu.renderPipeline;
    this.sim = simulation;
    this.overlayCtx = overlayCtx; // CanvasRenderingContext2D or null

    this.cameraBuffer = this.device.createBuffer({
      label: "camera",
      size: CAMERA_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // point sprite half-size in clip units (scaled per-body in shader)
    this.pointSize = 0.006;

    this.bindGroup = this.device.createBindGroup({
      label: "render-bg",
      layout: gpu.renderBGL,
      entries: [
        { binding: 0, resource: { buffer: this.cameraBuffer } },
        { binding: 1, resource: { buffer: simulation.positions } },
        { binding: 2, resource: { buffer: simulation.masses } },
      ],
    });

    this.nebula = new Nebula(this.device, gpu.nebulaPipeline, gpu.nebulaBGL);
    this.postfx = new PostFX(this.device, gpu);
    this.startTime = performance.now();
  }

  resize(width, height) {
    this.nebula.resize(width, height);
    this.postfx.resize(width, height);
  }

  // Reset trails on scene switch / reset.
  clearTrails() {
    this.postfx.clearTrails();
  }

  updateCamera(camera) {
    const { scaleX, scaleY, transX, transY } = camera.scaleAndTranslate();
    const data = new Float32Array(8);
    data[0] = scaleX;
    data[1] = scaleY;
    data[2] = transX;
    data[3] = transY;
    data[4] = this.pointSize;
    this.device.queue.writeBuffer(this.cameraBuffer, 0, data);
  }

  render(encoder, camera) {
    this.updateCamera(camera);
    const timeSeconds = (performance.now() - this.startTime) / 1000;

    // 1. nebula backdrop -> nebulaTex
    {
      const pass = this.postfx.beginNebulaPass(encoder);
      this.nebula.encode(pass, timeSeconds);
      pass.end();
    }

    // 2. bodies -> pointsTex (additive)
    {
      const pass = this.postfx.beginPointsPass(encoder);
      pass.setPipeline(this.renderPipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.draw(6, this.sim.activeCount, 0, 0);
      pass.end();
    }

    // 3. trails + bloom + final composite -> swapchain
    const swapView = this.context.getCurrentTexture().createView();
    this.postfx.composite(encoder, swapView);
  }

  // Draw the drag indicator on the 2D overlay canvas. dragState = {x0,y0,x1,y1} in pixels or null.
  drawOverlay(dragState) {
    const ctx = this.overlayCtx;
    if (!ctx) return;
    const c = ctx.canvas;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!dragState) return;

    ctx.strokeStyle = "rgba(140, 200, 255, 0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(dragState.x0, dragState.y0);
    ctx.lineTo(dragState.x1, dragState.y1);
    ctx.stroke();

    // start marker
    ctx.fillStyle = "rgba(255, 230, 150, 0.9)";
    ctx.beginPath();
    ctx.arc(dragState.x0, dragState.y0, 4, 0, Math.PI * 2);
    ctx.fill();

    // arrowhead at release end
    const ang = Math.atan2(dragState.y1 - dragState.y0, dragState.x1 - dragState.x0);
    const h = 9;
    ctx.beginPath();
    ctx.moveTo(dragState.x1, dragState.y1);
    ctx.lineTo(
      dragState.x1 - h * Math.cos(ang - Math.PI / 7),
      dragState.y1 - h * Math.sin(ang - Math.PI / 7)
    );
    ctx.lineTo(
      dragState.x1 - h * Math.cos(ang + Math.PI / 7),
      dragState.y1 - h * Math.sin(ang + Math.PI / 7)
    );
    ctx.closePath();
    ctx.fillStyle = "rgba(140, 200, 255, 0.9)";
    ctx.fill();
  }
}
