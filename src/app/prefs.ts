import { readJson, writeJson } from "./storage.ts";
import type { KeyValueStore } from "./storage.ts";

export interface Prefs {
  /** Credits per bet unit; always one of the allowed levels. */
  unitBet: number;
  turbo: boolean;
  /** Whether sound is on. */
  sound: boolean;
  /** 0 to 1. */
  volume: number;
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
    sound: typeof saved?.sound === "boolean" ? saved.sound : defaults.sound,
    volume:
      typeof saved?.volume === "number" && saved.volume >= 0 && saved.volume <= 1 ? saved.volume : defaults.volume,
    machine: typeof saved?.machine === "string" && machineIds.includes(saved.machine) ? saved.machine : defaults.machine,
  };
}

export function savePrefs(store: KeyValueStore, key: string, prefs: Prefs): void {
  writeJson(store, key, prefs);
}
