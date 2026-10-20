export type Easing = (u: number) => number;

export const linear: Easing = (u) => u;
export const easeOutCubic: Easing = (u) => 1 - (1 - u) ** 3;
export const easeInOutSine: Easing = (u) => 0.5 - 0.5 * Math.cos(Math.PI * u);

/** The point in a fall (as a fraction of its time) at which the piece reaches the ground. */
export const LANDING = 0.78;

/** How far a falling piece has got, from 0 (start) to 1 (on the ground). It speeds up, lands at LANDING, and stays. */
export const fallProgress: Easing = (u) => (u < LANDING ? (u / LANDING) ** 2 : 1);

/**
 * How far up a piece has bounced after landing, in the same units as `height`. The bounce is the same
 * small height whatever the fall: scaling it with the distance fallen made long falls bounce deep
 * into the piece above.
 */
export const rebound = (u: number, height: number): number =>
  u <= LANDING ? 0 : height * Math.sin((Math.PI * (u - LANDING)) / (1 - LANDING));

/** A frame longer than this (a hidden tab, a hiccup) counts as this long, so nothing jumps. */
const MAX_STEP_MS = 100;

interface Tween {
  elapsed: number;
  readonly duration: number;
  readonly update: (progress: number) => void;
  readonly ease: Easing;
  readonly done: () => void;
}

/**
 * Runs timed animations as promises. It has no clock of its own: call step() once per frame with the
 * frame's duration. That makes sequences deterministic and lets a test, or a QA script, run a whole
 * animation in a few milliseconds by stepping it by hand.
 */
export class Animator {
  #tweens: Tween[] = [];
  /** Animations run this many times faster: 1 is normal, bigger skips ahead. */
  speed = 1;

  get active(): number {
    return this.#tweens.length;
  }

  /** Calls `update` with the eased progress from 0 to 1 over `durationMs`, and finishes with exactly 1. */
  tween(durationMs: number, update: (progress: number) => void, ease: Easing = linear): Promise<void> {
    if (durationMs <= 0) {
      update(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.#tweens.push({ elapsed: 0, duration: durationMs, update, ease, done: resolve });
    });
  }

  wait(durationMs: number): Promise<void> {
    return this.tween(durationMs, () => {});
  }

  /** Moves every running animation on by one frame of `deltaMs`. */
  step(deltaMs: number): void {
    const advance = Math.min(deltaMs, MAX_STEP_MS) * this.speed;
    // Finished tweens resolve promises whose continuations may start new tweens; those start next frame.
    const running = this.#tweens;
    this.#tweens = [];
    const stillRunning: Tween[] = [];
    for (const tween of running) {
      tween.elapsed += advance;
      const progress = Math.min(1, tween.elapsed / tween.duration);
      tween.update(tween.ease(progress));
      if (progress < 1) stillRunning.push(tween);
      else tween.done();
    }
    this.#tweens = [...stillRunning, ...this.#tweens];
  }
}
