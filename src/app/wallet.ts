import { readJson, writeJson } from "./storage.ts";
import type { KeyValueStore } from "./storage.ts";

type Listener = (balance: number) => void;

function parseBalance(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const balance = (value as { balance?: unknown }).balance;
  return typeof balance === "number" && Number.isSafeInteger(balance) && balance >= 0 ? balance : null;
}

/**
 * The player's play-money balance, in whole credits, saved after every change.
 *
 * The saved copy is the truth, because the same visitor may have the site open in several tabs, each
 * with its own wallet object. So every check and every change first adopts the saved balance. Without
 * that, a tab holding a stale balance could spend credits the visitor had already spent elsewhere, or
 * overwrite what another tab had just earned: spend everything on an upgrade in one tab, earn a
 * little in another, and the credits would be back.
 */
export class Wallet {
  #balance: number;
  readonly #store: KeyValueStore;
  readonly #key: string;
  readonly #listeners = new Set<Listener>();

  constructor(store: KeyValueStore, key: string, startingBalance: number) {
    this.#store = store;
    this.#key = key;
    this.#balance = readJson(store, key, parseBalance) ?? startingBalance;
  }

  get balance(): number {
    return this.#balance;
  }

  canAfford(amount: number): boolean {
    this.#adoptSaved();
    return amount <= this.#balance;
  }

  /** Call when the saved balance may have been changed by another tab: adopts it and tells the listeners if it differs. */
  reload(): void {
    if (!this.#adoptSaved()) return;
    for (const listener of this.#listeners) listener(this.#balance);
  }

  /**
   * Takes the bet and pays the win as one saved change. A spin's outcome is known the moment it
   * is drawn, so the win is banked immediately and a page refresh mid-animation cannot lose it.
   */
  settle(bet: number, win: number): void {
    if (!Number.isSafeInteger(bet) || bet < 0) throw new RangeError(`bet must be a non-negative integer, got ${bet}`);
    if (!Number.isSafeInteger(win) || win < 0) throw new RangeError(`win must be a non-negative integer, got ${win}`);
    this.#adoptSaved();
    if (bet > this.#balance) throw new RangeError(`bet ${bet} exceeds balance ${this.#balance}`);
    this.#set(this.#balance - bet + win);
  }

  /** Adds credits earned outside the machines, such as at the Forge. */
  earn(amount: number): void {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError(`amount must be a non-negative integer, got ${amount}`);
    this.#adoptSaved();
    if (!Number.isSafeInteger(this.#balance + amount)) throw new RangeError("balance would be too large to keep exactly");
    this.#set(this.#balance + amount);
  }

  /** Takes credits for something other than a bet, such as a Forge upgrade. Throws if there are not enough. */
  spend(amount: number): void {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError(`amount must be a non-negative integer, got ${amount}`);
    this.#adoptSaved();
    if (amount > this.#balance) throw new RangeError(`cannot spend ${amount}, balance is ${this.#balance}`);
    this.#set(this.#balance - amount);
  }

  onChange(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Takes the saved balance as the current one. Returns whether that changed anything; a missing or damaged save changes nothing. */
  #adoptSaved(): boolean {
    const saved = readJson(this.#store, this.#key, parseBalance);
    if (saved === null || saved === this.#balance) return false;
    this.#balance = saved;
    return true;
  }

  #set(balance: number): void {
    this.#balance = balance;
    writeJson(this.#store, this.#key, { balance });
    for (const listener of this.#listeners) listener(balance);
  }
}
