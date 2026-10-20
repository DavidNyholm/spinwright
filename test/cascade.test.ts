import { describe, expect, it } from "vitest";
import {
  CascadeConfigError,
  columnFall,
  compileCascade,
  defineCascadeGame,
  drawPiece,
  findCascadeConfigProblems,
  findClusters,
  playCascade,
  removeAndRefill,
  toSymbolGrid,
} from "../src/engine/cascade/index.ts";
import type { CascadeConfig, CascadeResult, CompiledCascade } from "../src/engine/cascade/index.ts";
import { createRng, nextInt } from "../src/engine/index.ts";
import { makeCascade, rawCascade, TOY } from "./cascadeFixtures.ts";

/** Builds a grid from rows of text, top row first, one character per piece id (see `chars`). */
function gridFromRows(game: CompiledCascade, rowsText: readonly string[], chars: Readonly<Record<string, string>>): Uint8Array {
  const { columns, rows } = game.config;
  const grid = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const symbol = chars[rowsText[row]![column]!]!;
      grid[column * rows + row] = game.symbols.indexOf(symbol);
    }
  }
  return grid;
}

/** Cluster cells as "column,row" strings, each cluster sorted, and the clusters sorted: a canonical form to compare. */
function canonical(clusters: readonly (readonly string[])[]): string[] {
  return clusters.map((cluster) => [...cluster].sort().join(" ")).sort();
}

function engineClusters(game: CompiledCascade, grid: Uint8Array): string[] {
  const { rows } = game.config;
  return canonical(findClusters(game, grid).map((cluster) => cluster.cells.map((cell) => `${Math.floor(cell / rows)},${cell % rows}`)));
}

/**
 * A deliberately naive, independent cluster finder: every cell starts with its own label and the
 * smaller label spreads across same-piece neighbours until nothing changes. No flood fill, no stack.
 */
function naiveClusters(symbolGrid: readonly (readonly string[])[], scatter: string | null, minSize: number): string[] {
  const columns = symbolGrid.length;
  const rows = symbolGrid[0]!.length;
  const label = symbolGrid.map((column, c) => column.map((_, r) => c * rows + r));
  for (let changed = true; changed; ) {
    changed = false;
    for (let c = 0; c < columns; c++) {
      for (let r = 0; r < rows; r++) {
        if (symbolGrid[c]![r] === scatter) continue;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nc >= columns || nr < 0 || nr >= rows) continue;
          if (symbolGrid[nc]![nr] !== symbolGrid[c]![r]) continue;
          const smaller = Math.min(label[c]![r]!, label[nc]![nr]!);
          if (label[c]![r] !== smaller || label[nc]![nr] !== smaller) {
            label[c]![r] = smaller;
            label[nc]![nr] = smaller;
            changed = true;
          }
        }
      }
    }
  }
  const groups = new Map<number, string[]>();
  for (let c = 0; c < columns; c++) {
    for (let r = 0; r < rows; r++) {
      if (symbolGrid[c]![r] === scatter) continue;
      const key = label[c]![r]!;
      groups.set(key, [...(groups.get(key) ?? []), `${c},${r}`]);
    }
  }
  return canonical([...groups.values()].filter((cells) => cells.length >= minSize));
}

describe("defineCascadeGame", () => {
  it("accepts the toy game and freezes it", () => {
    const game = makeCascade();
    expect(Object.isFrozen(game)).toBe(true);
    expect(Object.isFrozen(game.weights[0])).toBe(true);
  });

  const cases: [string, Partial<CascadeConfig>, RegExp][] = [
    ["zero columns", { columns: 0 }, /columns must be a positive integer/],
    ["a missing column of weights", { weights: [{ A: 1, B: 1, S: 1 }] }, /expected one per column/],
    ["a zero weight", { weights: Array.from({ length: 4 }, () => ({ A: 0, B: 1, C: 1, S: 1 })) }, /must be a positive integer/],
    ["a fractional weight", { weights: Array.from({ length: 4 }, () => ({ A: 1.5, B: 1, C: 1, S: 1 })) }, /must be a positive integer/],
    ["an empty column", { weights: [{}, {}, {}, {}] }, /has no pieces/],
    ["a minimum cluster of one", { minCluster: 1 }, /minCluster must be an integer/],
    ["a minimum cluster bigger than the grid", { minCluster: 13 }, /minCluster must be an integer/],
    ["zero units", { units: 0 }, /units must be a positive integer/],
    ["a scatter in no column", { scatter: "Q" }, /scatter "Q" is in no column/],
    ["pays for an unknown piece", { pays: { ...TOY.pays, Z: { 3: 1 } } }, /"Z".*no column/],
    ["pays for the scatter", { pays: { ...TOY.pays, S: { 3: 1 } } }, /scatter must not have cluster pays/],
    ["a piece with no pays entry", { pays: { A: TOY.pays["A"]!, B: TOY.pays["B"]! } }, /piece "C" needs a pays entry/],
    ["a piece paying nothing at the smallest size", { pays: { ...TOY.pays, C: { 6: 5 } } }, /pays nothing at the smallest cluster size/],
    ["a fractional pay", { pays: { ...TOY.pays, A: { 3: 1.5 } } }, /non-negative integer/],
    ["a pay size beyond the grid", { pays: { ...TOY.pays, A: { 3: 1, 13: 5 } } }, /size "13"/],
    ["a feature with no scatter", { scatter: null, pays: TOY.pays, weights: Array.from({ length: 4 }, () => ({ A: 4, B: 3, C: 2 })) }, /feature needs a scatter/],
    ["a feature that cannot be triggered by the grid", { feature: { trigger: 13, spins: 3, retrigger: null, maxSpins: 8, heatStep: null } }, /trigger must be an integer/],
    ["a feature whose limit is below its spins", { feature: { trigger: 2, spins: 5, retrigger: null, maxSpins: 3, heatStep: null } }, /maxSpins must be an integer at least/],
    ["a zero feature heat step", { feature: { trigger: 2, spins: 3, retrigger: null, maxSpins: 8, heatStep: 0 } }, /feature.heatStep/],
    ["a heat maximum below its start", { heat: { start: 3, step: 1, max: 2 } }, /heat.max/],
    ["a zero heat step", { heat: { start: 1, step: 0, max: 4 } }, /heat.step/],
    ["no win cap", { maxWinMultiple: 0 }, /maxWinMultiple must be a positive integer/],
  ];

  it.each(cases)("flags %s", (_name, overrides, expected) => {
    const problems = findCascadeConfigProblems(rawCascade(overrides));
    expect(problems.some((problem) => expected.test(problem))).toBe(true);
  });

  it("lists every problem at once", () => {
    const error = (() => {
      try {
        defineCascadeGame(rawCascade({ units: 0, minCluster: 1, maxWinMultiple: 0 }));
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(CascadeConfigError);
    expect((error as CascadeConfigError).problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe("findClusters", () => {
  const game = compileCascade(makeCascade());
  const chars = { a: "A", b: "B", c: "C", s: "S" };
  // The toy grid is 4 columns x 3 rows and the smallest cluster is 3. Each grid below was checked by hand.
  const find = (rowsText: string[]) => engineClusters(game, gridFromRows(game, rowsText, chars));

  it("finds a row of three", () => {
    expect(find(["aaab", "bcbc", "cbcb"])).toEqual(canonical([["0,0", "1,0", "2,0"]]));
  });

  it("does not join diagonal neighbours", () => {
    // The three A pieces touch only at corners.
    expect(find(["abcb", "cabc", "bcab"])).toEqual([]);
  });

  it("joins up, down, left and right through a corner", () => {
    // An L of five A pieces down the left edge and along the bottom.
    expect(find(["abcb", "acbc", "aaac"])).toEqual(canonical([["0,0", "0,1", "0,2", "1,2", "2,2"]]));
  });

  it("ignores groups below the minimum size", () => {
    // Every piece is in a pair, none in a group of three.
    expect(find(["aabb", "bbaa", "ccbb"])).toEqual([]);
  });

  it("reports separate groups separately, including two of the same piece", () => {
    // Four columns, each a group of three; the two A columns are kept apart by the others.
    expect(find(["abca", "abca", "abca"])).toEqual(
      canonical([
        ["0,0", "0,1", "0,2"],
        ["1,0", "1,1", "1,2"],
        ["2,0", "2,1", "2,2"],
        ["3,0", "3,1", "3,2"],
      ]),
    );
  });

  it("never lets the scatter form a group", () => {
    expect(find(["ssss", "sssa", "cbcb"])).toEqual([]);
  });

  it("treats a grid of one piece as a single group", () => {
    const everyCell = Array.from({ length: 12 }, (_, i) => `${Math.floor(i / 3)},${i % 3}`);
    expect(find(["aaaa", "aaaa", "aaaa"])).toEqual(canonical([everyCell]));
  });

  it("agrees with an independent naive finder on thousands of random grids", () => {
    const rng = createRng("cluster-differential");
    for (const [columns, rows, minCluster] of [[4, 3, 3], [6, 5, 5], [5, 5, 4], [3, 3, 2]] as const) {
      const config = makeCascade({
        columns,
        rows,
        minCluster,
        // Every group of at least minCluster must pay, so the pay tables start at that size.
        pays: { A: { [minCluster]: 1 }, B: { [minCluster]: 1 }, C: { [minCluster]: 1 } },
        weights: Array.from({ length: columns }, () => ({ A: 5, B: 4, C: 3, S: 1 })),
        feature: { trigger: 2, spins: 3, retrigger: null, maxSpins: 8, heatStep: null },
      });
      const compiled = compileCascade(config);
      const grid = new Uint8Array(columns * rows);
      let withClusters = 0;
      for (let trial = 0; trial < 3_000; trial++) {
        for (let i = 0; i < grid.length; i++) grid[i] = nextInt(rng, compiled.symbols.length);
        const expected = naiveClusters(toSymbolGrid(compiled, grid), "S", minCluster);
        if (expected.length > 0) withClusters++;
        expect(engineClusters(compiled, grid)).toEqual(expected);
      }
      // The comparison is only meaningful if grids with clusters really occurred.
      expect(withClusters).toBeGreaterThan(300);
    }
  });
});

describe("removeAndRefill", () => {
  const game = compileCascade(makeCascade());
  const rows = game.config.rows;

  it("describes a column's fall: survivors drop, new pieces fill the top", () => {
    // Rows 1 and 3 removed: the survivor at row 4 stays, row 2 drops to 3, row 0 drops to 2, and two new pieces fill rows 0 and 1.
    expect(columnFall([false, true, false, true, false])).toEqual({ moves: [{ from: 2, to: 3 }, { from: 0, to: 2 }], spawned: 2 });
    expect(columnFall([false, false, false])).toEqual({ moves: [], spawned: 0 });
    expect(columnFall([true, true, true])).toEqual({ moves: [], spawned: 3 });
  });

  it("moves survivors exactly as columnFall says and draws the new pieces in the documented order", () => {
    const seedRng = createRng("fall");
    for (let trial = 0; trial < 500; trial++) {
      const grid = new Uint8Array(game.cells);
      for (let i = 0; i < grid.length; i++) grid[i] = nextInt(seedRng, game.symbols.length);
      const before = Uint8Array.from(grid);

      // Remove a random set of cells by presenting them as one fake cluster.
      const cells = Array.from({ length: game.cells }, (_, i) => i).filter(() => nextInt(seedRng, 3) === 0);
      const seed = `refill-${trial}`;
      removeAndRefill(game, createRng(seed), grid, [{ symbol: 0, cells }]);

      // Replay it by hand: survivors per columnFall, then new pieces drawn column by column, top down.
      const replayRng = createRng(seed);
      const expected = new Uint8Array(game.cells);
      for (let column = 0; column < game.config.columns; column++) {
        const removedFlags = Array.from({ length: rows }, (_, row) => cells.includes(column * rows + row));
        const fall = columnFall(removedFlags);
        const survivors = new Set(fall.moves.map((m) => m.from));
        for (let row = 0; row < rows; row++) {
          if (!removedFlags[row] && !survivors.has(row)) expected[column * rows + row] = before[column * rows + row]!;
        }
        for (const move of fall.moves) expected[column * rows + move.to] = before[column * rows + move.from]!;
        for (let row = 0; row < fall.spawned; row++) expected[column * rows + row] = drawPiece(game, replayRng, column);
      }
      expect(Array.from(grid)).toEqual(Array.from(expected));
    }
  });
});

/** Checks every rule a finished play must obey. Returns a description of the first broken rule, or null. */
function brokenRule(config: CascadeConfig, result: CascadeResult): string | null {
  const cells = config.columns * config.rows;
  const cap = config.maxWinMultiple * result.totalBet;
  const rounds = [result.base, ...(result.feature ?? [])];

  let total = 0;
  for (const [index, round] of rounds.entries()) {
    let roundWin = 0;
    let heat = round.startHeat;
    // The feature may heat faster than the base game.
    const heatStep = index === 0 ? config.heat.step : (config.feature?.heatStep ?? config.heat.step);
    for (const [stepIndex, step] of round.steps.entries()) {
      if (step.grid.length !== config.columns || step.grid.some((column) => column.length !== config.rows)) return "grid size changed";
      if (step.grid.flat().length !== cells) return "pieces were lost or created";
      if (step.heat !== heat) return `step heat ${step.heat}, expected ${heat}`;
      if (step.clusters.length === 0) return "a winning step with no clusters";
      const found = naiveClusters(step.grid, config.scatter, config.minCluster);
      const reported = canonical(step.clusters.map((cluster) => cluster.cells.map(([c, r]) => `${c},${r}`)));
      if (JSON.stringify(found) !== JSON.stringify(reported)) return "a step's clusters differ from the naive finder's";
      const clusterTotal = step.clusters.reduce((sum, cluster) => sum + cluster.win, 0);
      const isCappedStep = round.capped && stepIndex === round.steps.length - 1;
      if (!isCappedStep && clusterTotal !== step.win) return "step win is not the sum of its clusters";
      if (isCappedStep && step.win > clusterTotal) return "a capped step paid more than its clusters";
      for (const cluster of step.clusters) {
        if (cluster.size !== cluster.cells.length) return "cluster size does not match its cells";
        if (cluster.size < config.minCluster) return "a cluster below the minimum";
        if (cluster.win % result.unitBet !== 0) return "a cluster win that is not whole units";
      }
      roundWin += step.win;
      heat = Math.min(config.heat.max, heat + heatStep);
    }
    if (roundWin !== round.win) return `round win ${round.win} != sum of steps ${roundWin}`;
    if (round.stepCount !== round.steps.length) return "stepCount does not match steps";
    if (round.endHeat !== heat && !round.capped) return `endHeat ${round.endHeat}, expected ${heat}`;
    if (!round.capped) {
      // A finished spin ends on a grid with nothing left to win.
      if (naiveClusters(round.finalGrid!, config.scatter, config.minCluster).length > 0) return "a finished spin left a winning group";
    }
    const openingScatters = round.openingGrid!.flat().filter((symbol) => symbol === config.scatter).length;
    if (openingScatters !== round.scatters) return "scatter count does not match the opening grid";
    if (index === 0 && round.startHeat !== config.heat.start) return "base spin did not start at the start heat";
    if (index === 1 && round.startHeat !== config.heat.start) return "feature did not start at the start heat";
    if (index > 1 && round.startHeat !== rounds[index - 1]!.endHeat) return "heat was not carried between feature spins";
    total += round.win;
  }

  if (total !== result.totalWin) return `totalWin ${result.totalWin} != sum of rounds ${total}`;
  if (result.totalWin > cap) return "won more than the cap";
  if (result.capped && result.totalWin !== cap) return "capped but not at the cap";
  if (result.totalBet !== result.unitBet * config.units) return "totalBet is not unitBet x units";

  const feature = config.feature;
  if (feature !== null) {
    const shouldTrigger = result.base.scatters >= feature.trigger && !result.base.capped;
    if ((result.feature !== null) !== shouldTrigger) return "feature triggered wrongly";
    if (result.feature !== null) {
      // Replay the spin count from each spin's scatters: it must end exactly when the spins run out.
      let spinsLeft = feature.spins;
      let played = 0;
      for (const round of result.feature) {
        played++;
        spinsLeft--;
        if (feature.retrigger !== null && round.scatters >= feature.retrigger.count) {
          spinsLeft = Math.min(spinsLeft + feature.retrigger.spins, feature.maxSpins - played);
        }
      }
      if (played > feature.maxSpins) return "feature ran past its spin limit";
      if (!result.capped && spinsLeft !== 0) return "feature ended with spins left, or ran past its spins";
    }
  }
  return null;
}

describe("playCascade", () => {
  it("obeys every rule over thousands of plays, with every grid and step recorded", () => {
    const config = makeCascade();
    const rng = createRng("play-invariants");
    let featurePlays = 0;
    let longCascades = 0;
    let retriggers = 0;
    for (let play = 0; play < 4_000; play++) {
      const result = playCascade(config, rng, 1 + (play % 3), { record: true });
      const broken = brokenRule(config, result);
      if (broken !== null) throw new Error(`play ${play}: ${broken}`);
      if (result.feature !== null) featurePlays++;
      if (result.base.stepCount >= 3) longCascades++;
      if (result.feature !== null && result.feature.length > config.feature!.spins) retriggers++;
    }
    // These rules only mean something if the interesting cases actually occurred.
    expect(featurePlays).toBeGreaterThan(200);
    expect(longCascades).toBeGreaterThan(50);
    expect(retriggers).toBeGreaterThan(10);
  });

  it("is reproducible from a seed, with or without recording", () => {
    const config = makeCascade();
    const run = (record: boolean) => {
      const rng = createRng("repeat");
      return Array.from({ length: 200 }, () => playCascade(config, rng, 2, { record }).totalWin);
    };
    expect(run(false)).toEqual(run(true));
    expect(run(true)).toEqual(run(true));
  });

  it("never wins more than the cap, and stops exactly at it", () => {
    const config = makeCascade({ maxWinMultiple: 3 });
    const rng = createRng("cap");
    let cappedPlays = 0;
    for (let play = 0; play < 3_000; play++) {
      const result = playCascade(config, rng, 1, { record: true });
      expect(result.totalWin).toBeLessThanOrEqual(3 * result.totalBet);
      expect(brokenRule(config, result)).toBeNull();
      if (result.capped) {
        cappedPlays++;
        expect(result.totalWin).toBe(3 * result.totalBet);
      }
    }
    expect(cappedPlays).toBeGreaterThan(20);
  });

  it("caps the heat at its maximum", () => {
    const config = makeCascade({ heat: { start: 1, step: 2, max: 5 } });
    const rng = createRng("heat");
    let sawMax = false;
    for (let play = 0; play < 3_000; play++) {
      const result = playCascade(config, rng, 1, { record: true });
      for (const round of [result.base, ...(result.feature ?? [])]) {
        for (const step of round.steps) {
          expect(step.heat).toBeLessThanOrEqual(5);
          if (step.heat === 5) sawMax = true;
        }
      }
    }
    expect(sawMax).toBe(true);
  });

  it("heats faster in the feature when the game says so, and not in the base game", () => {
    const config = makeCascade({
      feature: { trigger: 2, spins: 3, retrigger: { count: 2, spins: 2 }, maxSpins: 8, heatStep: 3 },
      heat: { start: 1, step: 1, max: 50 },
    });
    const rng = createRng("feature-heat-step");
    const baseHeats = new Set<number>();
    const featureHeats = new Set<number>();
    for (let play = 0; play < 3_000; play++) {
      const result = playCascade(config, rng, 1, { record: true });
      expect(brokenRule(config, result)).toBeNull();
      for (const step of result.base.steps) baseHeats.add(step.heat);
      for (const round of result.feature ?? []) for (const step of round.steps) featureHeats.add(step.heat);
    }
    // Base heat goes 1, 2, 3...; feature heat goes 1, 4, 7... within a spin and carries on across spins.
    expect(baseHeats.has(2)).toBe(true);
    expect(featureHeats.has(4)).toBe(true);
    expect(featureHeats.has(2)).toBe(false);
  });

  it("works for a game with no feature", () => {
    const config = makeCascade({ feature: null });
    const rng = createRng("nofeature");
    for (let play = 0; play < 500; play++) {
      const result = playCascade(config, rng, 1, { record: true });
      expect(result.feature).toBeNull();
      expect(brokenRule(config, result)).toBeNull();
    }
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects a unit bet of %s", (unitBet) => {
    expect(() => playCascade(makeCascade(), createRng("x"), unitBet)).toThrow(RangeError);
  });
});
