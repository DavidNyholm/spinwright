import { describe, expect, it } from "vitest";
import { ConfigError, defineGame, findConfigProblems, lookupPay } from "../src/engine/index.ts";
import type { GameConfig } from "../src/engine/index.ts";
import { games } from "../src/games/index.ts";
import { makeGame, rawGame } from "./fixtures.ts";

describe("lookupPay", () => {
  const table = { 3: 5, 5: 60 };

  it("pays nothing below the smallest key", () => {
    expect(lookupPay(table, 0)).toBe(0);
    expect(lookupPay(table, 2)).toBe(0);
  });

  it("pays the largest key at or below the count", () => {
    expect(lookupPay(table, 3)).toBe(5);
    expect(lookupPay(table, 4)).toBe(5);
    expect(lookupPay(table, 5)).toBe(60);
    expect(lookupPay(table, 12)).toBe(60);
  });

  it("pays nothing from an empty table", () => {
    expect(lookupPay({}, 5)).toBe(0);
  });
});

describe("defineGame", () => {
  it("returns a deeply frozen config", () => {
    const game = makeGame();
    expect(Object.isFrozen(game)).toBe(true);
    expect(Object.isFrozen(game.strips)).toBe(true);
    expect(Object.isFrozen(game.strips[0])).toBe(true);
    expect(Object.isFrozen(game.pays["A"])).toBe(true);
  });

  it("throws a ConfigError that lists every problem at once", () => {
    const bad = rawGame({ strips: [], paylines: [] });
    const error = (() => {
      try {
        defineGame(bad);
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).problems.length).toBeGreaterThan(1);
  });

  it("accepts every shipped game", () => {
    for (const game of Object.values(games)) expect(findConfigProblems(game)).toEqual([]);
  });
});

describe("findConfigProblems", () => {
  const cases: [string, Partial<GameConfig>, RegExp][] = [
    ["a non-integer reel count", { reels: 2.5 }, /reels must be a positive integer/],
    ["zero rows", { rows: 0 }, /rows must be a positive integer/],
    ["a missing strip", { strips: [["A", "B", "C"]] }, /expected one per reel/],
    ["a strip shorter than the row count", { strips: [["A", "B"], ...rawGame().strips.slice(1)] }, /needs at least 3/],
    ["no paylines", { paylines: [] }, /paylines must not be empty/],
    ["a payline of the wrong length", { paylines: [[1, 1, 1]] }, /expected one per reel/],
    ["a payline row off the grid", { paylines: [[1, 1, 3, 1, 1]] }, /row 3/],
    ["a fractional payline row", { paylines: [[1, 1, 0.5, 1, 1]] }, /row 0.5/],
    [
      "a duplicate payline",
      { paylines: [[1, 1, 1, 1, 1], [1, 1, 1, 1, 1]] },
      /duplicates an earlier payline/,
    ],
    ["pays for a symbol on no strip", { pays: { A: { 3: 1 }, Z: { 3: 1 }, W: {} } }, /"Z".*no reel strip/],
    ["a pay count of zero", { pays: { A: { 0: 1 }, W: {} } }, /count "0"/],
    ["a pay count beyond the reels", { pays: { A: { 6: 1 }, W: {} } }, /count "6"/],
    ["a fractional multiplier", { pays: { A: { 3: 1.5 }, W: {} } }, /non-negative integer/],
    ["a negative multiplier", { pays: { A: { 3: -1 }, W: {} } }, /non-negative integer/],
    ["a wild on no strip", { wild: "Q", pays: { A: { 3: 1 }, Q: {} } }, /wild "Q" is on no reel strip/],
    ["a wild without a pays entry", { pays: { A: { 3: 1 } } }, /needs a pays entry/],
    ["a scatter on no strip", { scatter: { symbol: "Q", pays: { 3: 1 } } }, /scatter "Q" is on no reel strip/],
    ["a scatter that is also the wild", { scatter: { symbol: "W", pays: { 3: 1 } } }, /both "W"/],
    [
      "a scatter that also has a line pays entry",
      { pays: { A: { 3: 1 }, S: { 3: 1 }, W: {} } },
      /must not also have a line pays entry/,
    ],
    ["a scatter count beyond the grid", { scatter: { symbol: "S", pays: { 16: 1 } } }, /count "16"/],
  ];

  it.each(cases)("flags %s", (_name, overrides, expected) => {
    const problems = findConfigProblems(rawGame(overrides));
    expect(problems.some((problem) => expected.test(problem))).toBe(true);
  });

  it("finds nothing wrong with the base fixture", () => {
    expect(findConfigProblems(rawGame())).toEqual([]);
  });
});
