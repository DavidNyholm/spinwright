import { createRng } from "../engine/index.ts";
import { exactHoldReturn, playHoldRound, playHoldSession } from "../engine/hold/index.ts";
import type { HoldGameConfig } from "../engine/hold/index.ts";
import { Running } from "./running.ts";
import { WIN_BANDS } from "./stats.ts";

/** A simulated figure further than this many standard errors from the exact one means a bug, not bad luck. */
const MAX_Z = 4;

const percent = (fraction: number, digits = 2): string => `${(fraction * 100).toFixed(digits)}%`;
const oneIn = (fraction: number): string => (fraction > 0 ? `1 in ${(1 / fraction).toFixed(1)}` : "never");
const count = (n: number): string => n.toLocaleString("en-US");

export interface HoldSimOptions {
  readonly rounds: number;
  /** Features simulated on their own, for each number of starting coins, to check the exact value of each. */
  readonly sessions: number;
  readonly seed: string;
  readonly lineBet: number;
}

/**
 * Simulates a hold-and-win game and prints a report. Unlike a free-spins game, the whole return is
 * worked out exactly (see exactHoldReturn), so the simulation is a check and not the source of the
 * number: whole bets played end to end must match the exact opening spin and the exact feature, and
 * features played on their own from each number of starting coins must match the exact value of each.
 * Returns true if all of them agree.
 */
export function runHoldSim(game: HoldGameConfig, options: HoldSimOptions): { report: string; agrees: boolean } {
  const { rounds, sessions, seed, lineBet } = options;
  const { base, hold } = game;
  const totalBet = lineBet * base.paylines.length;
  const exact = exactHoldReturn(game);

  const rng = createRng(seed);
  const total = new Running();
  const opening = new Running();
  const feature = new Running();
  const perFeature = new Running();
  const bandCounts = WIN_BANDS.map(() => 0);
  let hits = 0;
  let triggers = 0;
  let fulls = 0;
  let coinsAtEnd = 0;
  let respinsPlayed = 0;
  let jackpotCoins = 0;
  let maxX = 0;
  let maxStops: readonly number[] = [];
  const started = performance.now();
  for (let i = 0; i < rounds; i++) {
    const round = playHoldRound(game, rng, lineBet);
    const x = round.totalWin / totalBet;
    total.add(x);
    opening.add(round.base.totalWin / totalBet);
    feature.add((round.feature?.win ?? 0) / totalBet);
    if (round.feature !== null) {
      triggers++;
      perFeature.add(round.feature.win / totalBet);
      if (round.feature.full) fulls++;
      coinsAtEnd += round.feature.coins.length;
      respinsPlayed += round.feature.respins.length;
      for (const coin of round.feature.coins) if (coin.jackpot !== null) jackpotCoins++;
    }
    if (x > 0) hits++;
    if (x > maxX) {
      maxX = x;
      maxStops = round.base.stops;
    }
    let band = 0;
    while (band + 1 < WIN_BANDS.length && x >= WIN_BANDS[band + 1]!.min) band++;
    bandCounts[band]!++;
  }
  const seconds = (performance.now() - started) / 1000;

  const openingZ = (opening.mean - exact.base.total) / opening.standardError;
  const featureZ = (feature.mean - exact.feature) / feature.standardError;
  let agrees = Math.abs(openingZ) <= MAX_Z && Math.abs(featureZ) <= MAX_Z;
  const verdict = (z: number): string => (Math.abs(z) <= MAX_Z ? "ok" : "MISMATCH");

  const sessionRng = createRng(`${seed}:sessions`);
  const startLines = exact.perStart.map((start) => {
    const value = new Running();
    for (let i = 0; i < sessions; i++) value.add(playHoldSession(game, sessionRng, lineBet, start.coins) / totalBet);
    const z = (value.mean - start.value) / value.standardError;
    agrees &&= Math.abs(z) <= MAX_Z;
    return {
      value,
      line: `  ${String(start.coins).padStart(2)} coins   ${oneIn(start.probability).padEnd(14)} exact value ${start.value.toFixed(2)}x, simulated ${value.mean.toFixed(2)}x   z = ${z.toFixed(2)}  ${verdict(z)}   full board ${percent(start.fullProbability, 2)}`,
    };
  });

  // What a buy returns, and how often it falls short of its price, from features played on their own.
  const bought = new Running();
  let shortOfPrice = 0;
  const buyRng = createRng(`${seed}:buy`);
  for (let i = 0; i < sessions; i++) {
    const win = playHoldSession(game, buyRng, lineBet, hold.minCoins) / totalBet;
    bought.add(win);
    if (hold.buyCost !== null && win < hold.buyCost) shortOfPrice++;
  }

  const lines: string[] = [
    `${base.name} (${base.paylines.length} lines, hold and win)`,
    `${count(rounds)} rounds, seed "${seed}", ${lineBet} credit(s) per line (${totalBet} total bet), ${seconds.toFixed(1)}s (${(rounds / seconds / 1e3).toFixed(0)}k rounds/s)`,
    "",
    `RTP            ${percent(total.mean)} +/- ${percent(1.96 * total.standardError)} (95% CI, end to end)   exact ${percent(exact.total, 3)}`,
    `  opening spin ${percent(opening.mean)}   exact ${percent(exact.base.total)}   z = ${openingZ.toFixed(2)}  ${verdict(openingZ)}`,
    `  hold and win ${percent(feature.mean)}   exact ${percent(exact.feature)}   z = ${featureZ.toFixed(2)}  ${verdict(featureZ)}`,
    `Trigger        ${oneIn(triggers / rounds)} simulated, ${oneIn(exact.trigger)} exact`,
    ...startLines.map((entry) => entry.line),
    `Hold and win   ${perFeature.mean.toFixed(1)}x total bet per feature (sd ${Math.sqrt(perFeature.variance).toFixed(1)}x), ` +
      `${(coinsAtEnd / Math.max(1, triggers)).toFixed(1)} coins at the end, ${(respinsPlayed / Math.max(1, triggers)).toFixed(1)} respins, ` +
      `${percent(jackpotCoins / Math.max(1, coinsAtEnd), 1)} of coins are jackpots, board full in ${percent(fulls / Math.max(1, triggers), 2)} of features`,
    hold.buyCost === null
      ? "Bonus buy      none"
      : `Bonus buy      costs ${hold.buyCost}x the total bet; a bought feature is worth ${exact.buyValue.toFixed(1)}x (exact), so it returns ${percent(exact.buyValue / hold.buyCost)}; ` +
        `${percent(shortOfPrice / sessions, 0)} of buys pay less than they cost`,
    `Hit frequency  ${percent(hits / rounds, 1)}  (${oneIn(hits / rounds)})`,
    `Volatility     sd ${Math.sqrt(total.variance).toFixed(2)}x total bet per round`,
    `Max win seen   ${maxX.toFixed(1)}x total bet  (opening stops ${maxStops.join(",")})`,
    "",
    "Win size (x total bet)      rounds        frequency",
    ...WIN_BANDS.map((band, i) => {
      const n = bandCounts[i]!;
      return `  ${band.label.padEnd(13)} ${count(n).padStart(13)}   ${percent(n / rounds, 3).padStart(9)}  ${oneIn(n / rounds)}`;
    }),
  ];
  return { report: lines.join("\n"), agrees };
}
