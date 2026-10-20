import { describe, expect, it } from "vitest";
import { createRng, evaluateLine, lookupPay, nextInt, playRound, smallestWinMultiple, spin } from "../src/engine/index.ts";
import { classic } from "../src/games/classic.ts";
import { makeGame } from "./fixtures.ts";

/** Clockwork's symbols from the poorest to the richest, which is the order its pays must follow. */
const LADDER = ["L1", "L2", "L3", "L4", "L5", "L6", "H1", "H2", "H3"] as const;
const pay = (symbol: string, run: number): number => lookupPay(classic.pays[symbol]!, run);
const LINES = classic.paylines.length;

describe("Clockwork's pay ladder", () => {
  it("never pays less for a longer run", () => {
    for (const symbol of LADDER) {
      expect(pay(symbol, 4), symbol).toBeGreaterThanOrEqual(pay(symbol, 3));
      expect(pay(symbol, 5), symbol).toBeGreaterThan(pay(symbol, 4));
    }
  });

  it("never pays a poorer symbol more than a richer one, at any run", () => {
    for (const run of [3, 4, 5]) {
      const pays = LADDER.map((symbol) => pay(symbol, run));
      expect(pays, `runs of ${run}`).toEqual([...pays].sort((a, b) => a - b));
    }
  });

  it("keeps the runs apart: the longest run of the poorest symbol pays well above the shortest of the richest low one", () => {
    // Without this a four of the lowest symbols could pay barely more than three of a better one, and the table would read as muddled.
    expect(pay("L1", 4)).toBeGreaterThanOrEqual(pay("L6", 3) + 3);
    expect(pay("L3", 4)).toBeGreaterThan(pay("L6", 3));
    expect(pay("H1", 3)).toBeGreaterThan(pay("L6", 3));
  });

  it("makes Nine and Ten pay only from four in a row", () => {
    const row = (...symbols: string[]) => evaluateLine(classic, symbols);
    expect(row("L1", "L1", "L1", "L5", "L6")).toBeNull();
    expect(row("L2", "L2", "L2", "L1", "L5")).toBeNull();
    expect(row("L1", "W", "L1", "L3", "L5")).toBeNull();
    expect(row("L1", "L1", "L1", "L1", "L5")).toEqual({ symbol: "L1", count: 4, multiplier: 25 });
    // A wild counts toward the run, so it can carry a three to four.
    expect(row("W", "L1", "L1", "L1", "L5")).toEqual({ symbol: "L1", count: 4, multiplier: 25 });
    expect(row("L2", "L2", "W", "L2", "L5")).toEqual({ symbol: "L2", count: 4, multiplier: 25 });
  });

  it("pays 22 for three Jacks, Queens, Kings or Aces", () => {
    for (const symbol of ["L3", "L4", "L5", "L6"]) {
      expect(evaluateLine(classic, [symbol, symbol, symbol, "L1", "L2"])).toEqual({ symbol, count: 3, multiplier: 22 });
    }
  });
});

describe("the promise that no win pays less than the bet", () => {
  it("is what the paytable works out to: the smallest pay is more than the whole bet", () => {
    const smallest = smallestWinMultiple(classic);
    expect(smallest).toBeGreaterThan(1);
    expect(smallest).toBe(22 / LINES);
    // Every positive pay in the game is at least that.
    for (const table of Object.values(classic.pays)) for (const value of Object.values(table)) expect(value / LINES).toBeGreaterThanOrEqual(smallest);
    for (const value of Object.values(classic.scatter!.pays)) expect(value).toBeGreaterThanOrEqual(smallest);
  });

  it("is worked out from the pays, so an old-style table breaks it", () => {
    // The fixture has one payline, so its smallest pay of 1 per line is exactly the whole bet: not more than it.
    expect(smallestWinMultiple(makeGame())).toBe(1);
    expect(smallestWinMultiple(makeGame({ pays: { A: { 3: 5 }, W: {} }, paylines: Array.from({ length: 5 }, (_, i) => [i % 3, i % 3, i % 3, i % 3, i % 3]).slice(0, 3) }))).toBe(5 / 3);
    expect(smallestWinMultiple({ ...classic, pays: { ...classic.pays, L1: { 3: 8, 4: 25, 5: 110 } } })).toBe(8 / LINES);
    expect(smallestWinMultiple({ ...classic, scatter: { symbol: "S", pays: { 3: 1, 4: 10, 5: 50 } } })).toBe(1);
    expect(smallestWinMultiple(makeGame({ pays: { W: {} }, wild: "W", scatter: null }))).toBe(Infinity);
  });

  it("holds in play: across thousands of rounds, no spin, opening or free, ever returns less than its bet unless it pays nothing", () => {
    const rng = createRng("no-win-below-stake");
    let wins = 0;
    let freeSpinWins = 0;
    let freeSpins = 0;
    const violations: string[] = [];
    for (let i = 0; i < 120_000; i++) {
      const round = playRound(classic, rng, 1 + nextInt(rng, 3));
      const spins = [round.base, ...(round.feature?.spins.map((free) => free.spin) ?? [])];
      for (const [index, one] of spins.entries()) {
        if (index > 0) freeSpins++;
        if (one.totalWin === 0) continue;
        wins++;
        if (index > 0) freeSpinWins++;
        if (one.totalWin <= one.totalBet) violations.push(`${one.totalWin} on a bet of ${one.totalBet}`);
      }
    }
    expect(violations.slice(0, 5)).toEqual([]);
    // Enough wins, and enough free-spin wins, were seen for that to mean something.
    expect(wins).toBeGreaterThan(30_000);
    expect(freeSpins).toBeGreaterThan(500);
    expect(freeSpinWins).toBeGreaterThan(300);
  });
});

describe("how often Clockwork's opening spin wins", () => {
  const rng = createRng("base-game-shape");
  const spins = 400_000;
  let hits = 0;
  let bigWins = 0;
  for (let i = 0; i < spins; i++) {
    const result = spin(classic, rng, 1);
    if (result.totalWin > 0) hits++;
    if (result.totalWin >= 5 * result.totalBet) bigWins++;
  }

  it("pays on about three spins in ten, and each is a profit", () => {
    expect(hits / spins).toBeGreaterThan(0.27);
    expect(hits / spins).toBeLessThan(0.31);
  });

  it("still pays five times the bet or more on a couple of spins in a hundred", () => {
    expect(bigWins / spins).toBeGreaterThan(0.015);
    expect(bigWins / spins).toBeLessThan(0.03);
  });
});
