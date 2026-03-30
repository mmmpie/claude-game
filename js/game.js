import { COLS, ROWS, SCORE, CLUSTER_MIN_SIZE } from './constants.js?v=25';
import { createGrid, findClusters, clearClusters, placeEntity, removeEntity, getCell, generatePieceContents, generateForcedPieceContents } from './grid.js?v=25';
import { createPiece, getPieceCells, movePiece, rotatePiece, isValidPlacement, lockPiece, randomType, randomColor, clampPiece } from './tetromino.js?v=25';
import { createAdventurer, createMonster, createTreasure, runAdventurerTurn, runSingleMonsterTurn, resolveCombat, collectTreasure, logEvent } from './entities.js?v=25';
import { createRenderer, layoutRenderer, render, flashCells, updatePortraitHUD } from './renderer.js?v=25';

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
function initLevel(state, levelNum) {
  state.level = levelNum;
  state.phase = 'PLACING';
  state.turnCount = 0;
  lastAutoTick = Infinity; // wait for first piece placement each level

  const grid = createGrid();
  state.grid = grid;

  // Spawn adventurer at center of playfield
  const advRow = Math.floor(ROWS / 2);
  const advCol = Math.floor(COLS / 2);
  const adv = levelNum === 1
    ? createAdventurer(advRow, advCol)
    : state.adventurer;

  removeEntitySafe(grid, adv);
  adv.row = advRow;
  adv.col = advCol;
  adv.alive = true;
  state.adventurer = adv;
  placeEntity(grid, advRow, advCol, 'adventurer', adv);

  grid.monsters = [];
  grid.treasures = [];
  grid.stairs = null;

  // Place stairs in a random corner
  const stairsPos = pickStairsCorner();
  grid.stairs = stairsPos;
  placeEntity(grid, stairsPos.row, stairsPos.col, 'stairs', stairsPos);

  // Seed the playfield — more pieces each level (capped at 6)
  const seedCount = Math.min(levelNum, 6);
  for (let i = 0; i < seedCount; i++) placeSeedPiece(state, grid);

  // First piece spawns near the adventurer (piece origin = adv position offset by -1)
  state.activePiece = clampPiece({ ...makePiece(state), row: advRow - 1, col: advCol - 1 });
  state.nextPiece   = makePiece(state);

  logEvent(state, `=== Level ${levelNum} ===`);
}

function pickStairsCorner() {
  const corners = [
    { row: 0,        col: 0        },
    { row: 0,        col: COLS - 1 },
    { row: ROWS - 1, col: 0        },
    { row: ROWS - 1, col: COLS - 1 },
  ];
  return corners[Math.floor(Math.random() * corners.length)];
}

// ---------------------------------------------------------------------------
// Seed piece — one pre-placed tetromino with forced content on every cell
// ---------------------------------------------------------------------------
function placeSeedPiece(state, grid) {
  const type  = randomType();
  const color = randomColor();
  // Every cell must contain a monster or treasure — unique types per piece
  const cellContents = generateForcedPieceContents(state.level, color);

  // Try random positions; try all rotations at each — grid is nearly empty
  // so a valid placement is found quickly
  for (let attempt = 0; attempt < 100; attempt++) {
    const row = Math.floor(Math.random() * ROWS);
    const col = Math.floor(Math.random() * COLS);
    let piece = { type, color, rotationIndex: 0, row, col, cellContents };
    for (let r = 0; r < 4; r++) {
      if (isValidPlacement(piece, grid)) {
        lockPiece(piece, grid);
        return;
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

  gameState.activePiece = clampPiece(newPiece);
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

  // Remember spawn position before we clear the active piece
  const spawnRow = activePiece.row;
  const spawnCol = activePiece.col;

  lockPiece(activePiece, grid);
  gameState.activePiece = null;   // hide ghost piece while animating

  // Cluster detection + clearing
  const clusters = findClusters(grid);
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
      { ...gameState.nextPiece, row: spawnRow, col: spawnCol }
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
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const testPiece = { ...piece, row: r, col: c };
      if (isValidPlacement(testPiece, grid)) return true;
    }
  }
  return false;
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
  gameState.activePiece = clampPiece(newPiece);
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
  layoutRenderer(renderer, portrait);
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
    if (portrait) updatePortraitHUD(gameState);
  }
  requestAnimationFrame(loop);
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

  // Canvas drag-to-move (touch)
  canvas.addEventListener('touchstart',  onCanvasTouchStart, { passive: false });
  canvas.addEventListener('touchmove',   onCanvasTouchMove,  { passive: false });
  canvas.addEventListener('touchend',    onCanvasTouchEnd);
  canvas.addEventListener('touchcancel', onCanvasTouchEnd);

  // Wait for Font Awesome to load before rendering any glyphs
  const fontSpec = '900 1em "Font Awesome 6 Free"';
  document.fonts.load(fontSpec)
    .catch(() => {}) // fallback: start anyway if load fails
    .finally(() => { startGame(); loop(); });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGame);
} else {
  initGame();
}
