import { COLS, ROWS, CLUSTER_MIN_SIZE, CONTENT_PROB, LEVEL_CONFIG, monsterWeights, TETROMINO_TYPES, COLOR_NAMES, ADVENTURER_BASE } from './constants.js';

// ---------------------------------------------------------------------------
// Cell factory
// ---------------------------------------------------------------------------
function makeCell() {
  return {
    color: null,       // 'red'|'blue'|'green'|'yellow'|null
    locked: false,     // true when occupied by a placed tetromino cell
    content: null,     // ContentDescriptor — hidden until cluster cleared
    revealed: false,   // true after cluster clear reveals content
    entity: null,      // 'adventurer'|'monster'|'treasure'|'stairs'|null
    entityRef: null,   // pointer to live entity object
  };
}

// ---------------------------------------------------------------------------
// Grid factory
// ---------------------------------------------------------------------------
export function createGrid() {
  const cells = [];
  for (let r = 0; r < ROWS; r++) {
    cells.push([]);
    for (let c = 0; c < COLS; c++) {
      cells[r].push(makeCell());
    }
  }
  return {
    cols: COLS,
    rows: ROWS,
    cells,
    contentPool: [],
    contentPoolIndex: 0,
    monsters: [],
    treasures: [],
    stairs: null,  // {row, col} when revealed
  };
}

// ---------------------------------------------------------------------------
// Cell accessors
// ---------------------------------------------------------------------------
export function getCell(grid, row, col) {
  if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) return null;
  return grid.cells[row][col];
}

export function setCell(grid, row, col, fields) {
  const cell = grid.cells[row][col];
  Object.assign(cell, fields);
}

// ---------------------------------------------------------------------------
// Cluster detection — BFS flood fill
// ---------------------------------------------------------------------------
export function findClusters(grid) {
  const visited = new Set();
  const clusters = [];

  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const key = `${r},${c}`;
      const cell = grid.cells[r][c];
      if (!cell.locked || cell.color === null || visited.has(key)) continue;

      // BFS from this seed
      const cluster = [];
      const queue = [{ row: r, col: c }];
      visited.add(key);

      while (queue.length > 0) {
        const cur = queue.shift();
        cluster.push(cur);
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const nr = cur.row + dr;
          const nc = cur.col + dc;
          const nKey = `${nr},${nc}`;
          if (visited.has(nKey)) continue;
          const nb = getCell(grid, nr, nc);
          if (!nb || !nb.locked || nb.color !== cell.color) continue;
          visited.add(nKey);
          queue.push({ row: nr, col: nc });
        }
      }

      if (cluster.length >= CLUSTER_MIN_SIZE) {
        clusters.push(cluster);
      }
    }
  }
  return clusters;
}

// ---------------------------------------------------------------------------
// Clear clusters — returns SpawnEvents for revealed contents
// ---------------------------------------------------------------------------
export function clearClusters(grid, clusters) {
  const events = [];
  for (const cluster of clusters) {
    for (const { row, col } of cluster) {
      const cell = grid.cells[row][col];
      const ev = revealCell(grid, row, col, cell);
      if (ev) events.push(ev);
      // Clear the block
      cell.color = null;
      cell.locked = false;
    }
  }
  return events;
}

function revealCell(grid, row, col, cell) {
  if (!cell.content || cell.content.type === 'nothing') return null;
  cell.revealed = true;
  return { type: cell.content.type, row, col, descriptor: cell.content };
}

// ---------------------------------------------------------------------------
// Passability check
// ---------------------------------------------------------------------------
// forEntity: 'adventurer' | 'monster'
export function isPassable(grid, row, col, forEntity) {
  if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) return false;
  const cell = grid.cells[row][col];
  if (cell.locked) return false;
  if (cell.entity === 'monster') return false;
  if (forEntity === 'monster' && cell.entity === 'adventurer') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Place entity on grid
// ---------------------------------------------------------------------------
export function placeEntity(grid, row, col, entityType, entityRef) {
  const cell = grid.cells[row][col];
  cell.entity = entityType;
  cell.entityRef = entityRef;
}

export function removeEntity(grid, row, col) {
  const cell = grid.cells[row][col];
  cell.entity = null;
  cell.entityRef = null;
}

// ---------------------------------------------------------------------------
// Level content pool seeding
// ---------------------------------------------------------------------------
export function seedContentPool(level) {
  const pool = [];

  const monsterCount = LEVEL_CONFIG.monstersBase + level * LEVEL_CONFIG.monstersPerLevel;
  const treasureCount = LEVEL_CONFIG.treasuresBase + (level - 1) * LEVEL_CONFIG.treasuresPerLevel;
  const weights = monsterWeights(level);

  for (let i = 0; i < monsterCount; i++) {
    pool.push({ type: 'monster', monsterType: weightedPick(weights) });
  }

  const treasureTypes = ['gold', 'gold', 'gold', 'potion', 'sword', 'armor'];
  for (let i = 0; i < treasureCount; i++) {
    const ttype = treasureTypes[Math.floor(Math.random() * treasureTypes.length)];
    const value = ttype === 'gold' ? 5 + Math.floor(Math.random() * 16) : 0;
    pool.push({ type: 'treasure', treasureType: ttype, value });
  }

  // One stairs, placed in the middle third
  const stairsIdx = Math.floor(pool.length / 3) + Math.floor(Math.random() * Math.floor(pool.length / 3));
  shuffle(pool);
  // Ensure stairs isn't at extremes — swap into middle third
  const stairsItem = { type: 'stairs' };
  const insertAt = Math.floor(pool.length * 0.33) + Math.floor(Math.random() * Math.floor(pool.length * 0.34));
  pool.splice(insertAt, 0, stairsItem);

  return pool;
}

// ---------------------------------------------------------------------------
// Draw from pool when locking a cell
// ---------------------------------------------------------------------------
export function drawContent(grid) {
  if (grid.contentPoolIndex >= grid.contentPool.length) return null;
  if (Math.random() > CONTENT_PROB) return null;
  return grid.contentPool[grid.contentPoolIndex++];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function weightedPick(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const [key, w] of Object.entries(weights)) {
    r -= w;
    if (r <= 0) return key;
  }
  return Object.keys(weights)[0];
}
