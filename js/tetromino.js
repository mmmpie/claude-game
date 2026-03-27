import { TETROMINOES, TETROMINO_TYPES, COLOR_NAMES, COLS, ROWS } from './constants.js';
import { getCell, drawContent, setCell } from './grid.js';

// ---------------------------------------------------------------------------
// Create a new active piece at the center-top of the grid
// ---------------------------------------------------------------------------
export function createPiece(type, color) {
  return {
    type,
    color,
    rotationIndex: 0,
    row: 0,
    col: Math.floor(COLS / 2) - 2,
  };
}

// ---------------------------------------------------------------------------
// Get the set of absolute {row, col} cells for a piece
// ---------------------------------------------------------------------------
export function getPieceCells(piece) {
  const offsets = TETROMINOES[piece.type][piece.rotationIndex];
  return offsets.map(([dr, dc]) => ({ row: piece.row + dr, col: piece.col + dc }));
}

// ---------------------------------------------------------------------------
// Move piece by delta (returns new piece, does not mutate)
// ---------------------------------------------------------------------------
export function movePiece(piece, dRow, dCol) {
  return { ...piece, row: piece.row + dRow, col: piece.col + dCol };
}

// ---------------------------------------------------------------------------
// Rotate piece clockwise or counter-clockwise
// ---------------------------------------------------------------------------
export function rotatePiece(piece, direction) {
  // direction: 1 = CW (X key), -1 = CCW (Z key)
  const numRotations = TETROMINOES[piece.type].length;
  const newIdx = ((piece.rotationIndex + direction) % numRotations + numRotations) % numRotations;
  return { ...piece, rotationIndex: newIdx };
}

// ---------------------------------------------------------------------------
// Validate that a piece can be placed at its current position
// A placement is valid if all cells are in-bounds and unoccupied (not locked,
// not an entity cell that blocks placement: adventurer, monster, stairs)
// ---------------------------------------------------------------------------
export function isValidPlacement(piece, grid) {
  const cells = getPieceCells(piece);
  for (const { row, col } of cells) {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return false;
    const cell = getCell(grid, row, col);
    if (!cell) return false;
    if (cell.locked) return false;
    // Cannot place on top of adventurer, monsters, or stairs
    if (cell.entity === 'adventurer' || cell.entity === 'monster' || cell.entity === 'stairs') return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Lock piece onto the grid — write color, locked flag, and maybe content
// ---------------------------------------------------------------------------
export function lockPiece(piece, grid) {
  const cells = getPieceCells(piece);
  for (const { row, col } of cells) {
    const content = drawContent(grid);
    setCell(grid, row, col, {
      color: piece.color,
      locked: true,
      content: content || null,
      revealed: false,
    });
  }
}

// ---------------------------------------------------------------------------
// Random piece type (7-bag would be ideal but simple random is fine here)
// ---------------------------------------------------------------------------
export function randomType() {
  return TETROMINO_TYPES[Math.floor(Math.random() * TETROMINO_TYPES.length)];
}

export function randomColor() {
  return COLOR_NAMES[Math.floor(Math.random() * COLOR_NAMES.length)];
}

// ---------------------------------------------------------------------------
// Clamp piece position so it stays within grid bounds (used when wrapping
// the cursor around the edge or after rotation makes it go OOB)
// ---------------------------------------------------------------------------
export function clampPiece(piece) {
  const cells = getPieceCells(piece);
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (const { row, col } of cells) {
    if (row < minR) minR = row;
    if (row > maxR) maxR = row;
    if (col < minC) minC = col;
    if (col > maxC) maxC = col;
  }
  let dr = 0, dc = 0;
  if (minR < 0) dr = -minR;
  if (maxR >= ROWS) dr = ROWS - 1 - maxR;
  if (minC < 0) dc = -minC;
  if (maxC >= COLS) dc = COLS - 1 - maxC;
  return movePiece(piece, dr, dc);
}
