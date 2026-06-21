# starforge Tasks

## Implementation Plan

### Wave 1 (parallel — no dependencies)
- [ ] **Task 1.1**: Page shell + fallback
  - What: `index.html` with `<canvas>`, overlay canvas, control bar (pause/reset, body count, fps), `#fallback` element, module entry. Minimal CSS.
  - Files: `index.html`
  - Done when: opens in a browser; `node --check` n/a; references resolve.
  - Depends on: none

- [ ] **Task 1.2**: Camera math module
  - What: `src/camera.js` — center/zoom state, worldToClip scale/translate, screenToWorld, zoom-to-cursor, pan, clamp.
  - Files: `src/camera.js`
  - Done when: `node --check` passes; pure module, no GPU refs.
  - Depends on: none

- [ ] **Task 1.3**: Compute shader
  - What: `src/shaders/nbody.wgsl` — SimParams uniform, SoA storage buffers, `computeForces` and `integrate` entry points with softening + leapfrog.
  - Files: `src/shaders/nbody.wgsl`
  - Done when: `naga` validates (or noted unavailable); bindings match design contract.
  - Depends on: none

- [ ] **Task 1.4**: Render shader
  - What: `src/shaders/render.wgsl` — Camera uniform, positions/masses storage, instanced-quad point sprite vertex + round-glow fragment.
  - Files: `src/shaders/render.wgsl`
  - Done when: `naga` validates (or noted unavailable); bindings match design contract.
  - Depends on: none

### Wave 2 (after Wave 1)
- [ ] **Task 2.1**: GPU bootstrap
  - What: `src/gpu.js` — adapter/device request, context config, fetch+compile WGSL, build compute & render pipelines and bind group layouts matching the design contract, error scopes.
  - Files: `src/gpu.js`
  - Done when: `node --check` passes; layout entries match WGSL bindings.
  - Depends on: 1.3, 1.4

- [ ] **Task 2.2**: Simulation module
  - What: `src/simulation.js` — allocate SoA buffers (MAX_BODIES=4096), SimParams uniform, seed initial bodies, compute bind group, `step()` dispatch (computeForces then integrate), `appendBody()`, `reset()`.
  - Files: `src/simulation.js`
  - Done when: `node --check` passes; uses bindings from 2.1.
  - Depends on: 2.1, 1.3

- [ ] **Task 2.3**: Renderer module
  - What: `src/renderer.js` — camera uniform buffer, render bind group, per-frame draw(6,count); drag-indicator on overlay 2D canvas.
  - Files: `src/renderer.js`
  - Done when: `node --check` passes; uses bindings from 2.1.
  - Depends on: 2.1, 1.2, 1.4

### Wave 3 (after Wave 2)
- [ ] **Task 3.1**: App wiring + interaction
  - What: `src/main.js` — WebGPU detection + fallback, init order, render loop with pause, pointer handlers (drag-to-add with drag-derived velocity), wheel zoom, right-drag pan, pause/reset buttons, fps + count UI.
  - Files: `src/main.js`
  - Done when: `node --check` passes; module graph resolves.
  - Depends on: 2.1, 2.2, 2.3, 1.1, 1.2

### Wave 4 (verification)
- [ ] **Task 4.1**: Static validation
  - What: `node --check` all JS; `naga` validate all WGSL (or note unavailable); structural binding cross-check; confirm no 404s in module graph.
  - Done when: all checks recorded with actual output.
  - Depends on: 3.1
- [ ] **Task 4.2**: Run docs
  - What: Document `python3 -m http.server 8080` run command + exact URL; note manual visual confirmation step.
  - Done when: README/notes present (in spec/report).
  - Depends on: 4.1

## Progress
- Total: 10 tasks | Completed: 0 | In Progress: 0
