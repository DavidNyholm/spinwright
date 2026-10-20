import {
  bell,
  Biquad,
  assertFitsLoop,
  fadeEdges,
  makeLoop,
  midi,
  mixInto,
  noiseBurst,
  noiseSource,
  noiseSweep,
  normalize,
  SAMPLE_RATE,
  silence,
  softClip,
  tone,
} from "./dsp.ts";
import type { Samples } from "./dsp.ts";
import { SFX_NAMES } from "./sfx.ts";
import type { SfxName } from "./sfx.ts";

/**
 * The recipe for every sound. Each is built from oscillators, filtered noise and bells in dsp.ts,
 * so the whole set is code: no recordings, no licences, and the same samples on every machine.
 *
 * Levels: one-shots are normalised to a peak chosen for their role (small clicks quiet, wins loud,
 * the biggest win loudest), and the player's limiter catches any pile-up on top of that.
 */

/** Sounds that repeat until stopped; their first and last samples join without a click. */
export const LOOPING: ReadonlySet<SfxName> = new Set<SfxName>(["reelLoop", "furnaceLoop"]);

/** Normalises to `peak` and rounds off the very start and end so the sound never clicks. */
const finish = (samples: Samples, peak: number, fadeOutSeconds = 0.01): Samples =>
  fadeEdges(normalize(samples, peak), 0.0005, fadeOutSeconds);

/** Adds `source` into `target` starting at `startSample`, wrapping around the end (for loops). */
function mixWrapped(target: Samples, source: Samples, startSample: number, gain = 1): void {
  for (let i = 0; i < source.length; i++) target[(startSample + i) % target.length]! += source[i]! * gain;
}

/** A run of bell notes, one after another, `spacing` seconds apart. */
function arpeggio(notes: readonly number[], spacing: number, seconds: number, decay: number, brightness = 1, gain = 1): Samples {
  const out = silence(spacing * notes.length + seconds);
  notes.forEach((note, index) => mixInto(out, bell(midi(note), seconds, decay, brightness), index * spacing, gain * (0.75 + 0.25 * ((index + 1) / notes.length))));
  return out;
}

const C2 = 36;

const RECIPES: Readonly<Record<SfxName, () => Samples>> = {
  // --- the page --------------------------------------------------------------------------

  tick: () => {
    const out = silence(0.05);
    mixInto(out, noiseBurst({ seconds: 0.05, seed: "tick", decay: 0.003, highpass: 2500 }), 0, 0.7);
    mixInto(out, tone({ seconds: 0.05, from: 1600, decay: 0.006, attack: 0.0005 }), 0, 0.5);
    return finish(out, 0.45, 0.004);
  },

  betUp: () => {
    const out = silence(0.09);
    mixInto(out, tone({ seconds: 0.09, from: 700, to: 1050, decay: 0.03 }), 0, 0.8);
    mixInto(out, noiseBurst({ seconds: 0.09, seed: "betUp", decay: 0.003, highpass: 3000 }), 0, 0.3);
    return finish(out, 0.4, 0.01);
  },

  betDown: () => {
    const out = silence(0.09);
    mixInto(out, tone({ seconds: 0.09, from: 1050, to: 700, decay: 0.03 }), 0, 0.8);
    mixInto(out, noiseBurst({ seconds: 0.09, seed: "betDown", decay: 0.003, highpass: 3000 }), 0, 0.3);
    return finish(out, 0.4, 0.01);
  },

  coin: () => {
    const out = silence(0.07);
    mixInto(out, tone({ seconds: 0.07, from: 3136, decay: 0.008, attack: 0.0008 }), 0, 1);
    mixInto(out, tone({ seconds: 0.07, from: 6272, decay: 0.005, attack: 0.0008 }), 0, 0.4);
    return finish(out, 0.28, 0.01);
  },

  // --- reels -----------------------------------------------------------------------------

  spinStart: () => {
    const out = silence(0.5);
    mixInto(out, noiseSweep({ seconds: 0.45, seed: "spinStart", fromHz: 250, toHz: 2600, q: 1.6, envelope: (p) => Math.min(1, p / 0.08) * (1 - p) ** 1.5 }));
    mixInto(out, tone({ seconds: 0.2, from: 140, to: 55, decay: 0.07 }), 0, 0.9);
    mixInto(out, noiseBurst({ seconds: 0.02, seed: "spinStart-click", decay: 0.003, highpass: 2000 }), 0, 0.5);
    return finish(out, 0.7, 0.03);
  },

  reelLoop: () => {
    // A ratchet: twenty ticks in 0.8 s over a soft bed. Ticks and hum repeat exactly; only the bed is crossfaded.
    const LOOP = 0.8;
    const FADE = 0.08;
    const TICKS = 20;
    const bedNoise = noiseSource("reelLoop-bed");
    const bedFilter = Biquad.bandpass(420, 0.9);
    const bed = silence(LOOP + FADE);
    for (let i = 0; i < bed.length; i++) bed[i] = bedFilter.process(bedNoise()) * 0.22;
    const out = makeLoop(bed, FADE);

    const tick = silence(0.015);
    mixInto(tick, noiseBurst({ seconds: 0.015, seed: "reelLoop-tick", decay: 0.0025, highpass: 1100 }), 0, 0.6);
    mixInto(tick, tone({ seconds: 0.015, from: 320, decay: 0.004 }), 0, 0.5);
    for (let k = 0; k < TICKS; k++) mixWrapped(out, tick, Math.round((k * out.length) / TICKS));

    // 110 Hz makes a whole number of cycles (88) in 0.8 s, so the hum meets itself at the seam.
    assertFitsLoop(110, out.length);
    for (let i = 0; i < out.length; i++) out[i]! += 0.07 * Math.sin((2 * Math.PI * 110 * i) / SAMPLE_RATE);
    return normalize(out, 0.35);
  },

  reelStop: () => {
    const out = silence(0.32);
    mixInto(out, tone({ seconds: 0.3, from: 170, to: 48, decay: 0.07, attack: 0.001 }), 0, 1);
    mixInto(out, noiseBurst({ seconds: 0.03, seed: "reelStop", decay: 0.004, highpass: 2500 }), 0, 0.55);
    mixInto(out, tone({ seconds: 0.25, from: 1760, decay: 0.045 }), 0.003, 0.14);
    mixInto(out, tone({ seconds: 0.25, from: 2793, decay: 0.035 }), 0.003, 0.09);
    softClip(out, 1.4);
    return finish(out, 0.7, 0.03);
  },

  // --- wins ------------------------------------------------------------------------------

  winTiny: () => finish(bell(midi(88), 0.5, 0.16), 0.5, 0.05),

  winSmall: () => finish(arpeggio([84, 88, 91], 0.085, 0.7, 0.2), 0.65, 0.08),

  winBig: () => {
    const out = silence(2);
    mixInto(out, arpeggio([84, 86, 88, 91, 93, 96], 0.075, 1.2, 0.35));
    mixInto(out, bell(midi(96), 1.5, 0.7, 0.6), 0.45, 0.5);
    mixInto(out, tone({ seconds: 1.6, from: midi(C2), attack: 0.15, decay: 0.8 }), 0, 0.35);
    return finish(out, 0.8, 0.15);
  },

  winHuge: () => {
    const out = silence(3.4);
    mixInto(out, arpeggio([72, 76, 79, 84, 88, 91, 96, 100], 0.09, 1.5, 0.45));
    // A held chord underneath: sawtooth notes through a low-pass so they sound like brass, not buzz.
    const chord = silence(3);
    for (const note of [48, 52, 55, 60]) mixInto(chord, tone({ seconds: 3, from: midi(note), shape: "saw", attack: 0.03, decay: 1, gain: 0.22 }));
    const brass = Biquad.lowpass(1400, 0.8);
    for (let i = 0; i < chord.length; i++) chord[i] = brass.process(chord[i]!);
    mixInto(out, chord, 0.35);
    mixInto(out, bell(midi(100), 2.6, 1.1, 0.5), 0.7, 0.5);
    mixInto(out, tone({ seconds: 2.2, from: midi(C2), attack: 0.2, decay: 1 }), 0, 0.4);
    return finish(out, 0.9, 0.3);
  },

  scatter: () => {
    const out = silence(0.7);
    const shimmer = tone({ seconds: 0.45, from: 500, to: 2200, decay: 0.35, attack: 0.02 });
    for (let i = 0; i < shimmer.length; i++) shimmer[i]! *= 0.6 + 0.4 * Math.sin((2 * Math.PI * 14 * i) / SAMPLE_RATE);
    mixInto(out, shimmer, 0, 0.8);
    mixInto(out, bell(1760, 0.4, 0.16), 0.3, 0.7);
    return finish(out, 0.6, 0.06);
  },

  // --- cascades --------------------------------------------------------------------------

  whoosh: () => {
    const out = noiseSweep({
      seconds: 0.4,
      seed: "whoosh",
      fromHz: 3200,
      toHz: 280,
      q: 1.2,
      envelope: (p) => Math.sin(Math.PI * Math.min(1, p * 1.1)) ** 1.2,
    });
    return finish(out, 0.5, 0.04);
  },

  gemLand: () => {
    const out = silence(0.16);
    mixInto(out, tone({ seconds: 0.15, from: 1300, decay: 0.022, attack: 0.0008 }), 0, 0.8);
    mixInto(out, tone({ seconds: 0.15, from: 1300 * 2.76, decay: 0.014, attack: 0.0008 }), 0, 0.35);
    mixInto(out, noiseBurst({ seconds: 0.02, seed: "gemLand", decay: 0.0015, highpass: 4500 }), 0, 0.5);
    return finish(out, 0.4, 0.02);
  },

  gemBurst: () => {
    // Glass breaking: a quick scatter of bright noise ticks, then a few chimes ringing out of it.
    const out = silence(0.55);
    const timing = noiseSource("gemBurst-timing");
    for (let k = 0; k < 12; k++) {
      const at = k * 0.014 + Math.abs(timing()) * 0.004;
      mixInto(out, noiseBurst({ seconds: 0.08, seed: `gemBurst-${k}`, decay: 0.012, highpass: 2800 + k * 150 }), at, 1 - k / 14);
    }
    [96, 100, 103].forEach((note, index) => mixInto(out, bell(midi(note), 0.5, 0.16), 0.03 * (index + 1), [0.5, 0.4, 0.3][index]!));
    return finish(out, 0.65, 0.04);
  },

  heatUp: () => {
    const out = silence(0.5);
    mixInto(out, tone({ seconds: 0.18, from: 330, to: 495, decay: 0.15, attack: 0.004, shape: "triangle" }), 0, 0.6);
    mixInto(out, bell(660, 0.45, 0.16, 0.8), 0.14, 0.7);
    mixInto(out, noiseBurst({ seconds: 0.3, seed: "heatUp", decay: 0.07, lowpass: 350 }), 0, 0.5);
    return finish(out, 0.6, 0.04);
  },

  ember: () => {
    // A fire catching: a scatter of crackles over a low, breathy glow.
    const out = silence(0.6);
    const timing = noiseSource("ember-timing");
    for (let k = 0; k < 14; k++) {
      const at = Math.abs(timing()) * 0.5;
      mixInto(out, noiseBurst({ seconds: 0.03, seed: `ember-${k}`, decay: 0.004, highpass: 1500, lowpass: 6000 }), at, 0.5 + 0.5 * Math.abs(timing()));
    }
    mixInto(out, noiseSweep({ seconds: 0.55, seed: "ember-glow", fromHz: 700, toHz: 1100, q: 0.8, envelope: (p) => Math.sin(Math.PI * p) ** 2 }), 0, 0.3);
    mixInto(out, tone({ seconds: 0.5, from: 196, attack: 0.08, decay: 0.2 }), 0, 0.3);
    return finish(out, 0.55, 0.05);
  },

  featureStart: () => {
    const out = silence(2.2);
    mixInto(out, noiseSweep({ seconds: 1.3, seed: "featureStart", fromHz: 180, toHz: 3400, q: 1.2, envelope: (p) => p ** 1.6 }), 0, 0.8);
    const swell = silence(2.2);
    for (const note of [36, 43, 48, 52]) mixInto(swell, tone({ seconds: 2.2, from: midi(note), shape: "saw", attack: 1.1, decay: 0.6, gain: 0.25 }));
    const warm = Biquad.lowpass(650, 0.9);
    for (let i = 0; i < swell.length; i++) swell[i] = warm.process(swell[i]!);
    mixInto(out, swell);
    // The furnace catches at 1.25 s.
    mixInto(out, noiseBurst({ seconds: 0.5, seed: "featureStart-hit", decay: 0.12, lowpass: 1200 }), 1.25, 0.9);
    mixInto(out, tone({ seconds: 0.8, from: 62, decay: 0.35 }), 1.25, 1);
    for (const note of [84, 88, 91]) mixInto(out, bell(midi(note), 0.9, 0.4), 1.25, 0.5);
    return finish(out, 0.9, 0.08);
  },

  retrigger: () => finish(arpeggio([91, 95, 98, 103], 0.07, 0.6, 0.3), 0.65, 0.08),

  // --- the Forge -------------------------------------------------------------------------

  anvil: () => {
    // A hammer on iron: a short low thump for the weight, then a ring of inharmonic partials (which is
    // what makes metal sound like metal and not a bell), a sharp click for the contact, and a hiss of sparks.
    const out = silence(0.5);
    mixInto(out, tone({ seconds: 0.14, from: 150, to: 70, decay: 0.03, attack: 0.0008 }), 0, 0.9);
    for (const [ratio, level, decay] of [
      [1, 1, 0.14],
      [2.32, 0.7, 0.1],
      [4.25, 0.5, 0.065],
      [6.63, 0.35, 0.045],
      [9.38, 0.2, 0.03],
    ] as const) {
      mixInto(out, tone({ seconds: 0.45, from: 540 * ratio, decay, attack: 0.0006 }), 0, level * 0.5);
    }
    mixInto(out, noiseBurst({ seconds: 0.015, seed: "anvil-click", decay: 0.0015, highpass: 3500 }), 0, 0.8);
    mixInto(out, noiseBurst({ seconds: 0.12, seed: "anvil-sparks", decay: 0.025, highpass: 5000 }), 0.004, 0.25);
    softClip(out, 1.3);
    return finish(out, 0.7, 0.05);
  },

  autoStrike: () => {
    // The mainspring's little hammer: lighter, higher and shorter than the player's.
    const out = silence(0.3);
    for (const [ratio, level, decay] of [
      [1, 1, 0.07],
      [2.76, 0.5, 0.045],
      [5.4, 0.25, 0.03],
    ] as const) {
      mixInto(out, tone({ seconds: 0.28, from: 1400 * ratio, decay, attack: 0.0006 }), 0, level * 0.6);
    }
    mixInto(out, noiseBurst({ seconds: 0.01, seed: "autoStrike", decay: 0.0012, highpass: 4000 }), 0, 0.5);
    mixInto(out, tone({ seconds: 0.05, from: 300, to: 180, decay: 0.012 }), 0, 0.35);
    return finish(out, 0.4, 0.03);
  },

  upgrade: () => {
    // Gears clicking home, then a chime.
    const out = silence(0.8);
    for (let k = 0; k < 4; k++) mixInto(out, noiseBurst({ seconds: 0.02, seed: `upgrade-${k}`, decay: 0.003, highpass: 1500 }), k * 0.04, 0.6);
    [79, 83, 86].forEach((note, index) => mixInto(out, bell(midi(note), 0.6, 0.22), 0.17 + index * 0.07, 0.8));
    return finish(out, 0.65, 0.08);
  },

  denied: () => {
    // A dull thunk: nothing rings, so it cannot be mistaken for a reward.
    const out = silence(0.22);
    mixInto(out, tone({ seconds: 0.2, from: 110, to: 65, decay: 0.05 }), 0, 1);
    mixInto(out, noiseBurst({ seconds: 0.03, seed: "denied", decay: 0.012, lowpass: 700 }), 0, 0.6);
    return finish(out, 0.5, 0.03);
  },

  ingotAppear: () => {
    // Light catching gold: a few high bells, one after another.
    const out = silence(0.9);
    [
      [96, 0, 0.6],
      [100, 0.09, 0.5],
      [103, 0.18, 0.45],
      [108, 0.3, 0.4],
      [112, 0.45, 0.35],
    ].forEach(([note, at, gain]) => mixInto(out, bell(midi(note!), 0.5, 0.15, 0.7), at!, gain!));
    return finish(out, 0.45, 0.08);
  },

  frenzy: () => {
    const out = silence(1.2);
    mixInto(out, noiseSweep({ seconds: 0.9, seed: "frenzy", fromHz: 400, toHz: 4200, q: 1.4, envelope: (p) => p ** 1.5 }), 0, 0.7);
    [84, 88, 91, 96].forEach((note, index) => mixInto(out, bell(midi(note), 0.55, 0.25), 0.45 + index * 0.13, 0.7));
    return finish(out, 0.8, 0.1);
  },

  furnaceLoop: () => {
    // A low rumble: soft filtered noise breathing slowly, a deep hum, and a few crackles.
    const LOOP = 2;
    const FADE = 0.2;
    const noise = noiseSource("furnaceLoop-bed");
    const low = Biquad.lowpass(160, 0.7);
    const bed = silence(LOOP + FADE);
    for (let i = 0; i < bed.length; i++) bed[i] = low.process(noise()) * 6;
    const out = makeLoop(bed, FADE);
    // 0.5 Hz and 55 Hz both make whole numbers of cycles in 2 s, so they meet at the seam.
    assertFitsLoop(0.5, out.length);
    assertFitsLoop(55, out.length);
    for (let i = 0; i < out.length; i++) {
      const t = i / SAMPLE_RATE;
      out[i] = out[i]! * (0.75 + 0.25 * Math.sin(2 * Math.PI * 0.5 * t)) + 0.18 * Math.sin(2 * Math.PI * 55 * t);
    }
    // Crackles sit well inside the loop so none straddles the seam.
    [0.31, 0.62, 0.94, 1.27, 1.5, 1.73].forEach((at, index) =>
      mixInto(out, noiseBurst({ seconds: 0.03, seed: `furnaceLoop-${index}`, decay: 0.004, highpass: 1800, lowpass: 7000 }), at, 0.35),
    );
    return normalize(out, 0.3);
  },
};

/** Builds the samples for one sound. */
export function renderSound(name: SfxName): Samples {
  return RECIPES[name]();
}

/** Builds every sound. */
export function renderAll(): Map<SfxName, Samples> {
  return new Map(SFX_NAMES.map((name) => [name, renderSound(name)]));
}
