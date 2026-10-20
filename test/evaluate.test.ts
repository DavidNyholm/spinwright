import { describe, expect, it } from "vitest";
import { evaluateGrid, evaluateLine } from "../src/engine/index.ts";
import { makeGame } from "./fixtures.ts";

const game = makeGame();
const line = (text: string) => evaluateLine(game, text.split(" "));

describe("evaluateLine", () => {
  it("pays 3, 4 and 5 of a kind from the left", () => {
    expect(line("A A A B C")).toEqual({ symbol: "A", count: 3, multiplier: 5 });
    expect(line("A A A A B")).toEqual({ symbol: "A", count: 4, multiplier: 20 });
    expect(line("A A A A A")).toEqual({ symbol: "A", count: 5, multiplier: 100 });
  });

  it("does not pay a run shorter than the smallest paytable count", () => {
    expect(line("A A B B B")).toBeNull();
    expect(line("A B A A A")).toBeNull();
  });

  it("only pays runs that start on the first reel", () => {
    expect(line("B A A A A")).toBeNull();
  });

  it("pays a count between table entries at the lower entry", () => {
    // C has only a 3-of-a-kind entry, so 4 and 5 of a kind pay that entry.
    expect(line("C C C C B")).toEqual({ symbol: "C", count: 4, multiplier: 1 });
  });

  it("lets the wild substitute inside and after a run", () => {
    expect(line("A W A B B")).toEqual({ symbol: "A", count: 3, multiplier: 5 });
    expect(line("A A W W W")).toEqual({ symbol: "A", count: 5, multiplier: 100 });
  });

  it("lets leading wilds take the identity of the first real symbol", () => {
    expect(line("W W A A B")).toEqual({ symbol: "A", count: 4, multiplier: 20 });
    expect(line("W B B C C")).toEqual({ symbol: "B", count: 3, multiplier: 2 });
  });

  it("ends a run at the scatter and never starts one with it", () => {
    expect(line("A A S A A")).toBeNull();
    expect(line("S A A A A")).toBeNull();
    expect(line("W W S A A")).toBeNull();
  });

  it("pays nothing for a symbol with no paytable entry", () => {
    expect(line("D D D D D")).toBeNull();
  });

  it("pays a line of all wilds as the wild's own table, which is empty here", () => {
    expect(line("W W W W W")).toBeNull();
  });

  describe("with a wild that has its own paytable", () => {
    const wildPays = makeGame({
      pays: { A: { 3: 5, 4: 20, 5: 100 }, B: { 3: 2, 4: 8, 5: 10 }, C: { 3: 1 }, W: { 3: 50, 5: 500 } },
    });

    it("takes the wild's own payout when it beats the substituted one", () => {
      // Three wilds pay 50; the same line as B B B B B... pays only 10.
      expect(evaluateLine(wildPays, ["W", "W", "W", "B", "B"])).toEqual({ symbol: "W", count: 3, multiplier: 50 });
    });

    it("takes the substituted payout when it beats the wild's own", () => {
      expect(evaluateLine(wildPays, ["W", "A", "A", "A", "A"])).toEqual({ symbol: "A", count: 5, multiplier: 100 });
    });

    it("pays a full line of wilds from the wild's table", () => {
      expect(evaluateLine(wildPays, ["W", "W", "W", "W", "W"])).toEqual({ symbol: "W", count: 5, multiplier: 500 });
    });
  });

  it("works for a game with no wild and no scatter", () => {
    const plain = makeGame({ wild: null, scatter: null, pays: { A: { 3: 5 }, W: { 3: 7 } } });
    expect(evaluateLine(plain, ["A", "A", "A", "S", "S"])).toEqual({ symbol: "A", count: 3, multiplier: 5 });
    // With no wild configured, W is just a symbol like any other.
    expect(evaluateLine(plain, ["A", "W", "A", "A", "A"])).toBeNull();
    expect(evaluateLine(plain, ["W", "W", "W", "A", "A"])).toEqual({ symbol: "W", count: 3, multiplier: 7 });
  });
});

describe("evaluateGrid", () => {
  const twoLines = makeGame({
    paylines: [
      [1, 1, 1, 1, 1],
      [0, 0, 0, 0, 0],
    ],
  });
  // grid[reel][row]
  const grid = [
    ["A", "A", "B"],
    ["A", "W", "S"],
    ["A", "A", "S"],
    ["B", "A", "C"],
    ["C", "B", "S"],
  ];

  it("totals line wins and the scatter win, scaled by the bet", () => {
    const result = evaluateGrid(twoLines, grid, 2);

    // Middle row is A W A A B: four A (wild substitutes) = 20 x 2.
    // Top row is A A A B C: three A = 5 x 2.
    expect(result.lineWins.map((w) => [w.line, w.symbol, w.count, w.win])).toEqual([
      [0, "A", 4, 40],
      [1, "A", 3, 10],
    ]);
    // Three scatters anywhere pay 2 x the total bet (2 credits x 2 lines).
    expect(result.scatterWin).toMatchObject({ count: 3, multiplier: 2, win: 8 });
    expect(result.totalWin).toBe(58);
  });

  it("reports the cells that make up each win", () => {
    const result = evaluateGrid(twoLines, grid, 1);
    expect(result.lineWins[0]!.positions).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    expect(result.scatterWin!.positions).toEqual([
      [1, 2],
      [2, 2],
      [4, 2],
    ]);
  });

  it("returns no wins for a dead grid", () => {
    const dead = [
      ["A", "B", "C"],
      ["B", "C", "A"],
      ["C", "A", "B"],
      ["A", "B", "C"],
      ["B", "C", "A"],
    ];
    const result = evaluateGrid(twoLines, dead, 1);
    expect(result.lineWins).toEqual([]);
    expect(result.scatterWin).toBeNull();
    expect(result.totalWin).toBe(0);
  });

  it("pays the highest scatter entry the count reaches", () => {
    const scatterGrid = [
      ["S", "A", "B"],
      ["S", "B", "C"],
      ["S", "C", "A"],
      ["S", "A", "B"],
      ["B", "C", "A"],
    ];
    const result = evaluateGrid(twoLines, scatterGrid, 1);
    expect(result.scatterWin).toMatchObject({ count: 4, multiplier: 10, win: 20 });
  });
});
