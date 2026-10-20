import { describe, expect, it } from "vitest";
import { createCryptoRng, createRng, nextInt, randomSeed } from "../src/engine/index.ts";

describe("createRng", () => {
  it("gives the same stream for the same seed and different streams for different seeds", () => {
    const draw = (seed: string) => {
      const rng = createRng(seed);
      return Array.from({ length: 8 }, () => rng.nextUint32());
    };
    expect(draw("a")).toEqual(draw("a"));
    expect(draw("a")).not.toEqual(draw("b"));
  });

  it("treats a number seed as its decimal string", () => {
    expect(createRng(42).nextUint32()).toBe(createRng("42").nextUint32());
  });

  // Regression guard, not a correctness proof: changing the stream would silently invalidate
  // every saved seed and QA repro, so a change here must be deliberate.
  it("keeps its stream stable for a known seed", () => {
    const rng = createRng("spinwright");
    expect([rng.nextUint32(), rng.nextUint32(), rng.nextUint32()]).toEqual([3059763358, 1213251011, 535239049]);
  });

  it("returns unsigned 32-bit integers", () => {
    const rng = createRng("range");
    for (let i = 0; i < 10_000; i++) {
      const x = rng.nextUint32();
      expect(Number.isInteger(x) && x >= 0 && x < 2 ** 32).toBe(true);
    }
  });
});

describe("nextInt", () => {
  it("is uniform over a small range (chi-square, 5 degrees of freedom, p = 0.001)", () => {
    const rng = createRng("uniform");
    const bound = 6;
    const draws = 600_000;
    const counts = new Array<number>(bound).fill(0);
    for (let i = 0; i < draws; i++) counts[nextInt(rng, bound)]!++;
    const expected = draws / bound;
    const chiSquare = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
    expect(chiSquare).toBeLessThan(20.515);
  });

  // With bound = 3 * 2^30, a plain `x % bound` makes results below 2^30 twice as likely (1/2 instead of 1/3).
  it("has no modulo bias when the bound does not divide 2^32", () => {
    const rng = createRng("bias");
    const bound = 3 * 2 ** 30;
    const draws = 200_000;
    let low = 0;
    for (let i = 0; i < draws; i++) if (nextInt(rng, bound) < 2 ** 30) low++;
    const p = 1 / 3;
    const fourSigma = 4 * Math.sqrt((p * (1 - p)) / draws);
    expect(Math.abs(low / draws - p)).toBeLessThan(fourSigma);
  });

  it("always returns 0 for a bound of 1", () => {
    const rng = createRng("one");
    for (let i = 0; i < 100; i++) expect(nextInt(rng, 1)).toBe(0);
  });

  it.each([0, -1, 1.5, Number.NaN, 2 ** 32 + 1])("rejects the bound %s", (bound) => {
    expect(() => nextInt(createRng("x"), bound)).toThrow(RangeError);
  });
});

describe("createCryptoRng", () => {
  it("is uniform over a small range (chi-square, 5 degrees of freedom)", () => {
    // Unlike the seeded generator this is genuinely random, so the limit is set far out
    // (a false failure has probability around 1e-7) rather than at the usual p = 0.001.
    const rng = createCryptoRng();
    const bound = 6;
    const draws = 600_000;
    const counts = new Array<number>(bound).fill(0);
    for (let i = 0; i < draws; i++) counts[nextInt(rng, bound)]!++;
    const expected = draws / bound;
    const chiSquare = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
    expect(chiSquare).toBeLessThan(40);
  });

  it("keeps producing fresh values across buffer refills", () => {
    const rng = createCryptoRng();
    const seen = new Set<number>();
    for (let i = 0; i < 2_000; i++) seen.add(rng.nextUint32());
    // 2,000 draws from 2^32 values: a collision is rare, a repeated block would show up at once.
    expect(seen.size).toBeGreaterThan(1_990);
  });

  it("gives independent generators different streams", () => {
    const a = createCryptoRng();
    const b = createCryptoRng();
    const first = (rng: typeof a) => Array.from({ length: 4 }, () => rng.nextUint32());
    expect(first(a)).not.toEqual(first(b));
  });

  it("works with nextInt like any other generator", () => {
    const rng = createCryptoRng();
    for (let i = 0; i < 1_000; i++) {
      const x = nextInt(rng, 36);
      expect(x >= 0 && x < 36 && Number.isInteger(x)).toBe(true);
    }
  });
});

describe("randomSeed", () => {
  it("returns 128 bits as hex and differs between calls", () => {
    const a = randomSeed();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(randomSeed()).not.toBe(a);
  });
});
