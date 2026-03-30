import { COLS, ROWS, COLORS, COLORS_DARK, MONSTER_STATS, TREASURE_TYPES, ROCK, FLASH_DURATION, FA_FONT, FA_WEIGHT, FA_ICONS } from './constants.js?v=25';
import { getPieceCells, isValidPlacement } from './tetromino.js?v=25';

// ---------------------------------------------------------------------------
// Renderer state
// ---------------------------------------------------------------------------
export function createRenderer(canvas) {
  return {
    canvas,
    ctx: canvas.getContext('2d'),
    cellSize: 50,
    offsetX: 0,
    offsetY: 0,
    hudX: 0,
    flashCells: new Map(),
  };
}

// ---------------------------------------------------------------------------
// Font Awesome helper — solid weight, given size in px
// ---------------------------------------------------------------------------
function faFont(size) {
  return `${FA_WEIGHT} ${size}px ${FA_FONT}`;
}

// ---------------------------------------------------------------------------
// Resize / recalculate layout
// ---------------------------------------------------------------------------
export function layoutRenderer(renderer, portrait) {
  const canvas = renderer.canvas;
  if (portrait) {
    const w = Math.min(window.innerWidth, 520);
    renderer.cellSize = Math.floor(w / COLS);
    canvas.width  = renderer.cellSize * COLS;
    canvas.height = renderer.cellSize * ROWS;
    renderer.offsetX = 0;
    renderer.offsetY = 0;
    renderer.hudX = null;
  } else {
    renderer.cellSize = 50;
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
  const { ctx } = renderer;
  const { grid, activePiece, adventurer } = gameState;

  ctx.clearRect(0, 0, renderer.canvas.width, renderer.canvas.height);

  drawBackground(ctx, renderer);
  drawLockedCells(ctx, renderer, grid);
  if (activePiece) drawActivePiece(ctx, renderer, activePiece, grid);
  drawGoalHighlight(ctx, renderer, adventurer);
  drawEntities(ctx, renderer, grid, adventurer);
  drawFlashEffects(ctx, renderer);
  if (renderer.hudX !== null) drawHUD(ctx, renderer, gameState);
  drawOverlay(ctx, renderer, gameState);
}

// ---------------------------------------------------------------------------
// Background and grid lines
// ---------------------------------------------------------------------------
function drawBackground(ctx, renderer) {
  const { cellSize, offsetX, offsetY, canvas } = renderer;
  const gridW = cellSize * COLS;
  const gridH = cellSize * ROWS;

  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(offsetX, offsetY, gridW, gridH);

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

  if (renderer.hudX !== null) {
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(renderer.hudX, 0, 200, canvas.height);
  }
}

// ---------------------------------------------------------------------------
// Locked cells — content visible immediately
// ---------------------------------------------------------------------------
function drawLockedCells(ctx, renderer, grid) {
  const { cellSize, offsetX, offsetY } = renderer;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = grid.cells[r][c];
      if (!cell.locked) continue;

      const x = offsetX + c * cellSize;
      const y = offsetY + r * cellSize;

      // Block background
      ctx.fillStyle = COLORS[cell.color];
      ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);

      ctx.strokeStyle = COLORS_DARK[cell.color];
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1, y + 1, cellSize - 2, cellSize - 2);

      // Bevel highlight
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(x + 1, y + 1, cellSize - 2, 3);
      ctx.fillRect(x + 1, y + 1, 3, cellSize - 2);

      // Content glyph — shown immediately (dimmed since entity not yet active)
      if (cell.content) {
        drawContentGlyph(ctx, x + cellSize / 2, y + cellSize / 2, cellSize, cell.content, 0.65, COLORS[cell.color]);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Active piece — show content glyphs on each cell
// ---------------------------------------------------------------------------
function drawActivePiece(ctx, renderer, piece, grid) {
  const { cellSize, offsetX, offsetY } = renderer;
  const cells = getPieceCells(piece);
  const valid = isValidPlacement(piece, grid);
  const color = COLORS[piece.color];

  for (let i = 0; i < cells.length; i++) {
    const { row, col } = cells[i];
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) continue;
    const x = offsetX + col * cellSize;
    const y = offsetY + row * cellSize;

    ctx.globalAlpha = valid ? 0.65 : 0.35;
    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = valid ? COLORS_DARK[piece.color] : '#FF0000';
    ctx.lineWidth = valid ? 1.5 : 2;
    ctx.strokeRect(x + 1, y + 1, cellSize - 2, cellSize - 2);

    // Show content glyph on the piece while it's being placed
    const content = piece.cellContents[i];
    if (content) {
      drawContentGlyph(ctx, x + cellSize / 2, y + cellSize / 2, cellSize, content, 0.9, COLORS[piece.color]);
    }
  }
}

// ---------------------------------------------------------------------------
// Blend a hex color toward white by `factor` (0 = unchanged, 1 = white)
// ---------------------------------------------------------------------------
function lightenColor(hex, factor) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.round(r + (255 - r) * factor)},${Math.round(g + (255 - g) * factor)},${Math.round(b + (255 - b) * factor)})`;
}

// ---------------------------------------------------------------------------
// Draw a content glyph (monster/treasure/rock) embedded inside a piece cell.
// pieceColorHex: hex color of the piece — glyph is rendered as a lightened tint.
// ---------------------------------------------------------------------------
function drawContentGlyph(ctx, cx, cy, cellSize, content, alpha, pieceColorHex) {
  const fontSize = Math.max(10, cellSize - 16);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = faFont(fontSize);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = lightenColor(pieceColorHex, 0.45);

  if (content.type === 'monster') {
    ctx.fillText(MONSTER_STATS[content.monsterType].glyph, cx, cy);
  } else if (content.type === 'treasure') {
    ctx.fillText(TREASURE_TYPES[content.treasureType].glyph, cx, cy);
  } else if (content.type === 'rock') {
    ctx.fillText(FA_ICONS.rock, cx, cy);
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Goal highlight — white circle around the adventurer's current target cell
// ---------------------------------------------------------------------------
function drawGoalHighlight(ctx, renderer, adventurer) {
  if (!adventurer || !adventurer.currentGoal) return;
  const { cellSize, offsetX, offsetY } = renderer;
  const { row, col } = adventurer.currentGoal;
  const cx = offsetX + col * cellSize + cellSize / 2;
  const cy = offsetY + row * cellSize + cellSize / 2;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, cellSize * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Active entities (adventurer, freed monsters, freed treasure, freed stairs)
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
        case 'adventurer': drawAdventurer(ctx, x, y, cellSize); break;
        case 'monster':    drawMonster(ctx, x, y, cellSize, fontSize, cell.entityRef); break;
        case 'treasure':   drawTreasure(ctx, x, y, fontSize, cell.entityRef); break;
        case 'stairs':     drawStairs(ctx, x, y, fontSize); break;
        case 'rock':       drawRock(ctx, x, y, fontSize); break;
      }
    }
  }
}

function drawAdventurer(ctx, x, y, cellSize) {
  const r = cellSize * 0.4;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#2c3e50';
  ctx.fill();
  ctx.strokeStyle = '#3498DB';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#ECF0F1';
  ctx.font = faFont(Math.max(10, cellSize - 14));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(FA_ICONS.adventurer, x, y);
}

function drawMonster(ctx, x, y, cellSize, fontSize, monster) {
  const stats = MONSTER_STATS[monster.type];
  ctx.fillStyle = stats.color;
  ctx.font = faFont(fontSize);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(stats.glyph, x, y - 3);

  const barW = cellSize - 6;
  const barH = 4;
  const barX = x - barW / 2;
  const barY = y + cellSize / 2 - barH - 2;
  ctx.fillStyle = '#333';
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = '#e74c3c';
  ctx.fillRect(barX, barY, barW * Math.max(0, monster.hp / monster.maxHp), barH);
}

function drawTreasure(ctx, x, y, fontSize, treasure) {
  const ttype = TREASURE_TYPES[treasure.type];
  ctx.fillStyle = ttype.color;
  ctx.font = faFont(fontSize);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ttype.glyph, x, y);
}

function drawStairs(ctx, x, y, fontSize) {
  ctx.fillStyle = '#F1C40F';
  ctx.font = faFont(fontSize);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(FA_ICONS.stairs, x, y);
}

function drawRock(ctx, x, y, fontSize) {
  ctx.fillStyle = ROCK.color;
  ctx.font = faFont(fontSize);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(FA_ICONS.rock, x, y);
}

// ---------------------------------------------------------------------------
// Flash effects
// ---------------------------------------------------------------------------
function drawFlashEffects(ctx, renderer) {
  const { cellSize, offsetX, offsetY } = renderer;
  const now = performance.now();
  for (const [key, { startTime }] of renderer.flashCells) {
    const elapsed = now - startTime;
    if (elapsed >= FLASH_DURATION) { renderer.flashCells.delete(key); continue; }
    const alpha = 1 - elapsed / FLASH_DURATION;
    const [r, c] = key.split(',').map(Number);
    ctx.fillStyle = `rgba(255,255,255,${alpha * 0.85})`;
    ctx.fillRect(offsetX + c * cellSize + 1, offsetY + r * cellSize + 1, cellSize - 2, cellSize - 2);
  }
}

// ---------------------------------------------------------------------------
// HUD panel (landscape)
// ---------------------------------------------------------------------------
function drawHUD(ctx, renderer, gameState) {
  const { hudX } = renderer;
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

  ctx.fillText(`HP: ${Math.max(0,adventurer.hp)} / ${adventurer.maxHp}`, x, y); y += 16;
  const barW = 175, barH = 10;
  ctx.fillStyle = '#4a4a4a';
  ctx.fillRect(x, y, barW, barH);
  ctx.fillStyle = '#E74C3C';
  ctx.fillRect(x, y, barW * Math.max(0, adventurer.hp / adventurer.maxHp), barH);
  y += barH + lineH * 0.6;

  ctx.fillStyle = '#BDC3C7';
  ctx.fillText(`ATK: ${adventurer.attack}  DEF: ${adventurer.defense}`, x, y); y += lineH * 1.5;

  ctx.fillStyle = '#ECF0F1';
  ctx.font = 'bold 13px monospace';
  ctx.fillText('NEXT:', x, y); y += lineH;

  if (nextPiece) drawNextPiecePreview(ctx, nextPiece, x, y);
  y += 75;

  ctx.fillStyle = '#7F8C8D';
  ctx.font = 'bold 11px monospace';
  ctx.fillText('─── LOG ───', x, y); y += 16;
  ctx.font = '11px monospace';
  for (let i = 0; i < Math.min(eventLog.length, 8); i++) {
    const alpha = 1 - i * 0.11;
    ctx.fillStyle = `rgba(189,195,199,${alpha})`;
    ctx.fillText(truncate(eventLog[i], 22), x, y);
    y += 14;
  }
}

function drawNextPiecePreview(ctx, piece, x, y) {
  const previewSize = 15;
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(x, y, 4 * previewSize, 4 * previewSize);

  const tempPiece = { ...piece, row: 0, col: 0 };
  const cells = getPieceCells(tempPiece);
  for (let i = 0; i < cells.length; i++) {
    const { row, col } = cells[i];
    if (row < 0 || row > 3 || col < 0 || col > 3) continue;
    const px = x + col * previewSize;
    const py = y + row * previewSize;
    ctx.fillStyle = colorForName(piece.color);
    ctx.fillRect(px + 1, py + 1, previewSize - 2, previewSize - 2);

    const content = piece.cellContents[i];
    if (content) {
      ctx.save();
      ctx.font = faFont(8);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = 0.9;
      if (content.type === 'monster') {
        ctx.fillStyle = MONSTER_STATS[content.monsterType].color;
        ctx.fillText(MONSTER_STATS[content.monsterType].glyph, px + previewSize / 2, py + previewSize / 2);
      } else if (content.type === 'treasure') {
        ctx.fillStyle = TREASURE_TYPES[content.treasureType].color;
        ctx.fillText(TREASURE_TYPES[content.treasureType].glyph, px + previewSize / 2, py + previewSize / 2);
      }
      ctx.restore();
    }
  }
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------
function drawOverlay(ctx, renderer, gameState) {
  const { phase, score } = gameState;
  if (phase === 'PLACING') return;

  const { cellSize, offsetX, offsetY } = renderer;
  const gridW = cellSize * COLS;
  const gridH = cellSize * ROWS;
  const cx = offsetX + gridW / 2;
  const cy = offsetY + gridH / 2;

  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(offsetX, offsetY, gridW, gridH);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (phase === 'GAME_OVER') {
    ctx.fillStyle = '#E74C3C';
    ctx.font = `bold ${Math.floor(cellSize * 1.1)}px monospace`;
    ctx.fillText('GAME OVER', cx, cy - 34);
    ctx.fillStyle = '#ECF0F1';
    ctx.font = `${Math.floor(cellSize * 0.65)}px monospace`;
    ctx.fillText(`Score: ${score}`, cx, cy + 8);
    ctx.fillStyle = '#95A5A6';
    ctx.font = `${Math.floor(cellSize * 0.48)}px monospace`;
    ctx.fillText('Press R to restart', cx, cy + 40);
  } else if (phase === 'LEVEL_COMPLETE') {
    ctx.fillStyle = '#F1C40F';
    ctx.font = `bold ${Math.floor(cellSize * 0.95)}px monospace`;
    ctx.fillText('LEVEL CLEAR!', cx, cy - 34);
    ctx.fillStyle = '#ECF0F1';
    ctx.font = `${Math.floor(cellSize * 0.65)}px monospace`;
    ctx.fillText(`Score: ${score}`, cx, cy + 8);
    ctx.fillStyle = '#95A5A6';
    ctx.font = `${Math.floor(cellSize * 0.48)}px monospace`;
    ctx.fillText('Press Enter to continue', cx, cy + 40);
  } else if (phase === 'PAUSED') {
    ctx.fillStyle = '#ECF0F1';
    ctx.font = `bold ${Math.floor(cellSize * 1.1)}px monospace`;
    ctx.fillText('PAUSED', cx, cy);
    ctx.fillStyle = '#95A5A6';
    ctx.font = `${Math.floor(cellSize * 0.48)}px monospace`;
    ctx.fillText('Press P to resume', cx, cy + 38);
  }
}

// ---------------------------------------------------------------------------
// Portrait HUD (DOM)
// ---------------------------------------------------------------------------
export function updatePortraitHUD(gameState) {
  const { adventurer, level, score, nextPiece } = gameState;
  const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };

  set('hud-level', `Lv ${level}`);
  set('hud-score', `Score: ${score}`);
  set('hud-hp', `HP ${Math.max(0,adventurer.hp)}/${adventurer.maxHp}`);

  const bar = document.getElementById('hud-hp-bar');
  if (bar) bar.style.width = `${Math.max(0, adventurer.hp / adventurer.maxHp * 100)}%`;

  const previewCanvas = document.getElementById('next-piece-canvas');
  if (previewCanvas && nextPiece) {
    const pctx = previewCanvas.getContext('2d');
    pctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    const previewSize = 11;
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

function colorForName(name) {
  return { red:'#E74C3C', blue:'#3498DB', green:'#2ECC71', yellow:'#F1C40F' }[name] || '#fff';
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}
