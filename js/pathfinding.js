import { isPassable } from './grid.js?v=17';

const DIRS = [[-1,0],[1,0],[0,-1],[0,1]];

// ---------------------------------------------------------------------------
// BFS from start toward goal.
// options.forEntity: 'adventurer' | 'monster'
// options.adjacentGoal: if true, stop when adjacent to goal (for combat approach)
// Returns array of {row,col} steps from start (exclusive) to goal (inclusive),
// or null if unreachable.
// ---------------------------------------------------------------------------
export function bfs(grid, start, goal, options = {}) {
  const { forEntity = 'adventurer', adjacentGoal = false } = options;
  const key = (r, c) => r * 1000 + c;
  const startKey = key(start.row, start.col);
  const goalKey  = key(goal.row,  goal.col);

  const visited = new Map();
  const queue = [{ row: start.row, col: start.col, parent: null }];
  visited.set(startKey, queue[0]);

  while (queue.length > 0) {
    const cur = queue.shift();
    const curKey = key(cur.row, cur.col);

    // Check termination
    if (adjacentGoal) {
      if (isAdjacentCoords(cur.row, cur.col, goal.row, goal.col)) {
        return reconstructPath(cur);
      }
    } else {
      if (curKey === goalKey) {
        return reconstructPath(cur);
      }
    }

    for (const [dr, dc] of DIRS) {
      const nr = cur.row + dr;
      const nc = cur.col + dc;
      const nKey = key(nr, nc);
      if (visited.has(nKey)) continue;

      // Goal cell is always reachable regardless of passability
      const isGoal = (nr === goal.row && nc === goal.col);
      if (!isGoal && !isPassable(grid, nr, nc, forEntity)) continue;

      const entry = { row: nr, col: nc, parent: cur };
      visited.set(nKey, entry);
      queue.push(entry);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Find nearest reachable target from a list of candidates.
// Runs a single BFS outward from `from`, returns first candidate hit.
// Returns { target, path } or null.
// ---------------------------------------------------------------------------
export function findNearest(grid, from, candidates, options = {}) {
  if (candidates.length === 0) return null;

  const { forEntity = 'adventurer' } = options;
  const candidateSet = new Set(candidates.map(c => c.row * 1000 + c.col));
  const candidateMap = new Map(candidates.map(c => [c.row * 1000 + c.col, c]));

  const key = (r, c) => r * 1000 + c;
  const visited = new Map();
  const queue = [{ row: from.row, col: from.col, parent: null }];
  visited.set(key(from.row, from.col), queue[0]);

  while (queue.length > 0) {
    const cur = queue.shift();
    const curKey = key(cur.row, cur.col);

    if (candidateSet.has(curKey) && (cur.row !== from.row || cur.col !== from.col)) {
      return {
        target: candidateMap.get(curKey),
        path: reconstructPath(cur),
      };
    }

    for (const [dr, dc] of DIRS) {
      const nr = cur.row + dr;
      const nc = cur.col + dc;
      const nKey = key(nr, nc);
      if (visited.has(nKey)) continue;

      const isCandidate = candidateSet.has(nKey);
      if (!isCandidate && !isPassable(grid, nr, nc, forEntity)) continue;

      const entry = { row: nr, col: nc, parent: cur };
      visited.set(nKey, entry);
      queue.push(entry);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function reconstructPath(goalEntry) {
  const path = [];
  let node = goalEntry;
  while (node.parent !== null) {
    path.unshift({ row: node.row, col: node.col });
    node = node.parent;
  }
  return path;
}

export function isAdjacentCoords(r1, c1, r2, c2) {
  return Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1;
}
