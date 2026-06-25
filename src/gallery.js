// starforge gallery (展示室): black, glow-styled tiles for the scenes, and the
// gallery <-> immersion routing. State is persisted in the URL hash
// (e.g. #scene=galaxy) so reload restores it. Esc returns to the gallery.
//
// The gallery is a DOM overlay built on top of the existing canvases. It does not
// own any GPU state; it calls back into the app to enter/exit scenes.

import { SCENES, getScene } from "./scenes.js";

export class Gallery {
  // callbacks: { onEnter(sceneId), onExit() }
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.currentScene = null; // null = in gallery
    this.root = this.buildDOM();
    document.body.appendChild(this.root);

    window.addEventListener("hashchange", () => this.applyHash());
  }

  // Parse "#scene=galaxy" -> "galaxy" (validated), else null.
  parseHash() {
    const h = window.location.hash.replace(/^#/, "");
    const m = /(?:^|&)scene=([a-z]+)/.exec(h);
    if (m && getScene(m[1])) return m[1];
    return null;
  }

  setHash(sceneId) {
    const want = sceneId ? `#scene=${sceneId}` : "#";
    if (window.location.hash !== want) {
      // replaceState avoids stacking history entries on every enter/exit
      history.replaceState(null, "", want);
    }
  }

  // Initial routing: if hash names a scene, go straight into immersion.
  start() {
    const sceneId = this.parseHash();
    if (sceneId) {
      this.enter(sceneId, { fromHash: true });
    } else {
      this.showGallery({ fromHash: true });
    }
  }

  // React to external hash changes (back/forward, manual edit).
  applyHash() {
    const sceneId = this.parseHash();
    if (sceneId && sceneId !== this.currentScene) {
      this.enter(sceneId, { fromHash: true });
    } else if (!sceneId && this.currentScene !== null) {
      this.showGallery({ fromHash: true });
    }
  }

  enter(sceneId, opts = {}) {
    if (!getScene(sceneId)) return;
    this.currentScene = sceneId;
    if (!opts.fromHash) this.setHash(sceneId);
    this.root.classList.add("hidden");
    this.root.setAttribute("aria-hidden", "true");
    // brief fade-in on the immersion layer
    document.body.classList.add("immersion");
    document.body.classList.remove("gallery-open");
    this.callbacks.onEnter?.(sceneId);
  }

  showGallery(opts = {}) {
    this.currentScene = null;
    if (!opts.fromHash) this.setHash(null);
    this.root.classList.remove("hidden");
    this.root.setAttribute("aria-hidden", "false");
    document.body.classList.remove("immersion");
    document.body.classList.add("gallery-open");
    this.callbacks.onExit?.();
  }

  // Called by app when Esc pressed during immersion.
  exitToGallery() {
    if (this.currentScene !== null) {
      this.showGallery();
    }
  }

  isInGallery() {
    return this.currentScene === null;
  }

  buildDOM() {
    const root = document.createElement("div");
    root.id = "gallery";

    // Atmospheric deep-space backdrop: layered starfield + drifting nebula +
    // a faint orbital armature. Self-contained inline SVG, network-free.
    root.appendChild(this.buildBackdrop());

    const stage = document.createElement("div");
    stage.className = "gallery-stage";

    const header = document.createElement("header");
    header.className = "gallery-header";
    header.innerHTML =
      '<span class="eyebrow">' +
        '<span class="eyebrow-dot" aria-hidden="true"></span>' +
        'WebGPU · N-body gravity · real-time' +
      '</span>' +
      '<h1>starforge</h1>' +
      '<p class="tagline">A cosmos of curated simulations. ' +
        '<span class="tagline-ja">空を選び、重力に身をあずける。</span> ' +
        'Choose a sky and watch thousands of bodies fall into orbit on the GPU.</p>';
    stage.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "gallery-grid";
    grid.setAttribute("role", "list");

    SCENES.forEach((s, idx) => {
      const tile = document.createElement("button");
      tile.className = "tile";
      tile.type = "button";
      tile.dataset.scene = s.id;
      tile.setAttribute("role", "listitem");
      tile.style.setProperty("--glow", tileGlow(s.id));
      tile.style.setProperty("--i", String(idx));
      tile.setAttribute(
        "aria-label",
        `${s.name}${s.nameJa ? " · " + s.nameJa : ""} — ${s.description}`
      );
      const index = String(idx + 1).padStart(2, "0");
      tile.innerHTML =
        `<span class="tile-glyph" aria-hidden="true">${sceneGlyph(s.id)}</span>` +
        `<span class="tile-index" aria-hidden="true">${index}</span>` +
        `<span class="tile-body">` +
          `<span class="tile-name">${s.name}</span>` +
          `<span class="tile-name-ja">${s.nameJa || ""}</span>` +
          `<span class="tile-desc">${s.description}</span>` +
        `</span>` +
        `<span class="tile-enter" aria-hidden="true">` +
          `Enter` +
          `<svg class="tile-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 6l6 6-6 6"/></svg>` +
        `</span>`;
      tile.addEventListener("click", () => this.enter(s.id));
      grid.appendChild(tile);
    });
    stage.appendChild(grid);

    const foot = document.createElement("footer");
    foot.className = "gallery-foot";
    foot.innerHTML =
      `<span class="foot-label">In a scene</span>` +
      [
        ["drag", "add a star"],
        ["wheel", "zoom"],
        ["right / shift-drag", "pan"],
        ["space", "pause"],
        ["R", "reset"],
        ["Esc", "back to gallery"],
      ]
        .map(
          ([k, v]) =>
            `<span class="foot-chip"><kbd>${k}</kbd>${v}</span>`
        )
        .join("");
    stage.appendChild(foot);

    root.appendChild(stage);

    return root;
  }

  // Self-contained atmospheric backdrop (no external assets).
  buildBackdrop() {
    const wrap = document.createElement("div");
    wrap.className = "gallery-backdrop";
    wrap.setAttribute("aria-hidden", "true");

    // Deterministic star scatter so the field looks intentional, not random noise.
    let seed = 0x5f3a;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const stars = [];
    for (let i = 0; i < 140; i++) {
      const x = (rnd() * 100).toFixed(2);
      const y = (rnd() * 100).toFixed(2);
      const r = (0.4 + rnd() * 1.5).toFixed(2);
      const o = (0.25 + rnd() * 0.6).toFixed(2);
      stars.push(
        `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${o}"/>`
      );
    }

    wrap.innerHTML =
      `<svg class="bg-nebula" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">` +
        `<defs>` +
          `<radialGradient id="neb-a" cx="72%" cy="8%" r="60%">` +
            `<stop offset="0%" stop-color="#3b2f7a" stop-opacity="0.55"/>` +
            `<stop offset="55%" stop-color="#241a52" stop-opacity="0.18"/>` +
            `<stop offset="100%" stop-color="#05050a" stop-opacity="0"/>` +
          `</radialGradient>` +
          `<radialGradient id="neb-b" cx="8%" cy="100%" r="65%">` +
            `<stop offset="0%" stop-color="#143a72" stop-opacity="0.5"/>` +
            `<stop offset="60%" stop-color="#0d2148" stop-opacity="0.16"/>` +
            `<stop offset="100%" stop-color="#05050a" stop-opacity="0"/>` +
          `</radialGradient>` +
          `<radialGradient id="neb-core" cx="50%" cy="50%" r="50%">` +
            `<stop offset="0%" stop-color="#fff" stop-opacity="0.9"/>` +
            `<stop offset="100%" stop-color="#fff" stop-opacity="0"/>` +
          `</radialGradient>` +
        `</defs>` +
        `<rect width="1000" height="1000" fill="url(#neb-a)"/>` +
        `<rect width="1000" height="1000" fill="url(#neb-b)"/>` +
      `</svg>` +
      `<div class="bg-stars" aria-hidden="true">` +
        `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">${stars.join("")}</svg>` +
      `</div>` +
      `<svg class="bg-orbits" viewBox="0 0 1200 1200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">` +
        `<g fill="none" stroke="rgba(150,180,255,0.10)" stroke-width="1">` +
          `<ellipse cx="600" cy="600" rx="230" ry="120"/>` +
          `<ellipse cx="600" cy="600" rx="380" ry="200"/>` +
          `<ellipse cx="600" cy="600" rx="540" ry="290"/>` +
          `<ellipse cx="600" cy="600" rx="720" ry="400"/>` +
        `</g>` +
        `<g transform="rotate(28 600 600)">` +
          `<ellipse cx="600" cy="600" rx="480" ry="180" fill="none" stroke="rgba(150,180,255,0.07)" stroke-width="1"/>` +
        `</g>` +
        `<circle class="bg-body bg-body-a" cx="600" cy="480" r="3.5" fill="#aec8ff"/>` +
        `<circle class="bg-body bg-body-b" cx="600" cy="400" r="2.5" fill="#ffd49a"/>` +
        `<circle cx="600" cy="600" r="6" fill="url(#neb-core)"/>` +
      `</svg>`;
    return wrap;
  }
}

// A small inline-SVG glyph per scene, evoking its physics. No emoji.
function sceneGlyph(id) {
  const a = 'fill="none" stroke="currentColor" stroke-width="1.4"';
  const inner = {
    // central star + a couple of orbits
    solar:
      `<circle cx="12" cy="12" r="2.2" fill="currentColor"/>` +
      `<ellipse cx="12" cy="12" rx="8.5" ry="4.2" ${a}/>` +
      `<ellipse cx="12" cy="12" rx="5" ry="2.4" ${a}/>` +
      `<circle cx="20.5" cy="12" r="1" fill="currentColor"/>`,
    // two converging disks
    galaxy:
      `<ellipse cx="8" cy="12" rx="4" ry="6" ${a} transform="rotate(-25 8 12)"/>` +
      `<ellipse cx="16" cy="12" rx="4" ry="6" ${a} transform="rotate(25 16 12)"/>`,
    // ring with infalling spiral
    accretion:
      `<circle cx="12" cy="12" r="2" fill="currentColor"/>` +
      `<ellipse cx="12" cy="12" rx="8" ry="3.4" ${a}/>` +
      `<path d="M19 12a7 3 0 0 1 -7 3" ${a}/>`,
    // collapsing arrows inward
    collapse:
      `<circle cx="12" cy="12" r="2" fill="currentColor"/>` +
      `<path d="M12 3v4M12 17v4M3 12h4M17 12h4" ${a} stroke-linecap="round"/>` +
      `<circle cx="12" cy="12" r="6.5" ${a} stroke-dasharray="2 2.5"/>`,
    // hyperbolic flyby
    slingshot:
      `<circle cx="14" cy="12" r="2" fill="currentColor"/>` +
      `<path d="M3 20C9 16 9 8 21 4" ${a} stroke-linecap="round"/>`,
    // dense cluster of points
    cluster:
      `<g fill="currentColor">` +
      `<circle cx="12" cy="12" r="1.1"/><circle cx="9" cy="10" r="0.9"/>` +
      `<circle cx="15" cy="10" r="0.9"/><circle cx="10" cy="14" r="0.9"/>` +
      `<circle cx="14" cy="14" r="0.9"/><circle cx="12" cy="8.5" r="0.8"/>` +
      `<circle cx="12" cy="15.5" r="0.8"/><circle cx="8" cy="13" r="0.7"/>` +
      `<circle cx="16" cy="13" r="0.7"/></g>` +
      `<circle cx="12" cy="12" r="7.5" ${a} opacity="0.5"/>`,
  }[id] || `<circle cx="12" cy="12" r="3" fill="currentColor"/>`;
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
}

// Per-scene accent glow color for tiles.
function tileGlow(id) {
  return (
    {
      solar: "255, 196, 92",
      galaxy: "150, 130, 255",
      accretion: "255, 130, 90",
      collapse: "120, 200, 255",
      slingshot: "120, 255, 190",
      cluster: "200, 200, 255",
    }[id] || "140, 200, 255"
  );
}
