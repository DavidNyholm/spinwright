import { lookupPay } from "./config.ts";
import { evaluateGrid } from "./evaluate.ts";
import { nextInt } from "./rng.ts";
import type { Rng } from "./rng.ts";
import { buildGrid, checkLineBet, spin, spinFromStops } from "./spin.ts";
import type { GameConfig, Position, SpinResult, SymbolId } from "./types.ts";

/** One free spin. */
export interface FeatureSpin {
  /**
   * The spin as the player sees it: the wilds locked by earlier spins are already in `grid`, and
   * the wins are worked out on that grid. `stops` are where the reels themselves landed.
   */
  readonly spin: SpinResult;
  /** Credits this spin adds to the round. Less than `spin.totalWin` only if the win cap cut it short. */
  readonly win: number;
  /** Cells that locked on this spin: wilds that landed where none was locked yet. */
  readonly newlyLocked: readonly Position[];
  /** Every locked cell once this spin is over. */
  readonly locked: readonly Position[];
  /** Free spins added by this spin's scatters. */
  readonly retriggered: number;
  /** Free spins still to play after this one. */
  readonly spinsLeft: number;
  readonly capped: boolean;
}

export interface FeatureResult {
  /** The free spins the opening spin's scatters awarded, before any retrigger. */
  readonly awarded: number;
  readonly spins: readonly FeatureSpin[];
  readonly win: number;
  readonly capped: boolean;
}

/** A whole bet: one spin and, if it opens with enough scatters, the free spins that follow. */
export interface RoundResult {
  readonly lineBet: number;
  readonly totalBet: number;
  readonly base: SpinResult;
  readonly feature: FeatureResult | null;
  /** Everything the bet won, never more than the cap. */
  readonly totalWin: number;
  readonly capped: boolean;
}

export function countSymbol(grid: readonly (readonly SymbolId[])[], symbol: SymbolId): number {
  let count = 0;
  for (const column of grid) for (const cell of column) if (cell === symbol) count++;
  return count;
}

/** How many free spins `scatters` scatters on the opening grid award: 0 if there are too few, or no feature. */
export function spinsAwarded(config: GameConfig, scatters: number): number {
  return config.feature === null ? 0 : lookupPay(config.feature.spins, scatters);
}

/** The most a round can win, in credits, for a bet of `totalBet`. */
function winCap(config: GameConfig, totalBet: number): number {
  return config.maxWinMultiple === null ? Infinity : config.maxWinMultiple * totalBet;
}

function playFeature(config: GameConfig, rng: Rng, lineBet: number, awarded: number, winRoom: number): FeatureResult {
  const feature = config.feature!;
  const wild = config.wild!;
  const scatter = config.scatter!.symbol;
  const { reels, rows } = config;

  const locked = new Set<number>();
  const spins: FeatureSpin[] = [];
  let spinsLeft = awarded;
  let won = 0;
  let capped = false;

  while (spinsLeft > 0 && won < winRoom) {
    const stops = feature.strips.map((strip) => nextInt(rng, strip.length));
    const landed = buildGrid(config, stops, feature.strips);

    // Wilds locked earlier sit over whatever the reels show in those cells.
    const grid = landed.map((column) => column.slice());
    for (const cell of locked) grid[Math.floor(cell / rows)]![cell % rows] = wild;

    const evaluation = evaluateGrid(config, grid, lineBet);
    const newlyLocked: Position[] = [];
    for (let reel = 0; reel < reels; reel++) {
      for (let row = 0; row < rows; row++) {
        if (landed[reel]![row] === wild && !locked.has(reel * rows + row)) newlyLocked.push([reel, row]);
      }
    }
    for (const [reel, row] of newlyLocked) locked.add(reel * rows + row);

    let win = evaluation.totalWin;
    if (won + win >= winRoom) {
      win = winRoom - won;
      capped = true;
    }
    won += win;
    spinsLeft--;

    const scatters = countSymbol(grid, scatter);
    // A capped spin ends the feature, so it never earns spins it will not play.
    const retriggered = capped ? 0 : Math.min(lookupPay(feature.retrigger, scatters), feature.maxSpins - spins.length - 1 - spinsLeft);
    spinsLeft += Math.max(0, retriggered);

    spins.push({
      spin: {
        lineBet,
        totalBet: lineBet * config.paylines.length,
        stops,
        grid,
        lineWins: evaluation.lineWins,
        scatterWin: evaluation.scatterWin,
        totalWin: evaluation.totalWin,
      },
      win,
      newlyLocked,
      locked: [...locked].sort((a, b) => a - b).map((cell): Position => [Math.floor(cell / rows), cell % rows]),
      retriggered: Math.max(0, retriggered),
      spinsLeft: capped ? 0 : spinsLeft,
      capped,
    });
    if (capped) break;
  }
  return { awarded, spins, win: won, capped };
}

/** Finishes a round whose opening spin has been decided: plays the free spins if it triggered them. */
function finishRound(config: GameConfig, rng: Rng, base: SpinResult): RoundResult {
  const cap = winCap(config, base.totalBet);
  const scatters = config.scatter === null ? 0 : countSymbol(base.grid, config.scatter.symbol);
  const awarded = spinsAwarded(config, scatters);

  let feature: FeatureResult | null = null;
  let totalWin = base.totalWin;
  let capped = false;
  if (totalWin >= cap) {
    totalWin = cap;
    capped = true;
  } else if (awarded > 0) {
    feature = playFeature(config, rng, base.lineBet, awarded, cap - totalWin);
    totalWin += feature.win;
    capped = feature.capped;
  }
  return { lineBet: base.lineBet, totalBet: base.totalBet, base, feature, totalWin, capped };
}

/** Plays a whole bet from random stops. The outcome, free spins included, is final before any animation. */
export function playRound(config: GameConfig, rng: Rng, lineBet: number): RoundResult {
  return finishRound(config, rng, spin(config, rng, lineBet));
}

/** The same, with the opening spin's stops chosen (for QA and tests); the free spins are still drawn from `rng`. */
export function playRoundFromStops(config: GameConfig, rng: Rng, stops: readonly number[], lineBet: number): RoundResult {
  return finishRound(config, rng, spinFromStops(config, stops, lineBet));
}

/** A feature bought outright: no opening spin, only the free spins, as if the fewest scatters that trigger it had landed. */
export interface BoughtFeature {
  readonly lineBet: number;
  readonly totalBet: number;
  /** What it cost, in credits. */
  readonly price: number;
  readonly feature: FeatureResult;
  /** What the feature won, never more than the cap. */
  readonly totalWin: number;
  readonly capped: boolean;
}

/** The fewest scatters that start the feature. */
export function smallestTrigger(config: GameConfig): number {
  if (config.feature === null) throw new Error(`${config.id} has no feature`);
  return Math.min(...Object.keys(config.feature.spins).map(Number));
}

/** What buying the feature costs at this bet, in credits, or null if the game's feature cannot be bought. */
export function featurePrice(config: GameConfig, lineBet: number): number | null {
  const buyCost = config.feature?.buyCost ?? null;
  return buyCost === null ? null : buyCost * lineBet * config.paylines.length;
}

/** Buys the feature and plays it. The outcome, every free spin of it, is final before anything is shown. */
export function buyFeature(config: GameConfig, rng: Rng, lineBet: number): BoughtFeature {
  checkLineBet(lineBet);
  const price = featurePrice(config, lineBet);
  if (price === null) throw new Error(`${config.id}'s feature cannot be bought`);
  const totalBet = lineBet * config.paylines.length;
  const feature = playFeature(config, rng, lineBet, spinsAwarded(config, smallestTrigger(config)), winCap(config, totalBet));
  return { lineBet, totalBet, price, feature, totalWin: feature.win, capped: feature.capped };
}

/**
 * Plays a feature on its own, as if `scatters` scatters had just triggered it, and returns what it won.
 * The simulator uses it to measure the feature's value directly instead of waiting for it to trigger.
 */
export function playFeatureSession(config: GameConfig, rng: Rng, lineBet: number, scatters: number): number {
  if (config.feature === null) throw new Error(`${config.id} has no feature`);
  const awarded = spinsAwarded(config, scatters);
  if (awarded === 0) throw new RangeError(`${scatters} scatters do not trigger ${config.id}'s feature`);
  const cap = winCap(config, lineBet * config.paylines.length);
  return playFeature(config, rng, lineBet, awarded, cap).win;
}
