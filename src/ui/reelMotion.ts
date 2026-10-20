/** How the reels move. Speeds are in cells per second, times in milliseconds. */
export const FEEL = {
  spinSpeed: 32,
  /** Time to reach full speed from rest. */
  rampMs: 180,
  /** Spin time before the first reel starts to stop. */
  minSpinMs: 700,
  /** Extra spin time for each reel after the first, so they stop left to right. */
  stopStaggerMs: 260,
  /** The least distance, in cells, a reel travels between starting to stop and landing. */
  minTravel: 6,
  /** How far past the landing position a reel rolls before easing back, in cells. */
  overshoot: 0.14,
  bounceMs: 160,
  quickStopMs: 110,
  /** Multiplies every duration in turbo mode. */
  turboScale: 0.4,
} as const;

export type MotionPhase = "idle" | "spinning" | "gliding" | "settling";

export interface MotionStart {
  /** Where the reel is now (an integer, at rest). */
  position: number;
  /** The stop to land on. */
  stop: number;
  now: number;
  /** How long to spin before starting to land, before the time scale is applied. */
  spinMs: number;
  /** 1 normally, FEEL.turboScale in turbo. */
  timeScale: number;
}

/**
 * The motion of one reel as a pure state machine: no drawing, no timers, no clock of its own.
 * The caller supplies the time on every step, which makes the landing logic testable in isolation.
 *
 * `position` and `shift` follow the conventions of ReelView. While landing, `shift` is changed so
 * that the stop's window lies a few cells ahead of the reel; on landing, `position` is exactly the
 * stop and `shift` is 0.
 */
export class ReelMotion {
  phase: MotionPhase = "idle";
  position = 0;
  shift = 0;
  /** Current speed in cells per second (for motion blur). */
  speed = 0;

  #stop = 0;
  #timeScale = 1;
  #spinStart = 0;
  #stopAt = 0;
  #quick = false;
  #from = 0;
  #to = 0;
  #t0 = 0;
  #dur = 1;
  #target = 0;

  get stop(): number {
    return this.#stop;
  }

  start(options: MotionStart): void {
    this.phase = "spinning";
    this.position = options.position;
    this.shift = 0;
    this.speed = 0;
    this.#stop = options.stop;
    this.#timeScale = options.timeScale;
    this.#spinStart = options.now;
    this.#stopAt = options.now + options.spinMs * options.timeScale;
    this.#quick = false;
  }

  /** Lands quickly if still spinning; snaps to the stop if already landing. Returns true if it landed now. */
  quickStop(now: number): boolean {
    if (this.phase === "spinning") {
      this.#stopAt = now;
      this.#quick = true;
      return false;
    }
    if (this.phase === "gliding" || this.phase === "settling") {
      this.#land();
      return true;
    }
    return false;
  }

  /** Advances to time `now`, `dtSeconds` after the previous step. Returns true on the step the reel lands. */
  step(now: number, dtSeconds: number): boolean {
    const before = this.position;
    switch (this.phase) {
      case "idle":
        return false;
      case "spinning": {
        const ramp = Math.min(1, (now - this.#spinStart) / (FEEL.rampMs * this.#timeScale));
        this.position = before - (FEEL.spinSpeed / this.#timeScale) * ramp * ramp * dtSeconds;
        this.speed = (before - this.position) / dtSeconds;
        if (now >= this.#stopAt) this.#beginGlide(now);
        return false;
      }
      case "gliding": {
        // Ease out from the spin's own speed: a quadratic ease starts at twice the average speed.
        const u = Math.min(1, (now - this.#t0) / this.#dur);
        this.position = this.#from + (this.#to - this.#from) * (1 - (1 - u) * (1 - u));
        this.speed = Math.abs(before - this.position) / dtSeconds;
        if (u >= 1) {
          this.phase = "settling";
          this.#from = this.#to;
          this.#to = this.#target;
          this.#t0 = now;
          this.#dur = Math.max(1, (this.#quick ? FEEL.quickStopMs / 2 : FEEL.bounceMs) * this.#timeScale);
        }
        return false;
      }
      case "settling": {
        const u = Math.min(1, (now - this.#t0) / this.#dur);
        this.position = this.#from + (this.#to - this.#from) * (0.5 - 0.5 * Math.cos(Math.PI * u));
        this.speed = Math.abs(before - this.position) / dtSeconds;
        if (u >= 1) {
          this.#land();
          return true;
        }
        return false;
      }
    }
  }

  /**
   * Starts landing. The reel is re-aligned so the stop's window sits `minTravel` cells ahead; the
   * swap happens at full blur, where individual symbols cannot be read.
   */
  #beginGlide(now: number): void {
    const current = this.position;
    const target = Math.floor(current - FEEL.minTravel);
    this.shift = this.#stop - target;
    const landing = target - FEEL.overshoot;

    this.phase = "gliding";
    this.#target = target;
    this.#from = current;
    this.#to = landing;
    this.#t0 = now;
    this.#dur = this.#quick
      ? FEEL.quickStopMs
      : Math.max(1, ((2 * (current - landing)) / Math.max(this.speed, 1)) * 1000);
  }

  #land(): void {
    this.phase = "idle";
    this.position = this.#stop;
    this.shift = 0;
    this.speed = 0;
  }
}
