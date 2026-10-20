import "@fontsource/big-shoulders-display/latin-800";
import { Application, Sprite } from "pixi.js";
import { classic } from "./games/classic.ts";
import { LAYOUT } from "./ui/layout.ts";
import { CLOCKWORK, createSymbolTextures } from "./ui/theme.ts";

/** Development page: draws every symbol of the Clockwork theme in a grid, for reviewing the artwork. */
const COLUMNS = 4;
const GAP = 16;

async function main(): Promise<void> {
  await document.fonts.load('800 48px "Big Shoulders Display"');
  const symbols = [...new Set(classic.strips.flat())];
  const { cellWidth, cellHeight } = LAYOUT;
  const rows = Math.ceil(symbols.length / COLUMNS);

  const app = new Application();
  await app.init({
    width: COLUMNS * (cellWidth + GAP) + GAP,
    height: rows * (cellHeight + GAP) + GAP,
    backgroundColor: 0x0b0a09,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 3),
    autoDensity: true,
  });
  document.getElementById("sheet")!.append(app.canvas);

  const textures = createSymbolTextures(app.renderer, CLOCKWORK, symbols, cellWidth, cellHeight);
  symbols.forEach((symbol, index) => {
    const sprite = new Sprite(textures.get(symbol));
    sprite.position.set(GAP + (index % COLUMNS) * (cellWidth + GAP), GAP + Math.floor(index / COLUMNS) * (cellHeight + GAP));
    app.stage.addChild(sprite);
  });
}

main().catch((error: unknown) => {
  console.error(error);
});
