import type { Rng } from "../rng.ts";
import type { Position } from "../types.ts";
import { compileCascade, countPiece, fillGrid, findClusters, removeAndRefill, toSymbolGrid } from "./grid.ts";
import type { CompiledCascade } from "./grid.ts";
import type { CascadeConfig, CascadeResult, CascadeStep, ClusterWin, PlayOptions, RoundResult } from "./types.ts";

function checkUnitBet(unitBet: number): void {
  if (!Number.isInteger(unitBet) || unitBet < 1) {
    throw new RangeError(`unitBet must be a positive integer number of credits, got ${unitBet}`);
  }
}

/**
 * Plays one spin: fills the grid, then pays, removes and refills until nothing pays. Every winning
 * step is paid at the current heat, and heat then rises by one step, up to its maximum.
 *
 * `winRoom` is how many more credits the play may win; the spin ends the moment it is used up.
 */
function playRound(
  game: CompiledCascade,
  rng: Rng,
  unitBet: number,
  startHeat: number,
  heatStep: number,
  winRoom: number,
  record: boolean,
): RoundResult {
  const { grid } = game.work;
  const { heat: heatRules, rows } = game.config;
  fillGrid(game, rng, grid);

  const scatters = game.scatterIndex < 0 ? 0 : countPiece(grid, game.scatterIndex);
  const openingGrid = record ? toSymbolGrid(game, grid) : null;
  const steps: CascadeStep[] = [];

  let heat = startHeat;
  let win = 0;
  let stepCount = 0;
  let capped = false;

  for (;;) {
    const clusters = findClusters(game, grid);
    if (clusters.length === 0) break;

    let units = 0;
    for (const cluster of clusters) units += game.pay[cluster.symbol]![cluster.cells.length]!;
    let stepWin = units * heat * unitBet;
    if (win + stepWin >= winRoom) {
      stepWin = winRoom - win;
      capped = true;
    }
    win += stepWin;
    stepCount++;

    if (record) {
      const wins: ClusterWin[] = clusters.map((cluster) => ({
        symbol: game.symbols[cluster.symbol]!,
        size: cluster.cells.length,
        cells: cluster.cells.map((cell): Position => [Math.floor(cell / rows), cell % rows]),
        win: game.pay[cluster.symbol]![cluster.cells.length]! * heat * unitBet,
      }));
      steps.push({ grid: toSymbolGrid(game, grid), clusters: wins, heat, win: stepWin });
    }
    if (capped) break;

    removeAndRefill(game, rng, grid, clusters);
    heat = Math.min(heatRules.max, heat + heatStep);
  }

  return {
    win,
    stepCount,
    scatters,
    startHeat,
    endHeat: heat,
    capped,
    openingGrid,
    steps,
    finalGrid: record ? toSymbolGrid(game, grid) : null,
  };
}

/** The spins of a feature, played from a fresh heat. The first spin comes from the triggering play. */
function playFeature(game: CompiledCascade, rng: Rng, unitBet: number, winRoom: number, record: boolean): RoundResult[] {
  const feature = game.config.feature!;
  const rounds: RoundResult[] = [];
  const heatStep = feature.heatStep ?? game.config.heat.step;
  let spinsLeft = feature.spins;
  let heat = game.config.heat.start;
  let won = 0;

  while (spinsLeft > 0 && won < winRoom) {
    const round = playRound(game, rng, unitBet, heat, heatStep, winRoom - won, record);
    rounds.push(round);
    spinsLeft--;
    won += round.win;
    heat = round.endHeat;
    if (round.capped) break;
    if (feature.retrigger !== null && round.scatters >= feature.retrigger.count) {
      spinsLeft = Math.min(spinsLeft + feature.retrigger.spins, feature.maxSpins - rounds.length);
    }
  }
  return rounds;
}

/**
 * Plays a whole bet: one base spin and, if it opens with enough scatters, the feature that follows.
 * A play never wins more than the cap. `unitBet` is credits per bet unit.
 */
export function playCascade(config: CascadeConfig, rng: Rng, unitBet: number, options: PlayOptions = {}): CascadeResult {
  checkUnitBet(unitBet);
  const game = compileCascade(config);
  const record = options.record ?? false;
  const totalBet = unitBet * config.units;
  const cap = config.maxWinMultiple * totalBet;

  const base = playRound(game, rng, unitBet, config.heat.start, config.heat.step, cap, record);
  let totalWin = base.win;
  let capped = base.capped;
  let feature: RoundResult[] | null = null;

  if (!capped && config.feature !== null && base.scatters >= config.feature.trigger) {
    feature = playFeature(game, rng, unitBet, cap - totalWin, record);
    for (const round of feature) totalWin += round.win;
    capped = feature.some((round) => round.capped);
  }
  return { unitBet, totalBet, base, feature, totalWin, capped };
}

/**
 * Plays a feature on its own, as if just triggered, and returns what it won. The simulator uses it
 * to measure the feature's value directly instead of waiting for it to be triggered by chance.
 */
export function playFeatureSession(config: CascadeConfig, rng: Rng, unitBet: number): number {
  checkUnitBet(unitBet);
  if (config.feature === null) throw new Error(`${config.id} has no feature`);
  const game = compileCascade(config);
  const cap = config.maxWinMultiple * unitBet * config.units;
  let total = 0;
  for (const round of playFeature(game, rng, unitBet, cap, false)) total += round.win;
  return total;
}
