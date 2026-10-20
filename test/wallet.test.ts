import { describe, expect, it } from "vitest";
import { loadPrefs, savePrefs } from "../src/app/prefs.ts";
import { memoryStore } from "../src/app/storage.ts";
import { Wallet } from "../src/app/wallet.ts";

const KEY = "test.wallet";

describe("Wallet", () => {
  it("starts at the starting balance", () => {
    expect(new Wallet(memoryStore(), KEY, 5_000).balance).toBe(5_000);
  });

  it("takes the bet and pays the win in one step", () => {
    const wallet = new Wallet(memoryStore(), KEY, 1_000);
    wallet.settle(20, 0);
    expect(wallet.balance).toBe(980);
    wallet.settle(20, 150);
    expect(wallet.balance).toBe(1_110);
  });

  it("saves every change, so a reload keeps the balance and any banked win", () => {
    const store = memoryStore();
    new Wallet(store, KEY, 1_000).settle(40, 500);
    expect(new Wallet(store, KEY, 1_000).balance).toBe(1_460);
  });

  it("refuses a bet larger than the balance and leaves the balance alone", () => {
    const wallet = new Wallet(memoryStore(), KEY, 100);
    expect(() => wallet.settle(101, 0)).toThrow(RangeError);
    expect(wallet.balance).toBe(100);
  });

  it("lets a bet use the whole balance", () => {
    const wallet = new Wallet(memoryStore(), KEY, 100);
    wallet.settle(100, 0);
    expect(wallet.balance).toBe(0);
    expect(wallet.canAfford(1)).toBe(false);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects an invalid amount (%s)", (amount) => {
    const wallet = new Wallet(memoryStore(), KEY, 100);
    expect(() => wallet.settle(amount, 0)).toThrow(RangeError);
    expect(() => wallet.settle(0, amount)).toThrow(RangeError);
  });

  it.each([
    ["not JSON", "oops"],
    ["a negative balance", '{"balance":-5}'],
    ["a fractional balance", '{"balance":1.5}'],
    ["a string balance", '{"balance":"100"}'],
    ["no balance", "{}"],
    ["null", "null"],
  ])("falls back to the starting balance for saved data that is %s", (_name, saved) => {
    const store = memoryStore();
    store.setItem(KEY, saved);
    expect(new Wallet(store, KEY, 777).balance).toBe(777);
  });

  it("resets to the starting balance", () => {
    const wallet = new Wallet(memoryStore(), KEY, 1_000);
    wallet.settle(1_000, 0);
    wallet.reset();
    expect(wallet.balance).toBe(1_000);
  });

  it("tells listeners about changes until they unsubscribe", () => {
    const wallet = new Wallet(memoryStore(), KEY, 1_000);
    const seen: number[] = [];
    const unsubscribe = wallet.onChange((balance) => seen.push(balance));
    wallet.settle(10, 0);
    unsubscribe();
    wallet.settle(10, 0);
    expect(seen).toEqual([990]);
  });
});

describe("prefs", () => {
  const LEVELS = [1, 2, 5];
  const DEFAULTS = { lineBet: 2, turbo: false };

  it("returns the defaults when nothing is saved", () => {
    expect(loadPrefs(memoryStore(), "p", LEVELS, DEFAULTS)).toEqual(DEFAULTS);
  });

  it("round-trips saved preferences", () => {
    const store = memoryStore();
    savePrefs(store, "p", { lineBet: 5, turbo: true });
    expect(loadPrefs(store, "p", LEVELS, DEFAULTS)).toEqual({ lineBet: 5, turbo: true });
  });

  it("drops a saved bet that is no longer an allowed level", () => {
    const store = memoryStore();
    savePrefs(store, "p", { lineBet: 3, turbo: true });
    expect(loadPrefs(store, "p", LEVELS, DEFAULTS)).toEqual({ lineBet: 2, turbo: true });
  });

  it("survives corrupt saved data", () => {
    const store = memoryStore();
    store.setItem("p", "{not json");
    expect(loadPrefs(store, "p", LEVELS, DEFAULTS)).toEqual(DEFAULTS);
  });
});
