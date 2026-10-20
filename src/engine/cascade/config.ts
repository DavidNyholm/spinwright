import { lookupPay } from "../config.ts";
import type { PayTable } from "../types.ts";
import type { CascadeConfig } from "./types.ts";

export class CascadeConfigError extends Error {
  readonly problems: readonly string[];

  constructor(gameId: string, problems: readonly string[]) {
    super(`Invalid cascade game "${gameId}":\n  - ${problems.join("\n  - ")}`);
    this.name = "CascadeConfigError";
    this.problems = problems;
  }
}

const isPositiveInt = (n: number): boolean => Number.isInteger(n) && n >= 1;

function checkPayTable(label: string, table: PayTable, maxSize: number, problems: string[]): void {
  for (const [key, multiplier] of Object.entries(table)) {
    const size = Number(key);
    if (!Number.isInteger(size) || size < 1 || size > maxSize) {
      problems.push(`${label}: size "${key}" must be an integer in [1, ${maxSize}]`);
    }
    if (!Number.isInteger(multiplier) || multiplier < 0) {
      problems.push(`${label}[${key}]: pay must be a non-negative integer, got ${multiplier}`);
    }
  }
}

/** Returns every problem found in `config`; an empty list means it is valid. */
export function findCascadeConfigProblems(config: CascadeConfig): string[] {
  const problems: string[] = [];
  const { columns, rows, weights, pays, minCluster, units, scatter, feature, heat, maxWinMultiple } = config;

  if (config.id.trim() === "") problems.push("id must not be empty");
  if (config.name.trim() === "") problems.push("name must not be empty");
  if (!isPositiveInt(columns)) problems.push(`columns must be a positive integer, got ${columns}`);
  if (!isPositiveInt(rows)) problems.push(`rows must be a positive integer, got ${rows}`);
  if (problems.length > 0) return problems;
  const cells = columns * rows;

  // Piece ids are stored in a Uint8Array while playing.
  const MAX_SYMBOLS = 255;

  if (weights.length !== columns) problems.push(`weights has ${weights.length} entries, expected one per column (${columns})`);
  const symbols = new Set<string>();
  weights.forEach((column, index) => {
    const entries = Object.entries(column);
    if (entries.length === 0) problems.push(`weights[${index}] has no pieces`);
    let total = 0;
    for (const [symbol, weight] of entries) {
      if (symbol === "") problems.push(`weights[${index}] contains an empty piece id`);
      if (!isPositiveInt(weight)) problems.push(`weights[${index}]["${symbol}"] must be a positive integer, got ${weight}`);
      symbols.add(symbol);
      total += weight;
    }
    if (total > 2 ** 32) problems.push(`weights[${index}] totals ${total}, which is more than 2^32`);
  });
  if (symbols.size > MAX_SYMBOLS) problems.push(`more than ${MAX_SYMBOLS} different pieces`);

  if (!isPositiveInt(minCluster) || minCluster < 2 || minCluster > cells) {
    problems.push(`minCluster must be an integer in [2, ${cells}], got ${minCluster}`);
  }
  if (!isPositiveInt(units)) problems.push(`units must be a positive integer, got ${units}`);
  if (!isPositiveInt(maxWinMultiple)) problems.push(`maxWinMultiple must be a positive integer, got ${maxWinMultiple}`);

  if (scatter !== null && !symbols.has(scatter)) problems.push(`scatter "${scatter}" is in no column's weights`);

  for (const [symbol, table] of Object.entries(pays)) {
    if (!symbols.has(symbol)) problems.push(`pays["${symbol}"]: piece is in no column's weights`);
    if (symbol === scatter) problems.push(`pays["${symbol}"]: the scatter must not have cluster pays`);
    checkPayTable(`pays["${symbol}"]`, table, cells, problems);
  }
  for (const symbol of symbols) {
    if (symbol === scatter) continue;
    const table = pays[symbol];
    if (table === undefined) {
      problems.push(`piece "${symbol}" needs a pays entry`);
    } else if (lookupPay(table, minCluster) === 0) {
      // Every group of minCluster or more is removed, so every group must pay something.
      problems.push(`pays["${symbol}"] pays nothing at the smallest cluster size (${minCluster})`);
    }
  }

  if (feature !== null) {
    if (scatter === null) problems.push("feature needs a scatter");
    if (!isPositiveInt(feature.trigger) || feature.trigger > cells) problems.push(`feature.trigger must be an integer in [1, ${cells}]`);
    if (!isPositiveInt(feature.spins)) problems.push("feature.spins must be a positive integer");
    if (!isPositiveInt(feature.maxSpins) || feature.maxSpins < feature.spins) {
      problems.push("feature.maxSpins must be an integer at least feature.spins");
    }
    if (feature.heatStep !== null && !isPositiveInt(feature.heatStep)) problems.push("feature.heatStep must be a positive integer or null");
    if (feature.buyCost !== null && !isPositiveInt(feature.buyCost)) problems.push("feature.buyCost must be a positive integer or null");
    if (feature.retrigger !== null) {
      if (!isPositiveInt(feature.retrigger.count) || feature.retrigger.count > cells) {
        problems.push(`feature.retrigger.count must be an integer in [1, ${cells}]`);
      }
      if (!isPositiveInt(feature.retrigger.spins)) problems.push("feature.retrigger.spins must be a positive integer");
    }
  }

  if (!isPositiveInt(heat.start)) problems.push("heat.start must be a positive integer");
  if (!isPositiveInt(heat.step)) problems.push("heat.step must be a positive integer");
  if (!Number.isInteger(heat.max) || heat.max < heat.start) problems.push("heat.max must be an integer at least heat.start");

  return problems;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Validates `config` and returns it deeply frozen. Throws CascadeConfigError listing every problem. */
export function defineCascadeGame(config: CascadeConfig): CascadeConfig {
  const problems = findCascadeConfigProblems(config);
  if (problems.length > 0) throw new CascadeConfigError(config.id, problems);
  return deepFreeze(config);
}
