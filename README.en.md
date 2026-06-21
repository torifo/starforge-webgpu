[日本語](./README.md) ・ [**English**](./README.en.md)

# WebGPU N-Body Gravity Sandbox (starforge-webgpu)

<!-- tech-stack:start (auto-generated) -->
<p align="center">
  <img src="https://img.shields.io/badge/WebGPU-005A9C?style=for-the-badge&logo=webgpu&logoColor=white" alt="WebGPU">
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="JavaScript">
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white" alt="HTML5">
</p>
<!-- tech-stack:end -->

A cinematic physics-sandbox gallery that runs an **N-body gravity simulation** of thousands of bodies
on the GPU via compute shaders. Click a curated scene in the **gallery** to launch it **full-screen**,
then drag to drop stars and watch the orbits evolve. It's the "real computation" counterpart to
CSS-animation studies. No backend, no network — plain ES modules.

## Flow
**Gallery (6 scenes) → click for full-screen immersion → Esc to return.** The current scene is kept in the URL hash (`#scene=galaxy`).

| Scene | Highlight |
|---|---|
| Solar system | stable orbits, Keplerian rhythm |
| Galaxy collision | tidal tails, the big spectacle |
| Accretion disk | inward spiral, glowing ring |
| Collapse (birth) | diffuse gas → structure |
| Gravity slingshot | intruder accelerates and scatters |
| Globular cluster | many-body aggregation, the GPU's forte |

## Look (cinematic effects)
- **Bloom**: bright cores bleed light.
- **Orbit trails**: a decaying history buffer leaves fading light trails.
- **Nebula backdrop**: faint colored gas for depth.
- HDR offscreen (rgba16float) → ACES tonemap composite.

Controls: drag to add a star (drag → velocity) · wheel zoom · right/Shift-drag pan · Space pause · R reset · Esc gallery.

## Stack
- **Rendering**: WebGPU (compute pipeline for force integration, render pipeline for points) + WGSL
- **Setup**: plain ES modules (no build step), zero dependencies, no CDN
- **Fallback**: a clear message when WebGPU is unavailable (never a blank page)

## Run & verify
In a WebGPU-capable browser (recent Chrome / Edge, etc.):
```sh
python3 -m http.server 8095   # → http://localhost:8095/
```

```sh
for f in src/shaders/*.wgsl; do naga "$f"; done   # validate WGSL
for f in src/*.js; do node --check "$f"; done       # JS syntax
node test/scenes.test.mjs                            # scene init conditions (78)
node test/bindings.test.mjs                          # binding contract (27)
```
> The actual rendered visuals (orbits, bloom, trails) are confirmed visually in a WebGPU browser.
