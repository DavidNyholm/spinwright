/** Every sound the game can make. Each has a recipe in sounds.ts. */
export const SFX_NAMES = [
  // The page
  "tick",
  "betUp",
  "betDown",
  "coin",
  // Reels
  "spinStart",
  "reelLoop",
  "reelStop",
  // Wins, from a nudge to a fanfare
  "winTiny",
  "winSmall",
  "winBig",
  "winHuge",
  "scatter",
  // Cascades
  "whoosh",
  "gemLand",
  "gemBurst",
  "heatUp",
  "ember",
  "featureStart",
  "retrigger",
  "furnaceLoop",
  // The Forge
  "anvil",
  "autoStrike",
  "upgrade",
  "denied",
  "ingotAppear",
  "frenzy",
  // Clockwork's free spins
  "cogLock",
  "anticipation",
] as const;

export type SfxName = (typeof SFX_NAMES)[number];

export interface PlayOptions {
  /** Loudness multiplier, 1 by default. */
  readonly gain?: number;
  /** Playback speed, which also changes pitch: 2 is an octave up. */
  readonly rate?: number;
  /** Stereo position from -1 (left) to 1 (right). */
  readonly pan?: number;
}

export interface LoopHandle {
  stop(fadeSeconds?: number): void;
}

/** What the views and machines call to make noise. They never touch the audio hardware themselves. */
export interface Sfx {
  play(name: SfxName, options?: PlayOptions): void;
  /** Starts a sound that repeats until stopped. */
  loop(name: SfxName, options?: PlayOptions): LoopHandle;
}

/** Makes no sound. Used where audio is unavailable and in tests. */
export const silent: Sfx = {
  play() {},
  loop: () => ({ stop() {} }),
};

/** Remembers what it was asked to play, in order, so a test can check the sequence. */
export class RecordingSfx implements Sfx {
  readonly calls: { name: SfxName; options: PlayOptions | undefined }[] = [];

  play(name: SfxName, options?: PlayOptions): void {
    this.calls.push({ name, options });
  }

  loop(name: SfxName, options?: PlayOptions): LoopHandle {
    this.calls.push({ name, options });
    return { stop() {} };
  }

  get names(): SfxName[] {
    return this.calls.map((call) => call.name);
  }
}

/** The win sound that fits a win of `win` credits on a bet of `totalBet`, or null for no win. */
export function winSound(win: number, totalBet: number): SfxName | null {
  if (win <= 0) return null;
  const multiple = win / totalBet;
  if (multiple < 1) return "winTiny";
  if (multiple < 5) return "winSmall";
  if (multiple < 25) return "winBig";
  return "winHuge";
}

/** Playback rate for a pitch `semitones` above the recorded one. */
export const semitoneRate = (semitones: number): number => 2 ** (semitones / 12);

const PENTATONIC = [0, 2, 4, 7, 9] as const;
// An octave and a half: higher than this the sounds' top partials would be pushed past what a speaker can play.
const HEAT_TOP_SEMITONES = 19;

/**
 * How many semitones above its base the heat sound plays at a given heat: a major pentatonic climb
 * (so every step sounds consonant), an octave and a half in all, then it holds at the top.
 */
export function heatSemitones(heat: number): number {
  const index = Math.max(0, Math.floor(heat) - 1);
  const semitones = PENTATONIC[index % PENTATONIC.length]! + 12 * Math.floor(index / PENTATONIC.length);
  return Math.min(HEAT_TOP_SEMITONES, semitones);
}

const STRIKE_SEMITONES = [0, 2, 4, 7] as const;

/** How many semitones higher the anvil rings at a heat tier: hotter strikes sound brighter. */
export function strikeSemitones(tier: number): number {
  return STRIKE_SEMITONES[Math.min(Math.max(0, Math.floor(tier)), STRIKE_SEMITONES.length - 1)]!;
}

/** Stereo position for item `index` of `count` laid out left to right, kept short of the extremes. */
export function panFor(index: number, count: number, width = 0.6): number {
  if (count <= 1) return 0;
  return (index / (count - 1) - 0.5) * 2 * width;
}
