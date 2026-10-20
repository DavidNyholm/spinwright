import { SAMPLE_RATE } from "./dsp.ts";
import type { Samples } from "./dsp.ts";
import type { LoopHandle, PlayOptions, Sfx, SfxName } from "./sfx.ts";
import { renderAll } from "./sounds.ts";

/** At most this many sounds play at once; a new one past the limit is dropped rather than piling up. */
const MAX_VOICES = 28;
/** The same sound is not started twice within this many seconds, which would only sound like a louder one. */
const RETRIGGER_GUARD_SECONDS = 0.012;
/** Overall level before the volume setting, leaving room for sounds to overlap. */
const MASTER_TRIM = 0.7;
const FADE_IN_SECONDS = 0.03;

const noLoop: LoopHandle = { stop() {} };

export interface SoundSettings {
  /** 0 to 1. The perceived loudness follows the square of this. */
  readonly volume: number;
  readonly muted: boolean;
}

/**
 * Plays the synthesized sounds through Web Audio. Browsers only let a page make sound after the
 * visitor has interacted with it, so nothing is audible until unlock() has been called from a click
 * or key press; sounds requested before then are simply not heard.
 */
export class SoundPlayer implements Sfx {
  /** How many times each sound was asked for, whether or not it could be heard. For QA scripts. */
  readonly requests: Partial<Record<SfxName, number>> = {};

  #context: AudioContext | null = null;
  #master: GainNode | null = null;
  #samples: Map<SfxName, Samples> | null = null;
  readonly #buffers = new Map<SfxName, AudioBuffer>();
  readonly #lastStart = new Map<SfxName, number>();
  #volume: number;
  #muted: boolean;
  #suspended = false;
  #voices = 0;

  constructor(settings: SoundSettings) {
    this.#volume = settings.volume;
    this.#muted = settings.muted;
    // Build the sounds while the page is idle, so the first click does not wait for them.
    setTimeout(() => this.#render(), 0);
  }

  /** "running" once sound can be heard; "unavailable" if this browser has no Web Audio. */
  get state(): AudioContextState | "unavailable" | "locked" {
    if (typeof AudioContext === "undefined") return "unavailable";
    return this.#context?.state ?? "locked";
  }

  /** Call from a user gesture (click or key press) to allow sound. Safe to call repeatedly. */
  unlock(): void {
    if (typeof AudioContext === "undefined") return;
    if (this.#context === null) this.#create();
    if (this.#context!.state === "suspended") void this.#context!.resume();
  }

  setVolume(volume: number): void {
    this.#volume = Math.min(1, Math.max(0, volume));
    this.#applyLevel();
  }

  setMuted(muted: boolean): void {
    this.#muted = muted;
    this.#applyLevel();
  }

  /** Silences everything for a while without muting it, for QA scripts that run the animation faster than real time. */
  setSuspended(suspended: boolean): void {
    this.#suspended = suspended;
  }

  play(name: SfxName, options: PlayOptions = {}): void {
    this.requests[name] = (this.requests[name] ?? 0) + 1;
    const source = this.#start(name, options, false);
    if (source !== null) {
      this.#voices++;
      source.node.onended = () => {
        this.#voices--;
        source.node.disconnect();
        source.gain.disconnect();
        source.pan?.disconnect();
      };
    }
  }

  loop(name: SfxName, options: PlayOptions = {}): LoopHandle {
    this.requests[name] = (this.requests[name] ?? 0) + 1;
    const voice = this.#start(name, options, true);
    if (voice === null) return noLoop;
    const context = this.#context!;
    this.#voices++;
    voice.gain.gain.setValueAtTime(0, context.currentTime);
    voice.gain.gain.linearRampToValueAtTime(options.gain ?? 1, context.currentTime + FADE_IN_SECONDS);
    let stopped = false;
    return {
      stop: (fadeSeconds = 0.1) => {
        if (stopped) return;
        stopped = true;
        const now = context.currentTime;
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
        voice.gain.gain.linearRampToValueAtTime(0, now + fadeSeconds);
        voice.node.stop(now + fadeSeconds + 0.02);
        voice.node.onended = () => {
          this.#voices--;
          voice.node.disconnect();
          voice.gain.disconnect();
          voice.pan?.disconnect();
        };
      },
    };
  }

  // --- internals ----------------------------------------------------------------------------

  #render(): Map<SfxName, Samples> {
    this.#samples ??= renderAll();
    return this.#samples;
  }

  #create(): void {
    const context = new AudioContext({ latencyHint: "interactive" });
    const master = context.createGain();
    // A limiter before the speakers: many sounds at once can add up past full scale, and this
    // squeezes them down smoothly instead of letting them clip.
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 10;
    limiter.ratio.value = 10;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    master.connect(limiter);
    limiter.connect(context.destination);
    this.#context = context;
    this.#master = master;
    this.#applyLevel();

    for (const [name, samples] of this.#render()) {
      const buffer = context.createBuffer(1, samples.length, SAMPLE_RATE);
      buffer.copyToChannel(samples, 0);
      this.#buffers.set(name, buffer);
    }
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) void context.suspend();
      else if (!this.#muted) void context.resume();
    });
  }

  #applyLevel(): void {
    if (this.#master === null || this.#context === null) return;
    const level = this.#muted ? 0 : MASTER_TRIM * this.#volume ** 2;
    this.#master.gain.setTargetAtTime(level, this.#context.currentTime, 0.01);
  }

  /** Sets up a source for `name` and starts it, or returns null if it cannot or should not be heard. */
  #start(
    name: SfxName,
    options: PlayOptions,
    loop: boolean,
  ): { node: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode | null } | null {
    const context = this.#context;
    const buffer = this.#buffers.get(name);
    if (context === null || this.#master === null || buffer === undefined) return null;
    if (this.#muted || this.#suspended || context.state !== "running") return null;
    if (this.#voices >= MAX_VOICES) return null;
    if (!loop) {
      const last = this.#lastStart.get(name) ?? -Infinity;
      if (context.currentTime - last < RETRIGGER_GUARD_SECONDS) return null;
      this.#lastStart.set(name, context.currentTime);
    }

    const node = context.createBufferSource();
    node.buffer = buffer;
    node.loop = loop;
    node.playbackRate.value = options.rate ?? 1;
    const gain = context.createGain();
    gain.gain.value = options.gain ?? 1;
    node.connect(gain);
    let pan: StereoPannerNode | null = null;
    if (options.pan !== undefined && options.pan !== 0) {
      pan = context.createStereoPanner();
      pan.pan.value = Math.min(1, Math.max(-1, options.pan));
      gain.connect(pan);
      pan.connect(this.#master);
    } else {
      gain.connect(this.#master);
    }
    node.start();
    return { node, gain, pan };
  }
}
