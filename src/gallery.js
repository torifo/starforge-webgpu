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

    const header = document.createElement("header");
    header.className = "gallery-header";
    header.innerHTML =
      '<h1>starforge</h1>' +
      '<p class="tagline">a WebGPU N-body 作品集 — choose a sky</p>';
    root.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "gallery-grid";

    for (const s of SCENES) {
      const tile = document.createElement("button");
      tile.className = "tile";
      tile.dataset.scene = s.id;
      tile.style.setProperty("--glow", tileGlow(s.id));
      tile.innerHTML =
        `<span class="tile-orb"></span>` +
        `<span class="tile-name">${s.name}</span>` +
        `<span class="tile-name-ja">${s.nameJa || ""}</span>` +
        `<span class="tile-desc">${s.description}</span>`;
      tile.addEventListener("click", () => this.enter(s.id));
      grid.appendChild(tile);
    }
    root.appendChild(grid);

    const foot = document.createElement("footer");
    foot.className = "gallery-foot";
    foot.textContent =
      "in a scene: drag = add a star · wheel = zoom · right/shift-drag = pan · space = pause · R = reset · Esc = back to gallery";
    root.appendChild(foot);

    return root;
  }
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
