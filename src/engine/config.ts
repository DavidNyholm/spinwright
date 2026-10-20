import type { GameConfig, PayTable } from "./types.ts";

export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(gameId: string, problems: readonly string[]) {
    super(`Invalid game config "${gameId}":\n  - ${problems.join("\n  - ")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

/**
 * Payout multiplier for `count` symbols: the entry for the largest key at or below
 * `count`, or 0 if there is none. So { 3: 5, 5: 60 } pays 5 for a count of 4.
 */
export function lookupPay(table: PayTable, count: number): number {
  for (let c = count; c >= 1; c--) {
    const multiplier = table[c];
    if (multiplier !== undefined) return multiplier;
  }
  return 0;
}

function checkPayTable(label: string, table: PayTable, maxCount: number, problems: string[]): void {
  for (const [key, multiplier] of Object.entries(table)) {
    const count = Number(key);
    if (!Number.isInteger(count) || count < 1 || count > maxCount) {
      problems.push(`${label}: count "${key}" must be an integer in [1, ${maxCount}]`);
    }
    // Wins are whole credits: a fractional multiplier would need a currency unit smaller than a credit.
    if (!Number.isInteger(multiplier) || multiplier < 0) {
      problems.push(`${label}[${key}]: multiplier must be a non-negative integer, got ${multiplier}`);
    }
  }
}

/** Returns every problem found in `config`; an empty list means it is valid. */
export function findConfigProblems(config: GameConfig): string[] {
  const problems: string[] = [];
  const { reels, rows, strips, paylines, pays, wild, scatter } = config;

  if (config.id.trim() === "") problems.push("id must not be empty");
  if (config.name.trim() === "") problems.push("name must not be empty");
  if (!Number.isInteger(reels) || reels < 1) problems.push(`reels must be a positive integer, got ${reels}`);
  if (!Number.isInteger(rows) || rows < 1) problems.push(`rows must be a positive integer, got ${rows}`);
  // Everything below indexes by reels/rows, so stop here if they are unusable.
  if (problems.length > 0) return problems;

  if (strips.length !== reels) {
    problems.push(`strips has ${strips.length} entries, expected one per reel (${reels})`);
  }
  const onStrips = new Set<string>();
  strips.forEach((strip, reel) => {
    if (strip.length < rows) {
      problems.push(`strips[${reel}] has ${strip.length} symbols, needs at least ${rows} (the row count)`);
    }
    for (const symbol of strip) {
      if (symbol === "") problems.push(`strips[${reel}] contains an empty symbol id`);
      onStrips.add(symbol);
    }
  });

  if (paylines.length === 0) problems.push("paylines must not be empty");
  const seenLines = new Set<string>();
  paylines.forEach((line, index) => {
    if (line.length !== reels) {
      problems.push(`paylines[${index}] has ${line.length} entries, expected one per reel (${reels})`);
    }
    for (const row of line) {
      if (!Number.isInteger(row) || row < 0 || row >= rows) {
        problems.push(`paylines[${index}] has row ${row}, expected an integer in [0, ${rows - 1}]`);
      }
    }
    const key = line.join(",");
    if (seenLines.has(key)) problems.push(`paylines[${index}] duplicates an earlier payline (${key}); it would pay twice`);
    seenLines.add(key);
  });

  for (const [symbol, table] of Object.entries(pays)) {
    if (!onStrips.has(symbol)) problems.push(`pays["${symbol}"]: symbol is on no reel strip`);
    checkPayTable(`pays["${symbol}"]`, table, reels, problems);
  }

  if (wild !== null) {
    if (!onStrips.has(wild)) problems.push(`wild "${wild}" is on no reel strip`);
    // Without an explicit table a line of all wilds would silently pay nothing.
    if (pays[wild] === undefined) problems.push(`wild "${wild}" needs a pays entry (use {} for no own payout)`);
  }

  if (scatter !== null) {
    if (!onStrips.has(scatter.symbol)) problems.push(`scatter "${scatter.symbol}" is on no reel strip`);
    if (scatter.symbol === wild) problems.push(`scatter and wild are both "${scatter.symbol}"`);
    if (pays[scatter.symbol] !== undefined) {
      problems.push(`scatter "${scatter.symbol}" must not also have a line pays entry`);
    }
    checkPayTable("scatter.pays", scatter.pays, reels * rows, problems);
  }

  return problems;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Validates `config` and returns it deeply frozen. Throws ConfigError listing every problem. */
export function defineGame(config: GameConfig): GameConfig {
  const problems = findConfigProblems(config);
  if (problems.length > 0) throw new ConfigError(config.id, problems);
  return deepFreeze(config);
}
