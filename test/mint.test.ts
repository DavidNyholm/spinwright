import { describe, expect, it } from "vitest";
import { createRng, exactRtp, lookupPay, openingScatterProbabilities, spin } from "../src/engine/index.ts";
import { exactHoldReturn, holdOutcome, holdValue, meanCoinValue, playHoldRound, playHoldSession, smallestHoldWinMultiple } from "../src/engine/hold/index.ts";
import { mint } from "../src/games/mint.ts";
import { Running } from "../src/sim/running.ts";
import { runHoldSim } from "../src/sim/holdSim.ts";

/** Mint's symbols from the poorest to the richest, which is the order its pays must follow. */
const LADDER = ["L1", "L2", "L3", "L4", "H1", "H2", "H3"] as const;
const LINES = mint.base.paylines.length;
const pay = (symbol: string, run: number): number => lookupPay(mint.base.pays[symbol]!, run);

describe("Mint's pay ladder", () => {
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

  it("makes the lowest symbol pay only from four in a row, and every other from three", () => {
    expect(pay("L1", 3)).toBe(0);
    expect(pay("L1", 4)).toBeGreaterThan(0);
    for (const symbol of LADDER.slice(1)) expect(pay(symbol, 3), symbol).toBeGreaterThan(0);
  });

  it("pays every win more than the whole bet: 22 or more per line over twenty lines", () => {
    for (const table of Object.values(mint.base.pays)) for (const value of Object.values(table)) expect(value / LINES).toBeGreaterThan(1);
    expect(smallestHoldWinMultiple(mint)).toBe(22 / LINES);
  });

  it("keeps the coin out of the lines: no pays of its own, no wild, and nothing else on the strips", () => {
    expect(mint.base.pays["C"]).toBeUndefined();
    expect(mint.base.wild).toBeNull();
    expect(mint.base.scatter).toEqual({ symbol: "C", pays: {} });
    expect(new Set(mint.base.strips.flat())).toEqual(new Set([...LADDER, "C"]));
  });
});

describe("Mint's coins on the reels", () => {
  it("sit four to a reel, in two adjacent pairs, so a window can show two and six take three reels", () => {
    for (const strip of mint.base.strips) {
      expect(strip).toHaveLength(40);
      expect(strip.filter((symbol) => symbol === "C")).toHaveLength(4);
      const at = strip.flatMap((symbol, index) => (symbol === "C" ? [index] : []));
      expect(at[1]! - at[0]!).toBe(1);
      expect(at[3]! - at[2]!).toBe(1);
      expect(at[2]! - at[1]!).toBeGreaterThan(10);
    }
  });

  it("are six or more on one spin in about one in ninety, the chance the lobby's return was built on", () => {
    const exact = exactHoldReturn(mint);
    expect(1 / exact.trigger).toBeGreaterThan(85);
    expect(1 / exact.trigger).toBeLessThan(95);
    const counts = openingScatterProbabilities(mint.base);
    expect(counts.slice(mint.hold.minCoins).reduce((sum, p) => sum + p, 0)).toBeCloseTo(exact.trigger, 15);
    expect(counts.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 12);
  });
});

describe("Mint's return", () => {
  const exact = exactHoldReturn(mint);

  it("is 96.0%, worked out exactly: lines about 62.5%, hold and win about 33.5%", () => {
    expect(exact.total).toBeGreaterThan(0.9595);
    expect(exact.total).toBeLessThan(0.9605);
    expect(exact.base.lines).toBeGreaterThan(0.62);
    expect(exact.base.lines).toBeLessThan(0.63);
    expect(exact.feature).toBeGreaterThan(0.33);
    expect(exact.feature).toBeLessThan(0.34);
    expect(exact.base.total + exact.feature).toBeCloseTo(exact.total, 15);
    // The coin pays nothing in the lines, so the opening spin has no scatter part.
    expect(exact.base.scatter).toBe(0);
  });

  it("is spread so that the hold and win is worth about thirty times the bet on average, mostly from six coins", () => {
    const six = exact.perStart.find((start) => start.coins === 6)!;
    expect(six.value).toBeGreaterThan(29);
    expect(six.value).toBeLessThan(30.5);
    expect(six.probability / exact.trigger).toBeGreaterThan(0.75);
    expect(exact.buyValue).toBe(six.value);
  });

  it("makes the Grand rare: a full board in under one feature in a hundred, from six coins", () => {
    const outcome = holdOutcome(mint.hold, 15, 6);
    expect(outcome.fullProbability).toBeGreaterThan(0.005);
    expect(outcome.fullProbability).toBeLessThan(0.01);
    // ...and worth having: it is about a tenth of what a feature pays on average.
    const share = (mint.hold.fullBoard.value / LINES) * outcome.fullProbability;
    expect(share / holdValue(mint, 6)).toBeGreaterThan(0.08);
    expect(share / holdValue(mint, 6)).toBeLessThan(0.15);
  });

  it("has jackpot coins at one in twenty of all coins, and a coin that averages about 2.8 times the bet", () => {
    const total = mint.hold.values.reduce((sum, entry) => sum + entry.weight, 0);
    const jackpots = mint.hold.values.filter((entry) => entry.jackpot !== undefined).reduce((sum, entry) => sum + entry.weight, 0);
    expect(jackpots / total).toBeCloseTo(0.05, 6);
    expect(meanCoinValue(mint.hold) / LINES).toBeGreaterThan(2.7);
    expect(meanCoinValue(mint.hold) / LINES).toBeLessThan(2.85);
  });

  it("pays every hold and win at least three times the bet, and every other win more than the bet, over 120,000 rounds", () => {
    const rng = createRng("mint-floors");
    let wins = 0;
    let features = 0;
    const violations: string[] = [];
    for (let i = 0; i < 120_000; i++) {
      const round = playHoldRound(mint, rng, 1 + (i % 3));
      if (round.totalWin === 0) continue;
      wins++;
      if (round.totalWin <= round.totalBet) violations.push(`${round.totalWin} on a bet of ${round.totalBet}`);
      if (round.feature !== null) {
        features++;
        if (round.feature.win < 3 * round.totalBet) violations.push(`a hold and win of ${round.feature.win} on a bet of ${round.totalBet}`);
      }
    }
    expect(violations.slice(0, 5)).toEqual([]);
    expect(wins).toBeGreaterThan(30_000);
    expect(features).toBeGreaterThan(1_000);
  });

  it("wins on about three spins in ten, and the biggest of them are a couple in a hundred", () => {
    const rng = createRng("mint-shape");
    const spins = 400_000;
    let hits = 0;
    let big = 0;
    for (let i = 0; i < spins; i++) {
      const result = spin(mint.base, rng, 1);
      if (result.totalWin > 0) hits++;
      if (result.totalWin >= 5 * result.totalBet) big++;
    }
    // The opening spin on its own: lines only. Features add their own wins on top in whole rounds.
    expect(hits / spins).toBeGreaterThan(0.27);
    expect(hits / spins).toBeLessThan(0.32);
    expect(big / spins).toBeGreaterThan(0.005);
    expect(big / spins).toBeLessThan(0.02);
  });
});

describe("Mint played, against Mint worked out", () => {
  it("has an opening spin that matches the exact lines to within sampling error", () => {
    const rng = createRng("mint-opening");
    const opening = new Running();
    for (let i = 0; i < 500_000; i++) {
      const result = spin(mint.base, rng, 1);
      opening.add(result.totalWin / result.totalBet);
    }
    expect(Math.abs(opening.mean - exactRtp(mint.base).total) / opening.standardError).toBeLessThan(4);
  });

  it.each([6, 8])("has a feature from %i coins worth what the exact calculation says", (start) => {
    const rng = createRng(`mint-session-${start}`);
    const value = new Running();
    for (let i = 0; i < 150_000; i++) value.add(playHoldSession(mint, rng, 1, start) / LINES);
    expect(Math.abs(value.mean - holdValue(mint, start)) / value.standardError).toBeLessThan(4);
  });

  it("is reported by the simulator, which exits clean only when every estimate agrees", () => {
    const { report, agrees } = runHoldSim(mint, { rounds: 300_000, sessions: 40_000, seed: "mint-report", lineBet: 1 });
    expect(agrees).toBe(true);
    expect(report).toContain("hold and win");
    expect(report).toContain("RTP ");
    expect(report).not.toContain("MISMATCH");
    expect(report).toMatch(/Bonus buy +costs 31x/);
    expect(report).toMatch(/Hit frequency +(2[7-9]|3[0-2])\.\d%/);
  });
});
