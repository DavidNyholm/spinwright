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

  it("adds earned credits and saves them", () => {
    const store = memoryStore();
    const wallet = new Wallet(store, KEY, 1_000);
    wallet.earn(250);
    expect(wallet.balance).toBe(1_250);
    expect(new Wallet(store, KEY, 1_000).balance).toBe(1_250);
  });

  it("spends credits, down to exactly zero, and refuses to go below", () => {
    const wallet = new Wallet(memoryStore(), KEY, 100);
    wallet.spend(60);
    expect(wallet.balance).toBe(40);
    expect(() => wallet.spend(41)).toThrow(RangeError);
    expect(wallet.balance).toBe(40);
    wallet.spend(40);
    expect(wallet.balance).toBe(0);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects earning or spending %s", (amount) => {
    const wallet = new Wallet(memoryStore(), KEY, 100);
    expect(() => wallet.earn(amount)).toThrow(RangeError);
    expect(() => wallet.spend(amount)).toThrow(RangeError);
    expect(wallet.balance).toBe(100);
  });

  it("refuses to earn past what a whole number can hold exactly", () => {
    const wallet = new Wallet(memoryStore(), KEY, Number.MAX_SAFE_INTEGER - 1);
    expect(() => wallet.earn(5)).toThrow(RangeError);
    expect(wallet.balance).toBe(Number.MAX_SAFE_INTEGER - 1);
  });

  it("tells listeners about changes until they unsubscribe", () => {
    const wallet = new Wallet(memoryStore(), KEY, 1_000);
    const seen: number[] = [];
    const unsubscribe = wallet.onChange((balance) => seen.push(balance));
    wallet.settle(10, 0);
    wallet.earn(5);
    wallet.spend(3);
    unsubscribe();
    wallet.settle(10, 0);
    expect(seen).toEqual([990, 995, 992]);
  });
});

describe("prefs", () => {
  const LEVELS = [1, 2, 5];
  const DEFAULTS = { unitBet: 2, turbo: false, sound: true, volume: 0.6 };
  const load = (store: ReturnType<typeof memoryStore>) => loadPrefs(store, "p", LEVELS, DEFAULTS);

  it("returns the defaults when nothing is saved", () => {
    expect(load(memoryStore())).toEqual(DEFAULTS);
  });

  it("round-trips saved preferences", () => {
    const store = memoryStore();
    const saved = { unitBet: 5, turbo: true, sound: false, volume: 0.25 };
    savePrefs(store, "p", saved);
    expect(load(store)).toEqual(saved);
  });

  it("drops a saved bet that is no longer an allowed level", () => {
    const store = memoryStore();
    savePrefs(store, "p", { ...DEFAULTS, unitBet: 3, turbo: true });
    expect(load(store)).toEqual({ ...DEFAULTS, unitBet: 2, turbo: true });
  });

  it("ignores a machine saved by an earlier version", () => {
    const store = memoryStore();
    store.setItem("p", JSON.stringify({ ...DEFAULTS, unitBet: 5, machine: "classic" }));
    expect(load(store)).toEqual({ ...DEFAULTS, unitBet: 5 });
  });

  it.each([-0.1, 1.5, Number.NaN])("drops a saved volume of %s", (volume) => {
    const store = memoryStore();
    store.setItem("p", JSON.stringify({ ...DEFAULTS, volume }));
    expect(load(store).volume).toBe(0.6);
  });

  it("keeps a saved volume of zero and a saved mute", () => {
    const store = memoryStore();
    savePrefs(store, "p", { ...DEFAULTS, volume: 0, sound: false });
    expect(load(store)).toMatchObject({ volume: 0, sound: false });
  });

  it("survives corrupt saved data", () => {
    const store = memoryStore();
    store.setItem("p", "{not json");
    expect(load(store)).toEqual(DEFAULTS);
  });
});
