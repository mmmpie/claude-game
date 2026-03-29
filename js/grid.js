import { COLS, ROWS, CLUSTER_MIN_SIZE, COLOR_MONSTER } from './constants.js?v=16';

// ---------------------------------------------------------------------------
// Cell factory
// ---------------------------------------------------------------------------
function makeCell() {
  return {
    color: null,       // 'red'|'blue'|'green'|'yellow'|null
    locked: false,     // true when occupied by a placed tetromino cell
    content: null,     // ContentDescriptor — set at piece placement, visible immediately
    entity: null,      // 'adventurer'|'monster'|'treasure'|'stairs'|null (active entities)
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
    monsters: [],
    treasures: [],
    stairs: null,  // {row, col} once freed by cluster clear
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
// Generate content for a single piece cell at instantiation time.
// Monster type is determined by the piece colour.
// Stairs is never produced here — it is placed directly on the playfield.
// ---------------------------------------------------------------------------
export function generateCellContent(level, color) {
  const r = Math.random();
  if (r < 0.35) {
    const monsterType = COLOR_MONSTER[color] || 'ghost';
    return { type: 'monster', monsterType };
  }
  if (r < 0.60) {
    const ttypes = ['gold', 'gold', 'gold', 'potion', 'sword', 'armor'];
    const ttype = ttypes[Math.floor(Math.random() * ttypes.length)];
    const value = ttype === 'gold' ? 5 + Math.floor(Math.random() * 16) : 0;
    return { type: 'treasure', treasureType: ttype, value };
  }
  return null;
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
// Clear clusters — returns SpawnEvents for cell contents
// Each SpawnEvent includes clusterSize so treasure value can be scaled.
// ---------------------------------------------------------------------------
export function clearClusters(grid, clusters) {
  const events = [];
  for (const cluster of clusters) {
    const clusterSize = cluster.length;
    for (const { row, col } of cluster) {
      const cell = grid.cells[row][col];
      if (cell.content) {
        events.push({ type: cell.content.type, row, col, descriptor: cell.content, clusterSize });
      }
      // Clear the block
      cell.color = null;
      cell.locked = false;
      cell.content = null;
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Passability check
// ---------------------------------------------------------------------------
export function isPassable(grid, row, col, forEntity) {
  if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) return false;
  const cell = grid.cells[row][col];
  if (cell.locked) return false;
  if (cell.entity === 'monster') return false;
  // Monsters cannot enter cells occupied by the adventurer, treasure, or stairs
  if (forEntity === 'monster' && cell.entity) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Entity placement helpers
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


