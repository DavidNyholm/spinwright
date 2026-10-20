import { describe, expect, it } from "vitest";
import * as cascade from "../src/engine/cascade/index.ts";
import { findCascadeConfigProblems } from "../src/engine/cascade/index.ts";
import {
  buyFeature,
  createRng,
  featurePrice,
  findConfigProblems,
  playFeatureSession,
  smallestTrigger,
} from "../src/engine/index.ts";
import type { GameConfig, Rng } from "../src/engine/index.ts";
import { classic } from "../src/games/classic.ts";
import { crucible } from "../src/games/crucible.ts";
import { makeGame, rawGame } from "./fixtures.ts";

function scripted(values: readonly number[]): Rng {
  let next = 0;
  return {
    nextUint32(): number {
      if (next >= values.length) throw new Error("the script ran out");
      return values[next++]!;
    },
  };
}

/** The value of `sessions` features played on their own, as multiples of the total bet. */
function featureValues(play: (rng: Rng) => number, sessions: number, seed: string): number[] {
  const rng = createRng(seed);
  return Array.from({ length: sessions }, () => play(rng));
}

const mean = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

describe("what a bonus costs", () => {
  it("is a multiple of the total bet, so it grows with the bet", () => {
    const multiple = classic.feature!.buyCost!;
    expect(featurePrice(classic, 1)).toBe(multiple * 20);
    expect(featurePrice(classic, 5)).toBe(multiple * 5 * 20);
    expect(cascade.featurePrice(crucible, 1)).toBe(crucible.feature!.buyCost! * crucible.units);
    expect(cascade.featurePrice(crucible, 3)).toBe(3 * crucible.feature!.buyCost! * crucible.units);
  });

  it("is always a whole number of credits", () => {
    for (const bet of [1, 2, 3, 5, 10, 20]) {
      expect(Number.isInteger(featurePrice(classic, bet))).toBe(true);
      expect(Number.isInteger(cascade.featurePrice(crucible, bet))).toBe(true);
    }
  });

  it("is null for a game whose feature cannot be bought, or that has none", () => {
    expect(featurePrice(makeGame(), 1)).toBeNull();
    const unbuyable = { ...classic, feature: { ...classic.feature!, buyCost: null } } as GameConfig;
    expect(featurePrice(unbuyable, 1)).toBeNull();
    expect(() => buyFeature(unbuyable, createRng("x"), 1)).toThrow(/cannot be bought/);
    expect(() => buyFeature(makeGame(), createRng("x"), 1)).toThrow(/cannot be bought/);
    expect(cascade.featurePrice({ ...crucible, feature: null }, 1)).toBeNull();
  });

  it("is checked when the game is defined", () => {
    const strips = Array.from({ length: 5 }, () => ["A", "B", "C", "W", "S"]);
    const feature = (buyCost: number | null) => ({ spins: { 3: 8 }, strips, retrigger: { 3: 4 }, maxSpins: 20, buyCost });
    expect(findConfigProblems(rawGame({ feature: feature(41) }))).toEqual([]);
    expect(findConfigProblems(rawGame({ feature: feature(null) }))).toEqual([]);
    expect(findConfigProblems(rawGame({ feature: feature(0) })).join("\n")).toContain("buyCost");
    expect(findConfigProblems(rawGame({ feature: feature(2.5) })).join("\n")).toContain("buyCost");

    const cascadeFeature = (buyCost: number | null) => ({ ...crucible, feature: { ...crucible.feature!, buyCost } });
    expect(findCascadeConfigProblems(cascadeFeature(79))).toEqual([]);
    expect(findCascadeConfigProblems(cascadeFeature(null))).toEqual([]);
    expect(findCascadeConfigProblems(cascadeFeature(0)).join("\n")).toContain("buyCost");
    expect(findCascadeConfigProblems(cascadeFeature(1.5)).join("\n")).toContain("buyCost");
  });
});

describe("buying Clockwork's free spins", () => {
  it("starts the feature as if the fewest scatters had landed, with no opening spin", () => {
    const bought = buyFeature(classic, createRng("buy-1"), 2);
    expect(smallestTrigger(classic)).toBe(3);
    expect(bought.feature.awarded).toBe(classic.feature!.spins[3]);
    expect(bought.price).toBe(featurePrice(classic, 2));
    expect(bought.totalBet).toBe(40);
    expect(bought.feature.spins.length).toBeGreaterThanOrEqual(bought.feature.awarded);
    expect(bought.totalWin).toBe(bought.feature.win);
    expect(bought.totalWin).toBe(bought.feature.spins.reduce((sum, spin) => sum + spin.win, 0));
    expect(bought.totalWin).toBeLessThanOrEqual(classic.maxWinMultiple! * bought.totalBet);
  });

  it("plays exactly what a feature played on its own would, from the same random numbers", () => {
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const bought = buyFeature(classic, createRng(seed), 1);
      expect(bought.totalWin).toBe(playFeatureSession(classic, createRng(seed), 1, smallestTrigger(classic)));
    }
  });

  it("locks wilds from the first spin, with nothing locked before it", () => {
    const small = makeGame({
      reels: 3,
      rows: 1,
      strips: [["A", "B", "S", "W"], ["A", "B", "S", "W"], ["A", "B", "S", "W"]],
      paylines: [[0, 0, 0]],
      pays: { A: { 2: 2, 3: 10 }, B: { 3: 4 }, W: {} },
      wild: "W",
      scatter: { symbol: "S", pays: {} },
      feature: { spins: { 2: 3 }, strips: [["A", "W", "S"], ["A", "W", "S"], ["A", "W", "S"]], retrigger: { 2: 2 }, maxSpins: 5, buyCost: 12 },
    });
    // Every random number is a stop: W A A, then A A A, then A W S.
    const bought = buyFeature(small, scripted([1, 0, 0, 0, 0, 0, 0, 1, 2]), 1);
    expect(bought.price).toBe(12);
    expect(bought.feature.spins.map((spin) => spin.win)).toEqual([10, 10, 0]);
    expect(bought.feature.spins[0]!.newlyLocked).toEqual([[0, 0]]);
    expect(bought.totalWin).toBe(20);
  });

  it("never pays a buy more than the cap, and says when it did", () => {
    // Each of these spins would win 10 (A A A with a locked wild); the cap of 15 allows 10 and then 5.
    const capped = makeGame({
      reels: 3,
      rows: 1,
      strips: [["A", "B", "S", "W"], ["A", "B", "S", "W"], ["A", "B", "S", "W"]],
      paylines: [[0, 0, 0]],
      pays: { A: { 2: 2, 3: 10 }, B: { 3: 4 }, W: {} },
      wild: "W",
      scatter: { symbol: "S", pays: {} },
      feature: { spins: { 2: 3 }, strips: [["A", "W", "S"], ["A", "W", "S"], ["A", "W", "S"]], retrigger: { 2: 2 }, maxSpins: 5, buyCost: 12 },
      maxWinMultiple: 15,
    });
    const bought = buyFeature(capped, scripted([1, 0, 0, 0, 0, 0, 0, 0, 0]), 1);
    expect(bought.totalWin).toBe(15);
    expect(bought.capped).toBe(true);
    expect(bought.feature.spins).toHaveLength(2);
  });

  it("rejects a bet that is not a whole number of credits", () => {
    expect(() => buyFeature(classic, createRng("x"), 0)).toThrow(RangeError);
    expect(() => buyFeature(classic, createRng("x"), 1.5)).toThrow(RangeError);
  });

  it("costs about what it returns: close to, and a little under, the machine's own return", { timeout: 120_000 }, () => {
    const values = featureValues((rng) => playFeatureSession(classic, rng, 1, smallestTrigger(classic)) / 20, 100_000, "buy-economy-classic");
    const returnToPlayer = mean(values) / classic.feature!.buyCost!;
    expect(returnToPlayer).toBeGreaterThan(0.93);
    expect(returnToPlayer).toBeLessThan(0.975);
  });

  it("pays less than it cost in most buys, so a buy is a gamble and not a refund", { timeout: 120_000 }, () => {
    const values = featureValues((rng) => playFeatureSession(classic, rng, 1, smallestTrigger(classic)) / 20, 30_000, "buy-median-classic");
    const cheaper = values.filter((value) => value < classic.feature!.buyCost!).length;
    expect(cheaper / values.length).toBeGreaterThan(0.5);
    // And sometimes it pays far more than it cost, or buying would not be worth offering.
    expect(values.filter((value) => value > 3 * classic.feature!.buyCost!).length).toBeGreaterThan(0);
  });
});

describe("buying Crucible's furnace", () => {
  it("plays the feature's spins from a fresh heat, with no base spin", () => {
    const bought = cascade.buyFeature(crucible, createRng("buy-furnace"), 2, { record: true });
    expect(bought.price).toBe(2 * crucible.units * crucible.feature!.buyCost!);
    expect(bought.totalBet).toBe(2 * crucible.units);
    expect(bought.feature.length).toBeGreaterThanOrEqual(1);
    expect(bought.feature.length).toBeLessThanOrEqual(crucible.feature!.maxSpins);
    expect(bought.feature[0]!.startHeat).toBe(crucible.heat.start);
    expect(bought.totalWin).toBe(bought.feature.reduce((sum, round) => sum + round.win, 0));
    expect(bought.totalWin).toBeLessThanOrEqual(crucible.maxWinMultiple * bought.totalBet);
    expect(bought.feature[0]!.openingGrid).not.toBeNull();
  });

  it("plays exactly what a feature played on its own would, from the same random numbers", () => {
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const bought = cascade.buyFeature(crucible, createRng(seed), 1);
      expect(bought.totalWin).toBe(cascade.playFeatureSession(crucible, createRng(seed), 1));
    }
  });

  it("never pays a buy more than the cap, and says when it did", () => {
    const tight = { ...crucible, maxWinMultiple: 2 };
    const rng = createRng("capped-buys");
    let capped = 0;
    for (let i = 0; i < 40; i++) {
      const bought = cascade.buyFeature(tight, rng, 1);
      expect(bought.totalWin).toBeLessThanOrEqual(2 * bought.totalBet);
      if (bought.capped) capped++;
    }
    expect(capped).toBeGreaterThan(0);
  });

  it("rejects a game with no feature to buy, and a bad bet", () => {
    expect(() => cascade.buyFeature({ ...crucible, feature: null }, createRng("x"), 1)).toThrow(/cannot be bought/);
    expect(() => cascade.buyFeature(crucible, createRng("x"), 0)).toThrow(RangeError);
  });

  it("costs about what it returns: close to, and a little under, the machine's own return", { timeout: 180_000 }, () => {
    const values = featureValues((rng) => cascade.playFeatureSession(crucible, rng, 1) / crucible.units, 100_000, "buy-economy-crucible");
    const returnToPlayer = mean(values) / crucible.feature!.buyCost!;
    expect(returnToPlayer).toBeGreaterThan(0.93);
    expect(returnToPlayer).toBeLessThan(0.975);
  });

  it("pays less than it cost in most buys", { timeout: 180_000 }, () => {
    const values = featureValues((rng) => cascade.playFeatureSession(crucible, rng, 1) / crucible.units, 30_000, "buy-median-crucible");
    expect(values.filter((value) => value < crucible.feature!.buyCost!).length / values.length).toBeGreaterThan(0.5);
  });
});
