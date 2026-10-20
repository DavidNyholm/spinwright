import { describe, expect, it } from "vitest";
import { createRng, nextInt } from "../src/engine/index.ts";
import type { Rng } from "../src/engine/index.ts";
import { ClickGuard, GUARD } from "../src/forge/guard.ts";
import type { GuardVerdict, StrikeInput } from "../src/forge/guard.ts";

/** A number evenly spread over [-spread, +spread]. */
const wobble = (rng: Rng, spread: number): number => (nextInt(rng, 100_001) / 100_000 - 0.5) * 2 * spread;

interface Run {
  /** The gap between strikes, on average, in milliseconds. */
  readonly gap: number;
  /** How far each gap wanders either side of that. */
  readonly jitter: number;
  readonly count: number;
  /** Where the pointer is, and how far it drifts (0 for never: the very same pixel every time). Omit for no pointer. */
  readonly pointer?: { readonly x: number; readonly y: number; readonly drift: number };
  readonly startAt?: number;
}

/** Strikes with the given rhythm, as a trusted source would deliver them. */
function strikes(run: Run, seed: string): StrikeInput[] {
  const rng = createRng(seed);
  let at = run.startAt ?? 10_000;
  return Array.from({ length: run.count }, () => {
    at += run.gap + wobble(rng, run.jitter);
    return {
      atMs: at,
      trusted: true,
      ...(run.pointer === undefined
        ? {}
        : { x: run.pointer.x + wobble(rng, run.pointer.drift), y: run.pointer.y + wobble(rng, run.pointer.drift) }),
    };
  });
}

const feed = (guard: ClickGuard, inputs: readonly StrikeInput[]): GuardVerdict[] => inputs.map((input) => guard.check(input));
const reasons = (verdicts: readonly GuardVerdict[]): string[] => verdicts.map((verdict) => (verdict.ok ? "ok" : verdict.reason));
const count = (verdicts: readonly GuardVerdict[], reason: string): number => reasons(verdicts).filter((r) => r === reason).length;

describe("a script's strikes", () => {
  it("are ignored when the browser says they did not come from the person's hardware, and never counted", () => {
    const guard = new ClickGuard();
    const script = strikes({ gap: 100, jitter: 0, count: 200 }, "s").map((input) => ({ ...input, trusted: false }));
    expect(new Set(reasons(feed(guard, script)))).toEqual(new Set(["untrusted"]));
    // Two hundred ignored strikes left no trace: a person's first strikes afterwards are welcome.
    const human = strikes({ gap: 150, jitter: 40, count: 10, startAt: 40_000 }, "h");
    expect(new Set(reasons(feed(guard, human)))).toEqual(new Set(["ok"]));
  });
});

describe("a person's strikes", () => {
  it.each([
    ["a relaxed 4 a second", 250],
    ["a steady 7 a second", 140],
    ["a fast 10 a second", 100],
    ["a very fast 12 a second", 80],
  ])("are never taken for a machine, however long they go on (%s)", (_name, gap) => {
    // A person's gaps wander by a quarter either way, and the hand drifts a few pixels.
    const guard = new ClickGuard();
    const verdicts = feed(guard, strikes({ gap, jitter: gap * 0.25, count: 600, pointer: { x: 300, y: 200, drift: 3 } }, `human-${gap}`));
    expect(new Set(reasons(verdicts))).toEqual(new Set(["ok"]));
    expect(guard.restingMs(1e9)).toBe(0);
  });

  it("are not taken for a machine when they are rhythmic but still wander a little (a drummer's hands)", () => {
    const guard = new ClickGuard();
    const verdicts = feed(guard, strikes({ gap: 120, jitter: 22, count: 400, pointer: { x: 50, y: 50, drift: 2 } }, "drummer"));
    expect(new Set(reasons(verdicts))).toEqual(new Set(["ok"]));
  });

  it("are not judged when slow, however evenly spaced", () => {
    const guard = new ClickGuard();
    expect(new Set(reasons(feed(guard, strikes({ gap: 600, jitter: 0, count: 100 }, "slow"))))).toEqual(new Set(["ok"]));
    // The line is the judged mean: just under it is judged, at it is not.
    expect(new Set(reasons(feed(new ClickGuard(), strikes({ gap: GUARD.judgedBelowMs, jitter: 0, count: 60 }, "edge"))))).toEqual(new Set(["ok"]));
    expect(count(feed(new ClickGuard(), strikes({ gap: GUARD.judgedBelowMs - 1, jitter: 0, count: 60 }, "edge")), "too-regular")).toBeGreaterThan(0);
  });

  it("are not taken for a machine when they come in short bursts with a pause between", () => {
    // Fifteen even strikes, a pause, fifteen more: no twenty-one in a row are evenly timed.
    const guard = new ClickGuard();
    const first = strikes({ gap: 100, jitter: 0, count: 15 }, "b1");
    const second = strikes({ gap: 100, jitter: 0, count: 15, startAt: first.at(-1)!.atMs + 2_000 }, "b2");
    expect(new Set(reasons(feed(guard, [...first, ...second])))).toEqual(new Set(["ok"]));
  });

  it("are judged on the strikes since a pause once enough have come, so a machine that pauses once is still caught", () => {
    const guard = new ClickGuard();
    const before = strikes({ gap: 100, jitter: 0, count: 30 }, "p1").slice(0, 10);
    const after = strikes({ gap: 100, jitter: 0, count: 40, startAt: before.at(-1)!.atMs + 3_000 }, "p2");
    const verdicts = feed(guard, [...before, ...after]);
    // Caught on the 21st strike after the pause: the pause's long gap has left the window by then.
    expect(reasons(verdicts).indexOf("too-regular")).toBe(before.length + GUARD.window);
  });
});

describe("an auto-clicker", () => {
  it("is stopped on the strike that completes a run of machine-even gaps, and earns nothing from then on", () => {
    const guard = new ClickGuard();
    const verdicts = feed(guard, strikes({ gap: 100, jitter: 0, count: 40, pointer: { x: 400, y: 300, drift: 0 } }, "bot"));
    const names = reasons(verdicts);
    expect(names.slice(0, GUARD.window)).toEqual(Array(GUARD.window).fill("ok"));
    expect(verdicts[GUARD.window]).toEqual({ ok: false, reason: "too-regular", cooldownMs: GUARD.cooldownMs });
    // The rest of this burst falls inside the rest.
    expect(new Set(names.slice(GUARD.window + 1))).toEqual(new Set(["cooling"]));
  });

  it("is stopped even when it sends no pointer position, as a key-repeat or a keyboard tool would", () => {
    expect(count(feed(new ClickGuard(), strikes({ gap: 90, jitter: 0, count: 30 }, "keys")), "too-regular")).toBe(1);
  });

  it.each([
    ["timer noise of a couple of milliseconds, drifting pointer", { gap: 100, jitter: 3, pointer: { x: 10, y: 10, drift: 3 } }],
    ["timer noise of a couple of milliseconds, one pixel", { gap: 100, jitter: 3, pointer: { x: 10, y: 10, drift: 0 } }],
    ["a fixed pixel with ten milliseconds of noise (a hand never holds that still)", { gap: 120, jitter: 12, pointer: { x: 10, y: 10, drift: 0 } }],
  ])("is stopped: %s", (_name, run) => {
    expect(count(feed(new ClickGuard(), strikes({ ...run, count: 60 }, "noisy")), "too-regular")).toBeGreaterThan(0);
  });

  it("gets away with more noise than a person's own: the limit of a check this simple", () => {
    // Honest about it: random timing of about twice a hand's wander, from a pointer that drifts, is not caught. See SECURITY.md.
    const verdicts = feed(new ClickGuard(), strikes({ gap: 120, jitter: 12, count: 300, pointer: { x: 10, y: 10, drift: 3 } }, "sly"));
    expect(count(verdicts, "too-regular")).toBe(0);
  });

  it("is rested for twice as long each time it starts again, up to a limit", () => {
    const guard = new ClickGuard();
    const rests: number[] = [];
    let at = 10_000;
    // A machine that clicks every 100 ms, forever, starting the moment it is allowed to.
    for (let i = 0; i < 4_000 && rests.length < 8; i++) {
      at += 100;
      const verdict = guard.check({ atMs: at, trusted: true, x: 5, y: 5 });
      if (!verdict.ok && verdict.reason === "too-regular") rests.push(verdict.cooldownMs);
    }
    expect(rests.slice(0, 5)).toEqual([8_000, 16_000, 32_000, 64_000, GUARD.maxCooldownMs]);
    expect(new Set(rests.slice(4))).toEqual(new Set([GUARD.maxCooldownMs]));
  });

  it("is rested for far longer than it works: a few percent of the time at most", () => {
    const guard = new ClickGuard();
    let paid = 0;
    let at = 0;
    const totalMs = 30 * 60_000;
    while (at < totalMs) {
      at += 100;
      if (guard.check({ atMs: at, trusted: true, x: 5, y: 5 }).ok) paid++;
    }
    const honest = totalMs / 100;
    expect(paid / honest).toBeLessThan(0.05);
  });

  it("is forgiven after a long quiet spell, and rested briefly the next time", () => {
    const guard = new ClickGuard();
    const first = feed(guard, strikes({ gap: 100, jitter: 0, count: 25 }, "again-1"));
    expect(first.some((verdict) => !verdict.ok && verdict.reason === "too-regular")).toBe(true);
    const later = strikes({ gap: 100, jitter: 0, count: 25, startAt: 10_000 + GUARD.cooldownMs + GUARD.forgetFlagsAfterMs + 60_000 }, "again-2");
    const second = feed(guard, later).find((verdict) => !verdict.ok && verdict.reason === "too-regular");
    expect(second).toEqual({ ok: false, reason: "too-regular", cooldownMs: GUARD.cooldownMs });
  });

  it("reports how long the anvil has left to rest", () => {
    const guard = new ClickGuard();
    expect(guard.restingMs(0)).toBe(0);
    const verdicts = feed(guard, strikes({ gap: 100, jitter: 0, count: 25 }, "rest"));
    const flaggedAt = 10_000 + 100 * (GUARD.window + 1);
    expect(verdicts[GUARD.window]!.ok).toBe(false);
    expect(guard.restingMs(flaggedAt)).toBe(GUARD.cooldownMs);
    expect(guard.restingMs(flaggedAt + 3_000)).toBe(GUARD.cooldownMs - 3_000);
    expect(guard.restingMs(flaggedAt + GUARD.cooldownMs)).toBe(0);
    expect(guard.restingMs(flaggedAt + 1e6)).toBe(0);
  });

  it("is let back in once the rest is over", () => {
    const guard = new ClickGuard();
    feed(guard, strikes({ gap: 100, jitter: 0, count: 25 }, "back"));
    const afterRest = strikes({ gap: 150, jitter: 40, count: 5, startAt: 10_000 + 100 * 25 + GUARD.cooldownMs + 100 }, "back-human");
    expect(new Set(reasons(feed(guard, afterRest)))).toEqual(new Set(["ok"]));
  });
});

describe("the pace limit", () => {
  it("ignores strikes faster than a hand can make, without calling them a machine", () => {
    const guard = new ClickGuard();
    const verdicts = feed(guard, strikes({ gap: 16, jitter: 0, count: 40 }, "mash"));
    const accepted = count(verdicts, "ok");
    const ceiling = GUARD.burst + (GUARD.maxPerSecond * 40 * 16) / 1000 + 1;
    expect(accepted).toBeGreaterThanOrEqual(GUARD.burst);
    expect(accepted).toBeLessThanOrEqual(ceiling);
    expect(count(verdicts, "too-fast")).toBe(40 - accepted);
    expect(count(verdicts, "too-regular")).toBe(0);
    expect(guard.restingMs(10_000 + 40 * 16)).toBe(0);
  });

  it("does not count the ignored strikes towards a run, and lets normal pace resume", () => {
    const guard = new ClickGuard();
    feed(guard, strikes({ gap: 16, jitter: 0, count: 40 }, "mash"));
    const normal = strikes({ gap: 140, jitter: 35, count: 30, startAt: 10_000 + 40 * 16 + 1_000 }, "normal");
    expect(new Set(reasons(feed(guard, normal)))).toEqual(new Set(["ok"]));
  });

  it("allows a short burst of a few quick strikes at once", () => {
    const guard = new ClickGuard();
    const verdicts = feed(guard, strikes({ gap: 20, jitter: 0, count: GUARD.burst }, "burst"));
    expect(new Set(reasons(verdicts))).toEqual(new Set(["ok"]));
  });
});

describe("odd input", () => {
  it("copes with a clock that goes backwards or stands still", () => {
    const guard = new ClickGuard();
    const at = [1000, 900, 900, 5000, 4000, 4000, 4000];
    for (const atMs of at) expect(() => guard.check({ atMs, trusted: true })).not.toThrow();
  });

  it("copes with missing, fractional and negative positions", () => {
    const guard = new ClickGuard();
    expect(guard.check({ atMs: 1, trusted: true, x: undefined, y: undefined }).ok).toBe(true);
    expect(guard.check({ atMs: 200, trusted: true, x: 1.4, y: -3.6 }).ok).toBe(true);
  });
});
