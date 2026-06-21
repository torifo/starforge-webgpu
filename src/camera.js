// starforge 2D camera. Pure module, no GPU dependency.
// State: center (world), zoom (world units visible across the half-height of the canvas).

export const ZOOM_MIN = 5;      // very zoomed in (few world units across)
export const ZOOM_MAX = 100000; // very zoomed out

export class Camera {
  constructor() {
    this.center = { x: 0, y: 0 };
    // halfWorldHeight = number of world units from screen center to top/bottom edge.
    this.halfWorldHeight = 600;
    this.width = 1;
    this.height = 1;
  }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  get aspect() {
    return this.width / this.height;
  }

  // clip = (world - center) * scale + translate, with clip in [-1, 1].
  // y is flipped so +world-y is up on screen.
  scaleAndTranslate() {
    const sy = 1 / this.halfWorldHeight;
    const sx = sy / this.aspect;
    // translate keeps center mapped to clip origin
    return {
      scaleX: sx,
      scaleY: sy,
      transX: -this.center.x * sx,
      transY: -this.center.y * sy,
    };
  }

  // Convert screen pixel (origin top-left) to world coordinates.
  screenToWorld(px, py) {
    // pixel -> normalized device coords [-1,1], y up
    const ndcX = (px / this.width) * 2 - 1;
    const ndcY = 1 - (py / this.height) * 2;
    const { scaleX, scaleY, transX, transY } = this.scaleAndTranslate();
    // clip = world*scale + trans  =>  world = (clip - trans)/scale
    return {
      x: (ndcX - transX) / scaleX,
      y: (ndcY - transY) / scaleY,
    };
  }

  // Zoom toward a screen point, keeping the world point under the cursor stationary.
  zoomAt(px, py, factor) {
    const before = this.screenToWorld(px, py);
    this.halfWorldHeight = clamp(this.halfWorldHeight * factor, ZOOM_MIN, ZOOM_MAX);
    const after = this.screenToWorld(px, py);
    // shift center so the same world point stays under the cursor
    this.center.x += before.x - after.x;
    this.center.y += before.y - after.y;
  }

  // Pan by a screen-space pixel delta (drag).
  panByPixels(dx, dy) {
    // convert pixel delta to world delta
    const worldPerPixelY = (2 * this.halfWorldHeight) / this.height;
    this.center.x -= dx * worldPerPixelY; // x uses same world-per-pixel as y (square pixels)
    this.center.y += dy * worldPerPixelY; // screen y is down, world y is up
  }
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
