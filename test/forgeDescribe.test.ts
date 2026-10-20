import { describe, expect, it } from "vitest";
import { createRng } from "../src/engine/index.ts";
import { FORGE, UPGRADE_IDS } from "../src/forge/config.ts";
import { describeUpgrade, formatAmount, UPGRADE_BLURBS } from "../src/forge/describe.ts";
import { ForgeEngine } from "../src/forge/engine.ts";
import type { ForgeSave } from "../src/forge/engine.ts";

describe("formatAmount", () => {
  it("writes whole credits with separators and part-credits to two places", () => {
    expect(formatAmount(1234567)).toBe("1,234,567");
    expect(formatAmount(1.5)).toBe("1.5");
    expect(formatAmount(0.6)).toBe("0.6");
    expect(formatAmount(1 / 3)).toBe("0.33");
  });
});

describe("describeUpgrade", () => {
  it("says nothing next at the top level, and something at every level below", () => {
    for (const id of UPGRADE_IDS) {
      const max = FORGE.upgrades[id].maxLevel;
      expect(describeUpgrade(id, max).next).toBeNull();
      expect(describeUpgrade(id, max - 1).next).not.toBeNull();
      expect(describeUpgrade(id, 0).next).toBe(describeUpgrade(id, 1).now);
    }
  });

  it("tells the mainspring's numbers as the engine plays them", () => {
    for (const level of [1, 2, 4, 6]) {
      const levels = { hammer: 0, tongs: 0, mainspring: level, luck: 0 };
      const save: ForgeSave = { levels, strikes: 0, lifetime: 0, bestHeat: 0 };
      const engine = new ForgeEngine({ bank: { balance: () => 0, earn() {}, spend() {} }, rng: createRng("describe"), onEvent() {}, save });
      const state = engine.state();
      const text = describeUpgrade("mainspring", level).now;
      expect(text).toContain(`Holds ${state.capacity} turns`);
      expect(text).toContain(`winds ${formatAmount(state.windPerStrike)}`);
      expect(text).toContain(`${formatAmount(state.autoRate)} times a second`);
    }
  });

  it("tells the hammer's strike value as the engine pays it", () => {
    for (const level of [0, 3, 10]) {
      const save: ForgeSave = { levels: { hammer: level, tongs: 0, mainspring: 0, luck: 0 }, strikes: 0, lifetime: 0, bestHeat: 0 };
      const engine = new ForgeEngine({ bank: { balance: () => 0, earn() {}, spend() {} }, rng: createRng("describe"), onEvent() {}, save });
      expect(describeUpgrade("hammer", level).now).toBe(`Each strike pays ${formatAmount(engine.state().strikeValue)}.`);
    }
  });

  it("describes a Forge without a mainspring as not fitted", () => {
    expect(describeUpgrade("mainspring", 0).now).toBe("Not fitted yet.");
  });

  it("has a line on every upgrade", () => {
    for (const id of UPGRADE_IDS) expect(UPGRADE_BLURBS[id].length).toBeGreaterThan(10);
  });
});
