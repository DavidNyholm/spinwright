/**
 * Colours and fonts for the Pixi artwork. The page's CSS (src/style.css) defines the same brass,
 * amber and iron tones as custom properties; keep the two in step when changing either.
 */
export const PALETTE = {
  ink: 0x0b0a09,
  iron: 0x1b1713,
  ironLight: 0x2a241d,
  recess: 0x0a0806,
  brass: 0xc79a45,
  brassLight: 0xf0d28a,
  brassDark: 0x6e4f1c,
  amber: 0xffb347,
  amberHot: 0xffd27a,
  cyan: 0x4fd0e0,
  blueprint: 0x1b5f93,
  rust: 0xc4482d,
  text: 0xefe6d5,
} as const;

export const FONT_DISPLAY = '"Big Shoulders Display", "Arial Narrow", Impact, sans-serif';
export const FONT_MONO = '"IBM Plex Mono", ui-monospace, "Cascadia Mono", Consolas, monospace';
