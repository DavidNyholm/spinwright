import { describe, expect, it } from "vitest";
import { defineCascadeGame, playCascade, scatterCountDistribution, triggerProbability } from "../src/engine/cascade/index.ts";
import type { CascadeConfig } from "../src/engine/cascade/index.ts";
import { createRng } from "../src/engine/index.ts";
import { makeCascade } from "./cascadeFixtures.ts";

/**
 * A game small enough (2 columns x 2 rows) to solve exactly. The solver below is written
 * independently of the engine: it walks 2D arrays with plain loops and filters, and shares only the
 * config with the code it checks. It does not call the engine's cluster finder, refill or play loop.
 */
const TINY: CascadeConfig = defineCascadeGame({
  id: "tiny",
  name: "Tiny",
  columns: 2,
  rows: 2,
  weights: [
    { A: 2, B: 1, S: 1 },
    { A: 1, B: 2, S: 1 },
  ],
  pays: { A: { 2: 1, 3: 3, 4: 8 }, B: { 2: 2, 3: 4, 4: 9 } },
  minCluster: 2,
  units: 1,
  scatter: "S",
  feature: { trigger: 2, spins: 2, retrigger: null, maxSpins: 2, heatStep: null },
  heat: { start: 1, step: 1, max: 3 },
  maxWinMultiple: 1_000_000,
});

type Cell = "A" | "B" | "S";
type Grid = Cell[][]; // grid[column][row]
const CELLS: readonly Cell[] = ["A", "B", "S"];

const columnTotal = (config: CascadeConfig, column: number): number => Object.values(config.weights[column]!).reduce((a, b) => a + b, 0);
const chance = (config: CascadeConfig, column: number, cell: Cell): number => config.weights[column]![cell]! / columnTotal(config, column);

function payFor(config: CascadeConfig, cell: Cell, size: number): number {
  const table = config.pays[cell]!;
  let best = 0;
  for (const [key, value] of Object.entries(table)) if (Number(key) <= size) best = Math.max(best, value);
  // The largest key at or below the size wins, which for these ascending tables is the largest value.
  return best;
}

/** Every opening grid with its probability. */
function openings(config: CascadeConfig): { grid: Grid; probability: number }[] {
  const out: { grid: Grid; probability: number }[] = [];
  const total = config.columns * config.rows;
  for (let code = 0; code < CELLS.length ** total; code++) {
    const grid: Grid = Array.from({ length: config.columns }, () => []);
    let probability = 1;
    let rest = code;
    for (let column = 0; column < config.columns; column++) {
      for (let row = 0; row < config.rows; row++) {
        const cell = CELLS[rest % CELLS.length]!;
        rest = Math.floor(rest / CELLS.length);
        grid[column]!.push(cell);
        probability *= chance(config, column, cell);
      }
    }
    out.push({ grid, probability });
  }
  return out;
}

const gridKey = (grid: Grid): string => grid.map((column) => column.join("")).join("|");

/** Groups of at least minCluster, found by repeated label spreading: no flood fill. */
function groups(config: CascadeConfig, grid: Grid): [Cell, [number, number][]][] {
  const label = grid.map((column, c) => column.map((_, r) => c * config.rows + r));
  for (let changed = true; changed; ) {
    changed = false;
    for (let c = 0; c < config.columns; c++) {
      for (let r = 0; r < config.rows; r++) {
        if (grid[c]![r] === "S") continue;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nc >= config.columns || nr < 0 || nr >= config.rows || grid[nc]![nr] !== grid[c]![r]) continue;
          const low = Math.min(label[c]![r]!, label[nc]![nr]!);
          if (label[c]![r] !== low || label[nc]![nr] !== low) {
            label[c]![r] = label[nc]![nr] = low;
            changed = true;
          }
        }
      }
    }
  }
  const byLabel = new Map<number, [Cell, [number, number][]]>();
  for (let c = 0; c < config.columns; c++) {
    for (let r = 0; r < config.rows; r++) {
      const cell = grid[c]![r]!;
      if (cell === "S") continue;
      const entry = byLabel.get(label[c]![r]!) ?? [cell, []];
      entry[1].push([c, r]);
      byLabel.set(label[c]![r]!, entry);
    }
  }
  return [...byLabel.values()].filter(([, cells]) => cells.length >= config.minCluster);
}

interface Transition {
  /** Credits (in bet units) this state pays when evaluated at its heat. Zero for a state with no groups. */
  win: number;
  /** Heat once this step is over. */
  nextHeat: number;
  /** Where the cascade goes next, with probabilities; empty if the spin has ended. */
  next: { probability: number; grid: Grid }[];
}

function transition(config: CascadeConfig, grid: Grid, heat: number, heatStep: number): Transition {
  const found = groups(config, grid);
  if (found.length === 0) return { win: 0, nextHeat: heat, next: [] };

  const removed = grid.map((column) => column.map(() => false));
  let win = 0;
  for (const [cell, cells] of found) {
    win += payFor(config, cell, cells.length) * heat;
    for (const [c, r] of cells) removed[c]![r] = true;
  }

  // Survivors fall to the bottom of their column, in order; the top cells are refilled at random.
  const survivors = grid.map((column, c) => column.filter((_, r) => !removed[c]![r]));
  const holes = survivors.map((column) => config.rows - column.length);
  const next: Transition["next"] = [];
  const totalHoles = holes.reduce((a, b) => a + b, 0);
  for (let code = 0; code < CELLS.length ** totalHoles; code++) {
    let rest = code;
    let probability = 1;
    const filled: Grid = survivors.map((column, c) => {
      const fresh: Cell[] = [];
      for (let i = 0; i < holes[c]!; i++) {
        const cell = CELLS[rest % CELLS.length]!;
        rest = Math.floor(rest / CELLS.length);
        fresh.push(cell);
        probability *= chance(config, c, cell);
      }
      return [...fresh, ...column];
    });
    next.push({ probability, grid: filled });
  }
  return { win, nextHeat: Math.min(config.heat.max, heat + heatStep), next };
}

/**
 * Expected win of one spin plus whatever `afterSpin(endHeat)` is worth, for every (grid, heat),
 * by value iteration. A cascade can revisit a grid, so this solves the system rather than recursing.
 */
function solveSpin(config: CascadeConfig, afterSpin: (endHeat: number) => number, heatStep: number): Map<string, number> {
  const states: { key: string; heat: number; t: Transition }[] = [];
  for (const { grid } of openings(config)) {
    for (let heat = config.heat.start; heat <= config.heat.max; heat++) {
      states.push({ key: `${gridKey(grid)}@${heat}`, heat, t: transition(config, grid, heat, heatStep) });
    }
  }
  const value = new Map<string, number>(states.map((s) => [s.key, 0]));
  for (let sweep = 0; sweep < 5_000; sweep++) {
    let largestChange = 0;
    for (const { key, heat, t } of states) {
      const updated =
        t.next.length === 0
          ? afterSpin(heat)
          : t.win + t.next.reduce((sum, n) => sum + n.probability * value.get(`${gridKey(n.grid)}@${t.nextHeat}`)!, 0);
      largestChange = Math.max(largestChange, Math.abs(updated - value.get(key)!));
      value.set(key, updated);
    }
    if (largestChange < 1e-13) break;
  }
  return value;
}

/** The exact expected win per play, in bet units, for TINY (which pays 1 credit per unit at a unit bet of 1). */
function exactTinyValue(config: CascadeConfig): number {
  const feature = config.feature!;
  const opening = openings(config);
  const expectedOver = (values: Map<string, number>, heat: number) =>
    opening.reduce((sum, { grid, probability }) => sum + probability * values.get(`${gridKey(grid)}@${heat}`)!, 0);

  // Feature spins, solved from the last spin backwards: with k spins left, the value after a spin is
  // that of k - 1 spins left, starting from the heat the spin ended at.
  let remaining: (heat: number) => number = () => 0;
  for (let spinsLeft = 1; spinsLeft <= feature.spins; spinsLeft++) {
    const after = remaining;
    const values = solveSpin(config, after, feature.heatStep ?? config.heat.step);
    remaining = (heat) => expectedOver(values, heat);
  }
  const featureValue = remaining(config.heat.start);

  const base = solveSpin(config, () => 0, config.heat.step);
  const triggerChance = opening
    .filter(({ grid }) => grid.flat().filter((cell) => cell === "S").length >= feature.trigger)
    .reduce((sum, { probability }) => sum + probability, 0);
  return expectedOver(base, config.heat.start) + triggerChance * featureValue;
}

describe("exact solution of a tiny game", () => {
  it("has probabilities that add up, so the solver itself is sane", () => {
    expect(openings(TINY).reduce((sum, o) => sum + o.probability, 0)).toBeCloseTo(1, 12);
    const found = transition(TINY, [["A", "A"], ["A", "B"]], 1, 1);
    expect(found.next.reduce((sum, n) => sum + n.probability, 0)).toBeCloseTo(1, 12);
  });

  it("matches the engine's simulated average, feature and heat included", { timeout: 60_000 }, () => {
    const exact = exactTinyValue(TINY);
    expect(exact).toBeGreaterThan(0.2);

    const rng = createRng("tiny-exact");
    const plays = 1_500_000;
    let sum = 0;
    let sumSquares = 0;
    let features = 0;
    for (let i = 0; i < plays; i++) {
      const result = playCascade(TINY, rng, 1);
      sum += result.totalWin;
      sumSquares += result.totalWin * result.totalWin;
      if (result.feature !== null) features++;
    }
    const mean = sum / plays;
    const standardError = Math.sqrt((sumSquares / plays - mean * mean) / plays);
    expect(Math.abs(mean - exact) / standardError).toBeLessThan(4);
    // The feature has to be a real part of what was checked.
    expect(features / plays).toBeGreaterThan(0.2);
  });

  it("matches with the feature taken away", { timeout: 60_000 }, () => {
    const noFeature = defineCascadeGame({ ...TINY, feature: null });
    // No feature: only the base spin counts.
    const base = solveSpin(noFeature, () => 0, noFeature.heat.step);
    const exact = openings(noFeature).reduce((sum, { grid, probability }) => sum + probability * base.get(`${gridKey(grid)}@1`)!, 0);

    const rng = createRng("tiny-nofeature");
    const plays = 1_000_000;
    let sum = 0;
    let sumSquares = 0;
    for (let i = 0; i < plays; i++) {
      const win = playCascade(noFeature, rng, 1).totalWin;
      sum += win;
      sumSquares += win * win;
    }
    const mean = sum / plays;
    const standardError = Math.sqrt((sumSquares / plays - mean * mean) / plays);
    expect(Math.abs(mean - exact) / standardError).toBeLessThan(4);
  });
});

describe("scatter probabilities", () => {
  it("match a brute-force count over every grid of a small game", () => {
    const distribution = scatterCountDistribution(TINY);
    const brute = new Array<number>(5).fill(0);
    for (const { grid, probability } of openings(TINY)) brute[grid.flat().filter((cell) => cell === "S").length]! += probability;
    expect(distribution.length).toBe(5);
    distribution.forEach((p, count) => expect(p).toBeCloseTo(brute[count]!, 12));
    expect(distribution.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it("give the trigger probability for the toy game, confirmed by simulation", () => {
    const config = makeCascade();
    const exact = triggerProbability(config);
    const rng = createRng("trigger");
    const plays = 300_000;
    let triggered = 0;
    for (let i = 0; i < plays; i++) if (playCascade(config, rng, 1).feature !== null) triggered++;
    const fraction = triggered / plays;
    const standardError = Math.sqrt((exact * (1 - exact)) / plays);
    expect(Math.abs(fraction - exact) / standardError).toBeLessThan(4);
  });

  it("is zero for a game with no feature, and a certainty for a trigger of zero scatters' worth", () => {
    expect(triggerProbability(makeCascade({ feature: null }))).toBe(0);
    expect(scatterCountDistribution(makeCascade({ scatter: null, feature: null, weights: Array.from({ length: 4 }, () => ({ A: 4, B: 3, C: 2 })) }))).toEqual([1]);
  });
});
