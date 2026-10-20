import { describe, expect, it } from "vitest";
import { FEEL, ReelMotion } from "../src/ui/reelMotion.ts";
import type { MotionStart } from "../src/ui/reelMotion.ts";

const mod = (n: number, m: number): number => ((n % m) + m) % m;
const FRAME_MS = 1000 / 60;

interface Sample {
  now: number;
  position: number;
  shift: number;
  phase: string;
  speed: number;
}

/** Runs a reel from rest to landing at a fixed frame time, recording every frame. */
function simulate(options: Partial<MotionStart> & { stop: number }, frameMs = FRAME_MS) {
  const motion = new ReelMotion();
  const start: MotionStart = { position: 0, now: 0, spinMs: FEEL.minSpinMs, timeScale: 1, ...options };
  motion.start(start);
  const trace: Sample[] = [];
  let now = start.now;
  let landedAt: number | null = null;
  for (let i = 0; i < 5_000 && landedAt === null; i++) {
    now += frameMs;
    const landed = motion.step(now, frameMs / 1000);
    trace.push({ now, position: motion.position, shift: motion.shift, phase: motion.phase, speed: motion.speed });
    if (landed) landedAt = now;
  }
  return { motion, trace, landedAt };
}

describe("ReelMotion landing", () => {
  it.each([5, 32, 36, 100])("lands exactly on every stop of a strip of %i symbols", (length) => {
    for (let stop = 0; stop < length; stop++) {
      const { motion, landedAt } = simulate({ stop, position: (stop * 7) % length });
      expect(landedAt).not.toBeNull();
      expect(motion.phase).toBe("idle");
      expect(motion.position).toBe(stop);
      expect(motion.shift).toBe(0);
    }
  });

  it("re-aligns the strip so the stop's window is what the reel is heading for", () => {
    const length = 36;
    for (const stop of [0, 1, 17, 35]) {
      const { trace } = simulate({ stop, position: 11 });
      const firstGlide = trace.find((s) => s.phase === "gliding")!;
      // The reel will come to rest at this integer position; with the shift applied, that index shows `stop`.
      const target = Math.floor(firstGlide.position - FEEL.minTravel);
      expect(mod(target + firstGlide.shift, length)).toBe(stop);
    }
  });

  it("only ever moves down while spinning and gliding, then rolls back up by the overshoot at most", () => {
    const { trace } = simulate({ stop: 20, position: 3 });
    const beforeSettle = trace.filter((s) => s.phase === "spinning" || s.phase === "gliding");
    for (let i = 1; i < beforeSettle.length; i++) {
      expect(beforeSettle[i]!.position).toBeLessThanOrEqual(beforeSettle[i - 1]!.position + 1e-9);
    }
    // The frame where the glide ends is already labelled "settling", so take the lowest point over every moving frame.
    const settling = trace.filter((s) => s.phase === "settling");
    const lowest = Math.min(...trace.filter((s) => s.phase !== "idle").map((s) => s.position));
    for (const sample of settling) {
      expect(sample.position).toBeLessThanOrEqual(lowest + FEEL.overshoot + 1e-9);
      expect(sample.position).toBeGreaterThanOrEqual(lowest - 1e-9);
    }
  });

  it("starts landing at the speed it was spinning at, with no jolt", () => {
    const { trace } = simulate({ stop: 9, position: 0 });
    const firstGlideIndex = trace.findIndex((s) => s.phase === "gliding");
    const spinSpeed = trace[firstGlideIndex - 1]!.speed;
    const glideSpeed = trace[firstGlideIndex + 1]!.speed;
    expect(spinSpeed).toBeGreaterThan(FEEL.spinSpeed * 0.95);
    expect(Math.abs(glideSpeed - spinSpeed) / spinSpeed).toBeLessThan(0.1);
  });

  it("lands within a sensible time", () => {
    const { landedAt } = simulate({ stop: 12 });
    expect(landedAt!).toBeGreaterThan(FEEL.minSpinMs);
    expect(landedAt!).toBeLessThan(FEEL.minSpinMs + 1_500);
  });

  it("still lands exactly when frames are long (a slow device or a hiccup)", () => {
    for (const frameMs of [33, 100, 250]) {
      const { motion, landedAt } = simulate({ stop: 27, position: 4 }, frameMs);
      expect(landedAt).not.toBeNull();
      expect(motion.position).toBe(27);
    }
  });

  it("is faster in turbo", () => {
    const normal = simulate({ stop: 15 }).landedAt!;
    const turbo = simulate({ stop: 15, timeScale: FEEL.turboScale }).landedAt!;
    expect(turbo).toBeLessThan(normal * 0.6);
  });

  it("lands staggered reels in left-to-right order", () => {
    const landings = [0, 1, 2, 3, 4].map(
      (reel) => simulate({ stop: 10, spinMs: FEEL.minSpinMs + reel * FEEL.stopStaggerMs }).landedAt!,
    );
    for (let i = 1; i < landings.length; i++) expect(landings[i]!).toBeGreaterThan(landings[i - 1]!);
  });

  it("can be started again from where it landed", () => {
    const first = simulate({ stop: 8 });
    const motion = first.motion;
    motion.start({ position: motion.position, stop: 30, now: 0, spinMs: FEEL.minSpinMs, timeScale: 1 });
    let now = 0;
    let landed = false;
    for (let i = 0; i < 2_000 && !landed; i++) landed = motion.step((now += FRAME_MS), FRAME_MS / 1000);
    expect(landed).toBe(true);
    expect(motion.position).toBe(30);
  });
});

describe("ReelMotion quick stop", () => {
  it("lands soon after a quick stop requested mid-spin, exactly on the stop", () => {
    const motion = new ReelMotion();
    motion.start({ position: 5, stop: 21, now: 0, spinMs: FEEL.minSpinMs, timeScale: 1 });
    let now = 0;
    while (now < 300) motion.step((now += FRAME_MS), FRAME_MS / 1000);
    expect(motion.phase).toBe("spinning");

    const requestedAt = now;
    expect(motion.quickStop(now)).toBe(false);
    let landed = false;
    for (let i = 0; i < 600 && !landed; i++) landed = motion.step((now += FRAME_MS), FRAME_MS / 1000);
    expect(landed).toBe(true);
    expect(now - requestedAt).toBeLessThan(FEEL.quickStopMs * 2 + 5 * FRAME_MS);
    expect(motion.position).toBe(21);
    expect(motion.shift).toBe(0);
  });

  it("snaps to the stop if the reel is already landing", () => {
    const motion = new ReelMotion();
    motion.start({ position: 0, stop: 13, now: 0, spinMs: FEEL.minSpinMs, timeScale: 1 });
    let now = 0;
    while (motion.phase !== "gliding") motion.step((now += FRAME_MS), FRAME_MS / 1000);
    expect(motion.quickStop(now)).toBe(true);
    expect(motion.phase).toBe("idle");
    expect(motion.position).toBe(13);
  });

  it("does nothing to a reel at rest", () => {
    expect(new ReelMotion().quickStop(0)).toBe(false);
  });

  it("lands exactly on every stop when quick-stopped at any moment of the spin", () => {
    const length = 36;
    for (let stop = 0; stop < length; stop += 5) {
      for (const requestAt of [0, 100, 400, 690, 710, 900, 1100]) {
        const motion = new ReelMotion();
        motion.start({ position: stop, stop: (stop * 3) % length, now: 0, spinMs: FEEL.minSpinMs, timeScale: 1 });
        let now = 0;
        let landed = false;
        let requested = false;
        for (let i = 0; i < 3_000 && !landed; i++) {
          now += FRAME_MS;
          if (!requested && now >= requestAt) {
            requested = true;
            landed = motion.quickStop(now);
            if (landed) break;
          }
          landed = motion.step(now, FRAME_MS / 1000);
        }
        expect(motion.phase).toBe("idle");
        expect(motion.position).toBe((stop * 3) % length);
      }
    }
  });
});
