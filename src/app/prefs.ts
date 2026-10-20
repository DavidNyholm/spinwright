import { readJson, writeJson } from "./storage.ts";
import type { KeyValueStore } from "./storage.ts";

export interface Prefs {
  /** Credits per payline; always one of the allowed levels. */
  lineBet: number;
  turbo: boolean;
}

/** Loads saved preferences, falling back to `defaults` for anything missing or no longer valid. */
export function loadPrefs(store: KeyValueStore, key: string, levels: readonly number[], defaults: Prefs): Prefs {
  const saved = readJson(store, key, (value): Partial<Prefs> | null =>
    typeof value === "object" && value !== null ? (value as Partial<Prefs>) : null,
  );
  return {
    lineBet: typeof saved?.lineBet === "number" && levels.includes(saved.lineBet) ? saved.lineBet : defaults.lineBet,
    turbo: typeof saved?.turbo === "boolean" ? saved.turbo : defaults.turbo,
  };
}

export function savePrefs(store: KeyValueStore, key: string, prefs: Prefs): void {
  writeJson(store, key, prefs);
}
