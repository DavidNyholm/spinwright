import { describe, expect, it } from "vitest";
import { createRng, exactRtp, playRound, spinFromStops } from "../src/engine/index.ts";
import { classic } from "../src/games/classic.ts";
import { estimateReturn } from "../src/sim/lineSim.ts";
import { createStats, record } from "../src/sim/stats.ts";
import { makeGame } from "./fixtures.ts";

/** Standard errors of the simulation allowed away from the exact value. A real bug is far outside this. */
const MAX_Z = 4;

describe("exactRtp", () => {
  // A game small enough to enumerate every outcome through the real spin path, with wilds,
  // scatters, two-of-a-kind pays and lines that share cells.
  const tiny = makeGame({
    reels: 3,
    rows: 2,
    strips: [
      ["A", "B", "S", "A"],
      ["A", "W", "B", "A"],
      ["B", "A", "S", "W"],
    ],
    paylines: [
      [0, 0, 0],
      [1, 1, 1],
      [0, 1, 0],
    ],
    pays: { A: { 2: 3, 3: 12 }, B: { 2: 1, 3: 6 }, W: { 3: 40 } },
    wild: "W",
    scatter: { symbol: "S", pays: { 2: 1, 3: 5 } },
  });

  it("equals the average over every possible set of stops", () => {
    const lengths = tiny.strips.map((strip) => strip.length);
    let outcomes = 0;
    let lineWin = 0;
    let scatterWin = 0;
    let totalBet = 0;
    for (let a = 0; a < lengths[0]!; a++) {
      for (let b = 0; b < lengths[1]!; b++) {
        for (let c = 0; c < lengths[2]!; c++) {
          const result = spinFromStops(tiny, [a, b, c], 1);
          outcomes++;
          totalBet += result.totalBet;
          scatterWin += result.scatterWin?.win ?? 0;
          lineWin += result.totalWin - (result.scatterWin?.win ?? 0);
        }
      }
    }
    expect(outcomes).toBe(4 * 4 * 4);

    const exact = exactRtp(tiny);
    expect(exact.lines).toBeCloseTo(lineWin / totalBet, 12);
    expect(exact.scatter).toBeCloseTo(scatterWin / totalBet, 12);
    expect(exact.total).toBeCloseTo((lineWin + scatterWin) / totalBet, 12);
    // Some of each kind of win must actually occur, or this test proves less than it seems to.
    expect(lineWin).toBeGreaterThan(0);
    expect(scatterWin).toBeGreaterThan(0);
  });

  it("splits line RTP by symbol so the parts add up to the whole", () => {
    const exact = exactRtp(tiny);
    const sum = Object.values(exact.lineBySymbol).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(exact.lines, 12);
  });
});

describe("classic game", () => {
  it("returns about 96% in all: an exact opening spin plus a simulated feature", { timeout: 120_000 }, () => {
    const estimate = estimateReturn(classic, 40_000, "rtp-test-sessions");
    expect(estimate.total).toBeGreaterThan(0.95);
    expect(estimate.total).toBeLessThan(0.97);
    // Split the way the design means it: most from the base game, about a third from the free spins.
    expect(estimate.base.total).toBeGreaterThan(0.58);
    expect(estimate.base.total).toBeLessThan(0.68);
    expect(estimate.featureRtp).toBeGreaterThan(0.28);
    expect(estimate.featureRtp).toBeLessThan(0.4);
    // The feature should be a feature: rare enough to look forward to, common enough to see.
    expect(1 / estimate.trigger).toBeGreaterThan(90);
    expect(1 / estimate.trigger).toBeLessThan(160);
  });

  it("plays end to end to what the exact opening spin and the by-parts feature predict", { timeout: 180_000 }, () => {
    const rng = createRng("rtp-test");
    const stats = createStats();
    for (let i = 0; i < 1_000_000; i++) record(stats, playRound(classic, rng, 1));

    // The opening spin has an exact answer, and the lines inside it too.
    const exact = exactRtp(classic);
    expect(Math.abs(stats.opening.mean - exact.total) / stats.opening.standardError).toBeLessThan(MAX_Z);
    expect(Math.abs(stats.lines.mean - exact.lines) / stats.lines.standardError).toBeLessThan(MAX_Z);

    // The free spins have none (locked wilds make each spin depend on the last), so they are
    // checked against features simulated on their own, weighted by the exact chance of each trigger.
    const estimate = estimateReturn(classic, 100_000, "rtp-test-by-parts");
    const standardError = Math.hypot(stats.freeSpins.standardError, estimate.featureStdError);
    expect(Math.abs(stats.freeSpins.mean - estimate.featureRtp) / standardError).toBeLessThan(MAX_Z);
    expect(stats.triggers).toBeGreaterThan(0);
  });
});
