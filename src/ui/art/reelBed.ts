import { FillGradient, Graphics } from "pixi.js";
import { verticalGradient } from "./metal.ts";
import { PALETTE } from "./palette.ts";

export interface WindowRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What sits behind the reels: a dark panel with one recessed window per reel. */
export function drawReelBed(width: number, height: number, windows: readonly WindowRect[]): Graphics {
  const bed = new Graphics()
    .roundRect(0, 0, width, height, 14)
    .fill(verticalGradient([0, 0x15110d], [1, 0x0a0806]))
    .stroke({ width: 2, color: PALETTE.brassDark, alpha: 0.85 });
  for (const { x, y, width: w, height: h } of windows) {
    bed
      .roundRect(x - 6, y - 6, w + 12, h + 12, 9)
      .fill(0x060504)
      .stroke({ width: 2.5, color: PALETTE.brassDark })
      .roundRect(x - 3.5, y - 3.5, w + 7, h + 7, 7)
      .stroke({ width: 1, color: PALETTE.brassLight, alpha: 0.1 });
  }
  return bed;
}

const SHADE_DEPTH = 40;
const shadeTop = new FillGradient({
  type: "linear",
  start: { x: 0, y: 0 },
  end: { x: 0, y: 1 },
  colorStops: [
    { offset: 0, color: "rgba(0, 0, 0, 0.72)" },
    { offset: 1, color: "rgba(0, 0, 0, 0)" },
  ],
  textureSpace: "local",
});
const shadeBottom = new FillGradient({
  type: "linear",
  start: { x: 0, y: 0 },
  end: { x: 0, y: 1 },
  colorStops: [
    { offset: 0, color: "rgba(0, 0, 0, 0)" },
    { offset: 1, color: "rgba(0, 0, 0, 0.72)" },
  ],
  textureSpace: "local",
});

/** Darkens the top and bottom of every window so the symbols look like they curve away on a drum. */
export function drawReelShade(windows: readonly WindowRect[]): Graphics {
  const shade = new Graphics();
  for (const { x, y, width, height } of windows) {
    shade.rect(x, y, width, SHADE_DEPTH).fill(shadeTop);
    shade.rect(x, y + height - SHADE_DEPTH, width, SHADE_DEPTH).fill(shadeBottom);
  }
  return shade;
}
