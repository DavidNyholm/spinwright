import { Container, Graphics, Text } from "pixi.js";
import { Animator, easeOutCubic } from "./animator.ts";
import { FONT_DISPLAY, PALETTE } from "./art/palette.ts";

const FADE_MS = 240;

export interface BannerOptions {
  /** The size of the whole stage: the banner sits in the middle of it. */
  readonly width: number;
  readonly height: number;
  readonly reduceMotion: boolean;
}

/**
 * The panel that announces a feature, a retrigger or a result: a title and a line under it, shown over
 * the middle of the stage, held for a while and faded out. It runs on the animator it is given, so it
 * speeds up with turbo and stop like everything else.
 */
export class Banner {
  readonly container = new Container();

  readonly #animator: Animator;
  readonly #reduceMotion: boolean;
  readonly #title: Text;
  readonly #subtitle: Text;

  constructor(animator: Animator, options: BannerOptions) {
    this.#animator = animator;
    this.#reduceMotion = options.reduceMotion;
    const { width, height } = options;
    const panel = new Graphics()
      .roundRect(-width * 0.34, -78, width * 0.68, 156, 18)
      .fill({ color: 0x0a0806, alpha: 0.92 })
      .stroke({ width: 3, color: PALETTE.brass });
    const text = (size: number, fill: number, spacing: number): Text => {
      const label = new Text({
        text: "",
        style: { fontFamily: FONT_DISPLAY, fontSize: size, fontWeight: "800", fill, letterSpacing: spacing, stroke: { color: 0x1a0c07, width: 6, join: "round" } },
      });
      label.anchor.set(0.5);
      return label;
    };
    this.#title = text(68, PALETTE.amberHot, 8);
    this.#title.position.set(0, -20);
    this.#subtitle = text(28, PALETTE.text, 4);
    this.#subtitle.position.set(0, 42);
    this.container.addChild(panel, this.#title, this.#subtitle);
    this.container.position.set(width / 2, height / 2);
    this.container.visible = false;
  }

  /** Shows the banner, holds it for `holdMs`, and fades it out. */
  async show(title: string, subtitle: string | null, holdMs: number): Promise<void> {
    this.#title.text = title;
    this.#subtitle.text = subtitle ?? "";
    this.#subtitle.visible = subtitle !== null;
    this.container.visible = true;
    const pop = this.#reduceMotion ? 1 : 0.85;
    await this.#animator.tween(
      FADE_MS,
      (progress) => {
        this.container.alpha = progress;
        this.container.scale.set(pop + (1 - pop) * progress);
      },
      easeOutCubic,
    );
    await this.#animator.wait(holdMs);
    await this.#animator.tween(FADE_MS, (progress) => (this.container.alpha = 1 - progress));
    this.container.visible = false;
  }

  /** Hides the banner at once. */
  hide(): void {
    this.container.visible = false;
  }
}
