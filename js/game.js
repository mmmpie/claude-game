import { COLS, ROWS, SCORE, COLOR_NAMES } from './constants.js';
import { createGrid, findClusters, clearClusters, placeEntity, removeEntity, getCell, seedContentPool } from './grid.js';
import { createPiece, getPieceCells, movePiece, rotatePiece, isValidPlacement, lockPiece, randomType, randomColor, clampPiece } from './tetromino.js';
import { createAdventurer, createMonster, createTreasure, runAdventurerTurn, runMonstersTurn, resolveCombat, collectTreasure, logEvent } from './entities.js';
import { createRenderer, layoutRenderer, render, flashCells, updatePortraitHUD } from './renderer.js';

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
let gameState = null;
let renderer  = null;
let portrait  = false;
let animFrameId = null;

function newGameState() {
  return {
    phase: 'PLACING',  // 'PLACING' | 'GAME_OVER' | 'LEVEL_COMPLETE' | 'PAUSED'
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

  const grid = createGrid();
  grid.contentPool = seedContentPool(levelNum);
  grid.contentPoolIndex = 0;
  state.grid = grid;

  // Spawn adventurer at bottom-center
  const advRow = ROWS - 2;
  const advCol = Math.floor(COLS / 2);
  const adv = state.level === 1
    ? createAdventurer(advRow, advCol)
    : state.adventurer;  // carry over between levels

  // Reset position for carried-over adventurer
  removeEntitySafe(grid, adv);
  adv.row = advRow;
  adv.col = advCol;
  adv.alive = true;
  state.adventurer = adv;
  placeEntity(grid, advRow, advCol, 'adventurer', adv);

  // Clear monsters/treasures/stairs from previous level
  grid.monsters = [];
  grid.treasures = [];
  grid.stairs = null;

  // Spawn first and next piece
  state.activePiece = makePiece();
  state.nextPiece   = makePiece();

  logEvent(state, `=== Level ${levelNum} ===`);
}

function removeEntitySafe(grid, entity) {
  if (!entity) return;
  const cell = getCell(grid, entity.row, entity.col);
  if (cell && cell.entityRef === entity) {
    removeEntity(grid, entity.row, entity.col);
  }
}

function makePiece() {
  return createPiece(randomType(), randomColor());
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

  if (action === 'restart' && phase === 'GAME_OVER') {
    startGame();
    return;
  }

  if (action === 'next-level' && phase === 'LEVEL_COMPLETE') {
    initLevel(gameState, gameState.level + 1);
    return;
  }

  if (phase !== 'PLACING') return;

  const piece = gameState.activePiece;
  if (!piece) return;

  let newPiece = piece;
  switch (action) {
    case 'left':   newPiece = movePiece(piece, 0, -1); break;
    case 'right':  newPiece = movePiece(piece, 0,  1); break;
    case 'up':     newPiece = movePiece(piece, -1, 0); break;
    case 'down':   newPiece = movePiece(piece,  1, 0); break;
    case 'rotateCW':  newPiece = rotatePiece(piece,  1); break;
    case 'rotateCCW': newPiece = rotatePiece(piece, -1); break;
    case 'place':  placePiece(); return;
    default: return;
  }

  // Clamp to grid bounds after move/rotate
  newPiece = clampPiece(newPiece);
  gameState.activePiece = newPiece;
}

function placePiece() {
  const { activePiece, grid } = gameState;
  if (!isValidPlacement(activePiece, grid)) return;

  // Lock piece
  lockPiece(activePiece, grid);

  // Cluster detection + clearing
  const clusters = findClusters(grid);
  let clearedCells = [];
  if (clusters.length > 0) {
    for (const cluster of clusters) clearedCells = clearedCells.concat(cluster);
    const events = clearClusters(grid, clusters);
    flashCells(renderer, clearedCells);

    // Score for clusters
    const baseScore = clearedCells.length * SCORE.clusterCell;
    const bonus = Math.max(0, clusters.length - 1) * SCORE.clusterBonus;
    gameState.score += baseScore + bonus;
    if (clusters.length > 1) {
      logEvent(gameState, `${clusters.length}x cluster! +${baseScore + bonus} pts`);
    } else {
      logEvent(gameState, `Cluster cleared! +${baseScore} pts`);
    }

    // Spawn revealed entities
    spawnRevealedEntities(grid, events);
  }

  gameState.turnCount++;

  // Entity turns
  const { moved, trapped } = runAdventurerTurn(gameState.adventurer, grid, gameState);
  if (trapped) logEvent(gameState, 'Adventurer is trapped!');

  // Check win (adventurer on stairs)
  if (checkWin()) return;

  runMonstersTurn(grid, gameState);
  resolveCombat(grid, gameState);

  if (gameState.phase === 'GAME_OVER') return;

  // Check win again after combat (edge case: adventurer pushed onto stairs somehow)
  if (checkWin()) return;

  // Next piece
  gameState.activePiece = gameState.nextPiece;
  gameState.nextPiece   = makePiece();

  // Check if no valid placement exists anywhere → GAME_OVER
  if (!anyValidPlacement(grid, gameState.activePiece)) {
    gameState.phase = 'GAME_OVER';
    logEvent(gameState, 'No space left! Game over.');
  }
}

function spawnRevealedEntities(grid, events) {
  for (const ev of events) {
    const { type, row, col, descriptor } = ev;

    if (type === 'stairs') {
      // Find nearest empty cell to place stairs
      const pos = findEmptyNear(grid, row, col);
      if (!pos) continue;
      grid.stairs = pos;
      placeEntity(grid, pos.row, pos.col, 'stairs', { row: pos.row, col: pos.col });
      logEvent(gameState, 'Stairs to next level revealed!');
      continue;
    }

    if (type === 'monster') {
      const adv = gameState.adventurer;
      // Don't spawn adjacent to adventurer if it's a dragon
      if (descriptor.monsterType === 'dragon') {
        const dist = Math.abs(row - adv.row) + Math.abs(col - adv.col);
        if (dist <= 2) {
          // Defer — put back in pool (simple: just skip)
          logEvent(gameState, 'A dragon lurks nearby...');
          continue;
        }
      }
      const pos = findEmptyNear(grid, row, col);
      if (!pos) continue;
      const monster = createMonster(descriptor.monsterType, pos.row, pos.col);
      grid.monsters.push(monster);
      placeEntity(grid, pos.row, pos.col, 'monster', monster);
      logEvent(gameState, `A ${descriptor.monsterType} appears!`);
      continue;
    }

    if (type === 'treasure') {
      const pos = findEmptyNear(grid, row, col);
      if (!pos) continue;
      const treasure = createTreasure(descriptor.treasureType, descriptor.value, pos.row, pos.col);
      grid.treasures.push(treasure);
      placeEntity(grid, pos.row, pos.col, 'treasure', treasure);
      continue;
    }
  }
}

function findEmptyNear(grid, row, col) {
  // Spiral search outward for an unoccupied, unlocked cell
  const visited = new Set();
  const queue = [{ row, col }];
  visited.add(`${row},${col}`);
  while (queue.length > 0) {
    const cur = queue.shift();
    const cell = getCell(grid, cur.row, cur.col);
    if (cell && !cell.locked && !cell.entity) return cur;
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
      const nr = cur.row + dr, nc = cur.col + dc;
      const key = `${nr},${nc}`;
      if (visited.has(key)) continue;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
      visited.add(key);
      queue.push({ row: nr, col: nc });
    }
    if (visited.size > 60) break; // give up after searching ~60 cells
  }
  return null;
}

function checkWin() {
  const adv = gameState.adventurer;
  const cell = getCell(gameState.grid, adv.row, adv.col);
  if (cell && cell.entity === 'stairs') {
    gameState.score += SCORE.levelComplete;
    gameState.phase = 'LEVEL_COMPLETE';
    logEvent(gameState, `Level ${gameState.level} complete! +${SCORE.levelComplete} pts`);
    return true;
  }
  // Also check if adventurer IS at stairs position
  if (gameState.grid.stairs &&
      adv.row === gameState.grid.stairs.row &&
      adv.col === gameState.grid.stairs.col) {
    gameState.score += SCORE.levelComplete;
    gameState.phase = 'LEVEL_COMPLETE';
    logEvent(gameState, `Level ${gameState.level} complete! +${SCORE.levelComplete} pts`);
    return true;
  }
  return false;
}

function anyValidPlacement(grid, piece) {
  // Sample a subset of positions rather than all ROWS*COLS (performance)
  for (let r = 0; r < ROWS - 2; r += 2) {
    for (let c = 0; c < COLS - 2; c += 2) {
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
    case 'Enter':       handleAction('next-level');break;
  }
}

// ---------------------------------------------------------------------------
// On-screen button wiring
// ---------------------------------------------------------------------------
function wireButtons() {
  const btns = {
    'btn-left':   'left',
    'btn-right':  'right',
    'btn-up':     'up',
    'btn-down':   'down',
    'btn-place':  'place',
    'btn-rotcw':  'rotateCW',
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
// Responsive layout
// ---------------------------------------------------------------------------
function detectPortrait() {
  return window.innerHeight > window.innerWidth;
}

function applyLayout() {
  portrait = detectPortrait();
  const container = document.getElementById('game-container');
  const btnPanel  = document.getElementById('btn-panel');
  const hudTop    = document.getElementById('hud-top');
  if (container) container.classList.toggle('portrait', portrait);
  if (btnPanel)  btnPanel.style.display  = portrait ? 'flex' : 'none';
  if (hudTop)    hudTop.style.display    = portrait ? 'flex' : 'none';
  layoutRenderer(renderer, portrait);
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------
function loop() {
  if (gameState) {
    render(renderer, gameState);
    if (portrait && gameState.phase !== 'GAME_OVER') {
      updatePortraitHUD(gameState);
    }
  }
  animFrameId = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Start / restart
// ---------------------------------------------------------------------------
function startGame() {
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

  startGame();
  loop();
}

// Auto-init on DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGame);
} else {
  initGame();
}
