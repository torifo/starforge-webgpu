// timecontrol.js — forward-primary time control for starforge.
//
// "Speed" is expressed as the number of physics SUBSTEPS run per frame; the
// physics dt stays fixed so leapfrog integration never blows up. Going faster
// = running more substeps, not a bigger dt. Hyperlapse is just a very large
// substep target, clamped by a per-frame load guard that scales with body
// count (gravity is O(n^2), so cost ~ count^2 * substeps).

// Discrete forward rates (substeps/frame). < 1 means "one step every 1/r frames".
export const RATES = [0, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64];
const DEFAULT_IDX = 3; // 1x

// Hyperlapse target substeps/frame (before the load guard trims it).
const HYPER_TARGET = 200;

// Load guard budget in "pair-ops" per frame: count^2 * substeps <= BUDGET.
// At 4096 bodies -> ~8 substeps; at 1000 -> ~130; small scenes run the full
// requested rate. Tuned generously; the HUD shows the EFFECTIVE rate so we
// never silently drop steps without telling the user.
const PAIR_BUDGET = 4096 * 4096 * 8;
const MAX_SUBSTEPS = 256; // absolute ceiling regardless of body count

// Display scale: one unit of accumulated sim-time (dt-seconds) ~= this many Myr.
const EPOCH_MYR_PER_UNIT = 1.0;

export class TimeControl {
  constructor() {
    this.idx = DEFAULT_IDX;
    this.hyper = false;
    this.simTime = 0; // accumulated dt * effective-substeps
    this._frac = 0; // accumulator for sub-1x rates
    this._resumeIdx = DEFAULT_IDX; // remembers rate across pause toggles
    this.lastEffective = 0; // substeps actually run last frame
  }

  get target() {
    return this.hyper ? HYPER_TARGET : RATES[this.idx];
  }

  get paused() {
    return !this.hyper && RATES[this.idx] === 0;
  }

  get label() {
    if (this.hyper) return "Hyperlapse";
    const r = RATES[this.idx];
    return r === 0 ? "Paused" : `${r}x`;
  }

  faster() {
    if (this.hyper) return;
    if (this.idx < RATES.length - 1) this.idx += 1;
    else this.hyper = true;
  }

  slower() {
    if (this.hyper) {
      this.hyper = false;
      this.idx = RATES.length - 1;
      return;
    }
    if (this.idx > 0) this.idx -= 1;
  }

  togglePause() {
    if (this.paused) {
      // resume to remembered rate
      this.hyper = false;
      this.idx = this._resumeIdx || DEFAULT_IDX;
    } else {
      if (!this.hyper) this._resumeIdx = this.idx;
      this.hyper = false;
      this.idx = 0;
    }
  }

  setPaused(p) {
    if (p && !this.paused) this.togglePause();
    if (!p && this.paused) this.togglePause();
  }

  reset() {
    this.simTime = 0;
    this._frac = 0;
    this.lastEffective = 0;
  }

  // How many physics substeps to run THIS frame for the given body count.
  // Also advances the epoch clock by the substeps it returns.
  substepsFor(count, dt) {
    const t = this.target;
    if (t === 0) {
      this.lastEffective = 0;
      return 0;
    }

    let n;
    if (t < 1) {
      // sub-1x: accumulate fractional steps, fire one when it crosses 1.
      this._frac += t;
      if (this._frac >= 1) {
        this._frac -= 1;
        n = 1;
      } else {
        n = 0;
      }
    } else {
      const guard = Math.max(
        1,
        Math.min(MAX_SUBSTEPS, Math.floor(PAIR_BUDGET / Math.max(1, count * count)))
      );
      n = Math.min(Math.round(t), guard);
    }

    this.lastEffective = n;
    this.simTime += dt * n;
    return n;
  }

  // Human-readable epoch, e.g. "T+ 3.4 Myr" / "T+ 1.20 Gyr".
  epochLabel() {
    const myr = this.simTime * EPOCH_MYR_PER_UNIT;
    if (myr >= 1000) return `T+ ${(myr / 1000).toFixed(2)} Gyr`;
    if (myr >= 10) return `T+ ${myr.toFixed(0)} Myr`;
    return `T+ ${myr.toFixed(1)} Myr`;
  }

  // Effective-rate readout; flags when the load guard trimmed the request.
  rateLabel() {
    if (this.paused) return "Paused";
    if (this.hyper) {
      return this.lastEffective < HYPER_TARGET
        ? `Hyperlapse (~${this.lastEffective}x)`
        : "Hyperlapse";
    }
    const r = RATES[this.idx];
    if (r >= 1 && this.lastEffective < Math.round(r)) {
      return `${r}x (~${this.lastEffective}x)`;
    }
    return `${r}x`;
  }
}
