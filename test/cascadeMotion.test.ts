import { describe, expect, it } from "vitest";
import { createRng, nextInt } from "../src/engine/index.ts";
import { dropY, FALL, fallDuration, planDropIn, planRefill } from "../src/ui/cascadeMotion.ts";
import type { BoardGeometry, Drop } from "../src/ui/cascadeMotion.ts";

// The Crucible board: pieces 108 high on a 114 step, so neighbours have 6 units of air between them.
const CELL = 108;
const GEOMETRY: BoardGeometry = { columns: 6, rows: 5, step: 114, top: 135 };
/** Pieces may touch by a hair as they bounce; anything deeper would be visible. */
const TOLERANCE = 2;

/**
 * The deepest any piece sinks into the one above it in the same column, over the whole animation,
 * counting pieces that are waiting to fall and survivors that never move.
 */
function worstOverlap(drops: readonly Drop[], resting: readonly { column: number; row: number }[], bounce: number): number {
  const end = Math.max(...drops.map((d) => d.delayMs + d.durationMs)) + 20;
  let worst = -Infinity;
  for (let t = 0; t <= end; t += 2) {
    const byColumn = new Map<number, number[]>();
    for (const drop of drops) byColumn.set(drop.column, [...(byColumn.get(drop.column) ?? []), dropY(drop, t, bounce)]);
    for (const { column, row } of resting) byColumn.set(column, [...(byColumn.get(column) ?? []), GEOMETRY.top + row * GEOMETRY.step]);
    for (const ys of byColumn.values()) {
      ys.sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) worst = Math.max(worst, CELL - (ys[i]! - ys[i - 1]!));
    }
  }
  return worst;
}

function randomRemoval(rng: ReturnType<typeof createRng>, density: number): boolean[][] {
  return Array.from({ length: GEOMETRY.columns }, () => Array.from({ length: GEOMETRY.rows }, () => nextInt(rng, 100) < density));
}

/** The pieces that survive a removal and stay exactly where they are. */
function stationary(removed: readonly (readonly boolean[])[], drops: readonly Drop[]): { column: number; row: number }[] {
  const out: { column: number; row: number }[] = [];
  for (let column = 0; column < GEOMETRY.columns; column++) {
    for (let row = 0; row < GEOMETRY.rows; row++) {
      if (removed[column]![row]) continue;
      if (!drops.some((d) => d.column === column && (d.fromRow === row || (d.fromRow === null && d.toRow === row)))) out.push({ column, row });
    }
  }
  return out;
}

describe("a whole new fill dropping in", () => {
  const drops = planDropIn(GEOMETRY);

  it("brings a piece for every cell, each landing in its own cell", () => {
    expect(drops).toHaveLength(GEOMETRY.columns * GEOMETRY.rows);
    const cells = new Set(drops.map((d) => `${d.column},${d.toRow}`));
    expect(cells.size).toBe(drops.length);
    for (const drop of drops) {
      expect(dropY(drop, drop.delayMs + drop.durationMs)).toBeCloseTo(drop.toY, 9);
      expect(drop.fromY).toBeLessThan(GEOMETRY.top - GEOMETRY.step); // it starts above the board
    }
  });

  it("never lets a piece fall into the one beneath it", () => {
    expect(worstOverlap(drops, [], FALL.bounce)).toBeLessThanOrEqual(TOLERANCE);
  });
});

describe("pieces falling after a removal", () => {
  it("never overlap, whichever cells vanish (thousands of random boards, any density)", () => {
    const rng = createRng("refill-motion");
    let compared = 0;
    for (let trial = 0; trial < 1_500; trial++) {
      const density = [8, 20, 35, 60, 90][trial % 5]!;
      const removed = randomRemoval(rng, density);
      const drops = planRefill(GEOMETRY, removed);
      const overlap = worstOverlap(drops, stationary(removed, drops), FALL.bounce);
      if (overlap > TOLERANCE) throw new Error(`trial ${trial} (density ${density}): pieces overlap by ${overlap.toFixed(1)}`);
      compared += drops.length;
    }
    expect(compared).toBeGreaterThan(10_000);
  });

  it("puts every moving piece exactly on its landing cell, and every vanished cell is refilled", () => {
    const rng = createRng("refill-landing");
    for (let trial = 0; trial < 300; trial++) {
      const removed = randomRemoval(rng, 40);
      const drops = planRefill(GEOMETRY, removed);
      for (const drop of drops) expect(dropY(drop, drop.delayMs + drop.durationMs + 5)).toBeCloseTo(drop.toY, 9);
      for (let column = 0; column < GEOMETRY.columns; column++) {
        const spawned = drops.filter((d) => d.column === column && d.fromRow === null).length;
        expect(spawned).toBe(removed[column]!.filter(Boolean).length);
      }
    }
  });

  it("only ever moves survivors down", () => {
    const rng = createRng("refill-direction");
    for (let trial = 0; trial < 300; trial++) {
      for (const drop of planRefill(GEOMETRY, randomRemoval(rng, 40))) expect(drop.toY).toBeGreaterThan(drop.fromY);
    }
  });

  it("has teeth: the checker flags a bounce that grows with the fall, which is the bug it was written for", () => {
    // A rebound of 6% of the whole fall (about 41 units for a six-row drop) pushed pieces 30 units into the one above.
    const drops = planDropIn(GEOMETRY);
    const proportional = drops.map((drop) => ({ ...drop }));
    const deepBounce = 0.06 * 6 * GEOMETRY.step;
    expect(worstOverlap(proportional, [], deepBounce)).toBeGreaterThan(15);
  });
});

describe("fall timing", () => {
  it("takes longer for a longer fall, but not in proportion", () => {
    const one = fallDuration(114, 114);
    const four = fallDuration(4 * 114, 114);
    expect(four).toBeGreaterThan(one);
    expect(four).toBeLessThan(4 * one);
  });
});
