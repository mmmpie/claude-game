import { COLS, ROWS, COLORS, COLORS_DARK, MONSTER_STATS, TREASURE_TYPES, ROCK, FLASH_DURATION, FA_FONT, FA_WEIGHT, FA_ICONS } from './constants.js?v=45';
import { getPieceCells, isValidPlacement } from './tetromino.js?v=45';

// ---------------------------------------------------------------------------
// Renderer state
// ---------------------------------------------------------------------------
export function createRenderer(canvas) {
  // Offscreen draw buffer — a full 2D context we render every pixel into.
  const offscreen = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(1, 1)
    : document.createElement('canvas');

  // Visible canvas uses an ImageBitmapRenderingContext ('bitmaprenderer').
  // This is the spec's purpose-built atomic-presentation API: its ONLY
  // operation, transferFromImageBitmap(), replaces the entire canvas
  // backing store with an ImageBitmap in a single indivisible step. The
  // compositor cannot observe a half-updated state because there is no
  // intermediate state — unlike drawImage() on a 2D context, which mutates
  // the existing backing store in place and can be observed mid-update on
  // the dirty rectangle (the exact symptom you're seeing in the playfield).
  //
  // A canvas can only ever have ONE context type for its lifetime; once we
  // create a 'bitmaprenderer' context, 2D operations on the visible canvas
  // are forbidden. That's fine — blit() is the only place we touch it.
  const bitmapRenderer = typeof canvas.getContext === 'function'
    ? canvas.getContext('bitmaprenderer')
    : null;

  const ctx = bitmapRenderer || canvas.getContext('2d', { alpha: false });

  return {
    canvas,
    ctx,
    ctxIsBitmapRenderer: !!bitmapRenderer,
    offscreen,
    offCtx: offscreen.getContext('2d', { alpha: false }),
    cellSize: 50,
    offsetX: 0,
    offsetY: 0,
    hudX: 0,
    rows: ROWS,
    cols: COLS,
    flashCells: new Map(),
  };
}

// ---------------------------------------------------------------------------
// Atomic blit: hand the offscreen buffer to the visible canvas in one step.
//
// Preferred path (all modern browsers):
//   offscreen.transferToImageBitmap()  → zero-copy handoff of the GPU texture
//   ctx.transferFromImageBitmap(bmp)   → atomic replacement of visible canvas
//
// Neither operation exposes an intermediate state to the compositor.
// ---------------------------------------------------------------------------
function blit(renderer) {
  const { offscreen, ctx, ctxIsBitmapRenderer } = renderer;
  const canTransfer = typeof offscreen.transferToImageBitmap === 'function';

  if (ctxIsBitmapRenderer && canTransfer) {
    // Ideal path: atomic frame presentation.
    ctx.transferFromImageBitmap(offscreen.transferToImageBitmap());
    return;
  }

  // Fallback path — older browsers without bitmaprenderer or OffscreenCanvas.
  if (canTransfer) {
    const bmp = offscreen.transferToImageBitmap();
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
  } else {
    ctx.drawImage(offscreen, 0, 0);
  }
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
export function layoutRenderer(renderer, portrait, rows = renderer.rows, cols = renderer.cols) {
  renderer.rows = rows;
  renderer.cols = cols;
  const canvas = renderer.canvas;
  let newW, newH;
  if (portrait) {
    const w = Math.min(window.innerWidth, 520);
    renderer.cellSize = Math.floor(w / cols);
    newW = renderer.cellSize * cols;
    newH = renderer.cellSize * rows;
    renderer.offsetX = 0;
    renderer.offsetY = 0;
    renderer.hudX = null;
  } else {
    renderer.cellSize = Math.min(50, Math.floor(window.innerHeight * 0.9 / rows));
    const gridW = renderer.cellSize * cols;
    const gridH = renderer.cellSize * rows;
    newW = gridW + 200;
    newH = Math.max(gridH, 500);
    renderer.offsetX = 0;
    renderer.offsetY = 0;
    renderer.hudX = gridW;
  }
  // Only reset canvas dimensions when they actually change — assigning canvas.width/height
  // (even to the same value) blanks the canvas and causes a one-frame flash.
  if (canvas.width !== newW)  canvas.width  = newW;
  if (canvas.height !== newH) canvas.height = newH;
  if (renderer.offscreen.width  !== newW) renderer.offscreen.width  = newW;
  if (renderer.offscreen.height !== newH) renderer.offscreen.height = newH;
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
  const { offCtx: ctx, offscreen } = renderer;

  // No clearRect here — every render path (drawBackground / drawTitleScreen)
  // fills every pixel with an opaque colour before the drawImage copy, so a
  // clearRect would only introduce a brief transparent state for no benefit.

  if (gameState.phase === 'TITLE') {
    drawTitleScreen(ctx, renderer);
    blit(renderer);
    return;
  }

  const { grid, activePiece, adventurer } = gameState;

  drawBackground(ctx, renderer);
  drawLockedCells(ctx, renderer, grid);
  if (activePiece) drawActivePiece(ctx, renderer, activePiece, grid);
  drawGoalHighlight(ctx, renderer, adventurer);
  drawEntities(ctx, renderer, grid, adventurer);
  drawFlashEffects(ctx, renderer);
  if (renderer.hudX !== null) drawHUD(ctx, renderer, gameState);
  drawOverlay(ctx, renderer, gameState);

  blit(renderer);
}

// ---------------------------------------------------------------------------
// Background and grid lines
// ---------------------------------------------------------------------------
function drawBackground(ctx, renderer) {
  const { cellSize, offsetX, offsetY, canvas, rows, cols } = renderer;
  const gridW = cellSize * cols;
  const gridH = cellSize * rows;

  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(offsetX, offsetY, gridW, gridH);

  ctx.strokeStyle = '#2a2a4e';
  ctx.lineWidth = 0.5;
  for (let r = 0; r <= rows; r++) {
    ctx.beginPath();
    ctx.moveTo(offsetX, offsetY + r * cellSize);
    ctx.lineTo(offsetX + gridW, offsetY + r * cellSize);
    ctx.stroke();
  }
  for (let c = 0; c <= cols; c++) {
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
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
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
    if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) continue;
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

  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cells[r][c];
      if (!cell.entity) continue;

      const x = offsetX + c * cellSize + cellSize / 2;
      const y = offsetY + r * cellSize + cellSize / 2;
      const fontSize = Math.max(10, cellSize - 10);

      switch (cell.entity) {
        case 'adventurer': drawAdventurer(ctx, x, y, cellSize, cell.entityRef); break;
        case 'monster':    drawMonster(ctx, x, y, cellSize, fontSize, cell.entityRef); break;
        case 'treasure':   drawTreasure(ctx, x, y, fontSize, cell.entityRef); break;
        case 'stairs':     drawStairs(ctx, x, y, fontSize); break;
        case 'rock':       drawRock(ctx, x, y, fontSize); break;
      }
    }
  }
}

function drawAdventurer(ctx, x, y, cellSize, adventurer) {
  // Shift the icon up slightly so the HP bar has room underneath, matching
  // how monsters are rendered.
  const iconY = y - 3;
  const r = cellSize * 0.38;
  ctx.beginPath();
  ctx.arc(x, iconY, r, 0, Math.PI * 2);
  ctx.fillStyle = '#2c3e50';
  ctx.fill();
  ctx.strokeStyle = '#3498DB';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#ECF0F1';
  ctx.font = faFont(Math.max(10, cellSize - 16));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(FA_ICONS.adventurer, x, iconY);

  // HP bar — same size/placement as monsters for visual consistency.
  if (adventurer && adventurer.maxHp > 0) {
    const barW = cellSize - 6;
    const barH = 4;
    const barX = x - barW / 2;
    const barY = y + cellSize / 2 - barH - 2;
    const pct  = Math.max(0, adventurer.hp / adventurer.maxHp);
    ctx.fillStyle = '#333';
    ctx.fillRect(barX, barY, barW, barH);
    // Colour shifts red → yellow → green based on current health
    ctx.fillStyle = pct > 0.6 ? '#2ecc71' : pct > 0.3 ? '#f1c40f' : '#e74c3c';
    ctx.fillRect(barX, barY, barW * pct, barH);
  }
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
// Title screen
// ---------------------------------------------------------------------------
function drawTitleScreen(ctx, renderer) {
  const { offscreen } = renderer;
  const w = offscreen.width;
  const h = offscreen.height;
  const cx = w / 2;

  // Background
  ctx.fillStyle = '#0d0d1a';
  ctx.fillRect(0, 0, w, h);

  // Subtle grid pattern
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = 0.5;
  const gs = 40;
  for (let x = 0; x <= w; x += gs) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y <= h; y += gs) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  let y = Math.round(h * 0.07);

  // Title
  const titleSize = Math.min(56, Math.max(28, Math.floor(w * 0.1)));
  ctx.fillStyle = '#F1C40F';
  ctx.font = `bold ${titleSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('GAUNTRIS', cx, y);
  y += titleSize + 4;

  // Subtitle
  const subSize = Math.max(10, Math.floor(titleSize * 0.28));
  ctx.fillStyle = '#7F8C8D';
  ctx.font = `${subSize}px monospace`;
  ctx.fillText('dungeon descent puzzle', cx, y);
  y += subSize + Math.round(h * 0.045);

  // Goals
  const goalSize = Math.max(9, Math.floor(titleSize * 0.26));
  const goalLineH = goalSize + 5;
  const goalLines = [
    'Place coloured tetrominoes to build matching clusters.',
    'Clear clusters to reveal monsters, treasure & hazards.',
    'Guide the adventurer to the stairs to descend deeper.',
  ];
  ctx.fillStyle = '#BDC3C7';
  ctx.font = `${goalSize}px monospace`;
  for (const line of goalLines) {
    ctx.fillText(line, cx, y);
    y += goalLineH;
  }
  y += Math.round(h * 0.04);

  // Divider
  ctx.strokeStyle = '#2a2a4e';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w * 0.08, y);
  ctx.lineTo(w * 0.92, y);
  ctx.stroke();
  y += 10;

  // Control columns
  const colW = w / 3;
  const ctrlTitleSize = Math.max(10, Math.floor(titleSize * 0.3));
  const ctrlLineSize  = Math.max(9,  Math.floor(titleSize * 0.23));
  const ctrlLineH     = ctrlLineSize + 4;
  const boxH          = ctrlTitleSize + ctrlLineH * 3 + 20;

  const controls = [
    {
      label: 'MOUSE',
      lines: ['Hover to position', 'Left click to place', 'Right click to rotate'],
    },
    {
      label: 'KEYBOARD',
      lines: ['Arrows to move', 'Space to place', 'X / Z to rotate'],
    },
    {
      label: 'TOUCH',
      lines: ['Drag to position', 'Tap to rotate', 'PLACE button to drop'],
    },
  ];

  controls.forEach(({ label, lines }, i) => {
    const colCx = Math.round(colW * i + colW / 2);
    const boxX  = Math.round(colW * i + 6);

    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(boxX, y, colW - 12, boxH);

    ctx.fillStyle = '#3498DB';
    ctx.font = `bold ${ctrlTitleSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label, colCx, y + 6);

    ctx.fillStyle = '#95A5A6';
    ctx.font = `${ctrlLineSize}px monospace`;
    lines.forEach((line, j) => {
      ctx.fillText(line, colCx, y + ctrlTitleSize + 10 + j * ctrlLineH);
    });
  });

  // Pulsing "press any key" prompt
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 500);
  ctx.globalAlpha = pulse;
  ctx.fillStyle = '#ECF0F1';
  const promptSize = Math.max(11, Math.floor(titleSize * 0.32));
  ctx.font = `bold ${promptSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Press any key, click, or tap to begin', cx, h - Math.round(h * 0.03));
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------
function drawOverlay(ctx, renderer, gameState) {
  const { phase, score } = gameState;
  if (phase === 'PLACING' || phase === 'TITLE') return;

  const { cellSize, offsetX, offsetY, rows, cols } = renderer;
  const gridW = cellSize * cols;
  const gridH = cellSize * rows;
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
//
// IMPORTANT: this runs every animation frame in portrait mode. Any DOM
// mutation here (textContent, style.width, canvas drawing) forces a layout
// and/or paint of #hud-top, which — because the HUD sits in the normal flex
// flow above #game-canvas — reflows the container and repaints the
// CSS-scaled game canvas. That is the visible flicker.
//
// Fix: dirty-check every field against the last value we wrote, and only
// touch the DOM when something actually changed. Most frames will do zero
// DOM writes.
// ---------------------------------------------------------------------------
const hudCache = {
  level:         null,
  score:         null,
  hpText:        null,
  hpPct:         null,
  nextPieceKey:  null,
};

export function resetPortraitHUDCache() {
  hudCache.level        = null;
  hudCache.score        = null;
  hudCache.hpText       = null;
  hudCache.hpPct        = null;
  hudCache.nextPieceKey = null;
}

export function updatePortraitHUD(gameState) {
  const { adventurer, level, score, nextPiece } = gameState;

  if (hudCache.level !== level) {
    hudCache.level = level;
    const e = document.getElementById('hud-level');
    if (e) e.textContent = `Lv ${level}`;
  }

  if (hudCache.score !== score) {
    hudCache.score = score;
    const e = document.getElementById('hud-score');
    if (e) e.textContent = `Score: ${score}`;
  }

  const hpText = `HP ${Math.max(0, adventurer.hp)}/${adventurer.maxHp}`;
  if (hudCache.hpText !== hpText) {
    hudCache.hpText = hpText;
    const e = document.getElementById('hud-hp');
    if (e) e.textContent = hpText;
  }

  const hpPct = Math.max(0, adventurer.hp / adventurer.maxHp * 100);
  if (hudCache.hpPct !== hpPct) {
    hudCache.hpPct = hpPct;
    const bar = document.getElementById('hud-hp-bar');
    if (bar) bar.style.width = `${hpPct}%`;
  }

  // Next-piece preview — only redraw when the piece identity actually changes.
  // Key on type + color + rotation; cell contents are baked in at piece creation.
  const nextPieceKey = nextPiece
    ? `${nextPiece.type}|${nextPiece.color}|${nextPiece.rotation}`
    : null;
  if (hudCache.nextPieceKey !== nextPieceKey) {
    hudCache.nextPieceKey = nextPieceKey;
    const previewCanvas = document.getElementById('next-piece-canvas');
    if (previewCanvas && nextPiece) {
      const pctx = previewCanvas.getContext('2d');
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
}

function colorForName(name) {
  return { red:'#E74C3C', blue:'#3498DB', green:'#2ECC71', yellow:'#F1C40F' }[name] || '#fff';
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}
