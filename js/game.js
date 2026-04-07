import { COLS, ROWS, SCORE, CLUSTER_MIN_SIZE, COLOR_NAMES } from './constants.js?v=39';
import { createGrid, findClusters, clearClusters, placeEntity, removeEntity, getCell, generatePieceContents, generateForcedPieceContents } from './grid.js?v=39';
import { createPiece, getPieceCells, movePiece, rotatePiece, isValidPlacement, lockPiece, randomType, randomColor, clampPiece } from './tetromino.js?v=39';
import { createAdventurer, createMonster, createTreasure, runAdventurerTurn, runSingleMonsterTurn, resolveCombat, collectTreasure, logEvent } from './entities.js?v=39';
import { createRenderer, layoutRenderer, render, flashCells, updatePortraitHUD } from './renderer.js?v=39';

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
let gameState    = null;
let renderer     = null;
let portrait     = false;
let pendingSteps = [];   // step queue for frame-by-frame turn animation
let lastAutoTick = 0;   // timestamp of last automatic entity movement
const AUTO_TICK_MS = 1000;

// Drag state for canvas touch movement
let dragActive    = false;
let dragMoved     = false;   // true once the finger moves beyond the tap threshold
let dragOffsetRow = 0;
let dragOffsetCol = 0;
let dragStartX    = 0;
let dragStartY    = 0;
const DRAG_THRESHOLD = 8; // pixels of movement before a touch counts as a drag

function newGameState() {
  return {
    phase: 'PLACING',
    level: 1,
    score: 0,
    grid: null,
    activePiece: null,
    nextPiece: null,
    adventurer: null,
    eventLog: [],
    turnCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Level initialization
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Compute grid dimensions: grows until there is room for all seed pieces
// while keeping a clearance zone around the adventurer centre.
// ---------------------------------------------------------------------------
const SEED_CLEARANCE = 3; // min Manhattan distance from adv centre to any seed cell

function computeGridDims(seedCount) {
  // Cells needed: 4 per piece + clearance diamond (r=SEED_CLEARANCE) + buffer
  const clearanceCells = 2 * SEED_CLEARANCE * (SEED_CLEARANCE + 1) + 1;
  const needed = seedCount * 4 + clearanceCells + 30;
  let size = ROWS; // never shrink below the base size
  while (size * size < needed) size++;
  return { rows: size, cols: size };
}

function initLevel(state, levelNum) {
  state.level = levelNum;
  state.phase = 'PLACING';
  state.turnCount = 0;
  lastAutoTick = Infinity; // wait for first piece placement each level

  const seedCount = levelNum + 2;
  const { rows, cols } = computeGridDims(seedCount);

  const grid = createGrid(rows, cols);
  state.grid = grid;

  grid.monsters = [];
  grid.treasures = [];
  grid.stairs = null;

  // Pick stairs corner first so the adventurer can be placed opposite.
  const stairsPos = pickStairsCorner(rows, cols);
  grid.stairs = stairsPos;
  placeEntity(grid, stairsPos.row, stairsPos.col, 'stairs', stairsPos);

  // Spawn adventurer in the centre of the quarter diagonally opposite the stairs.
  const advRow = stairsPos.row === 0 ? Math.floor(rows * 3 / 4) : Math.floor(rows / 4);
  const advCol = stairsPos.col === 0 ? Math.floor(cols * 3 / 4) : Math.floor(cols / 4);
  const adv = levelNum === 1
    ? createAdventurer(advRow, advCol)
    : state.adventurer;

  removeEntitySafe(grid, adv);
  adv.row = advRow;
  adv.col = advCol;
  adv.alive = true;
  state.adventurer = adv;
  placeEntity(grid, advRow, advCol, 'adventurer', adv);

  // Seed pieces fill from stairs corner, each a distinct colour, respecting
  // the clearance zone so the adventurer always has room to place pieces.
  const seedCandidates = buildStairsCandidates(stairsPos, grid);
  for (let i = 0; i < seedCount; i++) {
    placeSeedPiece(state, grid, COLOR_NAMES[i % COLOR_NAMES.length], seedCandidates, adv);
  }

  // Resize canvas for the new grid dimensions
  layoutRenderer(renderer, portrait, rows, cols);

  // First piece spawns near the adventurer
  state.activePiece = clampPiece(
    { ...makePiece(state), row: advRow - 1, col: advCol - 1 }, grid);
  state.nextPiece = makePiece(state);

  logEvent(state, `=== Level ${levelNum} ===`);
}

function pickStairsCorner(rows, cols) {
  const corners = [
    { row: 0,        col: 0        },
    { row: 0,        col: cols - 1 },
    { row: rows - 1, col: 0        },
    { row: rows - 1, col: cols - 1 },
  ];
  return corners[Math.floor(Math.random() * corners.length)];
}

// ---------------------------------------------------------------------------
// Build candidate positions sorted by Manhattan distance from the stairs,
// so seed pieces fill inward from the stairs corner first.
// ---------------------------------------------------------------------------
function buildStairsCandidates(stairsPos, grid) {
  const candidates = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      candidates.push({ row: r, col: c,
        dist: Math.abs(r - stairsPos.row) + Math.abs(c - stairsPos.col) });
    }
  }
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates;
}

// ---------------------------------------------------------------------------
// Seed piece — placed as close to the stairs as possible, never within
// SEED_CLEARANCE Manhattan distance of the adventurer.
// ---------------------------------------------------------------------------
function placeSeedPiece(state, grid, color, candidates, adv) {
  const type         = randomType();
  const cellContents = generateForcedPieceContents(state.level, color);

  for (const { row, col } of candidates) {
    let piece = { type, color, rotationIndex: 0, row, col, cellContents };
    for (let r = 0; r < 4; r++) {
      if (isValidPlacement(piece, grid)) {
        const pieceCells = getPieceCells(piece);
        const tooClose = pieceCells.some(
          c => Math.abs(c.row - adv.row) + Math.abs(c.col - adv.col) <= SEED_CLEARANCE
        );
        if (!tooClose) { lockPiece(piece, grid); return; }
      }
      piece = rotatePiece(piece, 1);
    }
  }
}

function removeEntitySafe(grid, entity) {
  if (!entity) return;
  const cell = getCell(grid, entity.row, entity.col);
  if (cell && cell.entityRef === entity) removeEntity(grid, entity.row, entity.col);
}

// ---------------------------------------------------------------------------
// Build a new piece with monster/treasure content assigned at instantiation.
// ---------------------------------------------------------------------------
function makePiece(gameState) {
  const color = randomColor();
  const cellContents = generatePieceContents(gameState.level, color);
  return createPiece(randomType(), color, cellContents);
}

// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------
function handleAction(action) {
  if (!gameState) return;
  const { phase } = gameState;

  // Any action dismisses the title screen and starts the game.
  if (phase === 'TITLE') { startGame(); return; }

  if (action === 'pause') {
    if (phase === 'PLACING') { gameState.phase = 'PAUSED'; return; }
    if (phase === 'PAUSED')  { gameState.phase = 'PLACING'; return; }
    return;
  }
  if ((action === 'restart' || action === 'place') && phase === 'GAME_OVER') { pendingSteps = []; startGame(); return; }
  if ((action === 'next-level' || action === 'place') && phase === 'LEVEL_COMPLETE') {
    pendingSteps = [];
    initLevel(gameState, gameState.level + 1);
    return;
  }

  if (phase !== 'PLACING') return;

  const piece = gameState.activePiece;
  if (!piece) return;

  let newPiece = piece;
  switch (action) {
    case 'left':      newPiece = movePiece(piece, 0, -1); break;
    case 'right':     newPiece = movePiece(piece, 0,  1); break;
    case 'up':        newPiece = movePiece(piece, -1, 0); break;
    case 'down':      newPiece = movePiece(piece,  1, 0); break;
    case 'rotateCW':  newPiece = rotatePiece(piece,  1); break;
    case 'rotateCCW': newPiece = rotatePiece(piece, -1); break;
    case 'place':     placePiece(); return;
    default: return;
  }

  gameState.activePiece = clampPiece(newPiece, gameState.grid);
}

// ---------------------------------------------------------------------------
// Queue entity movement steps (adventurer + monsters + combat).
// onDone() is called in the final step after combat resolves.
// ---------------------------------------------------------------------------
function queueEntityMoves(onDone) {
  const { grid } = gameState;
  const monstersThisTurn = grid.monsters.filter(m => m.alive);
  gameState.phase = 'ANIMATING';
  pendingSteps = [
    // Step 1 — move adventurer
    () => {
      const { trapped } = runAdventurerTurn(gameState.adventurer, grid, gameState);
      if (trapped) logEvent(gameState, 'Adventurer is trapped!');
      checkWin();
    },
    // Steps 2…N — move each monster individually
    ...monstersThisTurn.map(monster => () => {
      if (gameState.phase !== 'ANIMATING') return;
      runSingleMonsterTurn(monster, grid, gameState);
    }),
    // Final step — resolve combat then call onDone
    () => {
      if (gameState.phase !== 'ANIMATING') return;
      resolveCombat(grid, gameState);
      if (gameState.phase === 'GAME_OVER') return;
      if (checkWin()) return;
      onDone();
    },
  ];
}

// ---------------------------------------------------------------------------
// Place the active piece.
// Locks the piece + clears clusters synchronously (so the next render shows
// the final playfield), then queues the remaining turn steps so each one
// gets its own animation frame.
// ---------------------------------------------------------------------------
function placePiece() {
  const { activePiece, grid } = gameState;
  if (!isValidPlacement(activePiece, grid)) return;

  // Remember spawn position and placed cells before locking
  const spawnRow = activePiece.row;
  const spawnCol = activePiece.col;
  const placedKeys = new Set(getPieceCells(activePiece).map(c => c.row * 1000 + c.col));

  lockPiece(activePiece, grid);
  gameState.activePiece = null;   // hide ghost piece while animating

  // Only clear clusters that include at least one cell from the just-placed piece,
  // so pre-placed seed clusters don't vanish until the player touches them.
  const clusters = findClusters(grid)
    .filter(cluster => cluster.some(c => placedKeys.has(c.row * 1000 + c.col)));
  if (clusters.length > 0) {
    const allClearedCells = clusters.flat();
    const events = clearClusters(grid, clusters);
    flashCells(renderer, allClearedCells);

    const baseScore = allClearedCells.length * SCORE.clusterCell;
    const bonus = Math.max(0, clusters.length - 1) * SCORE.clusterBonus;
    gameState.score += baseScore + bonus;
    logEvent(gameState,
      clusters.length > 1
        ? `${clusters.length}x combo! +${baseScore + bonus} pts`
        : `Cluster! +${baseScore} pts`
    );
    spawnRevealedEntities(grid, events);
  }

  gameState.turnCount++;
  lastAutoTick = performance.now(); // reset auto-tick so entities don't double-move

  queueEntityMoves(() => {
    gameState.activePiece = clampPiece(
      { ...gameState.nextPiece, row: spawnRow, col: spawnCol }, grid
    );
    gameState.nextPiece = makePiece(gameState);

    if (!anyValidPlacement(grid, gameState.activePiece)) {
      gameState.phase = 'GAME_OVER';
      logEvent(gameState, 'No space left! Game over.');
    } else {
      gameState.phase = 'PLACING';
    }
  });
}

// ---------------------------------------------------------------------------
// Spawn entities freed by cluster clearing.
// Treasure value scales with clusterSize.
// ---------------------------------------------------------------------------
function spawnRevealedEntities(grid, events) {
  for (const { type, row, col, descriptor, clusterSize } of events) {

    if (type === 'monster') {
      const adv = gameState.adventurer;
      if (descriptor.monsterType === 'dragon') {
        const dist = Math.abs(row - adv.row) + Math.abs(col - adv.col);
        if (dist <= 2) { logEvent(gameState, 'A dragon lurks...'); continue; }
      }
      // Spawn at the exact cleared cell; cleared cells are guaranteed empty here
      const cell = getCell(grid, row, col);
      if (!cell || cell.entity) continue;
      const monster = createMonster(descriptor.monsterType, row, col, gameState.level);
      monster.justSpawned = true;   // skip movement this turn
      grid.monsters.push(monster);
      placeEntity(grid, row, col, 'monster', monster);
      logEvent(gameState, `A ${descriptor.monsterType} appears!`);
      continue;
    }

    if (type === 'rock') {
      const cell = getCell(grid, row, col);
      if (!cell || cell.entity) continue;
      placeEntity(grid, row, col, 'rock', { row, col });
      continue;
    }

    if (type === 'treasure') {
      // Spawn at the exact cleared cell
      const cell = getCell(grid, row, col);
      if (!cell || cell.entity) continue;
      // Scale gold value by cluster size; equipment unchanged
      const scaledValue = descriptor.treasureType === 'gold'
        ? Math.round(descriptor.value * (clusterSize / CLUSTER_MIN_SIZE))
        : descriptor.value;
      const treasure = createTreasure(descriptor.treasureType, scaledValue, row, col);
      grid.treasures.push(treasure);
      placeEntity(grid, row, col, 'treasure', treasure);
      continue;
    }
  }
}

// (findEmptyNear removed — entities now spawn at their exact cleared cell)

// ---------------------------------------------------------------------------
// Win condition check
// ---------------------------------------------------------------------------
function checkWin() {
  const adv = gameState.adventurer;
  const stairPos = gameState.grid.stairs;
  if (!stairPos) return false;
  if (adv.row === stairPos.row && adv.col === stairPos.col) {
    gameState.score += SCORE.levelComplete;
    gameState.phase = 'LEVEL_COMPLETE';
    logEvent(gameState, `Level ${gameState.level} complete! +${SCORE.levelComplete} pts`);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Check if the active piece has any valid placement on the grid
// ---------------------------------------------------------------------------
function anyValidPlacement(grid, piece) {
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const testPiece = { ...piece, row: r, col: c };
      if (isValidPlacement(testPiece, grid)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Mouse input
// ---------------------------------------------------------------------------
function canvasToGrid(e) {
  const canvas = renderer.canvas;
  const rect   = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const px = (e.clientX - rect.left)  * scaleX - renderer.offsetX;
  const py = (e.clientY - rect.top)   * scaleY - renderer.offsetY;
  return {
    col: Math.floor(px / renderer.cellSize),
    row: Math.floor(py / renderer.cellSize),
  };
}

function wireMouse() {
  // All three listeners are on document so they fire even when the cursor is
  // outside the canvas (piece is clamped to the playfield edge in that case).
  document.addEventListener('mousemove', e => {
    if (!gameState || gameState.phase !== 'PLACING' || !gameState.activePiece) return;
    const { row, col } = canvasToGrid(e);
    const piece = gameState.activePiece;
    // Find the minimum row/col offsets of the current rotation so the
    // top-left visible cell tracks the cursor rather than the anchor point.
    const cells = getPieceCells(piece);
    const minDr = Math.min(...cells.map(c => c.row - piece.row));
    const minDc = Math.min(...cells.map(c => c.col - piece.col));
    gameState.activePiece = clampPiece({ ...piece, row: row - minDr, col: col - minDc }, gameState.grid);
  });

  document.addEventListener('mousedown', e => {
    if (e.button === 0) {
      e.preventDefault();
      handleAction('place');
    }
  });

  document.addEventListener('contextmenu', e => {
    e.preventDefault();
    handleAction('rotateCW');
  });
}

// ---------------------------------------------------------------------------
// Keyboard input
// ---------------------------------------------------------------------------
function onKeyDown(e) {
  switch (e.key) {
    case 'ArrowLeft':  e.preventDefault(); handleAction('left');      break;
    case 'ArrowRight': e.preventDefault(); handleAction('right');     break;
    case 'ArrowUp':    e.preventDefault(); handleAction('up');        break;
    case 'ArrowDown':  e.preventDefault(); handleAction('down');      break;
    case ' ':          e.preventDefault(); handleAction('place');     break;
    case 'x': case 'X': handleAction('rotateCW');  break;
    case 'z': case 'Z': handleAction('rotateCCW'); break;
    case 'p': case 'P': handleAction('pause');     break;
    case 'r': case 'R': handleAction('restart');   break;
    case 'Enter':       handleAction('next-level'); break;
  }
}

// ---------------------------------------------------------------------------
// On-screen button wiring
// ---------------------------------------------------------------------------
function wireButtons() {
  const btns = {
    'btn-left':   'left',   'btn-right':  'right',
    'btn-up':     'up',     'btn-down':   'down',
    'btn-place':  'place',  'btn-rotcw':  'rotateCW',
    'btn-rotccw': 'rotateCCW',
  };
  for (const [id, action] of Object.entries(btns)) {
    const el = document.getElementById(id);
    if (!el) continue;
    const fire = e => { e.preventDefault(); handleAction(action); };
    el.addEventListener('touchstart', fire, { passive: false });
    el.addEventListener('mousedown',  fire);
  }
}

// ---------------------------------------------------------------------------
// Canvas drag-to-move touch support
// ---------------------------------------------------------------------------

// Convert a client-space touch coordinate to a grid {row, col}.
// Returns null when the touch is outside the grid area.
function screenToGrid(clientX, clientY) {
  const canvas = renderer.canvas;
  const rect   = canvas.getBoundingClientRect();
  // Account for CSS scaling of the canvas element
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const cx = (clientX - rect.left) * scaleX;
  const cy = (clientY - rect.top)  * scaleY;
  const col = Math.floor((cx - renderer.offsetX) / renderer.cellSize);
  const row = Math.floor((cy - renderer.offsetY) / renderer.cellSize);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
  return { row, col };
}

function onCanvasTouchStart(e) {
  if (gameState?.phase !== 'PLACING') return;
  const piece = gameState.activePiece;
  if (!piece) return;
  e.preventDefault();
  const t   = e.touches[0];
  const pos = screenToGrid(t.clientX, t.clientY);
  if (!pos) return;
  dragActive    = true;
  dragMoved     = false;
  dragStartX    = t.clientX;
  dragStartY    = t.clientY;
  dragOffsetRow = pos.row - piece.row;
  dragOffsetCol = pos.col - piece.col;
}

function onCanvasTouchMove(e) {
  if (!dragActive || gameState?.phase !== 'PLACING') return;
  e.preventDefault();
  const t = e.touches[0];
  // Only start moving the piece once the finger has travelled past the threshold
  if (!dragMoved) {
    const dx = t.clientX - dragStartX;
    const dy = t.clientY - dragStartY;
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    dragMoved = true;
  }
  const pos = screenToGrid(t.clientX, t.clientY);
  if (!pos) return;
  const piece    = gameState.activePiece;
  const newPiece = { ...piece, row: pos.row - dragOffsetRow, col: pos.col - dragOffsetCol };
  gameState.activePiece = clampPiece(newPiece, gameState.grid);
}

function onCanvasTouchEnd() {
  // Short tap (no significant movement) → rotate clockwise
  if (dragActive && !dragMoved) handleAction('rotateCW');
  dragActive = false;
  dragMoved  = false;
}

// ---------------------------------------------------------------------------
// Responsive layout
// ---------------------------------------------------------------------------
function applyLayout() {
  portrait = window.innerHeight > window.innerWidth;
  const container = document.getElementById('game-container');
  const btnPanel  = document.getElementById('btn-panel');
  const hudTop    = document.getElementById('hud-top');
  if (container) container.classList.toggle('portrait', portrait);
  if (btnPanel)  btnPanel.style.display  = portrait ? 'flex' : 'none';
  if (hudTop)    hudTop.style.display    = portrait ? 'flex' : 'none';
  layoutRenderer(renderer, portrait,
    gameState?.grid?.rows ?? ROWS, gameState?.grid?.cols ?? COLS);
}

// ---------------------------------------------------------------------------
// Game loop — executes one pending turn step per frame when animating;
// also fires automatic entity movement every AUTO_TICK_MS milliseconds.
// ---------------------------------------------------------------------------
function loop(timestamp) {
  if (gameState) {
    // Auto-tick: move entities once per second when idle
    if (gameState.phase === 'PLACING' && timestamp - lastAutoTick >= AUTO_TICK_MS) {
      lastAutoTick = timestamp;
      gameState.turnCount++;
      queueEntityMoves(() => { gameState.phase = 'PLACING'; });
    }

    if (gameState.phase === 'ANIMATING' && pendingSteps.length > 0) {
      const step = pendingSteps.shift();
      step();
      // If a step changed the phase (win / game-over), discard remaining steps
      if (gameState.phase !== 'ANIMATING') pendingSteps = [];
    }
    render(renderer, gameState);
    if (portrait && gameState.phase !== 'TITLE') updatePortraitHUD(gameState);
  }
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Title screen
// ---------------------------------------------------------------------------
function showTitle() {
  pendingSteps = [];
  gameState = { phase: 'TITLE' };
}

// ---------------------------------------------------------------------------
// Start / restart
// ---------------------------------------------------------------------------
function startGame() {
  pendingSteps = [];
  lastAutoTick = Infinity; // don't auto-tick until first piece is placed
  gameState = newGameState();
  initLevel(gameState, 1);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export function initGame() {
  const canvas = document.getElementById('game-canvas');
  renderer = createRenderer(canvas);

  applyLayout();
  window.addEventListener('resize', applyLayout);
  document.addEventListener('keydown', onKeyDown);
  wireButtons();
  wireMouse();

  // Canvas drag-to-move (touch)
  canvas.addEventListener('touchstart',  onCanvasTouchStart, { passive: false });
  canvas.addEventListener('touchmove',   onCanvasTouchMove,  { passive: false });
  canvas.addEventListener('touchend',    onCanvasTouchEnd);
  canvas.addEventListener('touchcancel', onCanvasTouchEnd);

  // Wait for Font Awesome to load before rendering any glyphs
  const fontSpec = '900 1em "Font Awesome 6 Free"';
  document.fonts.load(fontSpec)
    .catch(() => {}) // fallback: start anyway if load fails
    .finally(() => { showTitle(); loop(); });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGame);
} else {
  initGame();
}
