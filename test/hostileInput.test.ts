import { describe, expect, it } from "vitest";
import { MAX_SEED_LENGTH, parseLaunch } from "../src/app/launch.ts";
import { loadPrefs } from "../src/app/prefs.ts";
import { parseRoute } from "../src/app/router.ts";
import { memoryStore } from "../src/app/storage.ts";
import { Wallet } from "../src/app/wallet.ts";
import { createRng, nextInt } from "../src/engine/index.ts";
import type { Rng } from "../src/engine/index.ts";
import { FORGE, UPGRADE_IDS } from "../src/forge/config.ts";
import { ForgeEngine, parseForgeSave } from "../src/forge/engine.ts";

/**
 * Everything the game reads from outside itself (what is saved in the browser, which anyone can edit,
 * and the address) is fed hostile values here, and must come out valid or be thrown away.
 */

const KEYS = [
  "balance", "unitBet", "turbo", "sound", "volume", "levels", "strikes", "lifetime", "bestHeat", "hammer", "tongs", "mainspring", "luck",
  "__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty", "polluted", "length", "0", "",
];
const SPECIAL_NUMBERS = [0, -0, 1, -1, 2, 5, 20, 0.5, 1.5, -1.5, 1e21, -1e21, 2 ** 53, 2 ** 53 - 1, -(2 ** 53), Number.MAX_VALUE, Number.MIN_VALUE, 1e-300];
const STRINGS = ["", "0", "5", "NaN", "Infinity", "-1", "1e3", "true", "null", "<script>alert(1)</script>", "__proto__", "constructor", "x".repeat(10_000), "\u0000", "💥"];

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[nextInt(rng, items.length)]!;
}

/** A random JSON value, nested a few levels deep, built from awkward pieces. */
function randomValue(rng: Rng, depth = 0): unknown {
  const kinds = depth >= 3 ? 5 : 8;
  switch (nextInt(rng, kinds)) {
    case 0:
      return null;
    case 1:
      return nextInt(rng, 2) === 0;
    case 2:
      return pick(rng, SPECIAL_NUMBERS);
    case 3:
      return nextInt(rng, 2_000_000) - 1_000_000;
    case 4:
      return pick(rng, STRINGS);
    case 5:
      return Array.from({ length: nextInt(rng, 4) }, () => randomValue(rng, depth + 1));
    default: {
      const object: Record<string, unknown> = {};
      for (let i = nextInt(rng, 6); i > 0; i--) Object.defineProperty(object, pick(rng, KEYS), { value: randomValue(rng, depth + 1), enumerable: true, configurable: true, writable: true });
      return object;
    }
  }
}

/** Raw saved text that is not even JSON, or is JSON of the wrong shape, or has the dangerous keys written out by hand. */
const HAND_WRITTEN = [
  "", "{", "null", "[]", "0", '"balance"', "true", "{}", "[[]]", '{"balance":',
  '{"__proto__":{"polluted":true},"balance":5}',
  '{"balance":5,"__proto__":{"balance":1e9}}',
  '{"constructor":{"prototype":{"polluted":true}},"levels":{"__proto__":{"polluted":true}}}',
  '{"levels":{"constructor":{"prototype":{"polluted":true}}},"strikes":1}',
  '{"balance":1e999}', '{"balance":-1e999}', '{"balance":"1000000"}', '{"balance":[1000]}', '{"balance":{"valueOf":1}}',
  `{"balance":${"9".repeat(400)}}`, `{"levels":{"hammer":${"9".repeat(400)}}}`, `"${"x".repeat(100_000)}"`,
];

const sources = (seed: string, count: number): string[] => {
  const rng = createRng(seed);
  return [...HAND_WRITTEN, ...Array.from({ length: count }, () => JSON.stringify(randomValue(rng)) ?? "null")];
};

const polluted = (): boolean => ({} as Record<string, unknown>)["polluted"] !== undefined || ({} as Record<string, unknown>)["balance"] !== undefined;

describe("a hostile saved wallet", () => {
  it("never breaks the wallet or its balance, and never pollutes Object.prototype", () => {
    for (const text of sources("wallet-fuzz", 3_000)) {
      const store = memoryStore();
      store.setItem("w", text);
      const wallet = new Wallet(store, "w", 5_000);
      expect(Number.isSafeInteger(wallet.balance), text.slice(0, 80)).toBe(true);
      expect(wallet.balance).toBeGreaterThanOrEqual(0);
      expect(() => wallet.canAfford(1)).not.toThrow();
      expect(() => wallet.reload()).not.toThrow();
      expect(polluted()).toBe(false);
      // And it still plays: a damaged save costs the player their saved balance, not the game.
      if (wallet.balance >= 1) expect(() => wallet.settle(1, 2)).not.toThrow();
    }
  });

  it("falls back to the starting balance for anything but a whole non-negative number", () => {
    for (const text of ['{"balance":-1}', '{"balance":0.5}', '{"balance":"5"}', '{"balance":1e300}', "[]", "garbage", '{"balance":null}']) {
      const store = memoryStore();
      store.setItem("w", text);
      expect(new Wallet(store, "w", 5_000).balance, text).toBe(5_000);
    }
    const store = memoryStore();
    store.setItem("w", '{"balance":12345}');
    expect(new Wallet(store, "w", 5_000).balance).toBe(12_345);
  });
});

describe("hostile saved preferences", () => {
  const LEVELS = [1, 2, 3, 5, 10, 20];
  const DEFAULTS = { unitBet: 2, turbo: false, sound: true, volume: 0.6 };

  it("always come out as a valid choice, with nothing extra carried in", () => {
    for (const text of sources("prefs-fuzz", 3_000)) {
      const store = memoryStore();
      store.setItem("p", text);
      const prefs = loadPrefs(store, "p", LEVELS, DEFAULTS);
      expect(Object.keys(prefs).sort()).toEqual(["sound", "turbo", "unitBet", "volume"]);
      expect(LEVELS).toContain(prefs.unitBet);
      expect(typeof prefs.turbo).toBe("boolean");
      expect(typeof prefs.sound).toBe("boolean");
      expect(Number.isFinite(prefs.volume)).toBe(true);
      expect(prefs.volume).toBeGreaterThanOrEqual(0);
      expect(prefs.volume).toBeLessThanOrEqual(1);
      expect(polluted()).toBe(false);
    }
  });
});

describe("a hostile saved Forge", () => {
  it("is cleaned into a valid save, whatever was written, and an engine can run from it", () => {
    const rng = createRng("forge-engine");
    for (const text of sources("forge-fuzz", 3_000)) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Not JSON: the page treats it as no save at all.
      }
      const save = parseForgeSave(parsed);
      expect(Object.keys(save).sort()).toEqual(["bestHeat", "levels", "lifetime", "strikes"]);
      expect(Object.keys(save.levels).sort()).toEqual([...UPGRADE_IDS].sort());
      for (const id of UPGRADE_IDS) {
        expect(Number.isInteger(save.levels[id]), id).toBe(true);
        expect(save.levels[id]).toBeGreaterThanOrEqual(0);
        expect(save.levels[id]).toBeLessThanOrEqual(FORGE.upgrades[id].maxLevel);
      }
      for (const count of [save.strikes, save.lifetime, save.bestHeat]) {
        expect(Number.isSafeInteger(count)).toBe(true);
        expect(count).toBeGreaterThanOrEqual(0);
      }
      expect(save.bestHeat).toBeLessThanOrEqual(FORGE.heat.max);
      expect(polluted()).toBe(false);

      const engine = new ForgeEngine({ bank: { balance: () => 0, earn() {}, spend() {} }, rng, onEvent() {}, save });
      engine.strike();
      engine.tick(100);
      const state = engine.state();
      expect(Number.isFinite(state.heat)).toBe(true);
      expect(Number.isFinite(state.strikeValue)).toBe(true);
      for (const id of UPGRADE_IDS) expect(state.costs[id] === null || Number.isFinite(state.costs[id])).toBe(true);
    }
  });

  it("keeps an upgrade level only up to its top, so a forged save cannot buy past the end", () => {
    const save = parseForgeSave({ levels: { hammer: 99_999, tongs: 99_999, mainspring: 99_999, luck: 99_999 } });
    for (const id of UPGRADE_IDS) expect(save.levels[id]).toBe(FORGE.upgrades[id].maxLevel);
  });
});

describe("hostile addresses", () => {
  const MACHINES = ["classic", "crucible"];
  const ROUTE_PAGES = ["lobby", "machine", "forge"];

  it("always lead somewhere that exists, and never to a machine that is not on the floor", () => {
    const hostile = [
      "#/play/__proto__", "#/play/constructor", "#/play/toString", "#/play/hasOwnProperty", "#/play/classic/../crucible", "#/play/%2e%2e",
      "#/play/classic%00", "#//play//classic", "#/PLAY/classic", "#/play/Classic", "#/forge/../../x", `#/${"a/".repeat(5_000)}`, "#/play/" + "x".repeat(100_000),
      "#/<script>alert(1)</script>", "#/play/<img src=x onerror=alert(1)>", "#?x=1", "#/play/classic?seed=1#/forge", "", "#", "javascript:alert(1)", "#/play/💥",
    ];
    const rng = createRng("route-fuzz");
    const random = Array.from({ length: 2_000 }, () => `#/${Array.from({ length: nextInt(rng, 5) }, () => pick(rng, [...KEYS, ...STRINGS, "play", "forge", "classic", "crucible", ".."]).slice(0, 40)).join("/")}`);
    for (const hash of [...hostile, ...random]) {
      const route = parseRoute(hash, MACHINES);
      expect(ROUTE_PAGES, hash.slice(0, 60)).toContain(route.page);
      if (route.page === "machine") expect(MACHINES).toContain(route.machine);
    }
  });
});

describe("hostile launch parameters", () => {
  it("never throw and never produce a seed longer than the limit", () => {
    const rng = createRng("launch-fuzz");
    for (let i = 0; i < 2_000; i++) {
      const search = `?${Array.from({ length: nextInt(rng, 5) }, () => `${encodeURIComponent(pick(rng, [...KEYS, "seed", "debug", "Seed", "DEBUG"]))}=${encodeURIComponent(pick(rng, STRINGS))}`).join("&")}`;
      for (const allowed of [true, false]) {
        const launch = parseLaunch(search, allowed);
        if (!allowed) expect(launch).toEqual({ debug: false, seed: null });
        else expect(launch.seed === null || launch.seed.length <= MAX_SEED_LENGTH).toBe(true);
      }
    }
    expect(() => parseLaunch("?%E0%A4%A", true)).not.toThrow();
    expect(() => parseLaunch("?seed=%", true)).not.toThrow();
  });
});
