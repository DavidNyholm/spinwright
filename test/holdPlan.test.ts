import { describe, expect, it } from "vitest";
import { SETTINGS } from "../src/app/settings.ts";
import { createRng } from "../src/engine/index.ts";
import { playHoldRound, playHoldRoundFromStops } from "../src/engine/hold/index.ts";
import { mint } from "../src/games/mint.ts";
import { coinLabel, jackpotRank, planHold, prizeLadder } from "../src/ui/holdPlan.ts";
import { makeHoldGame, scriptedRng } from "./holdFixtures.ts";

describe("planHold", () => {
  // The first feature of test/hold.test.ts: coins 4 and 1 start it, respin 1 lands a 1 and a 4, then two respins land nothing.
  const game = makeHoldGame();
  const lineBet = 3;
  const rng = scriptedRng([3, 0, 1, 0, 0, 2, 0, 3, 1, 1, 2, 1]);
  const round = playHoldRoundFromStops(game, rng, [0, 1, 2], lineBet);
  const plan = planHold(game, round.feature!);

  it("reveals the starting coins and what they are worth together", () => {
    expect(plan.reveal.kind).toBe("reveal");
    expect(plan.reveal.coins.map((coin) => coin.position)).toEqual([[0, 1], [1, 0]]);
    expect(plan.reveal.coinCount).toBe(2);
    expect(plan.reveal.total).toBe(12 + 3);
  });

  it("lists the empty cells before each respin, reel by reel and top to bottom", () => {
    expect(plan.respins.map((beat) => beat.empty)).toEqual([
      [[0, 0], [1, 1], [2, 0], [2, 1]],
      [[0, 0], [2, 0]],
      [[0, 0], [2, 0]],
    ]);
  });

  it("reads off the respins left, whether they reset, and the board's count and worth after each respin", () => {
    expect(plan.respins.map((beat) => [beat.number, beat.landed.length, beat.respinsLeft, beat.refilled, beat.coinCount, beat.total])).toEqual([
      [1, 2, 2, true, 4, 30],
      [2, 0, 1, false, 4, 30],
      [3, 0, 0, false, 4, 30],
    ]);
  });

  it("ends on what the feature paid", () => {
    expect(plan.coinWin).toBe(30);
    expect(plan.fullBoardWin).toBe(0);
    expect(plan.win).toBe(30);
    expect(plan.full).toBe(false);
    expect(plan.respins.at(-1)!.total).toBe(plan.coinWin);
  });

  it("is a reading of the result and not part of it: planning draws nothing and changes nothing", () => {
    const again = playHoldRoundFromStops(game, scriptedRng([3, 0, 1, 0, 0, 2, 0, 3, 1, 1, 2, 1]), [0, 1, 2], lineBet);
    expect(again).toEqual(round);
    expect(planHold(game, round.feature!)).toEqual(plan);
  });

  it("lists the jackpots in the order they land, the starting coins first", () => {
    const named = makeHoldGame({ values: [{ value: 7, weight: 1, jackpot: "Mini" }, { value: 1, weight: 1 }], respins: 2, landing: { numerator: 1, denominator: 2 } });
    // Start: Mini, plain. Respin 1: cell 0 lands as a plain coin (0 then value draw 1), cell 3 does not, cell 4 lands as a Mini, cell 5 does not.
    const scripted = scriptedRng([0, 1, /* respin 1 */ 0, 1, 1, 0, 0, 1, /* respin 2 */ 1, 1, 1, 1, /* respin 3? */ 1, 1, 1, 1]);
    const result = playHoldRoundFromStops(named, scripted, [0, 1, 2], 1).feature!;
    expect(planHold(named, result).jackpots).toEqual(["Mini", "Mini"]);
    expect(result.coins.filter((coin) => coin.jackpot !== null)).toHaveLength(2);
  });
});

describe("planHold on the shipped game", () => {
  it("agrees with every feature over thousands of rounds", () => {
    const rng = createRng("hold-plan-mint");
    const cells = mint.base.reels * mint.base.rows;
    let features = 0;
    for (let i = 0; i < 6_000; i++) {
      const stops = mint.base.strips.map((strip, reel) => strip.indexOf("C", (reel * 3) % 7) % strip.length);
      const round = i % 3 === 0 ? playHoldRoundFromStops(mint, rng, stops, 1 + (i % 5)) : playHoldRound(mint, rng, 1 + (i % 5));
      if (round.feature === null) continue;
      features++;
      const feature = round.feature;
      const plan = planHold(mint, feature);

      expect(plan.respins).toHaveLength(feature.respins.length);
      expect(plan.reveal.total).toBe(feature.start.reduce((sum, coin) => sum + coin.win, 0));
      let previousCount = plan.reveal.coinCount;
      let previousTotal = plan.reveal.total;
      plan.respins.forEach((beat, index) => {
        const respin = feature.respins[index]!;
        // The cells that were empty are exactly the board's cells less the coins already on it.
        expect(beat.empty).toHaveLength(cells - previousCount);
        expect(new Set(beat.empty.map(([reel, row]) => `${reel},${row}`)).size).toBe(beat.empty.length);
        // Every coin that landed landed in one of them.
        const empty = new Set(beat.empty.map(([reel, row]) => `${reel},${row}`));
        for (const coin of beat.landed) expect(empty.has(`${coin.position[0]},${coin.position[1]}`)).toBe(true);
        expect(beat.respinsLeft).toBe(respin.respinsLeft);
        expect(beat.refilled).toBe(respin.landed.length > 0);
        expect(beat.coinCount).toBe(previousCount + respin.landed.length);
        expect(beat.total).toBe(previousTotal + respin.landed.reduce((sum, coin) => sum + coin.win, 0));
        previousCount = beat.coinCount;
        previousTotal = beat.total;
      });
      expect(previousCount).toBe(feature.coins.length);
      expect(previousTotal).toBe(feature.coinWin);
      expect(plan.win).toBe(feature.win);
      expect(plan.jackpots).toHaveLength(feature.coins.filter((coin) => coin.jackpot !== null).length);
    }
    expect(features).toBeGreaterThan(2_000);
  });
});

describe("coinLabel", () => {
  it("writes small amounts out with separators", () => {
    expect(coinLabel(0)).toBe("0");
    expect(coinLabel(20)).toBe("20");
    expect(coinLabel(1_240)).toBe("1,240");
    expect(coinLabel(9_999)).toBe("9,999");
  });

  it("goes to thousands, then millions, so the biggest coin at the biggest bet still fits", () => {
    expect(coinLabel(10_000)).toBe("10K");
    expect(coinLabel(12_499)).toBe("12K");
    expect(coinLabel(12_500)).toBe("13K");
    expect(coinLabel(999_499)).toBe("999K");
    expect(coinLabel(999_500)).toBe("1.0M");
    expect(coinLabel(999_999)).toBe("1.0M");
    expect(coinLabel(1_000_000)).toBe("1.0M");
    expect(coinLabel(2_500_000)).toBe("2.5M");
  });

  it("never needs more than five characters for a coin of the shipped game at its biggest bet", () => {
    const biggestBet = Math.max(...SETTINGS.betLevels);
    for (const entry of mint.hold.values) expect(coinLabel(entry.value * biggestBet).length).toBeLessThanOrEqual(5);
  });
});

describe("the prize ladder", () => {
  it("lists the jackpots lowest first and the full-board prize last, as multiples of the total bet", () => {
    expect(prizeLadder(mint)).toEqual([
      { name: "Mini", multiple: 10, fullBoard: false },
      { name: "Minor", multiple: 25, fullBoard: false },
      { name: "Major", multiple: 100, fullBoard: false },
      { name: "Grand", multiple: 500, fullBoard: true },
    ]);
  });

  it("sorts jackpots by what they are worth, not by the order they are written in", () => {
    const shuffled = makeHoldGame({
      values: [
        { value: 40, weight: 1, jackpot: "Big" },
        { value: 1, weight: 5 },
        { value: 4, weight: 1, jackpot: "Small" },
      ],
    });
    expect(prizeLadder(shuffled).map((prize) => prize.name)).toEqual(["Small", "Big", "Grand"]);
  });

  it("is only the full-board prize for a game with no jackpot coins", () => {
    expect(prizeLadder(makeHoldGame())).toEqual([{ name: "Grand", multiple: 25, fullBoard: true }]);
  });

  it("ranks a jackpot coin among the jackpots, and an ordinary coin as none", () => {
    const rng = createRng("hold-rank");
    const seen = new Map<string | null, number | null>();
    for (let i = 0; i < 400; i++) {
      for (const coin of playHoldRoundFromStops(mint, rng, mint.base.strips.map((strip) => strip.indexOf("C")), 1).feature?.coins ?? []) {
        seen.set(coin.jackpot, jackpotRank(mint, coin));
      }
    }
    expect(seen.get(null)).toBeNull();
    expect(seen.get("Mini")).toBe(0);
    expect(seen.get("Minor")).toBe(1);
    expect(seen.get("Major")).toBe(2);
  });
});
