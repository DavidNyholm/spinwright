import { createRng } from "../engine/index.ts";

/**
 * Small, dependency-free sound synthesis. Every sound in the game is built from these pieces as a
 * plain Float32Array of samples, so it is deterministic, testable in Node, and can be written out
 * as a WAV file. Nothing here touches the browser.
 */

export const SAMPLE_RATE = 44_100;

/** Mono samples in [-1, 1]. Always backed by a plain ArrayBuffer, which is what Web Audio accepts. */
export type Samples = Float32Array<ArrayBuffer>;

export const frames = (seconds: number): number => Math.max(1, Math.round(seconds * SAMPLE_RATE));
export const silence = (seconds: number): Samples => new Float32Array(frames(seconds));

/** The frequency of a MIDI note number (69 is concert A, 440 Hz). */
export const midi = (note: number): number => 440 * 2 ** ((note - 69) / 12);

/** White noise in [-1, 1). The same seed always gives the same noise. */
export function noiseSource(seed: string): () => number {
  const rng = createRng(`spinwright-sound:${seed}`);
  return () => rng.nextUint32() / 2 ** 31 - 1;
}

/** A second-order filter (the standard "audio EQ cookbook" biquad). Its cutoff can be moved while it runs. */
export class Biquad {
  #b0 = 1;
  #b1 = 0;
  #b2 = 0;
  #a1 = 0;
  #a2 = 0;
  #x1 = 0;
  #x2 = 0;
  #y1 = 0;
  #y2 = 0;

  static lowpass(frequency: number, q = 0.707): Biquad {
    return new Biquad().lowpass(frequency, q);
  }

  static highpass(frequency: number, q = 0.707): Biquad {
    return new Biquad().highpass(frequency, q);
  }

  static bandpass(frequency: number, q = 1): Biquad {
    return new Biquad().bandpass(frequency, q);
  }

  lowpass(frequency: number, q = 0.707): this {
    const { cos, alpha } = this.#terms(frequency, q);
    return this.#set((1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
  }

  highpass(frequency: number, q = 0.707): this {
    const { cos, alpha } = this.#terms(frequency, q);
    return this.#set((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
  }

  /** A band-pass with constant peak gain, so the level does not change as the centre moves. */
  bandpass(frequency: number, q = 1): this {
    const { cos, alpha } = this.#terms(frequency, q);
    return this.#set(alpha, 0, -alpha, 1 + alpha, -2 * cos, 1 - alpha);
  }

  process(x: number): number {
    const y = this.#b0 * x + this.#b1 * this.#x1 + this.#b2 * this.#x2 - this.#a1 * this.#y1 - this.#a2 * this.#y2;
    this.#x2 = this.#x1;
    this.#x1 = x;
    this.#y2 = this.#y1;
    this.#y1 = y;
    return y;
  }

  #terms(frequency: number, q: number): { cos: number; alpha: number } {
    // Keep the cutoff safely inside the range a sampled signal can hold.
    const clamped = Math.min(Math.max(frequency, 10), SAMPLE_RATE * 0.45);
    const w = (2 * Math.PI * clamped) / SAMPLE_RATE;
    return { cos: Math.cos(w), alpha: Math.sin(w) / (2 * q) };
  }

  #set(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): this {
    this.#b0 = b0 / a0;
    this.#b1 = b1 / a0;
    this.#b2 = b2 / a0;
    this.#a1 = a1 / a0;
    this.#a2 = a2 / a0;
    return this;
  }
}

export type Shape = "sine" | "triangle" | "saw" | "square";

export interface ToneOptions {
  readonly seconds: number;
  /** Starting frequency in Hz. */
  readonly from: number;
  /** Ending frequency, reached exponentially over the sound. Defaults to `from` (a steady pitch). */
  readonly to?: number;
  readonly shape?: Shape;
  /** Seconds to fade in, to avoid a click at the start. */
  readonly attack?: number;
  /** Time constant of the exponential fade-out, in seconds. */
  readonly decay: number;
  readonly gain?: number;
}

/** One oscillator with a fast attack and an exponential decay. */
export function tone(options: ToneOptions): Samples {
  const { seconds, from, to = from, shape = "sine", attack = 0.002, decay, gain = 1 } = options;
  const out = silence(seconds);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const frequency = from * (to / from) ** (t / seconds);
    phase += (2 * Math.PI * frequency) / SAMPLE_RATE;
    let wave: number;
    switch (shape) {
      case "sine":
        wave = Math.sin(phase);
        break;
      case "triangle":
        wave = (2 / Math.PI) * Math.asin(Math.sin(phase));
        break;
      case "saw":
        wave = 2 * ((phase / (2 * Math.PI)) % 1) - 1;
        break;
      case "square":
        wave = Math.sin(phase) >= 0 ? 1 : -1;
        break;
    }
    out[i] = wave * Math.min(1, t / attack) * Math.exp(-t / decay) * gain;
  }
  return out;
}

/** A struck bell: several inharmonic partials, the higher ones dying away faster. */
export function bell(frequency: number, seconds: number, decay: number, brightness = 1): Samples {
  const partials: readonly (readonly [ratio: number, level: number])[] = [
    [1, 1],
    [2, 0.5],
    [2.756, 0.38],
    [5.404, 0.2],
    [8.933, 0.09],
  ];
  const out = silence(seconds);
  partials.forEach(([ratio, level], index) => {
    if (frequency * ratio > SAMPLE_RATE * 0.45) return;
    const partial = tone({
      seconds,
      from: frequency * ratio,
      attack: 0.0015,
      decay: decay / (1 + 0.9 * index),
      gain: level * (index === 0 ? 1 : brightness),
    });
    mixInto(out, partial);
  });
  return normalize(out, 1);
}

export interface NoiseOptions {
  readonly seconds: number;
  readonly seed: string;
  readonly decay: number;
  readonly attack?: number;
  readonly highpass?: number;
  readonly lowpass?: number;
  readonly gain?: number;
}

/** A burst of filtered noise that fades away exponentially. */
export function noiseBurst(options: NoiseOptions): Samples {
  const { seconds, seed, decay, attack = 0.0005, highpass, lowpass, gain = 1 } = options;
  const noise = noiseSource(seed);
  const high = highpass === undefined ? null : Biquad.highpass(highpass);
  const low = lowpass === undefined ? null : Biquad.lowpass(lowpass);
  const out = silence(seconds);
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    let x = noise();
    if (high !== null) x = high.process(x);
    if (low !== null) x = low.process(x);
    out[i] = x * Math.min(1, t / attack) * Math.exp(-t / decay) * gain;
  }
  return out;
}

export interface SweepOptions {
  readonly seconds: number;
  readonly seed: string;
  readonly fromHz: number;
  readonly toHz: number;
  readonly q: number;
  /** The loudness over time, as a function of progress from 0 to 1. */
  readonly envelope: (progress: number) => number;
  readonly gain?: number;
}

/** Noise through a band-pass filter whose centre sweeps from one frequency to another. */
export function noiseSweep(options: SweepOptions): Samples {
  const { seconds, seed, fromHz, toHz, q, envelope, gain = 1 } = options;
  const noise = noiseSource(seed);
  const filter = Biquad.bandpass(fromHz, q);
  const out = silence(seconds);
  const UPDATE_EVERY = 32;
  for (let i = 0; i < out.length; i++) {
    const progress = i / out.length;
    if (i % UPDATE_EVERY === 0) filter.bandpass(fromHz * (toHz / fromHz) ** progress, q);
    out[i] = filter.process(noise()) * envelope(progress) * gain;
  }
  return out;
}

/** Adds `source` into `target`, starting `atSeconds` in. Anything past the end of `target` is dropped. */
export function mixInto(target: Samples, source: Samples, atSeconds = 0, gain = 1): void {
  const offset = Math.round(atSeconds * SAMPLE_RATE);
  for (let i = 0; i < source.length && offset + i < target.length; i++) target[offset + i]! += source[i]! * gain;
}

export function peakOf(samples: Samples): number {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

export function rmsOf(samples: Samples): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

/** Scales the samples so the loudest one is exactly `peak`. */
export function normalize(samples: Samples, peak: number): Samples {
  const current = peakOf(samples);
  if (current === 0) return samples;
  const scale = peak / current;
  for (let i = 0; i < samples.length; i++) samples[i]! *= scale;
  return samples;
}

/** A raised-cosine fade at the start and end, so a sound never begins or ends on a click. */
export function fadeEdges(samples: Samples, fadeInSeconds: number, fadeOutSeconds: number): Samples {
  const fadeIn = Math.min(frames(fadeInSeconds), samples.length);
  const fadeOut = Math.min(frames(fadeOutSeconds), samples.length);
  for (let i = 0; i < fadeIn; i++) samples[i]! *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeIn);
  for (let i = 0; i < fadeOut; i++) samples[samples.length - 1 - i]! *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeOut);
  return samples;
}

/** Rounds off peaks with tanh instead of letting them clip hard. */
export function softClip(samples: Samples, drive = 1): Samples {
  const norm = Math.tanh(drive);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.tanh(samples[i]! * drive) / norm;
  return samples;
}

/**
 * Throws unless a tone of `frequency` makes a whole number of cycles in `length` samples. A tone added
 * to a loop has to, or its end does not line up with its start and the loop clicks at the seam. This
 * is checked when a sound is built, so a recipe that breaks the rule fails at once instead of being heard.
 */
export function assertFitsLoop(frequency: number, length: number): void {
  const cycles = (frequency * length) / SAMPLE_RATE;
  if (Math.abs(cycles - Math.round(cycles)) > 1e-6) {
    throw new RangeError(`${frequency} Hz makes ${cycles} cycles in this loop, not a whole number; it would click at the seam`);
  }
}

/**
 * Turns a buffer that is `crossfade` seconds longer than the loop into one that repeats without a
 * seam: the extra tail is faded into the start, so the last sample flows straight into the first.
 */
export function makeLoop(samples: Samples, crossfadeSeconds: number): Samples {
  const overlap = frames(crossfadeSeconds);
  const length = samples.length - overlap;
  if (length <= overlap) throw new RangeError("loop is too short for its crossfade");
  const out = samples.slice(0, length);
  for (let i = 0; i < overlap; i++) {
    const fadeIn = Math.sin((Math.PI / 2) * (i / overlap));
    const fadeOut = Math.cos((Math.PI / 2) * (i / overlap));
    out[i] = samples[i]! * fadeIn + samples[length + i]! * fadeOut;
  }
  return out;
}
