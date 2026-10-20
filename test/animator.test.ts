import { describe, expect, it } from "vitest";
import { Animator, easeInOutSine, easeOutCubic, fallProgress, LANDING, rebound } from "../src/ui/animator.ts";

const FRAME_MS = 1000 / 60;

/** Steps an animator by whole frames, letting promise continuations run between frames. */
async function run(animator: Animator, ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += FRAME_MS) {
    animator.step(FRAME_MS);
    for (let i = 0; i < 10; i++) await Promise.resolve();
  }
}

describe("easings", () => {
  it.each([
    ["easeOutCubic", easeOutCubic],
    ["easeInOutSine", easeInOutSine],
    ["fallProgress", fallProgress],
  ])("%s starts at 0 and ends at exactly 1", (_name, ease) => {
    expect(ease(0)).toBeCloseTo(0, 12);
    expect(ease(1)).toBeCloseTo(1, 12);
  });

  it("a fall speeds up, reaches the ground at LANDING, and stays there", () => {
    expect(fallProgress(LANDING)).toBeCloseTo(1, 12);
    expect(fallProgress(0.9)).toBe(1);
    for (let u = 0.02; u <= LANDING; u += 0.02) expect(fallProgress(u)).toBeGreaterThan(fallProgress(u - 0.02));
  });

  it("the bounce is a fixed height that starts at the landing and ends back on the ground", () => {
    expect(rebound(0, 7)).toBe(0);
    expect(rebound(LANDING, 7)).toBeCloseTo(0, 12);
    expect(rebound(1, 7)).toBeCloseTo(0, 12);
    const peak = Math.max(...Array.from({ length: 101 }, (_, i) => rebound(i / 100, 7)));
    // It peaks at the height asked for, however far the piece fell.
    expect(peak).toBeCloseTo(7, 1);
    expect(rebound(0.5, 7)).toBe(0);
  });
});

describe("Animator", () => {
  it("runs a tween for its duration and finishes with exactly 1", async () => {
    const animator = new Animator();
    const seen: number[] = [];
    let finished = false;
    void animator.tween(200, (p) => seen.push(p)).then(() => (finished = true));

    await run(animator, 100);
    expect(finished).toBe(false);
    await run(animator, 150);
    expect(finished).toBe(true);
    expect(seen[seen.length - 1]).toBe(1);
    expect(Math.max(...seen)).toBe(1);
    expect(seen.every((p, i) => i === 0 || p >= seen[i - 1]!)).toBe(true);
  });

  it("applies the easing to what update sees", async () => {
    const animator = new Animator();
    const seen: number[] = [];
    void animator.tween(100, (p) => seen.push(p), (u) => u * u);
    await run(animator, 120);
    expect(seen[0]).toBeLessThan(0.1);
    expect(seen[seen.length - 1]).toBe(1);
  });

  it("finishes a zero-length tween at once", async () => {
    const animator = new Animator();
    let value = -1;
    await animator.tween(0, (p) => (value = p));
    expect(value).toBe(1);
    expect(animator.active).toBe(0);
  });

  it("lets an async sequence run in order, each step starting when the last ends", async () => {
    const animator = new Animator();
    let now = 0;
    const when: Record<string, number> = {};
    const sequence = (async () => {
      await animator.wait(100);
      when["a"] = now;
      // Two waits in parallel: the sequence continues when the longer one ends.
      await Promise.all([animator.wait(50), animator.wait(150)]);
      when["b"] = now;
      await animator.wait(50);
      when["c"] = now;
    })();

    while (when["c"] === undefined && now < 2_000) {
      animator.step(FRAME_MS);
      now += FRAME_MS;
      for (let i = 0; i < 10; i++) await Promise.resolve();
    }
    await sequence;

    // Each wait can end up to a frame or two late, because time moves in whole frames.
    const slack = 2.5 * FRAME_MS;
    expect(when["a"]!).toBeGreaterThanOrEqual(100 - 1);
    expect(when["a"]!).toBeLessThan(100 + slack);
    expect(when["b"]! - when["a"]!).toBeGreaterThanOrEqual(150 - 1);
    expect(when["b"]! - when["a"]!).toBeLessThan(150 + slack);
    expect(when["c"]! - when["b"]!).toBeGreaterThanOrEqual(50 - 1);
    expect(when["c"]! - when["b"]!).toBeLessThan(50 + slack);
  });

  it("runs faster when sped up, and can be sped up mid-animation", async () => {
    const animator = new Animator();
    let done = false;
    void animator.wait(1_000).then(() => (done = true));
    await run(animator, 400);
    expect(done).toBe(false);
    animator.speed = 10;
    await run(animator, 100);
    expect(done).toBe(true);
  });

  it("treats a very long frame as a short one, so nothing jumps", async () => {
    const animator = new Animator();
    const seen: number[] = [];
    void animator.tween(1_000, (p) => seen.push(p));
    animator.step(5_000);
    expect(seen[seen.length - 1]!).toBeLessThanOrEqual(0.11);
  });

  it("finishes several tweens that end on the same frame", async () => {
    const animator = new Animator();
    const finished: number[] = [];
    for (let i = 0; i < 5; i++) void animator.wait(100).then(() => finished.push(i));
    await run(animator, 130);
    expect(finished.sort()).toEqual([0, 1, 2, 3, 4]);
    expect(animator.active).toBe(0);
  });
});
