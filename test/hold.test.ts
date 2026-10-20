import { describe, expect, it } from "vitest";
import { createRng, spinFromStops } from "../src/engine/index.ts";
import {
  buyHold,
  defineHoldGame,
  exactHoldReturn,
  findHoldProblems,
  HoldConfigError,
  holdOutcome,
  holdPrice,
  holdValue,
  meanCoinValue,
  playHoldRound,
  playHoldRoundFromStops,
  playHoldSession,
  smallestHoldWinMultiple,
} from "../src/engine/hold/index.ts";
import type { HoldFeature, HoldGameConfig } from "../src/engine/hold/index.ts";
import { mint } from "../src/games/mint.ts";
import { makeHoldGame, rawHoldGame, scriptedRng, tinyBase, tinyHold } from "./holdFixtures.ts";

const cellOf = (game: HoldGameConfig, [reel, row]: readonly [number, number]): number => reel * game.base.rows + row;

describe("defineHoldGame", () => {
  it("returns a deeply frozen game", () => {
    const game = makeHoldGame();
    expect(Object.isFrozen(game)).toBe(true);
    expect(Object.isFrozen(game.hold.values)).toBe(true);
    expect(Object.isFrozen(game.hold.values[0])).toBe(true);
    expect(Object.isFrozen(game.hold.landing)).toBe(true);
  });

  it("accepts the shipped game and the fixture", () => {
    expect(findHoldProblems(mint)).toEqual([]);
    expect(findHoldProblems(rawHoldGame())).toEqual([]);
  });

  it("throws a HoldConfigError that lists every problem at once", () => {
    const bad = rawHoldGame({ minCoins: 0, respins: 0, values: [] });
    const error = (() => {
      try {
        defineHoldGame(bad);
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(HoldConfigError);
    expect((error as HoldConfigError).problems.length).toBeGreaterThanOrEqual(3);
  });

  const withWildAndFeature = {
    strips: [["A", "C", "W", "A"], ["A", "C", "W", "A"], ["A", "C", "W", "A"]],
    wild: "W",
    pays: { A: { 3: 2 }, W: {} },
    feature: { spins: { 3: 2 }, strips: [["A", "C", "W", "A"], ["A", "C", "W", "A"], ["A", "C", "W", "A"]], retrigger: {}, maxSpins: 2, buyCost: null },
  };
  const cases: [string, Partial<HoldFeature>, Parameters<typeof rawHoldGame>[1], RegExp][] = [
    ["a coin that is not the base game's scatter", { coin: "Z" }, {}, /must be the base game's scatter/],
    ["a scatter that pays", {}, { scatter: { symbol: "C", pays: { 3: 1 } } }, /must pay nothing by itself/],
    ["no scatter at all", {}, { scatter: null }, /needs a scatter/],
    ["free spins in the base game", {}, withWildAndFeature, /no free spins/],
    ["a base game that is itself invalid", {}, { rows: 0 }, /base: rows must be a positive integer/],
    ["a zero minimum", { minCoins: 0 }, {}, /minCoins/],
    ["a minimum beyond the board", { minCoins: 7 }, {}, /minCoins must be an integer in \[1, 6\]/],
    ["a fractional minimum", { minCoins: 2.5 }, {}, /minCoins/],
    ["no respins", { respins: 0 }, {}, /respins must be a positive integer/],
    ["a zero buy price", { buyCost: 0 }, {}, /buyCost/],
    ["a fractional buy price", { buyCost: 1.5 }, {}, /buyCost/],
    ["a landing chance of zero", { landing: { numerator: 0, denominator: 3 } }, {}, /landing/],
    ["a landing chance of one", { landing: { numerator: 3, denominator: 3 } }, {}, /landing/],
    ["a landing chance above one", { landing: { numerator: 4, denominator: 3 } }, {}, /landing/],
    ["a fractional landing chance", { landing: { numerator: 1.5, denominator: 3 } }, {}, /landing/],
    ["no coin values", { values: [] }, {}, /hold\.values is empty/],
    ["a coin worth nothing", { values: [{ value: 0, weight: 1 }] }, {}, /value must be a positive integer/],
    ["a fractional coin value", { values: [{ value: 1.5, weight: 1 }] }, {}, /value must be a positive integer/],
    ["a coin with no weight", { values: [{ value: 1, weight: 0 }] }, {}, /weight must be a positive integer/],
    ["a fractional weight", { values: [{ value: 1, weight: 0.5 }] }, {}, /weight must be a positive integer/],
    ["a nameless jackpot", { values: [{ value: 1, weight: 1, jackpot: " " }] }, {}, /jackpot must not be empty/],
    [
      "a jackpot name used twice",
      { values: [{ value: 1, weight: 1, jackpot: "Mini" }, { value: 2, weight: 1, jackpot: "Mini" }] },
      {},
      /"Mini" is used twice/,
    ],
    ["weights beyond what one draw can cover", { values: [{ value: 1, weight: 2 ** 32 }, { value: 2, weight: 1 }] }, {}, /more than 2\^32/],
    ["a nameless full-board prize", { fullBoard: { name: "", value: 5 } }, {}, /fullBoard\.name/],
    ["a full-board prize named like a coin", { fullBoard: { name: "Mini", value: 5 }, values: [{ value: 1, weight: 1, jackpot: "Mini" }] }, {}, /which a coin is also called/],
    ["a full-board prize worth nothing", { fullBoard: { name: "Grand", value: 0 } }, {}, /fullBoard\.value/],
  ];

  it.each(cases)("flags %s", (_name, hold, base, expected) => {
    const problems = findHoldProblems(rawHoldGame(hold, base));
    expect(problems.some((problem) => expected.test(problem))).toBe(true);
  });
});

describe("a feature played by hand", () => {
  // The fixture's strips put a coin in the bottom row at stop 0 and in the top row at stop 1; stop 2 shows none.
  const game = makeHoldGame();
  const lineBet = 3;

  it("starts from the coins on the grid, draws values in order, and runs respins down", () => {
    // Stops 0, 1, 2: coins at reel 0 row 1 (cell 1) and reel 1 row 0 (cell 2). Two coins start the feature.
    // Start values: 3 -> the 4 coin (weights 3 and 1), 0 -> the 1 coin.
    // Respin 1 visits cells 0, 3, 4, 5: no, yes (value draw 0 -> 1), no, yes (value draw 3 -> 4). The respins reset.
    // Respin 2: no, no. Respin 3: no, no. The feature ends with none left.
    const rng = scriptedRng([3, 0, /* respin 1 */ 1, 0, 0, 2, 0, 3, /* respin 2 */ 1, 1, /* respin 3 */ 2, 1]);
    const round = playHoldRoundFromStops(game, rng, [0, 1, 2], lineBet);
    rng.finished();

    expect(round.base.totalWin).toBe(0);
    expect(round.totalBet).toBe(6);
    const feature = round.feature!;
    expect(feature.start.map((coin) => [coin.position, coin.value, coin.win])).toEqual([
      [[0, 1], 4, 12],
      [[1, 0], 1, 3],
    ]);
    expect(feature.respins).toEqual([
      {
        landed: [
          { position: [1, 1], value: 1, jackpot: null, win: 3 },
          { position: [2, 1], value: 4, jackpot: null, win: 12 },
        ],
        respinsLeft: 2,
        coinCount: 4,
      },
      { landed: [], respinsLeft: 1, coinCount: 4 },
      { landed: [], respinsLeft: 0, coinCount: 4 },
    ]);
    expect(feature.coins.map((coin) => coin.value)).toEqual([4, 1, 1, 4]);
    expect(feature.full).toBe(false);
    expect(feature.coinWin).toBe(30);
    expect(feature.fullBoardWin).toBe(0);
    expect(feature.win).toBe(30);
    expect(round.totalWin).toBe(30);
  });

  it("resets the respins on a coin even on the last one, and pays the full-board prize when the board fills", () => {
    const rng = scriptedRng([
      3, 0, // start values: 4, 1
      /* respin 1: cells 0, 3, 4, 5 */ 1, 1, 1, 1,
      /* respin 2: cell 0 lands (value draw 1 -> 1); cells 3, 4, 5 do not */ 0, 1, 2, 1, 2,
      /* respin 3: cells 3, 4, 5 all land, with values 1, 4, 1 */ 0, 0, 0, 3, 0, 0,
    ]);
    const round = playHoldRoundFromStops(game, rng, [0, 1, 2], 1);
    rng.finished();

    const feature = round.feature!;
    expect(feature.respins.map((r) => [r.landed.length, r.respinsLeft, r.coinCount])).toEqual([
      [0, 1, 2],
      [1, 2, 3], // the coin landed with one respin left, so it is back to two
      [3, 0, 6], // a full board ends the feature at once
    ]);
    expect(feature.full).toBe(true);
    expect(feature.coins).toHaveLength(6);
    expect(new Set(feature.coins.map((coin) => cellOf(game, coin.position))).size).toBe(6);
    expect(feature.coinWin).toBe(4 + 1 + 1 + 1 + 4 + 1);
    expect(feature.fullBoardWin).toBe(50);
    expect(feature.win).toBe(62);
  });

  it("does not start with too few coins, and draws nothing for the feature when it does not", () => {
    const rng = scriptedRng([]);
    const round = playHoldRoundFromStops(game, rng, [0, 2, 2], 1); // one coin
    expect(round.feature).toBeNull();
    expect(round.totalWin).toBe(round.base.totalWin);
    rng.finished();
  });

  it("starts with every coin on a full grid and plays no respins", () => {
    // A board where the opening grid is already full has nothing to fill: the feature pays what is there and the prize.
    const small = makeHoldGame({ minCoins: 6 }, { strips: [["C", "C", "C", "C"], ["C", "C", "C", "C"], ["C", "C", "C", "C"]], pays: {} });
    const rng = scriptedRng([0, 0, 0, 0, 0, 0]);
    const round = playHoldRoundFromStops(small, rng, [0, 0, 0], 2);
    rng.finished();
    expect(round.feature!.respins).toEqual([]);
    expect(round.feature!.full).toBe(true);
    expect(round.feature!.win).toBe(6 * 1 * 2 + 50 * 2);
  });

  it("marks jackpot coins by name and pays them like any coin", () => {
    const named = makeHoldGame({ values: [{ value: 7, weight: 1, jackpot: "Mini" }, { value: 1, weight: 1 }], respins: 1 });
    // Weights 1 and 1: a draw of 0 is the Mini, 1 the plain coin. Start: Mini, plain. One respin, nothing lands.
    const rng = scriptedRng([0, 1, 1, 1, 1, 1]);
    const round = playHoldRoundFromStops(named, rng, [0, 1, 2], 2);
    rng.finished();
    expect(round.feature!.start.map((coin) => [coin.jackpot, coin.value, coin.win])).toEqual([
      ["Mini", 7, 14],
      [null, 1, 2],
    ]);
  });

  it("buys a feature from exactly the fewest coins, in cells it chose, with no opening spin", () => {
    // The partial shuffle: draw 4 of 6 -> cell 4; then 1 of the remaining 5 -> swaps in cell 2. Cells 2 and 4, in order.
    // Their values: 3 -> 4, 2 -> 1. Two respins, nothing lands in either (four cells each).
    const rng = scriptedRng([4, 1, 3, 2, 1, 1, 1, 1, 1, 1, 1, 1]);
    const bought = buyHold(game, rng, lineBet);
    rng.finished();
    expect(bought.price).toBe(5 * 3 * 2);
    expect(bought.totalBet).toBe(6);
    expect(bought.feature.start.map((coin) => [cellOf(game, coin.position), coin.value])).toEqual([
      [2, 4],
      [4, 1],
    ]);
    expect(bought.feature.respins).toHaveLength(2);
    expect(bought.totalWin).toBe(bought.feature.win);
    expect(bought.feature.win).toBe((4 + 1) * lineBet);
  });
});

describe("the rules held over many rounds", () => {
  const checkRound = (game: HoldGameConfig, round: ReturnType<typeof playHoldRound>): void => {
    const cells = game.base.reels * game.base.rows;
    const coinsOnGrid = round.base.grid.flat().filter((symbol) => symbol === game.hold.coin).length;
    expect(round.feature !== null).toBe(coinsOnGrid >= game.hold.minCoins);
    expect(round.totalWin).toBe(round.base.totalWin + (round.feature?.win ?? 0));
    if (round.feature === null) return;
    const feature = round.feature;
    // The coins that start it are the coin symbols of the grid, in cells with a coin on them.
    expect(feature.start).toHaveLength(coinsOnGrid);
    for (const coin of feature.start) expect(round.base.grid[coin.position[0]]![coin.position[1]]).toBe(game.hold.coin);
    // Respins: counts, resets and the cells that fill.
    let count = feature.start.length;
    let left = game.hold.respins;
    const occupied = new Set(feature.start.map((coin) => cellOf(game, coin.position)));
    for (const respin of feature.respins) {
      expect(left).toBeGreaterThan(0);
      expect(count).toBeLessThan(cells);
      for (const coin of respin.landed) {
        const cell = cellOf(game, coin.position);
        expect(occupied.has(cell)).toBe(false);
        occupied.add(cell);
      }
      count += respin.landed.length;
      left = respin.landed.length > 0 ? game.hold.respins : left - 1;
      expect(respin.coinCount).toBe(count);
      expect(respin.respinsLeft).toBe(count === cells ? 0 : left);
    }
    // It ended because the board is full or the respins ran out, and for no other reason.
    expect(count === cells || left === 0).toBe(true);
    expect(feature.full).toBe(count === cells);
    expect(feature.coins).toHaveLength(count);
    expect(occupied.size).toBe(count);
    // Every coin is one the table has, and the money adds up.
    const known = new Set(game.hold.values.map((entry) => `${entry.value}|${entry.jackpot ?? ""}`));
    let coinWin = 0;
    for (const coin of feature.coins) {
      expect(known.has(`${coin.value}|${coin.jackpot ?? ""}`)).toBe(true);
      expect(coin.win).toBe(coin.value * round.lineBet);
      coinWin += coin.win;
    }
    expect(feature.coinWin).toBe(coinWin);
    expect(feature.fullBoardWin).toBe(feature.full ? game.hold.fullBoard.value * round.lineBet : 0);
    expect(feature.win).toBe(feature.coinWin + feature.fullBoardWin);
  };

  it("holds on the shipped game: 12,000 rounds at random bets, including 600 or so that start the feature", () => {
    const rng = createRng("hold-invariants-mint");
    let features = 0;
    // Forced stops make the feature common enough to check: cycle the opening spin through stops that put coins on every reel.
    for (let i = 0; i < 12_000; i++) {
      const lineBet = 1 + (i % 7);
      const round = i % 20 === 0 ? playHoldRoundFromStops(mint, rng, mint.base.strips.map((strip, reel) => strip.indexOf("C", reel * 3 % 7) % strip.length), lineBet) : playHoldRound(mint, rng, lineBet);
      if (round.feature !== null) features++;
      checkRound(mint, round);
    }
    expect(features).toBeGreaterThan(500);
  });

  it("holds on the fixture, where the board often fills", () => {
    const game = makeHoldGame({ landing: { numerator: 1, denominator: 2 } });
    const rng = createRng("hold-invariants-tiny");
    let full = 0;
    let features = 0;
    for (let i = 0; i < 20_000; i++) {
      const round = playHoldRound(game, rng, 1 + (i % 4));
      checkRound(game, round);
      if (round.feature !== null) features++;
      if (round.feature?.full) full++;
    }
    expect(features).toBeGreaterThan(1_000);
    expect(full).toBeGreaterThan(100);
  });

  it("plays the same round from the same seed, and a different one from another", () => {
    const a = playHoldRound(mint, createRng("same"), 2);
    const b = playHoldRound(mint, createRng("same"), 2);
    expect(b).toEqual(a);
    const wins = new Set(Array.from({ length: 50 }, (_, i) => playHoldRound(mint, createRng(`seed-${i}`), 2).base.stops.join(",")));
    expect(wins.size).toBeGreaterThan(30);
  });

  it("scales every win with the bet and nothing else", () => {
    const one = playHoldRoundFromStops(makeHoldGame(), createRng("scale"), [0, 1, 2], 1);
    const five = playHoldRoundFromStops(makeHoldGame(), createRng("scale"), [0, 1, 2], 5);
    expect(five.totalWin).toBe(one.totalWin * 5);
    expect(five.feature!.coins.map((coin) => coin.position)).toEqual(one.feature!.coins.map((coin) => coin.position));
    expect(five.feature!.coins.map((coin) => coin.value)).toEqual(one.feature!.coins.map((coin) => coin.value));
  });

  it("rejects a bet that is not a whole number of credits", () => {
    expect(() => playHoldRound(mint, createRng("bet"), 0)).toThrow(RangeError);
    expect(() => playHoldRound(mint, createRng("bet"), 1.5)).toThrow(RangeError);
    expect(() => buyHold(mint, createRng("bet"), -1)).toThrow(RangeError);
  });
});

// ---- the exact calculation, against an independent one -------------------------------------------------------------------

interface Reference {
  /** Expected credits from the coins that land from here on, plus the prize if the board fills (lineBet 1). */
  win: number;
  coins: number;
  full: number;
}

/**
 * An independent solution of the feature for a small board: no binomials and no "only the count matters"
 * shortcut. It enumerates every subset of empty cells that can fill on a respin and every assignment of
 * coin values to them, over the actual set of filled cells. `reset: false` is a deliberately wrong
 * rule (a coin never sets the respins back) used to show the tests can tell the rule from its absence.
 */
function reference(game: HoldGameConfig, startMask: number, { reset = true } = {}): Reference & { start: number } {
  const { hold } = game;
  const cells = game.base.reels * game.base.rows;
  const FULL = (1 << cells) - 1;
  const p = hold.landing.numerator / hold.landing.denominator;
  const totalWeight = hold.values.reduce((sum, entry) => sum + entry.weight, 0);
  const popcount = (mask: number): number => mask.toString(2).replaceAll("0", "").length;
  const memo = new Map<string, Reference>();

  /** The expected sum of `k` independent coin values, by enumerating every assignment. */
  const expectedSum = (k: number): number => {
    let total = 0;
    const walk = (left: number, probability: number, sum: number): void => {
      if (left === 0) {
        total += probability * sum;
        return;
      }
      for (const entry of hold.values) walk(left - 1, probability * (entry.weight / totalWeight), sum + entry.value);
    };
    walk(k, 1, 0);
    return total;
  };

  const solve = (mask: number, left: number): Reference => {
    if (mask === FULL) return { win: hold.fullBoard.value, coins: cells, full: 1 };
    if (left === 0) return { win: 0, coins: popcount(mask), full: 0 };
    const key = `${mask}:${left}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    const empties = Array.from({ length: cells }, (_, cell) => cell).filter((cell) => (mask & (1 << cell)) === 0);
    const result: Reference = { win: 0, coins: 0, full: 0 };
    for (let subset = 0; subset < 1 << empties.length; subset++) {
      const landed = empties.filter((_, index) => (subset & (1 << index)) !== 0);
      const probability = p ** landed.length * (1 - p) ** (empties.length - landed.length);
      const next = solve(landed.reduce((m, cell) => m | (1 << cell), mask), landed.length > 0 && reset ? hold.respins : left - 1);
      result.win += probability * (expectedSum(landed.length) + next.win);
      result.coins += probability * next.coins;
      result.full += probability * next.full;
    }
    memo.set(key, result);
    return result;
  };

  const solved = solve(startMask, hold.respins);
  const startCoins = popcount(startMask);
  return { win: expectedSum(startCoins) + solved.win, coins: solved.coins, full: solved.full, start: startCoins };
}

const masksOfSize = (cells: number, size: number): number[] =>
  Array.from({ length: 1 << cells }, (_, mask) => mask).filter((mask) => mask.toString(2).replaceAll("0", "").length === size);

describe("the exact value of the feature", () => {
  const boards: [string, HoldGameConfig][] = [
    ["a 3x2 board, two respins, a third", makeHoldGame()],
    ["three respins, a quarter", makeHoldGame({ respins: 3, landing: { numerator: 1, denominator: 4 }, minCoins: 1 })],
    ["one respin, a half", makeHoldGame({ respins: 1, landing: { numerator: 1, denominator: 2 } })],
    [
      "a 4x2 board with a richer coin table",
      makeHoldGame(
        { values: [{ value: 2, weight: 5 }, { value: 3, weight: 2, jackpot: "Mini" }, { value: 11, weight: 1 }], landing: { numerator: 2, denominator: 7 }, fullBoard: { name: "Grand", value: 30 } },
        { reels: 4, strips: Array.from({ length: 4 }, () => ["A", "C", "A", "A"]), paylines: [[0, 0, 0, 0], [1, 1, 1, 1]], pays: { A: { 3: 2 } } },
      ),
    ],
  ];

  it.each(boards)("matches a full enumeration of every outcome, on %s", (_name, game) => {
    const cells = game.base.reels * game.base.rows;
    const lines = game.base.paylines.length;
    for (let start = 1; start <= Math.min(cells, 5); start++) {
      const analytic = holdValue(game, start) * lines; // credits at a bet of one per line
      const outcome = holdOutcome(game.hold, cells, start);
      // Where the coins sit makes no difference: every set of that many cells gives the same answer.
      for (const mask of masksOfSize(cells, start).filter((_, index) => index % 3 === 0).slice(0, 8)) {
        const expected = reference(game, mask);
        expect(expected.win, `value from ${start} coins, cells ${mask.toString(2)}`).toBeCloseTo(analytic, 9);
        expect(expected.coins).toBeCloseTo(outcome.expectedCoins, 9);
        expect(expected.full).toBeCloseTo(outcome.fullProbability, 9);
      }
    }
  });

  it("gives the whole game's return as the enumeration of every opening spin plus the feature each starts", () => {
    const game = makeHoldGame();
    const exact = exactHoldReturn(game);
    const lines = game.base.paylines.length;
    const stripLength = game.base.strips[0]!.length;
    let total = 0;
    let trigger = 0;
    const cells = game.base.reels * game.base.rows;
    for (let a = 0; a < stripLength; a++) {
      for (let b = 0; b < stripLength; b++) {
        for (let c = 0; c < stripLength; c++) {
          const spin = spinFromStops(game.base, [a, b, c], 1);
          let win = spin.totalWin;
          const coinMask = spin.grid.flat().reduce((mask, symbol, index) => (symbol === "C" ? mask | (1 << index) : mask), 0);
          if (coinMask.toString(2).replaceAll("0", "").length >= game.hold.minCoins) {
            // The grid is [reel][row] flattened reel by reel, which is the cell numbering the board uses.
            win += reference(game, coinMask).win;
            trigger += 1 / stripLength ** 3;
          }
          total += win / lines / stripLength ** 3;
        }
      }
    }
    expect(cells).toBe(6);
    expect(exact.total).toBeCloseTo(total, 12);
    expect(exact.trigger).toBeCloseTo(trigger, 12);
    expect(exact.base.total + exact.feature).toBeCloseTo(exact.total, 15);
    expect(exact.perStart.reduce((sum, start) => sum + start.probability, 0)).toBeCloseTo(exact.trigger, 15);
    expect(exact.buyValue).toBeCloseTo(holdValue(game, game.hold.minCoins), 15);
  });

  it("is the value the engine plays out: simulated features agree with it, and would not if a coin did not reset the respins", () => {
    const game = makeHoldGame();
    const lines = game.base.paylines.length;
    const rng = createRng("hold-engine-vs-exact");
    const n = 300_000;
    for (const start of [2, 3, 4]) {
      let sum = 0;
      let squares = 0;
      for (let i = 0; i < n; i++) {
        const win = playHoldSession(game, rng, 1, start);
        sum += win;
        squares += win * win;
      }
      const mean = sum / n;
      const standardError = Math.sqrt((squares / n - mean * mean) / n);
      const exact = holdValue(game, start) * lines;
      expect(Math.abs(mean - exact) / standardError, `from ${start} coins: simulated ${mean.toFixed(3)}, exact ${exact.toFixed(3)}`).toBeLessThan(4);
      // The same chain with the reset taken out is far from what the engine does: the check can tell.
      const wrong = reference(game, (1 << start) - 1, { reset: false }).win;
      expect(Math.abs(mean - wrong) / standardError, `without the reset ${wrong.toFixed(3)}`).toBeGreaterThan(10);
    }
  });

  it("is the mean coin times the average coin count, plus the prize times its chance", () => {
    const game = makeHoldGame();
    const outcome = holdOutcome(game.hold, 6, 2);
    expect(meanCoinValue(game.hold)).toBeCloseTo((3 * 1 + 1 * 4) / 4, 15);
    expect(holdValue(game, 2) * 2).toBeCloseTo(meanCoinValue(game.hold) * outcome.expectedCoins + 50 * outcome.fullProbability, 12);
  });

  it("ends where it starts when a board starts full, and cannot fill from a start with no landing", () => {
    const game = makeHoldGame();
    const full = holdOutcome(game.hold, 6, 6);
    expect(full.expectedCoins).toBe(6);
    expect(full.fullProbability).toBe(1);
    // Almost no chance to land: the board stays as it began.
    const stingy = holdOutcome({ ...tinyHold(), landing: { numerator: 1, denominator: 2 ** 31 } }, 6, 2);
    expect(stingy.expectedCoins).toBeCloseTo(2, 6);
    expect(stingy.fullProbability).toBeLessThan(1e-9);
  });

  it("rises with the number of starting coins and with the chance of landing", () => {
    for (let start = 1; start < 6; start++) expect(holdValue(mint, start + 1)).toBeGreaterThan(holdValue(mint, start));
    const slow = { ...mint, hold: { ...mint.hold, landing: { numerator: 1, denominator: 20 } } };
    const fast = { ...mint, hold: { ...mint.hold, landing: { numerator: 1, denominator: 10 } } };
    expect(holdValue(fast, 6)).toBeGreaterThan(holdValue(mint, 6));
    expect(holdValue(mint, 6)).toBeGreaterThan(holdValue(slow, 6));
  });
});

describe("buying the feature", () => {
  it("prices it in multiples of the total bet, which grow with the bet", () => {
    expect(holdPrice(mint, 1)).toBe(mint.hold.buyCost! * 20);
    expect(holdPrice(mint, 5)).toBe(mint.hold.buyCost! * 100);
    expect(holdPrice(makeHoldGame({ buyCost: null }), 1)).toBeNull();
  });

  it("cannot be bought in a game that does not sell it", () => {
    expect(() => buyHold(makeHoldGame({ buyCost: null }), createRng("nobuy"), 1)).toThrow(/cannot be bought/);
  });

  it("returns a little under what the machine does, and most buys pay less than they cost", () => {
    const exact = exactHoldReturn(mint);
    const rate = exact.buyValue / mint.hold.buyCost!;
    expect(rate).toBeGreaterThan(0.93);
    expect(rate).toBeLessThan(0.975);
    expect(rate).toBeLessThan(exact.total);
    const rng = createRng("hold-buys");
    let short = 0;
    const buys = 20_000;
    for (let i = 0; i < buys; i++) if (buyHold(mint, rng, 1).totalWin < mint.hold.buyCost! * 20) short++;
    expect(short / buys).toBeGreaterThan(0.5);
  });

  it("starts from exactly the fewest coins that trigger it, wherever they land, and pays only the feature", () => {
    const rng = createRng("hold-buy-shape");
    const places = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const bought = buyHold(mint, rng, 2);
      expect(bought.feature.start).toHaveLength(mint.hold.minCoins);
      const cells = bought.feature.start.map((coin) => cellOf(mint, coin.position));
      expect(new Set(cells).size).toBe(mint.hold.minCoins);
      expect([...cells].sort((a, b) => a - b)).toEqual(cells);
      cells.forEach((cell) => places.add(cell));
      expect(bought.totalWin).toBe(bought.feature.win);
      expect(bought.price).toBe(mint.hold.buyCost! * 40);
    }
    expect(places.size).toBe(15);
  });

  it("measures a session from any number of starting coins, and refuses a number that would not start it", () => {
    const rng = createRng("hold-session");
    expect(playHoldSession(mint, rng, 1, 6)).toBeGreaterThan(0);
    expect(playHoldSession(mint, rng, 1, 15)).toBeGreaterThan(mint.hold.fullBoard.value);
    expect(() => playHoldSession(mint, rng, 1, 5)).toThrow(RangeError);
    expect(() => playHoldSession(mint, rng, 1, 16)).toThrow(RangeError);
    expect(() => playHoldSession(mint, rng, 1, 6.5)).toThrow(RangeError);
  });
});

describe("the smallest win", () => {
  it("is the smaller of the smallest line pay and the cheapest possible feature", () => {
    // Fixture: one line pay of 2 over two lines (1x), and two cheapest coins (2 of value 1) over two lines (1x).
    expect(smallestHoldWinMultiple(makeHoldGame())).toBe(1);
    // Coins of 1 make the cheapest feature 6 x 1 over 20 lines: less than the bet, however high the line pays are.
    const cheap = { ...mint, hold: { ...mint.hold, values: [{ value: 1, weight: 1 }] } };
    expect(smallestHoldWinMultiple(cheap)).toBe(6 / 20);
    // With dear coins in the table too, it is the cheapest coin that sets the floor, not the dearest.
    const mixed = { ...mint, hold: { ...mint.hold, values: [{ value: 1, weight: 1 }, { value: 50, weight: 1 }] } };
    expect(smallestHoldWinMultiple(mixed)).toBe(6 / 20);
    // The shipped game: lines pay at least 1.1x, and six of the cheapest coin (half the bet) are 3x.
    expect(smallestHoldWinMultiple(mint)).toBe(1.1);
    const lowLines = { ...mint, base: { ...mint.base, pays: { ...mint.base.pays, L2: { 3: 8, 4: 40, 5: 220 } } } };
    expect(smallestHoldWinMultiple(lowLines)).toBe(8 / 20);
  });
});
