import "@fontsource/big-shoulders-display/latin-800";
import { Application, Sprite } from "pixi.js";
import { classic } from "./games/classic.ts";
import { crucible } from "./games/crucible.ts";
import { mint } from "./games/mint.ts";
import { LAYOUT } from "./ui/layout.ts";
import { CLOCKWORK, createSymbolTextures, FOUNDRY, MINT } from "./ui/theme.ts";

/** Development page: draws every symbol of the three themes in a grid, for reviewing the artwork. */
const COLUMNS = 6;
const GAP = 16;
const CRUCIBLE_CELL = 108;

async function main(): Promise<void> {
  await document.fonts.load('800 48px "Big Shoulders Display"');
  const clockwork = [...new Set(classic.strips.flat())];
  const foundry = [...new Set(crucible.weights.flatMap((column) => Object.keys(column)))];
  const minted = [...new Set(mint.base.strips.flat())];
  const { cellWidth, cellHeight } = LAYOUT;
  const clockworkRows = Math.ceil(clockwork.length / COLUMNS);
  const mintTop = GAP + clockworkRows * (cellHeight + GAP) + GAP;
  const foundryTop = mintTop + Math.ceil(minted.length / COLUMNS) * (cellHeight + GAP) + GAP;

  const app = new Application();
  await app.init({
    width: COLUMNS * (cellWidth + GAP) + GAP,
    height: foundryTop + Math.ceil(foundry.length / COLUMNS) * (CRUCIBLE_CELL + GAP),
    backgroundColor: 0x0b0a09,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 3),
    autoDensity: true,
  });
  document.getElementById("sheet")!.append(app.canvas);

  const place = (textures: ReturnType<typeof createSymbolTextures>, symbols: string[], top: number, w: number, h: number) =>
    symbols.forEach((symbol, index) => {
      const sprite = new Sprite(textures.get(symbol));
      sprite.position.set(GAP + (index % COLUMNS) * (w + GAP), top + Math.floor(index / COLUMNS) * (h + GAP));
      app.stage.addChild(sprite);
    });
  place(createSymbolTextures(app.renderer, CLOCKWORK, clockwork, cellWidth, cellHeight), clockwork, GAP, cellWidth, cellHeight);
  place(createSymbolTextures(app.renderer, MINT, minted, cellWidth, cellHeight), minted, mintTop, cellWidth, cellHeight);
  place(createSymbolTextures(app.renderer, FOUNDRY, foundry, CRUCIBLE_CELL, CRUCIBLE_CELL), foundry, foundryTop, CRUCIBLE_CELL, CRUCIBLE_CELL);
}

main().catch((error: unknown) => {
  console.error(error);
});
