import type { RoundResult, SymbolId } from "../engine/index.ts";
import { Running } from "./running.ts";

/** Win-size bands, as a multiple of the total bet. A round lands in the last band whose `min` it reaches. */
export const WIN_BANDS: readonly { readonly label: string; readonly min: number }[] = [
  { label: "no win", min: 0 },
  { label: "< 1x", min: Number.MIN_VALUE },
  { label: "1x - 2x", min: 1 },
  { label: "2x - 5x", min: 2 },
  { label: "5x - 10x", min: 5 },
  { label: "10x - 25x", min: 10 },
  { label: "25x - 100x", min: 25 },
  { label: "100x - 1000x", min: 100 },
  { label: "1000x +", min: 1_000 },
];

/** Streaming totals: memory use does not grow with the number of rounds. */
export interface SimStats {
  rounds: number;
  /** Per round, the win as a multiple of the total bet: overall, and from each part of it. */
  total: Running;
  /** The opening spin alone: its lines and its scatter. */
  opening: Running;
  lines: Running;
  scatter: Running;
  freeSpins: Running;
  /** Per triggered round, what the free spins won as a multiple of the total bet. */
  perFeature: Running;
  /** Sum of line wins, as multiples of the total bet, by the symbol they were paid as. */
  lineBySymbol: Record<SymbolId, number>;
  hits: number;
  triggers: number;
  freeSpinsPlayed: number;
  retriggers: number;
  /** Locked wilds on the board when the last free spin ended, summed over triggered rounds. */
  lockedAtEnd: number;
  capped: number;
  maxX: number;
  maxStops: readonly number[];
  bandCounts: number[];
}

export function createStats(): SimStats {
  return {
    rounds: 0,
    total: new Running(),
    opening: new Running(),
    lines: new Running(),
    scatter: new Running(),
    freeSpins: new Running(),
    perFeature: new Running(),
    lineBySymbol: {},
    hits: 0,
    triggers: 0,
    freeSpinsPlayed: 0,
    retriggers: 0,
    lockedAtEnd: 0,
    capped: 0,
    maxX: 0,
    maxStops: [],
    bandCounts: WIN_BANDS.map(() => 0),
  };
}

export function record(stats: SimStats, round: RoundResult): void {
  const bet = round.totalBet;
  stats.rounds++;
  stats.total.add(round.totalWin / bet);

  let lineWin = 0;
  for (const win of round.base.lineWins) {
    lineWin += win.win;
    stats.lineBySymbol[win.symbol] = (stats.lineBySymbol[win.symbol] ?? 0) + win.win / bet;
  }
  stats.lines.add(lineWin / bet);
  stats.scatter.add((round.base.scatterWin?.win ?? 0) / bet);
  stats.opening.add(round.base.totalWin / bet);
  stats.freeSpins.add((round.feature?.win ?? 0) / bet);

  if (round.feature !== null) {
    stats.triggers++;
    stats.perFeature.add(round.feature.win / bet);
    stats.freeSpinsPlayed += round.feature.spins.length;
    for (const spin of round.feature.spins) if (spin.retriggered > 0) stats.retriggers++;
    stats.lockedAtEnd += round.feature.spins.at(-1)?.locked.length ?? 0;
  }
  if (round.capped) stats.capped++;
  if (round.totalWin > 0) stats.hits++;

  const x = round.totalWin / bet;
  if (x > stats.maxX) {
    stats.maxX = x;
    stats.maxStops = round.base.stops;
  }
  let band = 0;
  while (band + 1 < WIN_BANDS.length && x >= WIN_BANDS[band + 1]!.min) band++;
  stats.bandCounts[band]!++;
}
