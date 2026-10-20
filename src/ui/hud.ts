const numberFormat = new Intl.NumberFormat("en-US");
export const formatCredits = (credits: number): string => numberFormat.format(credits);

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing #${id} in index.html`);
  return element as T;
}

/** A number shown on the page that can count up to a new value. */
class Counter {
  readonly #element: HTMLElement;
  #shown = 0;
  #target = 0;
  #frame = 0;

  constructor(element: HTMLElement) {
    this.#element = element;
    this.set(0);
  }

  /** The value this counter is showing or heading towards. */
  get target(): number {
    return this.#target;
  }

  set(value: number): void {
    cancelAnimationFrame(this.#frame);
    this.#shown = this.#target = value;
    this.#render();
  }

  animateTo(target: number, durationMs: number): void {
    cancelAnimationFrame(this.#frame);
    const from = this.#shown;
    this.#target = target;
    if (durationMs <= 0 || from === target) {
      this.set(target);
      return;
    }
    const started = performance.now();
    const step = (now: number): void => {
      const progress = Math.min(1, (now - started) / durationMs);
      this.#shown = Math.round(from + (target - from) * (1 - (1 - progress) ** 3));
      this.#render();
      if (progress < 1) this.#frame = requestAnimationFrame(step);
    };
    this.#frame = requestAnimationFrame(step);
  }

  /** Jumps to the final value if an animation is running. */
  finish(): void {
    this.set(this.#target);
  }

  #render(): void {
    this.#element.textContent = formatCredits(this.#shown);
  }
}

export interface HudHandlers {
  onSpin(): void;
  onBetStep(direction: -1 | 1): void;
  onTurbo(on: boolean): void;
  onRefill(): void;
}

/** The controls and readouts around the reels. Holds no game logic. */
export class Hud {
  readonly #balance = new Counter(byId("balance"));
  readonly #win = new Counter(byId("win"));
  readonly #totalBet = byId("total-bet");
  readonly #betDetail = byId("bet-detail");
  readonly #message = byId("message");
  readonly #spin = byId<HTMLButtonElement>("spin");
  readonly #betDown = byId<HTMLButtonElement>("bet-down");
  readonly #betUp = byId<HTMLButtonElement>("bet-up");
  readonly #turbo = byId<HTMLInputElement>("turbo");
  readonly #broke = byId("broke");
  readonly #state = { ready: false, spinning: false, broke: false, canDecrease: false, canIncrease: false };

  constructor(handlers: HudHandlers) {
    this.#spin.addEventListener("click", () => handlers.onSpin());
    this.#betDown.addEventListener("click", () => handlers.onBetStep(-1));
    this.#betUp.addEventListener("click", () => handlers.onBetStep(1));
    this.#turbo.addEventListener("change", () => handlers.onTurbo(this.#turbo.checked));
    byId("refill").addEventListener("click", () => handlers.onRefill());

    // Space or Enter spins, unless a control has focus (it would also fire that control's own click).
    document.addEventListener("keydown", (event) => {
      if (event.repeat || (event.code !== "Space" && event.code !== "Enter")) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("button, input, select, textarea, a")) return;
      event.preventDefault();
      handlers.onSpin();
    });
  }

  get balance(): number {
    return this.#balance.target;
  }

  setBalance(value: number, animateMs = 0): void {
    this.#balance.animateTo(value, animateMs);
  }

  setWin(value: number, animateMs = 0): void {
    this.#win.animateTo(value, animateMs);
  }

  /** Snaps any running count-up to its final value. */
  finishCounters(): void {
    this.#balance.finish();
    this.#win.finish();
  }

  /** `detail` is the small line under the bet, such as how it splits over the paylines. */
  setBet(totalBet: number, detail: string, canDecrease: boolean, canIncrease: boolean): void {
    this.#totalBet.textContent = formatCredits(totalBet);
    this.#betDetail.textContent = detail;
    this.#state.canDecrease = canDecrease;
    this.#state.canIncrease = canIncrease;
    this.#apply();
  }

  /** Enables the controls once the game has finished loading. */
  setReady(): void {
    this.#state.ready = true;
    this.#apply();
  }

  /** While the reels are moving the bet is locked and the spin button becomes a stop button. */
  setSpinning(spinning: boolean): void {
    this.#state.spinning = spinning;
    this.#apply();
  }

  /** Out of credits: hides nothing, but offers a refill and blocks spinning. */
  setBroke(broke: boolean): void {
    this.#state.broke = broke;
    this.#apply();
  }

  setTurbo(on: boolean): void {
    this.#turbo.checked = on;
  }

  setMessage(text: string): void {
    this.#message.textContent = text;
  }

  /** Derives every control's enabled state from one place, so they cannot drift apart. */
  #apply(): void {
    const { ready, spinning, broke, canDecrease, canIncrease } = this.#state;
    this.#spin.textContent = spinning ? "STOP" : "SPIN";
    this.#spin.dataset.spinning = String(spinning);
    this.#spin.disabled = !ready || broke;
    this.#betDown.disabled = spinning || !canDecrease;
    this.#betUp.disabled = spinning || !canIncrease;
    this.#turbo.disabled = spinning;
    this.#broke.hidden = !broke;
  }
}
