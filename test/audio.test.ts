import { describe, expect, it } from "vitest";
import { assertFitsLoop, Biquad, makeLoop, midi, noiseSource, peakOf, rmsOf, SAMPLE_RATE, silence, tone } from "../src/audio/dsp.ts";
import type { Samples } from "../src/audio/dsp.ts";
import { heatSemitones, panFor, RecordingSfx, semitoneRate, SFX_NAMES, silent, winSound } from "../src/audio/sfx.ts";
import type { SfxName } from "../src/audio/sfx.ts";
import { LOOPING, renderAll, renderSound } from "../src/audio/sounds.ts";
import { decodeWav, encodeWav } from "../src/audio/wav.ts";

/** How much of the sound's energy sits at `frequency`, by the Goertzel algorithm (one bin of a DFT). */
function energyAt(samples: Samples, frequency: number, from = 0, seconds = 0.4): number {
  const start = Math.round(from * SAMPLE_RATE);
  const end = Math.min(samples.length, start + Math.round(seconds * SAMPLE_RATE));
  const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / SAMPLE_RATE);
  let s1 = 0;
  let s2 = 0;
  for (let i = start; i < end; i++) {
    const s0 = samples[i]! + coefficient * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return (s1 * s1 + s2 * s2 - coefficient * s1 * s2) / (end - start) ** 2;
}

/**
 * How big the jump at a loop's seam is next to the biggest step anywhere else, looking only at the low
 * frequencies (below about 180 Hz), where a hum or a rumble that does not fit the loop would show up.
 * The loop is played twice through the filter so the seam is measured with the filter settled.
 */
function lowSeamRatio(samples: Samples): number {
  const filter = Biquad.lowpass(180, 0.7);
  const twice = new Float32Array(samples.length * 2);
  twice.set(samples);
  twice.set(samples, samples.length);
  const y = twice.map((x) => filter.process(x));
  const n = samples.length;
  let typical = 0;
  for (let i = n + 50; i < 2 * n - 1; i++) typical = Math.max(typical, Math.abs(y[i + 1]! - y[i]!));
  return Math.abs(y[n]! - y[n - 1]!) / typical;
}

const sounds = renderAll();
const get = (name: SfxName): Samples => sounds.get(name)!;
const oneShots = SFX_NAMES.filter((name) => !LOOPING.has(name));

describe("the sound set", () => {
  it("has a recipe for every name, and renders them all", () => {
    expect(sounds.size).toBe(SFX_NAMES.length);
    for (const name of SFX_NAMES) expect(get(name).length).toBeGreaterThan(0);
  });

  it("renders quickly enough to do at start-up", () => {
    const started = performance.now();
    renderAll();
    expect(performance.now() - started).toBeLessThan(3_000);
  });

  it("is deterministic: the same sound every time", () => {
    for (const name of SFX_NAMES) expect(renderSound(name)).toEqual(get(name));
  });

  it("makes every sound different from every other", () => {
    const seen = new Set<string>();
    for (const name of SFX_NAMES) seen.add(Array.from(get(name).slice(0, 2000)).join(","));
    expect(seen.size).toBe(SFX_NAMES.length);
  });

  it.each(SFX_NAMES)("%s has clean samples: finite, audible, never clipping", (name) => {
    const samples = get(name);
    expect(samples.every(Number.isFinite)).toBe(true);
    expect(peakOf(samples)).toBeGreaterThan(0.2);
    expect(peakOf(samples)).toBeLessThanOrEqual(0.96);
    expect(rmsOf(samples)).toBeGreaterThan(0.01);
    expect(samples.length / SAMPLE_RATE).toBeLessThan(4);
  });

  it.each(oneShots)("%s starts and ends at silence, and has no DC offset", (name) => {
    const samples = get(name);
    expect(Math.abs(samples[0]!)).toBeLessThan(0.02);
    expect(Math.abs(samples[samples.length - 1]!)).toBeLessThan(0.01);
    const mean = samples.reduce((sum, x) => sum + x, 0) / samples.length;
    expect(Math.abs(mean)).toBeLessThan(0.02);
  });

  it("makes the bigger wins louder and longer", () => {
    const tiers: SfxName[] = ["winTiny", "winSmall", "winBig", "winHuge"];
    for (let i = 1; i < tiers.length; i++) {
      expect(peakOf(get(tiers[i]!))).toBeGreaterThanOrEqual(peakOf(get(tiers[i - 1]!)));
      expect(get(tiers[i]!).length).toBeGreaterThan(get(tiers[i - 1]!).length);
    }
  });

  it("keeps the page's small sounds quieter than the big events", () => {
    for (const small of ["tick", "betUp", "betDown", "coin"] as const) {
      expect(peakOf(get(small))).toBeLessThan(peakOf(get("reelStop")));
      expect(peakOf(get(small))).toBeLessThan(peakOf(get("winBig")));
    }
  });
});

describe("what the sounds are made of", () => {
  it("rings a bell at the pitch asked for", () => {
    // winTiny is a single bell on E6 (1318.5 Hz): its energy sits there, not a minor third away.
    const samples = get("winTiny");
    expect(energyAt(samples, midi(88))).toBeGreaterThan(40 * energyAt(samples, midi(85)));
    expect(energyAt(samples, midi(88))).toBeGreaterThan(40 * energyAt(samples, 700));
  });

  it("puts the coin tick high and the reel thump low", () => {
    const coin = get("coin");
    expect(energyAt(coin, 3136, 0, 0.05)).toBeGreaterThan(30 * energyAt(coin, 500, 0, 0.05));
    const stop = get("reelStop");
    expect(energyAt(stop, 80, 0, 0.15)).toBeGreaterThan(5 * energyAt(stop, 9000, 0, 0.15));
  });

  it("rises when it says it rises", () => {
    const up = get("betUp");
    const down = get("betDown");
    // Early in the blip the pitch is near 700 Hz going up, near 1050 Hz going down; late it has swapped.
    expect(energyAt(up, 700, 0, 0.015)).toBeGreaterThan(energyAt(up, 1050, 0, 0.015));
    expect(energyAt(down, 1050, 0, 0.015)).toBeGreaterThan(energyAt(down, 700, 0, 0.015));
  });

  it("dies away rather than being cut off", () => {
    for (const name of ["reelStop", "winBig", "gemBurst", "retrigger"] as const) {
      const samples = get(name);
      const early = rmsOf(samples.slice(0, Math.round(samples.length * 0.2)));
      const late = rmsOf(samples.slice(Math.round(samples.length * 0.85)));
      expect(late).toBeLessThan(early * 0.25);
    }
  });
});

describe("loops", () => {
  const loops = [...LOOPING];

  it.each(loops)("%s joins its end to its start without a click", (name) => {
    const samples = get(name);
    let largestStep = 0;
    for (let i = 1; i < samples.length; i++) largestStep = Math.max(largestStep, Math.abs(samples[i]! - samples[i - 1]!));
    const seam = Math.abs(samples[0]! - samples[samples.length - 1]!);
    expect(seam).toBeLessThan(largestStep * 1.5);
  });

  it.each(loops)("%s has no jump at the seam in its hum and rumble", (name) => {
    expect(lowSeamRatio(get(name))).toBeLessThan(2);
  });

  it("makes the ratchet tick twenty times a loop, evenly", () => {
    const samples = get("reelLoop");
    expect(samples.length / SAMPLE_RATE).toBeCloseTo(0.8, 3);
    const period = samples.length / 20;
    let clearTicks = 0;
    for (let k = 0; k < 20; k++) {
      const at = Math.round(k * period);
      const onTick = rmsOf(samples.slice(at + 1, at + Math.round(0.004 * SAMPLE_RATE)));
      const between = rmsOf(samples.slice(Math.round(at + period / 2), Math.round(at + period / 2) + Math.round(0.004 * SAMPLE_RATE)));
      if (onTick > 1.5 * between) clearTicks++;
    }
    expect(clearTicks).toBeGreaterThanOrEqual(19);
  });

  it("only lets a hum into a loop if it makes whole cycles, so it cannot click at the seam", () => {
    const length = Math.round(0.8 * SAMPLE_RATE);
    expect(() => assertFitsLoop(110, length)).not.toThrow(); // 88 cycles
    expect(() => assertFitsLoop(125, length)).not.toThrow(); // 100 cycles
    expect(() => assertFitsLoop(113.3, length)).toThrow(RangeError);
    expect(() => assertFitsLoop(0.5, 2 * SAMPLE_RATE)).not.toThrow();
    expect(() => assertFitsLoop(55.7, 2 * SAMPLE_RATE)).toThrow(/whole number/);
  });

  it("refuses to make a loop too short for its crossfade", () => {
    expect(() => makeLoop(silence(0.05), 0.04)).toThrow(RangeError);
  });

  it("crossfades into the start so the last sample flows into the first", () => {
    // A steady tone whose pitch does NOT make a whole number of cycles in the loop (101.7 Hz over 1 s), so
    // it only loops smoothly if the crossfade does its job. A tone that fitted would pass either way.
    const base = tone({ seconds: 1.2, from: 101.7, decay: 1e9, attack: 0.0001 });
    const looped = makeLoop(base, 0.2);
    const step = Math.abs(looped[1]! - looped[0]!);
    expect(Math.abs(looped[0]! - looped[looped.length - 1]!)).toBeLessThan(step * 3 + 0.005);
    // And without the crossfade the same cut really would jump, so this test can fail.
    const plain = base.slice(0, looped.length);
    expect(Math.abs(plain[0]! - plain[plain.length - 1]!)).toBeGreaterThan(0.2);
  });
});

describe("dsp building blocks", () => {
  it("gives the same noise for the same seed, and different noise for another", () => {
    const a = noiseSource("a");
    const b = noiseSource("a");
    const c = noiseSource("c");
    const first = Array.from({ length: 8 }, () => a());
    expect(Array.from({ length: 8 }, () => b())).toEqual(first);
    expect(Array.from({ length: 8 }, () => c())).not.toEqual(first);
  });

  it("keeps noise within [-1, 1) and centred", () => {
    const noise = noiseSource("range");
    let sum = 0;
    for (let i = 0; i < 50_000; i++) {
      const x = noise();
      expect(x >= -1 && x < 1).toBe(true);
      sum += x;
    }
    expect(Math.abs(sum / 50_000)).toBeLessThan(0.02);
  });

  it("filters: a low-pass keeps a low tone and removes a high one", () => {
    const run = (frequency: number) => {
      const filter = Biquad.lowpass(1000);
      const input = tone({ seconds: 0.2, from: frequency, decay: 1e9, attack: 0.0001 });
      return rmsOf(input.map((x) => filter.process(x)).slice(4000));
    };
    expect(run(200)).toBeGreaterThan(0.6);
    expect(run(8000)).toBeLessThan(0.05);
  });

  it("gives the right pitch for MIDI notes", () => {
    expect(midi(69)).toBeCloseTo(440, 9);
    expect(midi(81)).toBeCloseTo(880, 9);
    expect(midi(60)).toBeCloseTo(261.6256, 3);
  });
});

describe("choosing sounds", () => {
  it("scales the win sound with the win", () => {
    expect(winSound(0, 40)).toBeNull();
    expect(winSound(10, 40)).toBe("winTiny");
    expect(winSound(40, 40)).toBe("winSmall");
    expect(winSound(199, 40)).toBe("winSmall");
    expect(winSound(200, 40)).toBe("winBig");
    expect(winSound(999, 40)).toBe("winBig");
    expect(winSound(1000, 40)).toBe("winHuge");
  });

  it("climbs a pentatonic scale with heat, then holds at the top", () => {
    const semitones = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 25, 100].map(heatSemitones);
    expect(semitones.slice(0, 5)).toEqual([0, 2, 4, 7, 9]);
    expect(semitones[5]).toBe(12);
    // Strictly rising until it reaches the top, never falling, never above it.
    for (let i = 1; i < semitones.length; i++) expect(semitones[i]!).toBeGreaterThanOrEqual(semitones[i - 1]!);
    expect(Math.max(...semitones)).toBe(19);
    expect(heatSemitones(0)).toBe(0);
  });

  it("turns semitones into a playback rate", () => {
    expect(semitoneRate(0)).toBe(1);
    expect(semitoneRate(12)).toBeCloseTo(2, 12);
    expect(semitoneRate(-12)).toBeCloseTo(0.5, 12);
  });

  it("spreads items across the stereo field, left to right, and centres a lone one", () => {
    expect([0, 1, 2, 3, 4].map((i) => panFor(i, 5))).toEqual([-0.6, -0.3, 0, 0.3, 0.6].map((x) => expect.closeTo(x, 12)));
    expect(panFor(0, 1)).toBe(0);
  });

  it("records the calls it is given, in order", () => {
    const sfx = new RecordingSfx();
    sfx.play("tick");
    sfx.loop("reelLoop").stop();
    sfx.play("reelStop", { rate: 1.1 });
    expect(sfx.names).toEqual(["tick", "reelLoop", "reelStop"]);
    expect(sfx.calls[2]!.options).toEqual({ rate: 1.1 });
    expect(() => silent.play("tick")).not.toThrow();
  });
});

describe("WAV files", () => {
  it("round-trips a sound to within one 16-bit step", () => {
    const original = get("winSmall");
    const decoded = decodeWav(encodeWav(original));
    expect(decoded.sampleRate).toBe(SAMPLE_RATE);
    expect(decoded.samples.length).toBe(original.length);
    let worst = 0;
    for (let i = 0; i < original.length; i++) worst = Math.max(worst, Math.abs(decoded.samples[i]! - original[i]!));
    expect(worst).toBeLessThan(1 / 32767);
  });

  it("writes a header a player will accept", () => {
    const bytes = encodeWav(get("tick"));
    const text = (from: number) => String.fromCharCode(...bytes.subarray(from, from + 4));
    expect([text(0), text(8), text(12), text(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    expect(new DataView(bytes.buffer).getUint32(4, true)).toBe(bytes.length - 8);
  });

  it("clips out-of-range samples instead of wrapping them", () => {
    const decoded = decodeWav(encodeWav(Float32Array.from([2, -2, 0])));
    expect(Array.from(decoded.samples)).toEqual([1, -1, 0]);
  });
});
