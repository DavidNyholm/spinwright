import { findConfigProblems } from "../config.ts";
import type { HoldGameConfig } from "./types.ts";

export class HoldConfigError extends Error {
  readonly problems: readonly string[];

  constructor(gameId: string, problems: readonly string[]) {
    super(`Invalid hold-and-win game "${gameId}":\n  - ${problems.join("\n  - ")}`);
    this.name = "HoldConfigError";
    this.problems = problems;
  }
}

const isPositiveInt = (n: number): boolean => Number.isInteger(n) && n >= 1;

/** The most the weights of one draw may total: a draw is one uniform integer below the total. */
const MAX_TOTAL = 2 ** 32;

/** Returns every problem found in `game`; an empty list means it is valid. */
export function findHoldProblems(game: HoldGameConfig): string[] {
  const { base, hold } = game;
  const problems = findConfigProblems(base).map((problem) => `base: ${problem}`);
  // The rest indexes into the base game's grid, so stop here if that is unusable.
  if (problems.length > 0) return problems;
  const cells = base.reels * base.rows;

  if (base.feature !== null) problems.push("base: a hold-and-win game has no free spins; its feature is the hold and win");
  if (base.scatter === null) {
    problems.push("base needs a scatter, which is the coin");
  } else {
    if (base.scatter.symbol !== hold.coin) problems.push(`hold.coin "${hold.coin}" must be the base game's scatter ("${base.scatter.symbol}")`);
    if (Object.keys(base.scatter.pays).length > 0) problems.push("the coin must pay nothing by itself: base.scatter.pays must be empty");
  }

  if (!isPositiveInt(hold.minCoins) || hold.minCoins > cells) problems.push(`hold.minCoins must be an integer in [1, ${cells}], got ${hold.minCoins}`);
  if (!isPositiveInt(hold.respins)) problems.push(`hold.respins must be a positive integer, got ${hold.respins}`);
  if (hold.buyCost !== null && !isPositiveInt(hold.buyCost)) problems.push(`hold.buyCost must be a positive integer or null, got ${hold.buyCost}`);

  const { numerator, denominator } = hold.landing;
  if (!isPositiveInt(numerator) || !isPositiveInt(denominator) || numerator >= denominator || denominator > MAX_TOTAL) {
    problems.push(`hold.landing must be a chance strictly between 0 and 1, as whole numbers (got ${numerator} in ${denominator})`);
  }

  if (hold.values.length === 0) problems.push("hold.values is empty: coins would be worth nothing");
  const names = new Set<string>();
  let totalWeight = 0;
  hold.values.forEach((entry, index) => {
    if (!isPositiveInt(entry.value)) problems.push(`hold.values[${index}].value must be a positive integer, got ${entry.value}`);
    if (!isPositiveInt(entry.weight)) problems.push(`hold.values[${index}].weight must be a positive integer, got ${entry.weight}`);
    totalWeight += entry.weight;
    if (entry.jackpot !== undefined) {
      if (entry.jackpot.trim() === "") problems.push(`hold.values[${index}].jackpot must not be empty`);
      if (names.has(entry.jackpot)) problems.push(`hold.values[${index}]: the jackpot name "${entry.jackpot}" is used twice`);
      names.add(entry.jackpot);
    }
  });
  if (totalWeight > MAX_TOTAL) problems.push(`hold.values weights total ${totalWeight}, which is more than 2^32`);

  if (hold.fullBoard.name.trim() === "") problems.push("hold.fullBoard.name must not be empty");
  if (names.has(hold.fullBoard.name)) problems.push(`the full-board prize is called "${hold.fullBoard.name}", which a coin is also called`);
  if (!isPositiveInt(hold.fullBoard.value)) problems.push(`hold.fullBoard.value must be a positive integer, got ${hold.fullBoard.value}`);

  return problems;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Validates `game` and returns it deeply frozen. Throws HoldConfigError listing every problem. */
export function defineHoldGame(game: HoldGameConfig): HoldGameConfig {
  const problems = findHoldProblems(game);
  if (problems.length > 0) throw new HoldConfigError(game.base.id, problems);
  return deepFreeze(game);
}
