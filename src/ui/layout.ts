/** Geometry of the reel stage, in stage units (the canvas scales to fit the page). */
export const LAYOUT = {
  cellWidth: 160,
  cellHeight: 140,
  reelGap: 8,
  paddingX: 34,
  paddingY: 30,
} as const;

export function stageSize(reels: number, rows: number): { width: number; height: number } {
  return {
    width: LAYOUT.paddingX * 2 + reels * LAYOUT.cellWidth + (reels - 1) * LAYOUT.reelGap,
    height: LAYOUT.paddingY * 2 + rows * LAYOUT.cellHeight,
  };
}

export const reelX = (reel: number): number => LAYOUT.paddingX + reel * (LAYOUT.cellWidth + LAYOUT.reelGap);
export const rowY = (row: number): number => LAYOUT.paddingY + row * LAYOUT.cellHeight;
export const cellCenterX = (reel: number): number => reelX(reel) + LAYOUT.cellWidth / 2;
export const cellCenterY = (row: number): number => rowY(row) + LAYOUT.cellHeight / 2;
