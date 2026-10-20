import { defineGame } from "../src/engine/index.ts";
import type { GameConfig } from "../src/engine/index.ts";

const BASE: GameConfig = {
  id: "test",
  name: "Test game",
  reels: 5,
  rows: 3,
  strips: Array.from({ length: 5 }, () => ["A", "B", "C", "W", "S"]),
  paylines: [[1, 1, 1, 1, 1]],
  pays: {
    A: { 3: 5, 4: 20, 5: 100 },
    B: { 3: 2, 4: 8, 5: 30 },
    C: { 3: 1 },
    W: {},
  },
  wild: "W",
  scatter: { symbol: "S", pays: { 3: 2, 4: 10, 5: 50 } },
  feature: null,
  maxWinMultiple: null,
};

/** The base test game with some fields replaced, validated like any real game. */
export function makeGame(overrides: Partial<GameConfig> = {}): GameConfig {
  return defineGame({ ...BASE, ...overrides });
}

/** The same, but unvalidated, for testing validation itself. */
export function rawGame(overrides: Partial<GameConfig> = {}): GameConfig {
  return { ...BASE, ...overrides };
}
