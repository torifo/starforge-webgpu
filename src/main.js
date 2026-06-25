// starforge entry point: WebGPU detection + fallback, init, gallery routing,
// immersion render loop, interaction, UI.

import { initGPU } from "./gpu.js";
import { Simulation, MAX_BODIES } from "./simulation.js";
import { Renderer } from "./renderer.js";
import { Camera } from "./camera.js";
import { Gallery } from "./gallery.js";
import { buildScene } from "./scenes.js";
import { TimeControl } from "./timecontrol.js";

const canvas = document.getElementById("gpu-canvas");
const overlay = document.getElementById("overlay-canvas");
const fallback = document.getElementById("fallback");
const elCount = document.getElementById("stat-count");
const elFps = document.getElementById("stat-fps");
const btnPause = document.getElementById("btn-pause");
const btnReset = document.getElementById("btn-reset");
const btnSlower = document.getElementById("btn-slower");
const btnFaster = document.getElementById("btn-faster");
const btnStep = document.getElementById("btn-step");
const elRate = document.getElementById("stat-rate");
const elEpoch = document.getElementById("stat-epoch");

function showFallback(message) {
  if (fallback) {
    fallback.textContent = message;
    fallback.style.display = "flex";
  }
  if (canvas) canvas.style.display = "none";
  if (overlay) overlay.style.display = "none";
  console.error("[starforge]", message);
}

function resizeCanvases(camera, renderer) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(window.innerWidth * dpr);
  const h = Math.floor(window.innerHeight * dpr);
  for (const c of [canvas, overlay]) {
    if (!c) continue;
    c.width = w;
    c.height = h;
    c.style.width = window.innerWidth + "px";
    c.style.height = window.innerHeight + "px";
  }
  camera.resize(w, h);
  renderer.resize(w, h);
}

async function main() {
  if (!navigator.gpu) {
    showFallback("WebGPU not supported in this browser.");
    return;
  }

  let gpu;
  try {
    gpu = await initGPU(canvas);
  } catch (e) {
    showFallback(`Could not start WebGPU: ${e.message || e}`);
    return;
  }

  gpu.device.lost.then((info) => {
    showFallback(`GPU device lost: ${info.message || info.reason || "unknown"}`);
  });

  const camera = new Camera();
  const sim = new Simulation(
    gpu.device,
    gpu.computeForcesPipeline,
    gpu.integratePipeline,
    gpu.computeBGL
  );
  const overlayCtx = overlay ? overlay.getContext("2d") : null;
  const renderer = new Renderer(gpu, sim, overlayCtx);

  resizeCanvases(camera, renderer);
  window.addEventListener("resize", () => resizeCanvases(camera, renderer));

  // ---- Live control panel (sliders) ----
  // A small registry so new controls are easy to add. All client-side.
  const controlsEl = document.createElement("div");
  controlsEl.id = "controls";
  controlsEl.innerHTML = `<div class="ctl-head">controls</div>`;
  const CONTROLS = [
    { label: "Gravity 重力", min: 0, max: 150, step: 1,
      get: () => sim.g, set: (v) => { sim.g = v; sim.writeParams(); }, fmt: (v) => v.toFixed(0) },
    { label: "Trail トレイル", min: 0.5, max: 0.98, step: 0.01,
      get: () => renderer.postfx.trailDecay, set: (v) => { renderer.postfx.trailDecay = v; }, fmt: (v) => v.toFixed(2) },
    { label: "Bloom", min: 0, max: 2, step: 0.05,
      get: () => renderer.postfx.bloomStrength, set: (v) => { renderer.postfx.bloomStrength = v; }, fmt: (v) => v.toFixed(2) },
  ];
  const ctlRefs = CONTROLS.map((c) => {
    const wrap = document.createElement("div"); wrap.className = "ctl";
    const row = document.createElement("div"); row.className = "ctl-row";
    const name = document.createElement("span"); name.textContent = c.label;
    const val = document.createElement("b");
    const input = document.createElement("input");
    input.type = "range"; input.min = c.min; input.max = c.max; input.step = c.step;
    input.addEventListener("input", () => { const v = Number(input.value); c.set(v); val.textContent = c.fmt(v); });
    row.append(name, val); wrap.append(row, input); controlsEl.appendChild(wrap);
    return { c, input, val };
  });
  document.body.appendChild(controlsEl);
  function syncControls() {
    for (const { c, input, val } of ctlRefs) { const v = c.get(); input.value = String(v); val.textContent = c.fmt(v); }
  }
  syncControls();

  // Apply a scene's camera initial state to the live camera.
  function applyCameraFor(sceneId) {
    const meta = buildScene(sceneId);
    if (meta && meta.camera) {
      camera.center.x = meta.camera.center.x;
      camera.center.y = meta.camera.center.y;
      camera.halfWorldHeight = meta.camera.halfWorldHeight;
    }
  }

  // ---- Gallery routing ----
  const time = new TimeControl();
  let active = false; // true while immersed in a scene
  let stepOnce = false; // run exactly one substep next frame (manual frame-step)

  function setPaused(p) {
    time.setPaused(p);
    refreshTimeHud();
  }
  function refreshTimeHud() {
    if (btnPause) btnPause.textContent = time.paused ? "Resume" : "Pause";
  }

  function restartScene() {
    applyCameraFor(sim.sceneId);
    sim.reset();
    renderer.clearTrails();
    time.reset();
    syncControls();
    refreshTimeHud();
  }

  const gallery = new Gallery({
    onEnter(sceneId) {
      active = true;
      setPaused(false);
      applyCameraFor(sceneId);
      sim.loadScene(sceneId);
      renderer.clearTrails();
      time.reset();
      syncControls();
      refreshTimeHud();
    },
    onExit() {
      active = false;
    },
  });

  // ---- UI controls ----
  btnPause?.addEventListener("click", () => setPaused(!time.paused));
  btnReset?.addEventListener("click", () => { if (active) restartScene(); });
  btnSlower?.addEventListener("click", () => { time.slower(); refreshTimeHud(); });
  btnFaster?.addEventListener("click", () => { time.faster(); refreshTimeHud(); });
  btnStep?.addEventListener("click", () => { if (active) stepOnce = true; });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      gallery.exitToGallery();
      return;
    }
    if (!active) return;
    if (e.code === "Space") {
      e.preventDefault();
      setPaused(!time.paused);
    } else if (e.key === "r" || e.key === "R") {
      restartScene();
    } else if (e.key === "," || e.key === "<") {
      time.slower();
      refreshTimeHud();
    } else if (e.key === "." || e.key === ">") {
      time.faster();
      refreshTimeHud();
    } else if (e.key === "h" || e.key === "H") {
      time.hyper = !time.hyper;
      refreshTimeHud();
    } else if (e.key === "n" || e.key === "N") {
      stepOnce = true;
    }
  });

  // ---- Interaction (only meaningful during immersion) ----
  const dpr = () => canvas.width / window.innerWidth;
  let drag = null;
  let panning = null;

  function devPx(ev) {
    const k = dpr();
    return { x: ev.clientX * k, y: ev.clientY * k };
  }

  overlay.addEventListener("contextmenu", (e) => e.preventDefault());

  overlay.addEventListener("pointerdown", (e) => {
    if (!active) return;
    overlay.setPointerCapture(e.pointerId);
    const p = devPx(e);
    if (e.button === 2 || e.shiftKey) {
      panning = { px: p.x, py: p.y };
    } else if (e.button === 0) {
      drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    }
  });

  overlay.addEventListener("pointermove", (e) => {
    if (!active) return;
    const p = devPx(e);
    if (panning) {
      camera.panByPixels(p.x - panning.px, p.y - panning.py);
      panning = { px: p.x, py: p.y };
    } else if (drag) {
      drag.x1 = p.x;
      drag.y1 = p.y;
    }
  });

  function endDrag(e) {
    const p = devPx(e);
    if (panning) {
      panning = null;
      return;
    }
    if (drag) {
      const world0 = camera.screenToWorld(drag.x0, drag.y0);
      const world1 = camera.screenToWorld(p.x, p.y);
      const k = 1.5;
      const vx = (world1.x - world0.x) * k;
      const vy = (world1.y - world0.y) * k;
      const added = sim.appendBody(world0.x, world0.y, vx, vy, 30);
      if (!added) console.warn("[starforge] body buffer full; ignoring new body");
      drag = null;
    }
  }
  overlay.addEventListener("pointerup", endDrag);
  overlay.addEventListener("pointercancel", () => {
    drag = null;
    panning = null;
  });

  overlay.addEventListener(
    "wheel",
    (e) => {
      if (!active) return;
      e.preventDefault();
      const p = devPx(e);
      const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1;
      camera.zoomAt(p.x, p.y, factor);
    },
    { passive: false }
  );

  // ---- Render loop ----
  let last = performance.now();
  let fpsAccum = 0;
  let fpsFrames = 0;

  function frame(now) {
    const elapsed = now - last;
    last = now;
    fpsAccum += elapsed;
    fpsFrames++;
    if (fpsAccum >= 500) {
      const fps = (fpsFrames / fpsAccum) * 1000;
      if (elFps) elFps.textContent = fps.toFixed(0);
      fpsAccum = 0;
      fpsFrames = 0;
    }
    if (elCount) elCount.textContent = `${sim.activeCount} / ${MAX_BODIES}`;

    // Always render (so the scene shows through behind the gallery is avoided by
    // the opaque gallery overlay); only advance physics while immersed.
    // "Speed" = substeps per frame at a fixed dt (see TimeControl).
    const encoder = gpu.device.createCommandEncoder();
    if (active) {
      let substeps;
      if (stepOnce) {
        substeps = 1;
        stepOnce = false;
        time.simTime += sim.dt;
      } else {
        substeps = time.substepsFor(sim.activeCount, sim.dt);
      }
      for (let s = 0; s < substeps; s++) sim.step(encoder);
    }
    renderer.render(encoder, camera);
    gpu.device.queue.submit([encoder.finish()]);

    if (active) {
      if (elRate) elRate.textContent = time.rateLabel();
      if (elEpoch) elEpoch.textContent = time.epochLabel();
    }

    renderer.drawOverlay(active ? drag : null);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Kick off routing (restores #scene=... on reload, else shows gallery).
  gallery.start();
}

main();
