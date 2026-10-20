import { readJson, writeJson } from "./storage.ts";
import type { KeyValueStore } from "./storage.ts";

type Listener = (balance: number) => void;

function parseBalance(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const balance = (value as { balance?: unknown }).balance;
  return typeof balance === "number" && Number.isSafeInteger(balance) && balance >= 0 ? balance : null;
}

/** The player's play-money balance, in whole credits, saved after every change. */
export class Wallet {
  #balance: number;
  readonly #store: KeyValueStore;
  readonly #key: string;
  readonly #startingBalance: number;
  readonly #listeners = new Set<Listener>();

  constructor(store: KeyValueStore, key: string, startingBalance: number) {
    this.#store = store;
    this.#key = key;
    this.#startingBalance = startingBalance;
    this.#balance = readJson(store, key, parseBalance) ?? startingBalance;
  }

  get balance(): number {
    return this.#balance;
  }

  canAfford(amount: number): boolean {
    return amount <= this.#balance;
  }

  /**
   * Takes the bet and pays the win as one saved change. A spin's outcome is known the moment it
   * is drawn, so the win is banked immediately and a page refresh mid-animation cannot lose it.
   */
  settle(bet: number, win: number): void {
    if (!Number.isSafeInteger(bet) || bet < 0) throw new RangeError(`bet must be a non-negative integer, got ${bet}`);
    if (!Number.isSafeInteger(win) || win < 0) throw new RangeError(`win must be a non-negative integer, got ${win}`);
    if (bet > this.#balance) throw new RangeError(`bet ${bet} exceeds balance ${this.#balance}`);
    this.#set(this.#balance - bet + win);
  }

  /** Back to the starting balance (stand-in until credits can be earned another way). */
  reset(): void {
    this.#set(this.#startingBalance);
  }

  onChange(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #set(balance: number): void {
    this.#balance = balance;
    writeJson(this.#store, this.#key, { balance });
    for (const listener of this.#listeners) listener(balance);
  }
}
