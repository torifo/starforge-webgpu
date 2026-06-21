# starforge Requirements

## Overview
starforge is a browser-based WebGPU N-body gravity sandbox. It simulates several thousand point-mass bodies on the GPU using compute shaders, integrates their motion under mutual gravity, and renders them as points in real time. The user drags on the canvas to inject new bodies with a drag-derived initial velocity, and can pan/zoom a 2D camera, pause, and reset. The product runs entirely locally with no backend and no network/CDN dependencies.

## User Stories

### US-001: Launch the simulation
**As a** curious visitor **I want to** open the page and immediately see thousands of bodies orbiting **So that** I understand the sandbox is alive without any setup.

**Acceptance Criteria:**
- WHEN the page finishes loading in a WebGPU-capable browser THE SYSTEM SHALL initialize a GPU device and begin advancing the simulation at the display refresh rate.
- WHEN the simulation starts THE SYSTEM SHALL seed at least 2000 bodies in a visually distributed initial configuration.
- WHILE the simulation is running THE SYSTEM SHALL render every body as a point each frame.

### US-002: WebGPU-absent fallback
**As a** visitor on an unsupported browser **I want to** see a clear message **So that** I am not confronted with a blank page.

**Acceptance Criteria:**
- IF `navigator.gpu` is undefined THEN THE SYSTEM SHALL display a human-readable "WebGPU not supported in this browser" message and SHALL NOT attempt to create a GPU device.
- IF GPU adapter or device acquisition fails (rejected promise / null adapter) THEN THE SYSTEM SHALL display a human-readable error message describing the failure.

### US-003: Add bodies by dragging
**As a** user **I want to** click-drag on the canvas to place a star **So that** I can perturb the system and watch new orbits form.

**Acceptance Criteria:**
- WHEN the user presses the pointer down on the canvas THE SYSTEM SHALL record the world-space press position as the spawn origin.
- WHEN the user releases the pointer THE SYSTEM SHALL create one new body at the spawn origin with an initial velocity proportional to the drag vector (release minus press) in world space.
- WHILE the pointer is held down after a press THE SYSTEM SHALL render a visual indicator (a line from press point to current pointer) showing the drag-derived velocity.
- IF the body buffer is already at maximum capacity THEN THE SYSTEM SHALL ignore the new-body request without crashing.

### US-004: Pan and zoom the camera
**As a** user **I want to** pan and zoom **So that** I can inspect tight clusters or see the whole system.

**Acceptance Criteria:**
- WHEN the user scrolls the mouse wheel THE SYSTEM SHALL zoom the view toward/away from the cursor position keeping the cursor's world point stationary.
- WHEN the user drags with the secondary (right) button or with a pan modifier THE SYSTEM SHALL translate the camera by the pointer delta in world units.
- THE SYSTEM SHALL clamp zoom to a finite positive range to prevent degenerate projections.

### US-005: Pause and reset
**As a** user **I want to** pause and reset **So that** I can freeze a moment or start over.

**Acceptance Criteria:**
- WHEN the user activates pause THE SYSTEM SHALL stop advancing physics while continuing to render the current (frozen) state.
- WHEN the user activates pause again (resume) THE SYSTEM SHALL continue advancing physics from the frozen state.
- WHEN the user activates reset THE SYSTEM SHALL re-seed the bodies to the initial configuration and resume from a clean state.

## Functional Requirements

### FR-001: GPU-resident N-body integration
**Priority:** P0
**Persona:** all users
WHEN a physics step is requested AND the simulation is not paused THE SYSTEM SHALL compute the net gravitational acceleration on each body from all other bodies and advance positions and velocities using velocity-Verlet (leapfrog) integration with a fixed timestep.
**Rationale:** Symplectic integration keeps orbits stable over long runs; doing it on the GPU is the product's core value.

### FR-002: Gravitational softening
**Priority:** P0
**Persona:** all users
THE SYSTEM SHALL compute pairwise gravitational acceleration using a softened denominator `(r^2 + epsilon^2)^(3/2)` with a configurable softening length epsilon greater than zero.
**Rationale:** Prevents the `1/r^2` singularity and resulting numerical explosions when two bodies pass arbitrarily close.

### FR-003: Point rendering with camera transform
**Priority:** P0
**Persona:** all users
WHEN a frame is rendered THE SYSTEM SHALL transform each body's world position by the current camera (pan/zoom) into clip space and draw it as a point sprite.
**Rationale:** The simulation must be visible and navigable.

### FR-004: Bounded body count
**Priority:** P1
**Persona:** all users
THE SYSTEM SHALL allocate a fixed-capacity body buffer sized for at least 4096 bodies and SHALL track the active body count separately so that added bodies beyond capacity are rejected.
**Rationale:** GPU buffers are fixed-size; the active count drives dispatch and draw calls.

### FR-005: No external network dependencies
**Priority:** P0
**Persona:** operator
THE SYSTEM SHALL load all HTML, JavaScript, and WGSL assets from the local origin with no CDN, no third-party fetch, and no build step required to run.
**Rationale:** Product constraint — runs locally and offline.

## Non-Functional Requirements
- Performance: SHALL sustain interactive frame rates (target >= 30 fps) for 2000-4096 bodies on a modern integrated GPU using naive O(n^2) force computation.
- Robustness: SHALL not produce NaN/Inf positions during normal operation; softening epsilon enforces this.
- Portability: SHALL run from a static file server (e.g. `python3 -m http.server`) using ES modules, no transpilation.
- Accessibility of failure: SHALL surface every initialization failure as visible text, never a blank canvas or silent console-only error.

## Out of Scope
- Barnes-Hut / tree codes or any sub-O(n^2) acceleration.
- 3D camera fly-through (camera is 2D pan/zoom only).
- Collisions / merging of bodies.
- Saving / loading / sharing simulation state.
