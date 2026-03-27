import { COLS, ROWS, COLORS, COLORS_DARK, MONSTER_STATS, TREASURE_TYPES, FLASH_DURATION } from './constants.js';
import { getPieceCells, isValidPlacement } from './tetromino.js';

// ---------------------------------------------------------------------------
// Renderer state
// ---------------------------------------------------------------------------
export function createRenderer(canvas) {
  return {
    canvas,
    ctx: canvas.getContext('2d'),
    cellSize: 28,
    offsetX: 0,   // game grid x offset on canvas
    offsetY: 0,
    hudX: 0,      // HUD panel x offset
    flashCells: new Map(),  // key "r,c" -> { startTime, color }
  };
}

// ---------------------------------------------------------------------------
// Resize / recalculate layout
// Called on init and on window resize
// ---------------------------------------------------------------------------
export function layoutRenderer(renderer, portrait) {
  const canvas = renderer.canvas;
  if (portrait) {
    // Portrait: canvas fills screen width, height is auto
    const w = Math.min(window.innerWidth, 480);
    renderer.cellSize = Math.floor(w / COLS);
    canvas.width  = renderer.cellSize * COLS;
    canvas.height = renderer.cellSize * ROWS;
    renderer.offsetX = 0;
    renderer.offsetY = 0;
    renderer.hudX = null; // HUD is DOM, not canvas
  } else {
    renderer.cellSize = 28;
    const gridW = renderer.cellSize * COLS;
    const gridH = renderer.cellSize * ROWS;
    canvas.width  = gridW + 200;
    canvas.height = Math.max(gridH, 500);
    renderer.offsetX = 0;
    renderer.offsetY = 0;
    renderer.hudX = gridW;
  }
}

// ---------------------------------------------------------------------------
// Flash effect trigger
// ---------------------------------------------------------------------------
export function flashCells(renderer, cells) {
  const now = performance.now();
  for (const { row, col } of cells) {
    renderer.flashCells.set(`${row},${col}`, { startTime: now });
  }
}

// ---------------------------------------------------------------------------
// Master render call
// ---------------------------------------------------------------------------
export function render(renderer, gameState) {
  const { ctx, cellSize, offsetX, offsetY, hudX } = renderer;
  const { grid, activePiece, adventurer } = gameState;

  ctx.clearRect(0, 0, renderer.canvas.width, renderer.canvas.height);

  drawBackground(ctx, renderer);
  drawLockedCells(ctx, renderer, grid);
  if (activePiece) drawActivePiece(ctx, renderer, activePiece, grid);
  drawEntities(ctx, renderer, grid, adventurer);
  drawFlashEffects(ctx, renderer);
  if (hudX !== null) drawHUD(ctx, renderer, gameState);
  drawOverlay(ctx, renderer, gameState);
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------
function drawBackground(ctx, renderer) {
  const { cellSize, offsetX, offsetY, canvas } = renderer;
  const gridW = cellSize * COLS;
  const gridH = cellSize * ROWS;

  // Dungeon floor
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(offsetX, offsetY, gridW, gridH);

  // Grid lines
  ctx.strokeStyle = '#2a2a4e';
  ctx.lineWidth = 0.5;
  for (let r = 0; r <= ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(offsetX, offsetY + r * cellSize);
    ctx.lineTo(offsetX + gridW, offsetY + r * cellSize);
    ctx.stroke();
  }
  for (let c = 0; c <= COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(offsetX + c * cellSize, offsetY);
    ctx.lineTo(offsetX + c * cellSize, offsetY + gridH);
    ctx.stroke();
  }

  // HUD background
  if (renderer.hudX !== null) {
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(renderer.hudX, 0, 200, canvas.height);
  }
}

// ---------------------------------------------------------------------------
// Locked cells
// ---------------------------------------------------------------------------
function drawLockedCells(ctx, renderer, grid) {
  const { cellSize, offsetX, offsetY } = renderer;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = grid.cells[r][c];
      if (!cell.locked) continue;

      const x = offsetX + c * cellSize;
      const y = offsetY + r * cellSize;

      ctx.fillStyle = COLORS[cell.color];
      ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);

      // Darker border
      ctx.strokeStyle = COLORS_DARK[cell.color];
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1, y + 1, cellSize - 2, cellSize - 2);

      // Subtle highlight — top-left bevel
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(x + 1, y + 1, cellSize - 2, 3);
      ctx.fillRect(x + 1, y + 1, 3, cellSize - 2);

      // Hidden content hint
      if (cell.content && !cell.revealed) {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.font = `bold ${Math.max(10, cellSize - 14)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', x + cellSize / 2, y + cellSize / 2);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Active piece (cursor-placed)
// ---------------------------------------------------------------------------
function drawActivePiece(ctx, renderer, piece, grid) {
  const { cellSize, offsetX, offsetY } = renderer;
  const cells = getPieceCells(piece);
  const valid = isValidPlacement(piece, grid);
  const color = COLORS[piece.color];

  for (const { row, col } of cells) {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) continue;
    const x = offsetX + col * cellSize;
    const y = offsetY + row * cellSize;

    if (valid) {
      ctx.globalAlpha = 0.65;
      ctx.fillStyle = color;
      ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = COLORS_DARK[piece.color];
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
    } else {
      // Invalid placement — red outline
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = color;
      ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#FF0000';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
    }
  }
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
function drawEntities(ctx, renderer, grid, adventurer) {
  const { cellSize, offsetX, offsetY } = renderer;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = grid.cells[r][c];
      if (!cell.entity) continue;

      const x = offsetX + c * cellSize + cellSize / 2;
      const y = offsetY + r * cellSize + cellSize / 2;
      const fontSize = Math.max(10, cellSize - 10);

      switch (cell.entity) {
        case 'adventurer':
          drawAdventurer(ctx, x, y, cellSize, adventurer);
          break;
        case 'monster':
          drawMonster(ctx, x, y, cellSize, fontSize, cell.entityRef);
          break;
        case 'treasure':
          drawTreasure(ctx, x, y, fontSize, cell.entityRef);
          break;
        case 'stairs':
          drawStairs(ctx, x, y, fontSize);
          break;
      }
    }
  }
}

function drawAdventurer(ctx, x, y, cellSize, adv) {
  const r = cellSize * 0.38;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#2c3e50';
  ctx.fill();
  ctx.strokeStyle = '#ecf0f1';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.max(10, cellSize - 10)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('@', x, y);
}

function drawMonster(ctx, x, y, cellSize, fontSize, monster) {
  const stats = MONSTER_STATS[monster.type];
  ctx.fillStyle = stats.color;
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(stats.glyph, x, y - 2);

  // HP bar
  const barW = cellSize - 4;
  const barH = 3;
  const barX = x - barW / 2;
  const barY = y + cellSize / 2 - barH - 1;
  ctx.fillStyle = '#333';
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = '#e74c3c';
  ctx.fillRect(barX, barY, barW * Math.max(0, monster.hp / monster.maxHp), barH);
}

function drawTreasure(ctx, x, y, fontSize, treasure) {
  const ttype = TREASURE_TYPES[treasure.type];
  ctx.fillStyle = ttype.color;
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ttype.glyph, x, y);
}

function drawStairs(ctx, x, y, fontSize) {
  ctx.fillStyle = '#F1C40F';
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('>', x, y);
}

// ---------------------------------------------------------------------------
// Flash effects
// ---------------------------------------------------------------------------
function drawFlashEffects(ctx, renderer) {
  const { cellSize, offsetX, offsetY, flashCells } = renderer;
  const now = performance.now();
  for (const [key, { startTime }] of flashCells) {
    const elapsed = now - startTime;
    if (elapsed >= FLASH_DURATION) { flashCells.delete(key); continue; }
    const alpha = 1 - elapsed / FLASH_DURATION;
    const [r, c] = key.split(',').map(Number);
    const x = offsetX + c * cellSize + 1;
    const y = offsetY + r * cellSize + 1;
    ctx.fillStyle = `rgba(255,255,255,${alpha * 0.8})`;
    ctx.fillRect(x, y, cellSize - 2, cellSize - 2);
  }
}

// ---------------------------------------------------------------------------
// HUD panel (landscape only)
// ---------------------------------------------------------------------------
function drawHUD(ctx, renderer, gameState) {
  const { hudX, canvas } = renderer;
  const { adventurer, level, score, eventLog, nextPiece } = gameState;
  const x = hudX + 10;
  let y = 20;
  const lineH = 22;

  ctx.fillStyle = '#ECF0F1';
  ctx.font = 'bold 18px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('GAUNTRIS', x, y); y += lineH * 1.5;

  ctx.font = '13px monospace';
  ctx.fillStyle = '#BDC3C7';
  ctx.fillText(`Level: ${level}`, x, y); y += lineH;
  ctx.fillText(`Score: ${score}`, x, y); y += lineH;
  ctx.fillText(`Gold:  ${adventurer.gold}`, x, y); y += lineH * 1.2;

  // HP bar
  ctx.fillStyle = '#BDC3C7';
  ctx.fillText(`HP: ${Math.max(0,adventurer.hp)} / ${adventurer.maxHp}`, x, y); y += 16;
  const barW = 175;
  const barH = 10;
  ctx.fillStyle = '#4a4a4a';
  ctx.fillRect(x, y, barW, barH);
  ctx.fillStyle = '#E74C3C';
  ctx.fillRect(x, y, barW * Math.max(0, adventurer.hp / adventurer.maxHp), barH);
  y += barH + lineH * 0.6;

  ctx.fillStyle = '#BDC3C7';
  ctx.fillText(`ATK: ${adventurer.attack + (adventurer.sword?.attackBonus ?? 0)}`, x, y); y += lineH;
  ctx.fillText(`DEF: ${adventurer.defense + (adventurer.armor?.defenseBonus ?? 0)}`, x, y); y += lineH;
  ctx.fillText(`Sword: ${adventurer.sword ? 'Yes' : 'None'}`, x, y); y += lineH;
  ctx.fillText(`Armor: ${adventurer.armor ? 'Yes' : 'None'}`, x, y); y += lineH * 1.5;

  // Next piece preview
  ctx.fillStyle = '#ECF0F1';
  ctx.font = 'bold 13px monospace';
  ctx.fillText('NEXT:', x, y); y += lineH;

  if (nextPiece) {
    drawNextPiecePreview(ctx, nextPiece, x, y);
  }
  y += 80;

  // Event log
  ctx.fillStyle = '#7F8C8D';
  ctx.font = 'bold 11px monospace';
  ctx.fillText('--- LOG ---', x, y); y += 16;
  ctx.font = '11px monospace';
  for (let i = 0; i < Math.min(eventLog.length, 7); i++) {
    const alpha = 1 - i * 0.12;
    ctx.fillStyle = `rgba(189,195,199,${alpha})`;
    ctx.fillText(truncate(eventLog[i], 22), x, y);
    y += 15;
  }
}

function drawNextPiecePreview(ctx, piece, x, y) {
  const { TETROMINOES } = { TETROMINOES: null };
  // Use getPieceCells logic inline (avoid circular import by re-importing constants)
  // We'll draw a 4x4 preview grid at 15px per cell
  const previewSize = 15;
  // Render a temporary piece at row=0,col=0 to get relative cells
  const tempPiece = { ...piece, row: 0, col: 0 };
  const cells = getPieceCells(tempPiece);

  // Background
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(x, y, 4 * previewSize, 4 * previewSize);

  const { COLORS: C, COLORS_DARK: CD } = { COLORS: null, COLORS_DARK: null };
  for (const { row, col } of cells) {
    if (row < 0 || row > 3 || col < 0 || col > 3) continue;
    const px = x + col * previewSize;
    const py = y + row * previewSize;
    ctx.fillStyle = colorForName(piece.color);
    ctx.fillRect(px + 1, py + 1, previewSize - 2, previewSize - 2);
  }
}

function colorForName(name) {
  const map = { red:'#E74C3C', blue:'#3498DB', green:'#2ECC71', yellow:'#F1C40F' };
  return map[name] || '#fff';
}

// ---------------------------------------------------------------------------
// Overlay — game over / level complete / paused
// ---------------------------------------------------------------------------
function drawOverlay(ctx, renderer, gameState) {
  const { phase, level, score } = gameState;
  if (phase === 'PLACING') return;

  const { cellSize, offsetX, offsetY, canvas } = renderer;
  const gridW = cellSize * COLS;
  const gridH = cellSize * ROWS;

  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(offsetX, offsetY, gridW, gridH);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = offsetX + gridW / 2;
  const cy = offsetY + gridH / 2;

  if (phase === 'GAME_OVER') {
    ctx.fillStyle = '#E74C3C';
    ctx.font = `bold ${Math.floor(cellSize * 1.2)}px monospace`;
    ctx.fillText('GAME OVER', cx, cy - 30);
    ctx.fillStyle = '#ECF0F1';
    ctx.font = `${Math.floor(cellSize * 0.7)}px monospace`;
    ctx.fillText(`Score: ${score}`, cx, cy + 10);
    ctx.fillStyle = '#95A5A6';
    ctx.font = `${Math.floor(cellSize * 0.55)}px monospace`;
    ctx.fillText('Press R to restart', cx, cy + 40);
  } else if (phase === 'LEVEL_COMPLETE') {
    ctx.fillStyle = '#F1C40F';
    ctx.font = `bold ${Math.floor(cellSize * 1.0)}px monospace`;
    ctx.fillText('LEVEL CLEAR!', cx, cy - 30);
    ctx.fillStyle = '#ECF0F1';
    ctx.font = `${Math.floor(cellSize * 0.7)}px monospace`;
    ctx.fillText(`Score: ${score}`, cx, cy + 10);
    ctx.fillStyle = '#95A5A6';
    ctx.font = `${Math.floor(cellSize * 0.55)}px monospace`;
    ctx.fillText('Press Enter to continue', cx, cy + 40);
  } else if (phase === 'PAUSED') {
    ctx.fillStyle = '#ECF0F1';
    ctx.font = `bold ${Math.floor(cellSize * 1.2)}px monospace`;
    ctx.fillText('PAUSED', cx, cy);
    ctx.fillStyle = '#95A5A6';
    ctx.font = `${Math.floor(cellSize * 0.55)}px monospace`;
    ctx.fillText('Press P to resume', cx, cy + 36);
  }
}

// ---------------------------------------------------------------------------
// HUD update for portrait mode (writes to DOM elements)
// ---------------------------------------------------------------------------
export function updatePortraitHUD(gameState) {
  const { adventurer, level, score, nextPiece } = gameState;
  const el = id => document.getElementById(id);
  const set = (id, val) => { const e = el(id); if (e) e.textContent = val; };

  set('hud-level', `Lv ${level}`);
  set('hud-score', `Score: ${score}`);
  set('hud-hp', `HP ${Math.max(0,adventurer.hp)}/${adventurer.maxHp}`);

  const bar = el('hud-hp-bar');
  if (bar) bar.style.width = `${Math.max(0, adventurer.hp / adventurer.maxHp * 100)}%`;

  // Next piece preview via canvas
  const previewCanvas = el('next-piece-canvas');
  if (previewCanvas && nextPiece) {
    const pctx = previewCanvas.getContext('2d');
    pctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    const previewSize = 12;
    pctx.fillStyle = '#1a1a2e';
    pctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    const tempPiece = { ...nextPiece, row: 0, col: 0 };
    for (const { row, col } of getPieceCells(tempPiece)) {
      if (row < 0 || row > 3 || col < 0 || col > 3) continue;
      pctx.fillStyle = colorForName(nextPiece.color);
      pctx.fillRect(col * previewSize + 1, row * previewSize + 1, previewSize - 2, previewSize - 2);
    }
  }
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}
