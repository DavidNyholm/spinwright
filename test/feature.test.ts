import { describe, expect, it } from "vitest";
import {
  buildGrid,
  createRng,
  evaluateGrid,
  findConfigProblems,
  lookupPay,
  openingScatterProbabilities,
  playFeatureSession,
  playRound,
  playRoundFromStops,
  spinsAwarded,
  triggerProbability,
} from "../src/engine/index.ts";
import type { GameConfig, Rng } from "../src/engine/index.ts";
import { classic } from "../src/games/classic.ts";
import { makeGame, rawGame } from "./fixtures.ts";

/** An rng that hands out the integers it was given, in order. nextInt on a small bound returns each one unchanged. */
function scripted(values: readonly number[]): Rng {
  let next = 0;
  return {
    nextUint32(): number {
      if (next >= values.length) throw new Error("the script ran out: more random numbers were asked for than expected");
      return values[next++]!;
    },
  };
}

// A game small enough to read: three reels of one row and one payline. Two scatters start three free
// spins. On free spins stop 0 shows A, stop 1 a wild and stop 2 a scatter. (The base reels carry a
// wild too, at stop 3, because the rules want every symbol to be on a base reel.)
const demo = makeGame({
  reels: 3,
  rows: 1,
  strips: [
    ["A", "B", "S", "W"],
    ["A", "B", "S", "W"],
    ["A", "B", "S", "W"],
  ],
  paylines: [[0, 0, 0]],
  pays: { A: { 2: 2, 3: 10 }, B: { 3: 4 }, W: {} },
  wild: "W",
  scatter: { symbol: "S", pays: {} },
  feature: {
    spins: { 2: 3 },
    strips: [
      ["A", "W", "S"],
      ["A", "W", "S"],
      ["A", "W", "S"],
    ],
    retrigger: { 2: 2 },
    maxSpins: 5,
  },
});
/** Opening stops that show S, S, A: two scatters, so the feature starts with three spins. */
const TRIGGER = [2, 2, 0];

describe("spinsAwarded", () => {
  it("awards nothing below the smallest count, and reads the table as N or more", () => {
    expect(spinsAwarded(classic, 2)).toBe(0);
    expect(spinsAwarded(classic, 3)).toBe(8);
    expect(spinsAwarded(classic, 4)).toBe(12);
    expect(spinsAwarded(classic, 5)).toBe(16);
  });

  it("awards nothing in a game with no feature", () => {
    expect(spinsAwarded(makeGame(), 5)).toBe(0);
  });
});

describe("the free spins, played out by hand", () => {
  it("does not start without enough scatters", () => {
    const round = playRoundFromStops(demo, scripted([]), [0, 0, 2], 1);
    expect(round.feature).toBeNull();
    expect(round.totalWin).toBe(round.base.totalWin);
  });

  it("locks a wild where it lands, keeps it there, and pays wins that use it", () => {
    // Spin 1: W A A pays as three A. Spin 2: A A A, but reel 1 is still a wild. Spin 3: A W S locks a second wild and wins nothing.
    const round = playRoundFromStops(demo, scripted([1, 0, 0, 0, 0, 0, 0, 1, 2]), TRIGGER, 1);
    const feature = round.feature!;
    expect(feature.awarded).toBe(3);
    expect(feature.spins).toHaveLength(3);

    const [first, second, third] = feature.spins;
    expect(first!.spin.stops).toEqual([1, 0, 0]);
    expect(first!.spin.grid).toEqual([["W"], ["A"], ["A"]]);
    expect(first!.newlyLocked).toEqual([[0, 0]]);
    expect(first!.win).toBe(10);

    // The reels landed on A A A, and the wild locked on spin 1 still shows in the first cell.
    expect(second!.spin.stops).toEqual([0, 0, 0]);
    expect(second!.spin.grid).toEqual([["W"], ["A"], ["A"]]);
    expect(second!.newlyLocked).toEqual([]);
    expect(second!.locked).toEqual([[0, 0]]);
    expect(second!.win).toBe(10);

    // A second wild lands; the scatter that ends the run keeps this spin from paying.
    expect(third!.spin.grid).toEqual([["W"], ["W"], ["S"]]);
    expect(third!.newlyLocked).toEqual([[1, 0]]);
    expect(third!.locked).toEqual([
      [0, 0],
      [1, 0],
    ]);
    expect(third!.win).toBe(0);

    expect(feature.win).toBe(20);
    expect(round.totalWin).toBe(20);
    expect(third!.spinsLeft).toBe(0);
  });

  it("does not lock a wild twice, nor one that was already locked", () => {
    // Wilds land on reel 0 on spins 1 and 2; only the first one is new.
    const round = playRoundFromStops(demo, scripted([1, 0, 0, 1, 0, 0, 0, 0, 0]), TRIGGER, 1);
    const [first, second, third] = round.feature!.spins;
    expect(first!.newlyLocked).toEqual([[0, 0]]);
    expect(second!.newlyLocked).toEqual([]);
    expect(third!.locked).toEqual([[0, 0]]);
  });

  it("adds spins for scatters on a free spin, up to the most a feature may reach", () => {
    // Every free spin shows three scatters. The first earns two more spins (3 awarded - 1 played + 2 = 4 left);
    // the second would earn two more, but a feature may not pass five spins in all.
    const round = playRoundFromStops(demo, scripted([2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]), TRIGGER, 1);
    const feature = round.feature!;
    expect(feature.spins).toHaveLength(5);
    expect(feature.spins.map((spin) => spin.retriggered)).toEqual([2, 0, 0, 0, 0]);
    expect(feature.spins.map((spin) => spin.spinsLeft)).toEqual([4, 3, 2, 1, 0]);
  });

  it("scales wins with the bet per line", () => {
    const one = playRoundFromStops(demo, scripted([1, 0, 0, 0, 0, 0, 0, 1, 2]), TRIGGER, 1);
    const five = playRoundFromStops(demo, scripted([1, 0, 0, 0, 0, 0, 0, 1, 2]), TRIGGER, 5);
    expect(five.feature!.win).toBe(5 * one.feature!.win);
  });
});

describe("the win cap", () => {
  const capped = makeGame({ ...demo, maxWinMultiple: 15 });

  it("cuts the spin that reaches it, and ends the feature", () => {
    // Each spin would win 10 (A A A with a locked wild). The second takes the round to 20, so it is cut to the 5 left.
    const round = playRoundFromStops(capped, scripted([1, 0, 0, 0, 0, 0, 0, 0, 0]), TRIGGER, 1);
    const feature = round.feature!;
    expect(feature.spins).toHaveLength(2);
    expect(feature.spins.map((spin) => spin.win)).toEqual([10, 5]);
    expect(feature.spins[1]!.spin.totalWin).toBe(10);
    expect(feature.spins[1]!.capped).toBe(true);
    expect(feature.spins[1]!.spinsLeft).toBe(0);
    expect(feature.capped).toBe(true);
    expect(round.totalWin).toBe(15);
    expect(round.capped).toBe(true);
  });

  it("holds a feature played on its own to the cap too, as the simulator plays them", () => {
    const rng = createRng("capped-session");
    const wins = Array.from({ length: 400 }, () => playFeatureSession(capped, rng, 1, 2));
    expect(Math.max(...wins)).toBe(15);
    expect(wins.every((win) => win <= 15)).toBe(true);
  });

  it("does not mark a round capped when it stops short of the cap", () => {
    const round = playRoundFromStops(capped, scripted([1, 0, 0, 0, 0, 0, 0, 1, 2]), [0, 0, 2], 1);
    expect(round.feature).toBeNull();
    expect(round.capped).toBe(false);
  });
});

describe("free spins over thousands of random rounds", () => {
  const rng = createRng("feature-invariants");
  const rounds = Array.from({ length: 12_000 }, () => playRound(classic, rng, 1 + (rng.nextUint32() % 3)));
  const triggered = rounds.filter((round) => round.feature !== null);
  const feature = classic.feature!;
  const { rows, reels } = classic;

  it("starts the feature exactly when the opening grid has enough scatters", () => {
    const scatters = (grid: readonly (readonly string[])[]): number => grid.flat().filter((symbol) => symbol === "S").length;
    for (const round of rounds) {
      expect(round.feature !== null).toBe(scatters(round.base.grid) >= 3);
      if (round.feature !== null) expect(round.feature.awarded).toBe(lookupPay(feature.spins, scatters(round.base.grid)));
    }
    // Enough features happened for the checks below to mean something.
    expect(triggered.length).toBeGreaterThan(40);
  });

  it("plays the feature's own reels, and shows exactly what they landed on, plus the locked wilds", () => {
    for (const round of triggered) {
      const locked = new Set<string>();
      for (const spin of round.feature!.spins) {
        const landed = buildGrid(classic, spin.spin.stops, feature.strips);
        const expected = landed.map((column) => column.slice());
        for (const key of locked) {
          const [reel, row] = key.split(",").map(Number) as [number, number];
          expected[reel]![row] = "W";
        }
        expect(spin.spin.grid).toEqual(expected);
        // Wins are those of the grid the player sees, locked wilds included.
        expect(spin.spin.totalWin).toBe(evaluateGrid(classic, spin.spin.grid, spin.spin.lineBet).totalWin);

        // New locks are exactly the wilds the reels landed that were not already locked.
        const fresh: string[] = [];
        for (let reel = 0; reel < reels; reel++) {
          for (let row = 0; row < rows; row++) if (landed[reel]![row] === "W" && !locked.has(`${reel},${row}`)) fresh.push(`${reel},${row}`);
        }
        expect(spin.newlyLocked.map(([reel, row]) => `${reel},${row}`)).toEqual(fresh);
        for (const key of fresh) locked.add(key);
        expect(new Set(spin.locked.map(([reel, row]) => `${reel},${row}`))).toEqual(locked);
      }
    }
  });

  it("only ever adds locks: a locked wild is still there on every later spin", () => {
    for (const round of triggered) {
      let previous = 0;
      for (const spin of round.feature!.spins) {
        expect(spin.locked.length).toBeGreaterThanOrEqual(previous);
        expect(spin.locked.length).toBe(previous + spin.newlyLocked.length);
        previous = spin.locked.length;
      }
    }
  });

  it("keeps count of the spins: awarded plus retriggered, never more than the most allowed", () => {
    for (const round of triggered) {
      const { awarded, spins } = round.feature!;
      if (round.feature!.capped) continue;
      expect(spins.length).toBe(awarded + spins.reduce((sum, spin) => sum + spin.retriggered, 0));
      expect(spins.length).toBeLessThanOrEqual(feature.maxSpins);
      let left = awarded;
      for (const spin of spins) {
        left = left - 1 + spin.retriggered;
        expect(spin.spinsLeft).toBe(left);
        const scatters = spin.spin.grid.flat().filter((symbol) => symbol === "S").length;
        expect(spin.retriggered).toBeLessThanOrEqual(lookupPay(feature.retrigger, scatters));
        expect(spin.retriggered === 0 || spin.retriggered === lookupPay(feature.retrigger, scatters) || left + spin.retriggered >= 0).toBe(true);
      }
      expect(left).toBe(0);
    }
    // Some features did retrigger, or this proves less than it seems to.
    expect(triggered.some((round) => round.feature!.spins.some((spin) => spin.retriggered > 0))).toBe(true);
  });

  it("adds up: the round is the opening spin plus every free spin, within the cap", () => {
    for (const round of rounds) {
      const featureWin = round.feature?.win ?? 0;
      expect(round.feature === null ? 0 : round.feature.spins.reduce((sum, spin) => sum + spin.win, 0)).toBe(featureWin);
      expect(round.totalWin).toBe(round.base.totalWin + featureWin);
      expect(round.totalWin).toBeLessThanOrEqual(classic.maxWinMultiple! * round.totalBet);
      expect(Number.isInteger(round.totalWin)).toBe(true);
    }
  });

  it("repeats exactly from the same seed", () => {
    const a = playRound(classic, createRng("repeat"), 2);
    const b = playRound(classic, createRng("repeat"), 2);
    expect(b).toEqual(a);
  });
});

describe("the exact trigger chance", () => {
  const tiny = makeGame({
    reels: 3,
    rows: 2,
    strips: [
      ["A", "S", "B", "A", "S", "W"],
      ["B", "S", "A", "S", "A", "W"],
      ["A", "B", "S", "A", "B", "W"],
    ],
    paylines: [[0, 0, 0], [1, 1, 1]],
    pays: { A: { 2: 3, 3: 12 }, B: { 2: 1, 3: 6 }, W: {} },
    wild: "W",
    scatter: { symbol: "S", pays: { 2: 1 } },
    feature: {
      spins: { 3: 4 },
      strips: [["A", "W", "B"], ["W", "A", "S"], ["B", "W", "S"]],
      retrigger: { 3: 1 },
      maxSpins: 6,
    },
  });

  it("equals the share of every possible opening grid that holds enough scatters", () => {
    const lengths = tiny.strips.map((strip) => strip.length);
    const counts = [0, 0, 0, 0, 0, 0, 0];
    let outcomes = 0;
    for (let a = 0; a < lengths[0]!; a++) {
      for (let b = 0; b < lengths[1]!; b++) {
        for (let c = 0; c < lengths[2]!; c++) {
          const scatters = buildGrid(tiny, [a, b, c]).flat().filter((symbol) => symbol === "S").length;
          counts[scatters]!++;
          outcomes++;
        }
      }
    }
    const exact = openingScatterProbabilities(tiny);
    counts.forEach((n, scatters) => expect(exact[scatters] ?? 0).toBeCloseTo(n / outcomes, 12));
    expect(exact.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(triggerProbability(tiny)).toBeCloseTo((counts[3]! + counts[4]! + counts[5]! + counts[6]!) / outcomes, 12);
    expect(counts[3]).toBeGreaterThan(0);
  });

  it("is zero for a game without a feature", () => {
    expect(triggerProbability(makeGame())).toBe(0);
  });
});

/**
 * An independent calculation of a feature's exact average value on a small game, written from the
 * rules alone: it never calls the engine's feature code, and it works through every possible stop
 * on every spin, carrying the locked wilds (as a set of cells), the spins played and the spins left.
 */
function exactFeatureValue(config: GameConfig, scatters: number, options: { sticky: boolean }): number {
  const feature = config.feature!;
  const lineBet = 1;
  const totalBet = config.paylines.length * lineBet;
  const lengths = feature.strips.map((strip) => strip.length);
  const pays = config.pays;

  const lineMultiple = (symbols: readonly string[]): number => {
    const anchor = symbols.find((symbol) => symbol !== "W");
    if (anchor === undefined || anchor === "S") return 0;
    let run = 0;
    for (const symbol of symbols) {
      if (symbol === anchor || symbol === "W") run++;
      else break;
    }
    return lookupPay(pays[anchor]!, run);
  };

  const memo = new Map<string, number>();
  const solve = (played: number, left: number, locked: number): number => {
    if (left === 0) return 0;
    const key = `${played}/${left}/${locked}`;
    const known = memo.get(key);
    if (known !== undefined) return known;

    let sum = 0;
    let combos = 0;
    const stops = [0, 0, 0];
    for (stops[0] = 0; stops[0]! < lengths[0]!; stops[0]!++) {
      for (stops[1] = 0; stops[1]! < lengths[1]!; stops[1]!++) {
        for (stops[2] = 0; stops[2]! < lengths[2]!; stops[2]!++) {
          const landed = stops.map((stop, reel) => Array.from({ length: config.rows }, (_, row) => feature.strips[reel]![(stop + row) % lengths[reel]!]!));
          const grid = landed.map((column, reel) => column.map((symbol, row) => (locked & (1 << (reel * config.rows + row)) ? "W" : symbol)));
          let win = 0;
          for (const line of config.paylines) win += lineMultiple(grid.map((column, reel) => column[line[reel]!]!)) * lineBet;
          const shown = grid.flat().filter((symbol) => symbol === "S").length;
          win += lookupPay(config.scatter!.pays, shown) * totalBet;

          let nextLocked = locked;
          if (options.sticky) {
            landed.forEach((column, reel) => column.forEach((symbol, row) => symbol === "W" && (nextLocked |= 1 << (reel * config.rows + row))));
          }
          const room = feature.maxSpins - (played + 1) - (left - 1);
          const added = Math.max(0, Math.min(lookupPay(feature.retrigger, shown), room));
          sum += win + solve(played + 1, left - 1 + added, nextLocked);
          combos++;
        }
      }
    }
    const value = sum / combos;
    memo.set(key, value);
    return value;
  };
  return solve(0, lookupPay(feature.spins, scatters), 0);
}

describe("a feature solved exactly", () => {
  // Two rows, so the way cells are numbered across reels and rows is exercised; wilds on every reel;
  // scatters that pay and that retrigger; a most-spins limit that is sometimes reached.
  const small = makeGame({
    reels: 3,
    rows: 2,
    strips: [
      ["A", "S", "B", "W"],
      ["B", "S", "A", "W"],
      ["A", "B", "S", "W"],
    ],
    paylines: [[0, 0, 0], [1, 1, 1], [0, 1, 0]],
    pays: { A: { 2: 3, 3: 12 }, B: { 2: 1, 3: 6 }, W: {} },
    wild: "W",
    scatter: { symbol: "S", pays: { 2: 1 } },
    feature: {
      spins: { 2: 3 },
      strips: [
        ["A", "W", "B"],
        ["W", "A", "S"],
        ["B", "W", "S"],
      ],
      retrigger: { 2: 1 },
      maxSpins: 5,
    },
  });

  it("averages what the independent calculation says, within sampling error", { timeout: 60_000 }, () => {
    const exact = exactFeatureValue(small, 2, { sticky: true });
    const rng = createRng("exact-feature");
    const sessions = 400_000;
    let sum = 0;
    let sumSquares = 0;
    for (let i = 0; i < sessions; i++) {
      const value = playFeatureSession(small, rng, 1, 2);
      sum += value;
      sumSquares += value * value;
    }
    const mean = sum / sessions;
    const standardError = Math.sqrt((sumSquares / sessions - mean * mean) / sessions);
    expect(Math.abs(mean - exact) / standardError).toBeLessThan(4);
  });

  it("would notice if wilds did not lock: that changes the exact answer a great deal", () => {
    // Locking can go either way here: a locked wild helps lines but covers whatever scatter was under it,
    // and this game is scatter-heavy. What matters is that the difference is far larger than the test's sampling error.
    const sticky = exactFeatureValue(small, 2, { sticky: true });
    const loose = exactFeatureValue(small, 2, { sticky: false });
    expect(Math.abs(sticky - loose) / loose).toBeGreaterThan(0.1);
  });
});

describe("feature configuration", () => {
  const strips = Array.from({ length: 5 }, () => ["A", "B", "C", "W", "S"]);
  const withFeature = (feature: Partial<NonNullable<GameConfig["feature"]>> = {}, rest: Partial<GameConfig> = {}): GameConfig =>
    rawGame({ feature: { spins: { 3: 8 }, strips, retrigger: { 3: 4 }, maxSpins: 20, ...feature }, ...rest });

  it("accepts a sound feature, and the shipped game", () => {
    expect(findConfigProblems(withFeature())).toEqual([]);
    expect(findConfigProblems(classic)).toEqual([]);
  });

  it("needs a wild and a scatter", () => {
    expect(findConfigProblems(withFeature({}, { wild: null, pays: { A: { 3: 1 } } })).join("\n")).toContain("needs a wild");
    expect(findConfigProblems(withFeature({}, { scatter: null })).join("\n")).toContain("needs a scatter");
  });

  it("needs a strip for every reel, each long enough, using only symbols the base reels have", () => {
    expect(findConfigProblems(withFeature({ strips: strips.slice(0, 4) })).join("\n")).toContain("feature.strips has 4 entries");
    expect(findConfigProblems(withFeature({ strips: [["A"], ...strips.slice(1)] })).join("\n")).toContain("feature.strips[0] has 1 symbols");
    expect(findConfigProblems(withFeature({ strips: [["A", "B", "Z"], ...strips.slice(1)] })).join("\n")).toContain('contains "Z"');
  });

  it("needs spins that mean something, and a limit that fits them", () => {
    expect(findConfigProblems(withFeature({ spins: {} })).join("\n")).toContain("could never be triggered");
    expect(findConfigProblems(withFeature({ spins: { 3: 0 } })).join("\n")).toContain("at least one spin");
    expect(findConfigProblems(withFeature({ retrigger: { 3: 0 } })).join("\n")).toContain("at least one spin");
    expect(findConfigProblems(withFeature({ spins: { 3: 8, 5: 25 }, maxSpins: 20 })).join("\n")).toContain("maxSpins");
    expect(findConfigProblems(withFeature({ spins: { 99: 8 } })).join("\n")).toContain("feature.spins");
  });

  it("checks the win cap", () => {
    expect(findConfigProblems(rawGame({ maxWinMultiple: 0 })).join("\n")).toContain("maxWinMultiple");
    expect(findConfigProblems(rawGame({ maxWinMultiple: 2.5 })).join("\n")).toContain("maxWinMultiple");
    expect(findConfigProblems(rawGame({ maxWinMultiple: 5000 }))).toEqual([]);
  });
});
