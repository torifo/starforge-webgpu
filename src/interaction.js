// interaction.js — tool-aware pointer control for starforge immersion.
//
// Owns all overlay pointer/wheel events: camera pan/zoom plus four "verbs" that
// let the viewer act on the simulation instead of just watching it. Grab/throw
// and shock drive GPU impulse passes (see interact.wgsl); mass and collide spawn
// bodies. Every left-button gesture snapshots first (via beforeInteract) so it
// can be rewound.

const TOOLS = [
  {
    key: "grab",
    label: "Grab ✋",
    name: "つかむ・投げる",
    title: "1 · つかむ・投げる",
    desc: "星をドラッグでつまんで引き寄せられる。勢いをつけて手を離すと、その向きへ放り投げる。軌道を少しだけ乱したいときに。",
  },
  {
    key: "mass",
    label: "Mass ☀",
    name: "重い星を置く",
    title: "2 · 重い星を置く",
    desc: "ドラッグした場所に重い天体を落とす。引っぱった向きと長さがそのまま初速。周りを一気に巻き込むので、中心づくりや降着のきっかけに。",
  },
  {
    key: "collide",
    label: "Collide ✦",
    name: "ぶつける",
    title: "3 · ぶつける",
    desc: "ドラッグした方向へ小さな星の群れを撃ち込む。今ある集団にぶつければ、衝突や潮汐の尾を自分の手で起こせる。",
  },
  {
    key: "shock",
    label: "Shock 💥",
    name: "爆発させる",
    title: "4 · 爆発させる",
    desc: "クリックした場所から外向きの衝撃波を出す。固まった構造を一瞬で吹き飛ばして、もう一度集まっていく様子を眺める。",
  },
];

// Tuning (world units / per-frame velocities). Tweak freely during debugging.
const GRAB_STRENGTH = 6.0; // pull velocity at cursor center
const THROW_GAIN = 3.0; // amplifies recent cursor velocity on release
const SHOCK_STRENGTH = 45.0; // outward kick at center
const LAUNCH_K = 1.5; // drag-vector -> spawn velocity
const MASS_BODY = 5000; // heavy body mass for the Mass tool
const CLUSTER_N = 14; // bodies in a Collide intruder cluster
const CLUSTER_MASS = 60;

export class Interaction {
  constructor({ overlay, canvas, camera, sim, getActive, beforeInteract, onTool }) {
    this.overlay = overlay;
    this.canvas = canvas;
    this.camera = camera;
    this.sim = sim;
    this.getActive = getActive;
    this.beforeInteract = beforeInteract || (() => {});
    this.onTool = onTool || (() => {});

    this.toolIdx = 0;
    this.grab = null; // { world, last, vel }
    this.drag = null; // { x0, y0, x1, y1 } device px (mass/collide aim)
    this.pan = null; // { px, py }
    this._pending = []; // one-shot GPU interaction commands

    this._btns = [];
    this._attach();
    this.onTool(TOOLS[this.toolIdx]); // publish initial tool guide
  }

  get tool() {
    return TOOLS[this.toolIdx].key;
  }

  setTool(i) {
    if (i < 0 || i >= TOOLS.length) return;
    this.toolIdx = i;
    this._refreshToolbar();
    this.onTool(TOOLS[i]);
  }

  // Effect radius in world units, sized to ~30% of the visible half-height so it
  // stays a consistent on-screen size across zoom levels.
  radius() {
    return this.camera.halfWorldHeight * 0.3;
  }

  _devPx(e) {
    const k = this.canvas.width / window.innerWidth;
    return { x: e.clientX * k, y: e.clientY * k };
  }

  _attach() {
    const ov = this.overlay;
    ov.addEventListener("contextmenu", (e) => e.preventDefault());
    ov.addEventListener("pointerdown", (e) => this._onDown(e));
    ov.addEventListener("pointermove", (e) => this._onMove(e));
    ov.addEventListener("pointerup", (e) => this._onUp(e));
    ov.addEventListener("pointercancel", () => {
      this.grab = null;
      this.drag = null;
      this.pan = null;
    });
    ov.addEventListener(
      "wheel",
      (e) => {
        if (!this.getActive()) return;
        e.preventDefault();
        const p = this._devPx(e);
        const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1;
        this.camera.zoomAt(p.x, p.y, factor);
      },
      { passive: false }
    );
    window.addEventListener("keydown", (e) => {
      if (!this.getActive()) return;
      const n = Number(e.key);
      if (n >= 1 && n <= TOOLS.length) this.setTool(n - 1);
    });
  }

  _onDown(e) {
    if (!this.getActive()) return;
    this.overlay.setPointerCapture(e.pointerId);
    const p = this._devPx(e);

    if (e.button === 2 || e.shiftKey) {
      this.pan = { px: p.x, py: p.y };
      return;
    }
    if (e.button !== 0) return;

    this.beforeInteract(); // checkpoint before any state-changing gesture
    const w = this.camera.screenToWorld(p.x, p.y);

    switch (this.tool) {
      case "grab":
        this.grab = { world: w, last: w, vel: { x: 0, y: 0 } };
        break;
      case "shock":
        this._pending.push({
          x: w.x, y: w.y, vx: 0, vy: 0,
          radius: this.radius(), strength: SHOCK_STRENGTH, mode: 3,
        });
        break;
      default: // mass / collide use a drag vector
        this.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    }
  }

  _onMove(e) {
    if (!this.getActive()) return;
    const p = this._devPx(e);
    if (this.pan) {
      this.camera.panByPixels(p.x - this.pan.px, p.y - this.pan.py);
      this.pan = { px: p.x, py: p.y };
    } else if (this.grab) {
      const w = this.camera.screenToWorld(p.x, p.y);
      this.grab.vel = { x: w.x - this.grab.last.x, y: w.y - this.grab.last.y };
      this.grab.last = w;
      this.grab.world = w;
    } else if (this.drag) {
      this.drag.x1 = p.x;
      this.drag.y1 = p.y;
    }
  }

  _onUp(e) {
    const p = this._devPx(e);
    if (this.pan) {
      this.pan = null;
      return;
    }
    if (this.grab) {
      const v = this.grab.vel;
      this._pending.push({
        x: this.grab.world.x, y: this.grab.world.y,
        vx: v.x * THROW_GAIN, vy: v.y * THROW_GAIN,
        radius: this.radius(), strength: 1.0, mode: 2,
      });
      this.grab = null;
      return;
    }
    if (this.drag) {
      const w0 = this.camera.screenToWorld(this.drag.x0, this.drag.y0);
      const w1 = this.camera.screenToWorld(p.x, p.y);
      const vx = (w1.x - w0.x) * LAUNCH_K;
      const vy = (w1.y - w0.y) * LAUNCH_K;
      if (this.tool === "mass") {
        this.sim.appendBody(w0.x, w0.y, vx, vy, MASS_BODY);
      } else if (this.tool === "collide") {
        this._spawnCluster(w0, vx, vy);
      }
      this.drag = null;
    }
  }

  _spawnCluster(w0, vx, vy) {
    const spread = this.radius() * 0.22;
    for (let i = 0; i < CLUSTER_N; i++) {
      const a = (i / CLUSTER_N) * Math.PI * 2;
      const r = spread * Math.sqrt((i + 1) / CLUSTER_N);
      this.sim.appendBody(w0.x + Math.cos(a) * r, w0.y + Math.sin(a) * r, vx, vy, CLUSTER_MASS);
    }
  }

  // Called once per frame. Returns a single GPU interaction command, or null.
  tick() {
    if (!this.getActive()) return null;
    if (this.grab) {
      return {
        x: this.grab.world.x, y: this.grab.world.y,
        vx: this.grab.vel.x, vy: this.grab.vel.y,
        radius: this.radius(), strength: GRAB_STRENGTH, mode: 1,
      };
    }
    if (this._pending.length) return this._pending.shift();
    return null;
  }

  // Aim line for the overlay (mass/collide drag), in device px, or null.
  aim() {
    return this.drag;
  }

  mountToolbar(parent) {
    const bar = document.createElement("div");
    bar.id = "toolbar";
    TOOLS.forEach((t, i) => {
      const b = document.createElement("button");
      b.textContent = t.label;
      b.title = t.title;
      b.addEventListener("click", () => this.setTool(i));
      bar.appendChild(b);
      this._btns.push(b);
    });
    parent.appendChild(bar);
    this._refreshToolbar();
  }

  _refreshToolbar() {
    this._btns.forEach((b, i) => b.classList.toggle("active", i === this.toolIdx));
  }
}
