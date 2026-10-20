/** The win counter runs longer for bigger wins, within these limits. */
const WIN_COUNT = { minMs: 400, maxMs: 2_500, msPerBetMultiple: 120 };

/** How long the win and balance counters take to roll up to a win of `win` on a bet of `totalBet`. */
export function winCountDuration(win: number, totalBet: number): number {
  const ms = WIN_COUNT.minMs + (win / totalBet) * WIN_COUNT.msPerBetMultiple;
  return Math.min(WIN_COUNT.maxMs, ms);
}
