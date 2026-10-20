import { describe, expect, it } from "vitest";
import { MAX_SEED_LENGTH, parseLaunch, wantsRepeatableRng } from "../src/app/launch.ts";

describe("parseLaunch", () => {
  it("honours ?debug and ?seed when QA is allowed", () => {
    expect(parseLaunch("?debug", true)).toEqual({ debug: true, seed: null });
    expect(parseLaunch("?seed=abc", true)).toEqual({ debug: false, seed: "abc" });
    expect(parseLaunch("?debug&seed=qa-1", true)).toEqual({ debug: true, seed: "qa-1" });
    expect(parseLaunch("", true)).toEqual({ debug: false, seed: null });
  });

  it.each(["", "?debug", "?seed=abc", "?debug&seed=abc", "?seed=&debug=1", "?DEBUG", "?debug=true&seed=1"])(
    "ignores %j on the deployed site, so no link can put a visitor's game in a QA state",
    (search) => {
      const launch = parseLaunch(search, false);
      expect(launch).toEqual({ debug: false, seed: null });
      expect(wantsRepeatableRng(launch)).toBe(false);
    },
  );

  it("asks for a repeatable generator exactly when QA asked for one", () => {
    expect(wantsRepeatableRng(parseLaunch("", true))).toBe(false);
    expect(wantsRepeatableRng(parseLaunch("?debug", true))).toBe(true);
    expect(wantsRepeatableRng(parseLaunch("?seed=x", true))).toBe(true);
    expect(wantsRepeatableRng(parseLaunch("?seed=", true))).toBe(true);
  });

  it("is case sensitive and does not read other parameters", () => {
    expect(parseLaunch("?Debug&Seed=1&other=1", true)).toEqual({ debug: false, seed: null });
  });

  it("cuts an enormous seed down", () => {
    const launch = parseLaunch(`?seed=${"x".repeat(100_000)}`, true);
    expect(launch.seed).toHaveLength(MAX_SEED_LENGTH);
  });

  it("keeps whatever characters a seed holds as plain text, never interpreting them", () => {
    const seed = `<img src=x onerror=alert(1)>"'&`;
    expect(parseLaunch(`?seed=${encodeURIComponent(seed)}`, true).seed).toBe(seed);
  });
});
