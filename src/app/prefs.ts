import { readJson, writeJson } from "./storage.ts";
import type { KeyValueStore } from "./storage.ts";

export interface Prefs {
  /** Credits per bet unit; always one of the allowed levels. */
  unitBet: number;
  turbo: boolean;
  /** The machine last played; always one of the known machine ids. */
  machine: string;
}

/** Loads saved preferences, falling back to `defaults` for anything missing or no longer valid. */
export function loadPrefs(
  store: KeyValueStore,
  key: string,
  levels: readonly number[],
  machineIds: readonly string[],
  defaults: Prefs,
): Prefs {
  const saved = readJson(store, key, (value): Partial<Prefs> | null =>
    typeof value === "object" && value !== null ? (value as Partial<Prefs>) : null,
  );
  return {
    unitBet: typeof saved?.unitBet === "number" && levels.includes(saved.unitBet) ? saved.unitBet : defaults.unitBet,
    turbo: typeof saved?.turbo === "boolean" ? saved.turbo : defaults.turbo,
    machine: typeof saved?.machine === "string" && machineIds.includes(saved.machine) ? saved.machine : defaults.machine,
  };
}

export function savePrefs(store: KeyValueStore, key: string, prefs: Prefs): void {
  writeJson(store, key, prefs);
}
