import { describe, expect, it } from "vitest";
import { createRng, nextInt } from "../src/engine/index.ts";
import { brightness, floaterPose, HammerSwing, heatColor, SPARKS, sparkAlpha, spawnSparks, stepSpark, SWING } from "../src/ui/forgeMotion.ts";

const FRAME = 1000 / 60;

/** Steps a swing for `ms`, returning every angle it passed through and how many impacts it reported. */
function run(swing: HammerSwing, ms: number): { angles: number[]; impacts: number } {
  const angles: number[] = [];
  let impacts = 0;
  for (let t = 0; t < ms; t += FRAME) {
    if (swing.update(FRAME)) impacts++;
    angles.push(swing.angle);
  }
  return { angles, impacts };
}

describe("HammerSwing", () => {
  it("waits raised until struck", () => {
    const swing = new HammerSwing();
    expect(run(swing, 500)).toEqual({ angles: expect.any(Array), impacts: 0 });
    expect(swing.angle).toBe(SWING.restRad);
  });

  it("falls to the iron, reports the impact once, and lifts back to rest", () => {
    const swing = new HammerSwing();
    swing.strike();
    const { angles, impacts } = run(swing, 600);
    expect(impacts).toBe(1);
    expect(Math.min(...angles)).toBe(0);
    expect(swing.angle).toBe(SWING.restRad);
    // It is monotone down to the iron, then monotone up.
    const low = angles.indexOf(0);
    for (let i = 1; i <= low; i++) expect(angles[i]!).toBeLessThanOrEqual(angles[i - 1]!);
    const lastZero = angles.lastIndexOf(0);
    for (let i = lastZero + 1; i < angles.length; i++) expect(angles[i]!).toBeGreaterThanOrEqual(angles[i - 1]!);
  });

  it("starts the next fall from where the hammer is, with no jump", () => {
    const swing = new HammerSwing();
    swing.strike();
    run(swing, SWING.fallMs + SWING.holdMs + SWING.riseMs / 2);
    const midRise = swing.angle;
    expect(midRise).toBeGreaterThan(0);
    expect(midRise).toBeLessThan(SWING.restRad);
    swing.strike();
    swing.update(0.001);
    expect(Math.abs(swing.angle - midRise)).toBeLessThan(0.01);
  });

  it("reports one impact per strike even when strikes come faster than the hammer lifts", () => {
    const swing = new HammerSwing();
    let impacts = 0;
    for (let strike = 0; strike < 20; strike++) {
      swing.strike();
      for (let t = 0; t < 100; t += FRAME) if (swing.update(FRAME)) impacts++;
    }
    expect(impacts).toBe(20);
  });
});

describe("sparks", () => {
  const random = (): (() => number) => {
    const rng = createRng("sparks");
    return () => nextInt(rng, 1_000_000) / 1_000_000;
  };

  it("throws them upward and within their limits", () => {
    const sparks = spawnSparks(random(), 100, 200, 400);
    expect(sparks).toHaveLength(400);
    for (const spark of sparks) {
      expect(spark.vy).toBeLessThan(0);
      expect(Math.hypot(spark.vx, spark.vy)).toBeGreaterThanOrEqual(SPARKS.minSpeed - 1e-9);
      expect(Math.hypot(spark.vx, spark.vy)).toBeLessThanOrEqual(SPARKS.maxSpeed + 1e-9);
      expect(spark.life).toBeGreaterThanOrEqual(SPARKS.minLifeMs);
      expect(spark.life).toBeLessThanOrEqual(SPARKS.maxLifeMs);
    }
  });

  it("scales speed with power", () => {
    const slow = spawnSparks(random(), 0, 0, 50, 0.5);
    const fast = spawnSparks(random(), 0, 0, 50, 1.5);
    const mean = (sparks: typeof slow): number => sparks.reduce((sum, s) => sum + Math.hypot(s.vx, s.vy), 0) / sparks.length;
    expect(mean(fast)).toBeCloseTo(3 * mean(slow), 6);
  });

  it("rises, slows, falls back under gravity, and burns out", () => {
    const [spark] = spawnSparks(() => 0.5, 0, 0, 1);
    const top = { y: 0 };
    let alive = true;
    let steps = 0;
    while (alive && steps < 1000) {
      alive = stepSpark(spark!, FRAME);
      top.y = Math.min(top.y, spark!.y);
      steps++;
    }
    expect(top.y).toBeLessThan(-20);
    expect(spark!.vy).toBeGreaterThan(0);
    expect(alive).toBe(false);
    expect(spark!.age).toBeGreaterThanOrEqual(spark!.life);
  });

  it("fades out as it ages", () => {
    const [spark] = spawnSparks(() => 0.5, 0, 0, 1);
    expect(sparkAlpha({ ...spark!, age: 0 })).toBe(1);
    expect(sparkAlpha({ ...spark!, age: spark!.life })).toBe(0);
    expect(sparkAlpha({ ...spark!, age: spark!.life * 0.9 })).toBeLessThan(sparkAlpha({ ...spark!, age: spark!.life * 0.6 }));
  });
});

describe("floaterPose", () => {
  it("starts in place, solid and slightly enlarged, and ends risen and invisible", () => {
    const start = floaterPose(0, 1000);
    expect(start).toMatchObject({ dy: 0, alpha: 1 });
    expect(start.scale).toBeGreaterThan(1);
    const end = floaterPose(1000, 1000);
    expect(end.dy).toBeLessThan(-50);
    expect(end.alpha).toBe(0);
    expect(end.scale).toBe(1);
  });

  it("rises and fades without ever going backwards", () => {
    let previous = floaterPose(0, 900);
    for (let age = 20; age <= 900; age += 20) {
      const pose = floaterPose(age, 900);
      expect(pose.dy).toBeLessThanOrEqual(previous.dy);
      expect(pose.alpha).toBeLessThanOrEqual(previous.alpha);
      previous = pose;
    }
  });

  it("stays in range if asked about a time outside its life", () => {
    expect(floaterPose(-50, 900).alpha).toBe(1);
    expect(floaterPose(5000, 900).alpha).toBe(0);
  });
});

describe("heatColor", () => {
  it("gets brighter as the iron gets hotter", () => {
    let previous = -1;
    for (let heat = 0; heat <= 100; heat += 2) {
      const level = brightness(heatColor(heat));
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });

  it("runs from grey iron to white", () => {
    expect(heatColor(0)).toBe(0x555049);
    expect(heatColor(100)).toBe(0xfff2d2);
  });

  it("turns red before it turns yellow", () => {
    const red = (color: number): number => (color >> 16) & 0xff;
    const blue = (color: number): number => color & 0xff;
    expect(red(heatColor(30))).toBeGreaterThan(blue(heatColor(30)) + 40);
  });

  it("clamps outside its range", () => {
    expect(heatColor(-20)).toBe(heatColor(0));
    expect(heatColor(500)).toBe(heatColor(100));
  });
});
