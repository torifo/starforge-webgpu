// starforge WebGPU bootstrap: device, context, shader compilation, pipelines, bind group layouts.
// The bind group layouts here are the authoritative match for the @group/@binding in the WGSL.

const SHADER_DIR = new URL("./shaders/", import.meta.url);

// HDR offscreen format for the multi-pass postfx pipeline.
export const HDR_FORMAT = "rgba16float";

async function loadShaderModule(device, file) {
  const url = new URL(file, SHADER_DIR);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load shader ${file}: HTTP ${res.status}`);
  }
  const code = await res.text();
  device.pushErrorScope("validation");
  const module = device.createShaderModule({ label: file, code });
  const err = await device.popErrorScope();
  if (err) {
    throw new Error(`Shader compile error in ${file}: ${err.message}`);
  }
  return module;
}

const ADD_BLEND = {
  color: { srcFactor: "one", dstFactor: "one", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
};

// Returns a structured object the rest of the app uses (sim + render + postfx pipelines).
export async function initGPU(canvas) {
  if (!navigator.gpu) {
    throw new Error("WebGPU not supported in this browser.");
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("No WebGPU adapter available (GPU not accessible).");
  }

  let device;
  try {
    device = await adapter.requestDevice();
  } catch (e) {
    throw new Error(`Failed to acquire GPU device: ${e.message || e}`);
  }

  const context = canvas.getContext("webgpu");
  if (!context) {
    throw new Error("Failed to get WebGPU canvas context.");
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "premultiplied" });

  // ---- Compute pipelines (nbody.wgsl) ----
  const nbody = await loadShaderModule(device, "nbody.wgsl");

  const computeBGL = device.createBindGroupLayout({
    label: "compute-bgl",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
    ],
  });

  const computeLayout = device.createPipelineLayout({
    label: "compute-layout",
    bindGroupLayouts: [computeBGL],
  });

  const computeForcesPipeline = device.createComputePipeline({
    label: "computeForces",
    layout: computeLayout,
    compute: { module: nbody, entryPoint: "computeForces" },
  });
  const integratePipeline = device.createComputePipeline({
    label: "integrate",
    layout: computeLayout,
    compute: { module: nbody, entryPoint: "integrate" },
  });

  // ---- Bodies render pipeline (render.wgsl) -> HDR offscreen ----
  const renderShader = await loadShaderModule(device, "render.wgsl");

  const renderBGL = device.createBindGroupLayout({
    label: "render-bgl",
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
    ],
  });

  const renderLayout = device.createPipelineLayout({
    label: "render-layout",
    bindGroupLayouts: [renderBGL],
  });

  const renderPipeline = device.createRenderPipeline({
    label: "points",
    layout: renderLayout,
    vertex: { module: renderShader, entryPoint: "vs" },
    fragment: {
      module: renderShader,
      entryPoint: "fs",
      targets: [{ format: HDR_FORMAT, blend: ADD_BLEND }],
    },
    primitive: { topology: "triangle-list" },
  });

  // ---- Nebula pipeline (nebula.wgsl) -> HDR offscreen ----
  const nebulaShader = await loadShaderModule(device, "nebula.wgsl");
  const nebulaBGL = device.createBindGroupLayout({
    label: "nebula-bgl",
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
    ],
  });
  const nebulaPipeline = device.createRenderPipeline({
    label: "nebula",
    layout: device.createPipelineLayout({ bindGroupLayouts: [nebulaBGL] }),
    vertex: { module: nebulaShader, entryPoint: "vs" },
    fragment: { module: nebulaShader, entryPoint: "fs", targets: [{ format: HDR_FORMAT }] },
    primitive: { topology: "triangle-list" },
  });

  // ---- Bloom pipelines (bloom.wgsl): brightpass / blurH / blurV ----
  const bloomShader = await loadShaderModule(device, "bloom.wgsl");
  const bloomBGL = device.createBindGroupLayout({
    label: "bloom-bgl",
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
    ],
  });
  const bloomLayout = device.createPipelineLayout({ bindGroupLayouts: [bloomBGL] });
  const makeBloom = (entry, label) =>
    device.createRenderPipeline({
      label,
      layout: bloomLayout,
      vertex: { module: bloomShader, entryPoint: "vs" },
      fragment: { module: bloomShader, entryPoint: entry, targets: [{ format: HDR_FORMAT }] },
      primitive: { topology: "triangle-list" },
    });
  const brightpassPipeline = makeBloom("brightpass", "bloom-brightpass");
  const blurHPipeline = makeBloom("blurH", "bloom-blurH");
  const blurVPipeline = makeBloom("blurV", "bloom-blurV");

  // ---- Trail accumulation pipeline (composite.wgsl) -> HDR offscreen ----
  const trailShader = await loadShaderModule(device, "composite.wgsl");
  const trailBGL = device.createBindGroupLayout({
    label: "trail-bgl",
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
    ],
  });
  const trailPipeline = device.createRenderPipeline({
    label: "trail-accumulate",
    layout: device.createPipelineLayout({ bindGroupLayouts: [trailBGL] }),
    vertex: { module: trailShader, entryPoint: "vs" },
    fragment: { module: trailShader, entryPoint: "fs", targets: [{ format: HDR_FORMAT }] },
    primitive: { topology: "triangle-list" },
  });

  // ---- Final composite pipeline (final.wgsl) -> swapchain ----
  const finalShader = await loadShaderModule(device, "final.wgsl");
  const finalBGL = device.createBindGroupLayout({
    label: "final-bgl",
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
    ],
  });
  const finalPipeline = device.createRenderPipeline({
    label: "final-composite",
    layout: device.createPipelineLayout({ bindGroupLayouts: [finalBGL] }),
    vertex: { module: finalShader, entryPoint: "vs" },
    fragment: { module: finalShader, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });

  return {
    device,
    context,
    format,
    // sim
    computeForcesPipeline,
    integratePipeline,
    computeBGL,
    // bodies
    renderPipeline,
    renderBGL,
    // postfx
    nebulaPipeline,
    nebulaBGL,
    brightpassPipeline,
    blurHPipeline,
    blurVPipeline,
    bloomBGL,
    trailPipeline,
    trailBGL,
    finalPipeline,
    finalBGL,
  };
}
