import { describe, expect, it } from "vitest";
import { CRUCIBLE_RTP_PERCENT } from "../src/app/catalog.ts";
import { playCascade, playFeatureSession, triggerProbability } from "../src/engine/cascade/index.ts";
import { createRng } from "../src/engine/index.ts";
import { crucible } from "../src/games/crucible.ts";

describe("Crucible", () => {
  const totalBet = crucible.units; // at 1 credit per unit

  it("triggers its feature about once in a hundred spins, exactly", () => {
    const chance = triggerProbability(crucible);
    expect(1 / chance).toBeGreaterThan(95);
    expect(1 / chance).toBeLessThan(130);
  });

  it("returns about 95% by parts, and its simulated spins agree with the pieces", { timeout: 120_000 }, () => {
    // The return is the base spins' average plus the exact trigger chance times the average feature.
    // The seed is fixed, so this is a repeatable check that the economy has not been broken,
    // not a lottery: limits are wide enough for sampling error and narrow enough to catch a bad pay table.
    const rng = createRng("crucible-economy");
    const plays = 500_000;
    let base = 0;
    let hits = 0;
    for (let i = 0; i < plays; i++) {
      const result = playCascade(crucible, rng, 1);
      base += result.base.win;
      if (result.totalWin > 0) hits++;
    }
    const sessionRng = createRng("crucible-sessions");
    const sessions = 100_000;
    let feature = 0;
    for (let i = 0; i < sessions; i++) feature += playFeatureSession(crucible, sessionRng, 1);

    const rtp = base / plays / totalBet + (triggerProbability(crucible) * feature) / sessions / totalBet;
    expect(rtp).toBeGreaterThan(0.935);
    expect(rtp).toBeLessThan(0.975);
    // The lobby quotes a return for this machine; it must stay close to what the machine really does.
    expect(Math.abs(rtp * 100 - CRUCIBLE_RTP_PERCENT)).toBeLessThan(1);
    expect(hits / plays).toBeGreaterThan(0.55);
    expect(hits / plays).toBeLessThan(0.7);
  });

  it("never pays more than its cap, even when heat runs to its maximum", { timeout: 120_000 }, () => {
    const rng = createRng("crucible-cap");
    let sawMaxHeat = false;
    for (let i = 0; i < 20_000; i++) {
      const result = playCascade(crucible, rng, 3);
      expect(result.totalWin).toBeLessThanOrEqual(crucible.maxWinMultiple * result.totalBet);
      expect(Number.isInteger(result.totalWin)).toBe(true);
      for (const round of result.feature ?? []) if (round.endHeat === crucible.heat.max) sawMaxHeat = true;
    }
    expect(sawMaxHeat).toBe(true);
  });
});
