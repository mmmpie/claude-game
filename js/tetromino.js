import { TETROMINOES, TETROMINO_TYPES, COLOR_NAMES, COLS, ROWS } from './constants.js?v=44';
import { getCell, setCell } from './grid.js?v=44';

// ---------------------------------------------------------------------------
// Create a new active piece, spawning at the center of the grid.
// cellContents: array of 4 ContentDescriptor|null values, one per piece cell.
// ---------------------------------------------------------------------------
export function createPiece(type, color, cellContents) {
  return {
    type,
    color,
    rotationIndex: 0,
    row: Math.floor((ROWS - 4) / 2),   // vertically centered
    col: Math.floor((COLS - 4) / 2),   // horizontally centered
    cellContents: cellContents || [null, null, null, null],
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
  const numRotations = TETROMINOES[piece.type].length;
  const newIdx = ((piece.rotationIndex + direction) % numRotations + numRotations) % numRotations;
  return { ...piece, rotationIndex: newIdx };
}

// ---------------------------------------------------------------------------
// Validate that a piece can be placed at its current position.
// Blocked by: out-of-bounds, locked cells, adventurer, monsters, stairs, treasure, rocks.
// ---------------------------------------------------------------------------
export function isValidPlacement(piece, grid) {
  const cells = getPieceCells(piece);
  for (const { row, col } of cells) {
    if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) return false;
    const cell = getCell(grid, row, col);
    if (!cell) return false;
    if (cell.locked) return false;
    if (cell.entity === 'adventurer' || cell.entity === 'monster' ||
        cell.entity === 'stairs'     || cell.entity === 'treasure' ||
        cell.entity === 'rock') return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Lock piece onto the grid.
// Content is written immediately and visible (no hidden state).
// ---------------------------------------------------------------------------
export function lockPiece(piece, grid) {
  const cells = getPieceCells(piece);
  for (let i = 0; i < cells.length; i++) {
    const { row, col } = cells[i];
    setCell(grid, row, col, {
      color: piece.color,
      locked: true,
      content: piece.cellContents[i] || null,
    });
  }
}

// ---------------------------------------------------------------------------
// Random generators
// ---------------------------------------------------------------------------
export function randomType() {
  return TETROMINO_TYPES[Math.floor(Math.random() * TETROMINO_TYPES.length)];
}

export function randomColor() {
  return COLOR_NAMES[Math.floor(Math.random() * COLOR_NAMES.length)];
}

// ---------------------------------------------------------------------------
// Clamp piece so all its cells remain within grid bounds
// ---------------------------------------------------------------------------
export function clampPiece(piece, grid = null) {
  const gridRows = grid ? grid.rows : ROWS;
  const gridCols = grid ? grid.cols : COLS;
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
  if (maxR >= gridRows) dr = gridRows - 1 - maxR;
  if (minC < 0) dc = -minC;
  if (maxC >= gridCols) dc = gridCols - 1 - maxC;
  return movePiece(piece, dr, dc);
}
