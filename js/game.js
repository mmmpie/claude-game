import { COLS, ROWS, SCORE, CLUSTER_MIN_SIZE } from './constants.js';
import { createGrid, findClusters, clearClusters, placeEntity, removeEntity, getCell, generateCellContent } from './grid.js';
import { createPiece, getPieceCells, movePiece, rotatePiece, isValidPlacement, lockPiece, randomType, randomColor, clampPiece } from './tetromino.js';
import { createAdventurer, createMonster, createTreasure, runAdventurerTurn, runMonstersTurn, resolveCombat, collectTreasure, logEvent } from './entities.js';
import { createRenderer, layoutRenderer, render, flashCells, updatePortraitHUD } from './renderer.js';

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
let gameState = null;
let renderer  = null;
let portrait  = false;

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

  const grid = createGrid();
  state.grid = grid;

  // Spawn adventurer at bottom-center
  const advRow = ROWS - 2;
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

  // Place stairs visibly on the playfield at level start.
  // Pick a random cell in the top half of the grid, away from the adventurer.
  const stairsPos = pickStairsPosition(grid, adv);
  grid.stairs = stairsPos;
  placeEntity(grid, stairsPos.row, stairsPos.col, 'stairs', stairsPos);

  state.activePiece = makePiece(state);
  state.nextPiece   = makePiece(state);

  logEvent(state, `=== Level ${levelNum} ===`);
}

function pickStairsPosition(grid, adv) {
  // Collect all empty cells in the top half, at least 3 rows from adventurer
  const candidates = [];
  for (let r = 0; r < Math.floor(ROWS / 2); r++) {
    for (let c = 0; c < COLS; c++) {
      const dist = Math.abs(r - adv.row) + Math.abs(c - adv.col);
      const cell = getCell(grid, r, c);
      if (cell && !cell.entity && dist >= 4) candidates.push({ row: r, col: c });
    }
  }
  if (candidates.length === 0) {
    // Fallback: any empty cell except adventurer's
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const cell = getCell(grid, r, c);
        if (cell && !cell.entity) return { row: r, col: c };
      }
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
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
  const cellContents = Array.from({ length: 4 }, () =>
    generateCellContent(gameState.level)
  );
  return createPiece(randomType(), randomColor(), cellContents);
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
  if (action === 'restart' && phase === 'GAME_OVER') { startGame(); return; }
  if (action === 'next-level' && phase === 'LEVEL_COMPLETE') {
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
// Place the active piece — core turn sequence
// ---------------------------------------------------------------------------
function placePiece() {
  const { activePiece, grid } = gameState;
  if (!isValidPlacement(activePiece, grid)) return;

  lockPiece(activePiece, grid);

  // Cluster detection + clearing
  const clusters = findClusters(grid);
  let allClearedCells = [];
  if (clusters.length > 0) {
    for (const cluster of clusters) allClearedCells = allClearedCells.concat(cluster);
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

  const { trapped } = runAdventurerTurn(gameState.adventurer, grid, gameState);
  if (trapped) logEvent(gameState, 'Adventurer is trapped!');

  if (checkWin()) return;

  runMonstersTurn(grid, gameState);
  resolveCombat(grid, gameState);

  if (gameState.phase === 'GAME_OVER') return;
  if (checkWin()) return;

  gameState.activePiece = gameState.nextPiece;
  gameState.nextPiece   = makePiece(gameState);

  if (!anyValidPlacement(grid, gameState.activePiece)) {
    gameState.phase = 'GAME_OVER';
    logEvent(gameState, 'No space left! Game over.');
  }
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
      // Scale gold value by cluster size; equipment unchanged
      const scaledValue = descriptor.treasureType === 'gold'
        ? Math.round(descriptor.value * (clusterSize / CLUSTER_MIN_SIZE))
        : descriptor.value;
      const treasure = createTreasure(descriptor.treasureType, scaledValue, pos.row, pos.col);
      grid.treasures.push(treasure);
      placeEntity(grid, pos.row, pos.col, 'treasure', treasure);
      continue;
    }
  }
}

// ---------------------------------------------------------------------------
// BFS outward search for nearest empty unlocked cell
// ---------------------------------------------------------------------------
function findEmptyNear(grid, row, col) {
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
    if (visited.size > 80) break;
  }
  return null;
}

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
// Game loop
// ---------------------------------------------------------------------------
function loop() {
  if (gameState) {
    render(renderer, gameState);
    if (portrait) updatePortraitHUD(gameState);
  }
  requestAnimationFrame(loop);
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGame);
} else {
  initGame();
}
