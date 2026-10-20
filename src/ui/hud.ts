import { byId } from "./dom.ts";

const numberFormat = new Intl.NumberFormat("en-US");
export const formatCredits = (credits: number): string => numberFormat.format(credits);

/** While a counter rolls up it calls its tick callback at most this often, which is the pace of the coin sound. */
const TICK_INTERVAL_MS = 55;

/** A number shown on the page that can count up to a new value. */
class Counter {
  readonly #element: HTMLElement;
  readonly #onTick: (() => void) | undefined;
  #shown = 0;
  #target = 0;
  #frame = 0;

  constructor(element: HTMLElement, onTick?: () => void) {
    this.#element = element;
    this.#onTick = onTick;
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
    let lastTick = -Infinity;
    const step = (now: number): void => {
      const progress = Math.min(1, (now - started) / durationMs);
      const before = this.#shown;
      this.#shown = Math.round(from + (target - from) * (1 - (1 - progress) ** 3));
      this.#render();
      if (this.#shown !== before && now - lastTick >= TICK_INTERVAL_MS) {
        lastTick = now;
        this.#onTick?.();
      }
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
  /** Called as the win counter rolls up, at the pace of a coin sound. */
  onWinTick?(): void;
  /** Whether the machine page is the one on screen; Space and Enter only spin then. */
  isActive(): boolean;
  /** The player pressed the buy button; the page decides whether to go on. */
  onBonusRequest(): void;
}

/** The controls and readouts around the reels. Holds no game logic. */
export class Hud {
  readonly #balance: Counter;
  readonly #win: Counter;
  readonly #totalBet = byId("total-bet");
  readonly #betDetail = byId("bet-detail");
  readonly #message = byId("message");
  readonly #spin = byId<HTMLButtonElement>("spin");
  readonly #betDown = byId<HTMLButtonElement>("bet-down");
  readonly #betUp = byId<HTMLButtonElement>("bet-up");
  readonly #turbo = byId<HTMLInputElement>("turbo");
  readonly #broke = byId("broke");
  readonly #bonusBar = byId("bonus-bar");
  readonly #bonusButton = byId<HTMLButtonElement>("bonus-buy");
  readonly #bonusPrice = byId("bonus-price");
  readonly #bonusName = byId("bonus-name");
  readonly #dialog = byId<HTMLDialogElement>("bonus-dialog");
  readonly #state = { ready: false, spinning: false, broke: false, canDecrease: false, canIncrease: false, bonus: false, bonusAffordable: false };

  constructor(handlers: HudHandlers) {
    this.#balance = new Counter(byId("balance"));
    this.#win = new Counter(byId("win"), () => handlers.onWinTick?.());
    this.#spin.addEventListener("click", () => handlers.onSpin());
    this.#betDown.addEventListener("click", () => handlers.onBetStep(-1));
    this.#betUp.addEventListener("click", () => handlers.onBetStep(1));
    this.#turbo.addEventListener("change", () => handlers.onTurbo(this.#turbo.checked));
    this.#bonusButton.addEventListener("click", () => handlers.onBonusRequest());

    // Space or Enter spins, unless a control has focus (it would also fire that control's own click).
    document.addEventListener("keydown", (event) => {
      if (!handlers.isActive() || event.repeat || (event.code !== "Space" && event.code !== "Enter")) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("button, input, select, textarea, a")) return;
      event.preventDefault();
      handlers.onSpin();
    });
  }

  get balance(): number {
    return this.#balance.target;
  }

  /** The win being shown, or the one it is counting up to. */
  get win(): number {
    return this.#win.target;
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

  /** Enables the controls once a machine has loaded, and disables them while one is loading. */
  setReady(ready = true): void {
    this.#state.ready = ready;
    this.#apply();
  }

  /** While the reels are moving the bet is locked and the spin button becomes a stop button. */
  setSpinning(spinning: boolean): void {
    this.#state.spinning = spinning;
    this.#apply();
  }

  /** Out of credits: blocks spinning and points the player to the Forge. */
  setBroke(broke: boolean): void {
    this.#state.broke = broke;
    this.#apply();
  }

  /**
   * Shows the buy bar for a machine whose bonus costs `price`, or hides it for one with nothing to buy.
   * `affordable` is whether the balance covers it.
   */
  setBonus(price: number | null, name: string | null, affordable: boolean): void {
    this.#state.bonus = price !== null;
    this.#state.bonusAffordable = affordable;
    if (price !== null && name !== null) {
      this.#bonusName.textContent = name;
      this.#bonusPrice.textContent = `· ${formatCredits(price)}`;
    }
    this.#apply();
  }

  /** Asks the player to confirm buying the bonus. Resolves true only if they chose to buy. */
  confirmBonus(name: string, price: number): Promise<boolean> {
    byId("bonus-dialog-title").textContent = `Buy the ${name}?`;
    byId("bonus-dialog-body").textContent = `This costs ${formatCredits(price)} credits and starts the ${name} at once.`;
    byId("bonus-confirm").textContent = `Buy for ${formatCredits(price)}`;
    this.#dialog.returnValue = "";
    return new Promise((resolve) => {
      this.#dialog.addEventListener("close", () => resolve(this.#dialog.returnValue === "buy"), { once: true });
      this.#dialog.showModal();
    });
  }

  setTurbo(on: boolean): void {
    this.#turbo.checked = on;
  }

  setMessage(text: string): void {
    this.#message.textContent = text;
  }

  /** Derives every control's enabled state from one place, so they cannot drift apart. */
  #apply(): void {
    const { ready, spinning, broke, canDecrease, canIncrease, bonus, bonusAffordable } = this.#state;
    this.#spin.textContent = spinning ? "STOP" : "SPIN";
    this.#spin.dataset.spinning = String(spinning);
    this.#spin.disabled = !ready || broke;
    this.#betDown.disabled = spinning || !canDecrease;
    this.#betUp.disabled = spinning || !canIncrease;
    this.#turbo.disabled = spinning;
    this.#broke.hidden = !broke;
    this.#bonusBar.hidden = !bonus;
    this.#bonusButton.disabled = !ready || spinning || !bonusAffordable;
  }
}
