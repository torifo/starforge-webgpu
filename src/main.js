// starforge entry point: WebGPU detection + fallback, init, gallery routing,
// immersion render loop, interaction, UI.

import { initGPU } from "./gpu.js";
import { Simulation, MAX_BODIES } from "./simulation.js";
import { Renderer } from "./renderer.js";
import { Camera } from "./camera.js";
import { Gallery } from "./gallery.js";
import { buildScene } from "./scenes.js";
import { TimeControl } from "./timecontrol.js";
import { Interaction } from "./interaction.js";

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
const btnRewind = document.getElementById("btn-rewind");
const elRate = document.getElementById("stat-rate");
const elEpoch = document.getElementById("stat-epoch");
const elGuide = document.getElementById("guide");
const btnGuideToggle = document.getElementById("guide-toggle");
const elGuideName = document.getElementById("guide-tool-name");
const elGuideDesc = document.getElementById("guide-tool-desc");

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
  const sim = new Simulation(gpu.device, gpu);
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
  btnRewind?.addEventListener("click", rewind);

  // Restore the most recent checkpoint and rewind the epoch clock to match.
  function rewind() {
    if (!active) return;
    const t = sim.restoreLast();
    if (t === null) return;
    time.simTime = t;
    renderer.clearTrails();
  }

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
    } else if (e.key === "z" || e.key === "Z") {
      rewind();
    }
  });

  // ---- Interaction (tools, pointer, pan/zoom — only meaningful during immersion) ----
  const interaction = new Interaction({
    overlay,
    canvas,
    camera,
    sim,
    getActive: () => active,
    // checkpoint before each gesture so any interaction can be rewound
    beforeInteract: () => sim.snapshot(time.simTime),
    // keep the guide panel in sync with the selected tool
    onTool: (t) => {
      if (elGuideName) elGuideName.textContent = t.name;
      if (elGuideDesc) elGuideDesc.textContent = t.desc;
    },
  });
  interaction.mountToolbar(document.body);

  // Collapsible guide panel.
  btnGuideToggle?.addEventListener("click", () => {
    const open = elGuide.classList.toggle("open");
    btnGuideToggle.setAttribute("aria-expanded", String(open));
  });

  // ---- Render loop ----
  let last = performance.now();
  let fpsAccum = 0;
  let fpsFrames = 0;
  let lastSnap = 0; // wall-clock of last auto checkpoint
  const SNAP_INTERVAL_MS = 5000;

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
      // Apply at most one pointer interaction this frame (works while paused too).
      const cmd = interaction.tick();
      if (cmd) sim.applyInteraction(encoder, cmd);

      let substeps;
      if (stepOnce) {
        substeps = 1;
        stepOnce = false;
        time.simTime += sim.dt;
      } else {
        substeps = time.substepsFor(sim.activeCount, sim.dt);
      }
      // Auto checkpoint while time is actually advancing.
      if (substeps > 0 && now - lastSnap >= SNAP_INTERVAL_MS) {
        sim.snapshot(time.simTime);
        lastSnap = now;
      }
      for (let s = 0; s < substeps; s++) sim.step(encoder);
    }
    renderer.render(encoder, camera);
    gpu.device.queue.submit([encoder.finish()]);

    if (active) {
      if (elRate) elRate.textContent = time.rateLabel();
      if (elEpoch) elEpoch.textContent = time.epochLabel();
    }

    renderer.drawOverlay(active ? interaction.aim() : null);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Kick off routing (restores #scene=... on reload, else shows gallery).
  gallery.start();
}

main();
