import { describe, expect, it } from "vitest";
import { ANTICIPATION_MS, planSpin } from "../src/ui/spinPlan.ts";
import { FEEL } from "../src/ui/reelMotion.ts";

/** A grid of one row per reel, from a string like "S.S..": S is a scatter. */
const grid = (pattern: string): string[][] => [...pattern].map((cell) => [cell === "S" ? "S" : "L1"]);
const staggered = (reels: number): number[] => Array.from({ length: reels }, (_, reel) => FEEL.minSpinMs + reel * FEEL.stopStaggerMs);

describe("planSpin", () => {
  it("stops the reels one stagger apart, left to right, when no feature is in sight", () => {
    const plan = planSpin(grid("....."), "S", 3);
    expect(plan.spinMs).toEqual(staggered(5));
    expect(plan.anticipating).toEqual([false, false, false, false, false]);
    expect(plan.scatters).toEqual([0, 0, 0, 0, 0]);
  });

  it("does not hold on after one scatter, because one more would still not be enough", () => {
    const plan = planSpin(grid("S...."), "S", 3);
    expect(plan.anticipating.some(Boolean)).toBe(false);
    expect(plan.spinMs).toEqual(staggered(5));
  });

  it("holds every later reel on once one more scatter would start the feature", () => {
    const plan = planSpin(grid("SS..."), "S", 3);
    expect(plan.anticipating).toEqual([false, false, true, true, true]);
    // Each holding reel stops a stagger and a hold after the one before it.
    expect(plan.spinMs[1]).toBe(FEEL.minSpinMs + FEEL.stopStaggerMs);
    expect(plan.spinMs[2]).toBe(plan.spinMs[1]! + FEEL.stopStaggerMs + ANTICIPATION_MS);
    expect(plan.spinMs[3]).toBe(plan.spinMs[2]! + FEEL.stopStaggerMs + ANTICIPATION_MS);
    expect(plan.spinMs[4]).toBe(plan.spinMs[3]! + FEEL.stopStaggerMs + ANTICIPATION_MS);
  });

  it("counts scatters wherever they are, not only side by side", () => {
    expect(planSpin(grid("S.S.."), "S", 3).anticipating).toEqual([false, false, false, true, true]);
    expect(planSpin(grid("S..S."), "S", 3).anticipating).toEqual([false, false, false, false, true]);
  });

  it("stops holding on once the feature is won", () => {
    const plan = planSpin(grid("SSS.."), "S", 3);
    expect(plan.anticipating).toEqual([false, false, true, false, false]);
    expect(plan.spinMs[3]).toBe(plan.spinMs[2]! + FEEL.stopStaggerMs);
  });

  it("counts two scatters on one reel as two", () => {
    const stacked = [["S", "S", "L1"], ["L1", "L1", "L1"], ["L1", "L1", "L1"], ["L1", "L1", "L1"], ["L1", "L1", "L1"]];
    const plan = planSpin(stacked, "S", 3);
    expect(plan.scatters).toEqual([2, 0, 0, 0, 0]);
    expect(plan.anticipating).toEqual([false, true, true, true, true]);
  });

  it("never holds on in a game with no feature to wait for", () => {
    expect(planSpin(grid("SSSSS"), "S", null).anticipating.some(Boolean)).toBe(false);
    expect(planSpin(grid("SS..."), null, null).scatters).toEqual([0, 0, 0, 0, 0]);
  });
});
