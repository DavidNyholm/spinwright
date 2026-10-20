/**
 * Basic checks that a strike came from a hand and not from an auto-clicker. They are deliberately
 * simple and run in the visitor's own browser, so they stop the common tools (a console loop, a
 * userscript, a fixed-interval clicker) and not a determined person: see SECURITY.md for what they do
 * and do not promise. Pure and clock-free: every call says when it happened.
 *
 * The checks, in order:
 *  1. Untrusted events. The browser marks events made by a script (`dispatchEvent`, `element.click()`)
 *     as untrusted. Those are ignored.
 *  2. Pace. A hand cannot sustain more than about fourteen strikes a second; faster ones are ignored.
 *  3. Regularity. A person's gaps between fast strikes wander by several milliseconds; a machine's
 *     barely move. A run of fast strikes this evenly timed (or timed evenly and always on the very same
 *     pixel, which a real hand never manages) puts the anvil to rest. Each repeat doubles the rest.
 */

export const GUARD = {
  /** The most strikes a person can sustain in a second. */
  maxPerSecond: 14,
  /** How many strikes may come in one quick burst before the pace limit bites. */
  burst: 6,
  /** How many gaps between strikes are judged together. */
  window: 20,
  /** A run's gaps spread less than this (standard deviation, in milliseconds) and it is a machine. */
  minSpreadMs: 4,
  /** The same, when every strike landed on exactly the same pixel: a real hand drifts, so this is looser. */
  minSpreadStillMs: 10,
  /** Only fast runs are judged: slow, even clicking is just someone being calm. */
  judgedBelowMs: 400,
  /** How long the anvil rests the first time, and the longest it ever does. */
  cooldownMs: 8_000,
  maxCooldownMs: 120_000,
  /** Once a rest has ended, this long without another flag and the next one is treated as a first. */
  forgetFlagsAfterMs: 120_000,
} as const;

export interface StrikeInput {
  /** When it happened, on a steady clock (an event's timeStamp), in milliseconds. */
  readonly atMs: number;
  /** Whether the browser says it came from the person's own hardware. False for anything a script made. */
  readonly trusted: boolean;
  /** Where the pointer was, if the strike came from a pointer. */
  readonly x?: number | undefined;
  readonly y?: number | undefined;
}

export type GuardVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "untrusted" | "too-fast" | "cooling" }
  | { readonly ok: false; readonly reason: "too-regular"; readonly cooldownMs: number };

const OK: GuardVerdict = { ok: true };

export class ClickGuard {
  #tokens: number = GUARD.burst;
  #lastRefill: number | null = null;
  /** The accepted strikes of the current run, and where each landed (null if it had no pointer). */
  #times: number[] = [];
  #spots: (string | null)[] = [];
  #coolUntil = -Infinity;
  #flags = 0;

  /** Decides whether to count a strike. A strike that is not counted earns nothing. */
  check(input: StrikeInput): GuardVerdict {
    if (!input.trusted) return { ok: false, reason: "untrusted" };
    const { atMs } = input;
    if (atMs < this.#coolUntil) return { ok: false, reason: "cooling" };

    this.#refill(atMs);
    if (this.#tokens < 1) return { ok: false, reason: "too-fast" };
    this.#tokens -= 1;

    // No rule is needed for a pause, or for a clock that jumps: an odd gap inside the window spreads the timing too
    // widely to look like a machine, and leaves the window after 20 more strikes.
    this.#times.push(atMs);
    this.#spots.push(input.x === undefined || input.y === undefined ? null : `${Math.round(input.x)},${Math.round(input.y)}`);
    if (this.#times.length > GUARD.window + 1) {
      this.#times.shift();
      this.#spots.shift();
    }
    if (this.#times.length === GUARD.window + 1 && this.#looksAutomatic()) return this.#rest(atMs);
    return OK;
  }

  /** How much longer the anvil rests, in milliseconds; 0 when it is not resting. */
  restingMs(atMs: number): number {
    return Math.max(0, this.#coolUntil - atMs);
  }

  #refill(atMs: number): void {
    if (this.#lastRefill !== null && atMs > this.#lastRefill) {
      this.#tokens = Math.min(GUARD.burst, this.#tokens + ((atMs - this.#lastRefill) / 1000) * GUARD.maxPerSecond);
    }
    this.#lastRefill = atMs;
  }

  #looksAutomatic(): boolean {
    const gaps = this.#times.slice(1).map((time, i) => time - this.#times[i]!);
    const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    if (mean >= GUARD.judgedBelowMs) return false;
    const spread = Math.sqrt(gaps.reduce((sum, gap) => sum + (gap - mean) ** 2, 0) / gaps.length);
    const first = this.#spots[0];
    const stayedStill = first !== null && this.#spots.every((spot) => spot === first);
    return spread < (stayedStill ? GUARD.minSpreadStillMs : GUARD.minSpreadMs);
  }

  #rest(atMs: number): GuardVerdict {
    // Counted from the end of the last rest, so a machine that starts again the moment it may is never forgiven.
    if (atMs - this.#coolUntil > GUARD.forgetFlagsAfterMs) this.#flags = 0;
    this.#flags++;
    const cooldownMs = Math.min(GUARD.maxCooldownMs, GUARD.cooldownMs * 2 ** (this.#flags - 1));
    this.#coolUntil = atMs + cooldownMs;
    this.#clearRun();
    return { ok: false, reason: "too-regular", cooldownMs };
  }

  #clearRun(): void {
    this.#times = [];
    this.#spots = [];
  }
}
