import { describe, expect, it } from "vitest";
import { buildGrid, createRng, spin, spinFromStops } from "../src/engine/index.ts";
import { makeGame } from "./fixtures.ts";

// Distinct symbols per position so the window is easy to read off.
const STRIP = ["a", "b", "c", "d", "e"];
const windowGame = makeGame({
  strips: Array.from({ length: 5 }, () => STRIP),
  paylines: [[0, 0, 0, 0, 0], [1, 1, 1, 1, 1]],
  pays: { a: { 3: 1 } },
  wild: null,
  scatter: null,
});

describe("buildGrid", () => {
  it("shows `rows` symbols from each stop, reading down the strip", () => {
    const grid = buildGrid(windowGame, [0, 1, 2, 0, 1]);
    expect(grid[0]).toEqual(["a", "b", "c"]);
    expect(grid[1]).toEqual(["b", "c", "d"]);
    expect(grid[2]).toEqual(["c", "d", "e"]);
  });

  it("wraps from the end of the strip to its start", () => {
    const grid = buildGrid(windowGame, [3, 4, 0, 0, 0]);
    expect(grid[0]).toEqual(["d", "e", "a"]);
    expect(grid[1]).toEqual(["e", "a", "b"]);
  });

  it("indexes each reel's own strip", () => {
    const mixed = makeGame({
      strips: [["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"], ["j", "k", "l"], ["m", "n", "o"]],
      pays: { a: { 3: 1 } },
      wild: null,
      scatter: null,
    });
    expect(buildGrid(mixed, [0, 1, 2, 0, 1]).map((column) => column[0])).toEqual(["a", "e", "i", "j", "n"]);
  });
});

describe("spinFromStops", () => {
  it("resolves a forced outcome", () => {
    const strips = [["A", "B", "C"], ["A", "B", "C"], ["A", "B", "C"], ["A", "B", "C"], ["A", "B", "C"]];
    const forced = makeGame({
      strips,
      pays: { A: { 3: 5, 4: 20, 5: 100 }, B: { 3: 2 }, C: { 3: 1 } },
      wild: null,
      scatter: null,
    });
    // The single payline is the middle row. These stops leave B C A B C there: no run, no win.
    const quiet = spinFromStops(forced, [0, 1, 2, 0, 1], 3);
    expect(quiet.grid[0]).toEqual(["A", "B", "C"]);
    expect(quiet.lineWins).toEqual([]);
    expect(quiet.totalWin).toBe(0);
    expect(quiet.totalBet).toBe(3);

    // Stop 2 shows C A B, so the middle row is A on every reel: five of a kind.
    const winning = spinFromStops(forced, [2, 2, 2, 2, 2], 3);
    expect(winning.grid[0]).toEqual(["C", "A", "B"]);
    expect(winning.lineWins).toHaveLength(1);
    expect(winning.lineWins[0]).toMatchObject({ symbol: "A", count: 5, multiplier: 100, win: 300 });
    expect(winning.totalWin).toBe(300);
  });

  it("scales totalBet with the number of paylines", () => {
    expect(spinFromStops(windowGame, [0, 0, 0, 0, 0], 4).totalBet).toBe(8);
  });

  it("copies the stops so the caller cannot change the result afterwards", () => {
    const stops = [0, 0, 0, 0, 0];
    const result = spinFromStops(windowGame, stops, 1);
    stops[0] = 4;
    expect(result.stops[0]).toBe(0);
  });

  it.each([
    ["too few stops", [0, 0, 0, 0]],
    ["too many stops", [0, 0, 0, 0, 0, 0]],
    ["a negative stop", [-1, 0, 0, 0, 0]],
    ["a stop past the strip end", [0, 0, 0, 0, 5]],
    ["a fractional stop", [0.5, 0, 0, 0, 0]],
    ["a NaN stop", [Number.NaN, 0, 0, 0, 0]],
  ])("rejects %s", (_name, stops) => {
    expect(() => spinFromStops(windowGame, stops, 1)).toThrow(RangeError);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects a line bet of %s", (lineBet) => {
    expect(() => spinFromStops(windowGame, [0, 0, 0, 0, 0], lineBet)).toThrow(RangeError);
  });
});

describe("spin", () => {
  it("is reproducible from a seed", () => {
    const run = (seed: string) => {
      const rng = createRng(seed);
      return Array.from({ length: 50 }, () => spin(windowGame, rng, 1));
    };
    expect(run("same")).toEqual(run("same"));
    expect(run("same")).not.toEqual(run("other"));
  });

  it("can stop on every position of every reel, and only on those", () => {
    const rng = createRng("coverage");
    const seen = windowGame.strips.map(() => new Set<number>());
    for (let i = 0; i < 2_000; i++) {
      spin(windowGame, rng, 1).stops.forEach((stop, reel) => seen[reel]!.add(stop));
    }
    for (const stops of seen) expect([...stops].sort()).toEqual([0, 1, 2, 3, 4]);
  });
});
