import { ADVENTURER_BASE, MONSTER_STATS, TREASURE_TYPES, ADVENTURER_MOVES, LOG_MAX } from './constants.js?v=20';
import { placeEntity, removeEntity, getCell } from './grid.js?v=20';
import { bfs, findNearest, isAdjacentCoords } from './pathfinding.js?v=20';

// ---------------------------------------------------------------------------
// Adventurer
// ---------------------------------------------------------------------------
export function createAdventurer(row, col) {
  return {
    row, col,
    hp: ADVENTURER_BASE.hp,
    maxHp: ADVENTURER_BASE.maxHp,
    attack: ADVENTURER_BASE.attack,
    defense: ADVENTURER_BASE.defense,
    gold: 0,
    alive: true,
    currentGoal: null,  // {row,col} of current navigation target — used by renderer
  };
}

export function adventurerAttack(adv)  { return adv.attack; }
export function adventurerDefense(adv) { return adv.defense; }

// ---------------------------------------------------------------------------
// Monster
// ---------------------------------------------------------------------------
// level controls max random attack/defense (0..level inclusive)
export function createMonster(monsterType, row, col, level = 1) {
  const stats = MONSTER_STATS[monsterType];
  return {
    type: monsterType,
    row, col,
    hp: stats.hp,
    maxHp: stats.hp,
    attack:  Math.floor(Math.random() * (level + 1)),
    defense: Math.floor(Math.random() * (level + 1)),
    xpValue: stats.xpValue,
    alive: true,
  };
}

// ---------------------------------------------------------------------------
// Treasure
// ---------------------------------------------------------------------------
export function createTreasure(treasureType, value, row, col) {
  return {
    type: treasureType,
    value,
    row, col,
    collected: false,
  };
}

// ---------------------------------------------------------------------------
// Adventurer AI turn
// Returns { moved: bool, trapped: bool }
// ---------------------------------------------------------------------------
export function runAdventurerTurn(adv, grid, gameState) {
  if (!adv.alive) return { moved: false, trapped: false };

  let movesLeft = ADVENTURER_MOVES;
  let moved = false;

  while (movesLeft > 0) {
    const step = computeNextStep(adv, grid, gameState);
    if (!step) break;

    // Check what's at the destination before moving
    const destCell = getCell(grid, step.row, step.col);

    // Never step into a monster's cell — stay adjacent and let combat resolve
    if (destCell && destCell.entity === 'monster') break;

    const destTreasure = (destCell && destCell.entity === 'treasure') ? destCell.entityRef : null;
    const isStairs     = destCell && destCell.entity === 'stairs';

    // Move adventurer
    removeEntity(grid, adv.row, adv.col);
    adv.row = step.row;
    adv.col = step.col;
    placeEntity(grid, adv.row, adv.col, 'adventurer', adv);
    moved = true;
    movesLeft--;

    if (destTreasure) collectTreasure(adv, destTreasure, grid, gameState);
    if (isStairs) break;
  }

  // Check trapped (no passable neighbors)
  const trapped = !moved && !hasPassableNeighbor(adv, grid);
  return { moved, trapped };
}

function computeNextStep(adv, grid, gameState) {
  // Always grab adjacent treasure for free (it's literally in our path)
  for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    const nr = adv.row + dr, nc = adv.col + dc;
    const cell = getCell(grid, nr, nc);
    if (cell && !cell.locked && cell.entity === 'treasure') {
      adv.currentGoal = { row: nr, col: nc };
      return { row: nr, col: nc };
    }
  }

  // Primary goal: stairs (head there directly if a path exists)
  if (grid.stairs) {
    const stairPath = bfs(grid, adv, grid.stairs, { forEntity: 'adventurer' });
    if (stairPath && stairPath.length > 0) {
      adv.currentGoal = { row: grid.stairs.row, col: grid.stairs.col };
      return stairPath[0];
    }
  }

  // Stairs unreachable — fall back to nearest treasure or killable monster
  const targets = [];
  for (const t of grid.treasures) {
    if (!t.collected) targets.push({ row: t.row, col: t.col });
  }
  for (const m of grid.monsters) {
    if (!m.alive) continue;
    const dmgToM   = Math.max(1, adventurerAttack(adv)  - m.defense);
    const dmgToAdv = Math.max(1, m.attack - adventurerDefense(adv));
    if (Math.ceil(m.hp / dmgToM) < Math.ceil(adv.hp / dmgToAdv)) {
      targets.push({ row: m.row, col: m.col });
    }
  }

  if (targets.length === 0) { adv.currentGoal = null; return null; }

  const result = findNearest(grid, adv, targets, { forEntity: 'adventurer' });
  if (!result || result.path.length === 0) { adv.currentGoal = null; return null; }

  adv.currentGoal = { row: result.target.row, col: result.target.col };
  return result.path[0];
}

function hasPassableNeighbor(adv, grid) {
  for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    const cell = getCell(grid, adv.row + dr, adv.col + dc);
    if (cell && !cell.locked && cell.entity !== 'monster') return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Treasure collection
// ---------------------------------------------------------------------------
export function collectTreasure(adv, treasure, grid, gameState) {
  if (!treasure || treasure.collected) return;
  treasure.collected = true;
  // Only clear the cell if it still holds the treasure reference.
  // If the adventurer already moved onto this cell, placeEntity has already
  // overwritten the treasure — removing it now would erase the adventurer.
  const cell = getCell(grid, treasure.row, treasure.col);
  if (cell && cell.entityRef === treasure) {
    removeEntity(grid, treasure.row, treasure.col);
  }

  switch (treasure.type) {
    case 'gold':
      adv.gold += treasure.value;
      gameState.score += treasure.value;
      logEvent(gameState, `Found ${treasure.value} gold!`);
      break;
    case 'sword':
      adv.attack += TREASURE_TYPES.sword.attackBonus;
      gameState.score += 5;
      logEvent(gameState, `Found a Sword! (ATK now ${adv.attack})`);
      break;
    case 'armor':
      adv.defense += TREASURE_TYPES.armor.defenseBonus;
      gameState.score += 5;
      logEvent(gameState, `Found a Shield! (DEF now ${adv.defense})`);
      break;
    case 'potion': {
      const restored = Math.min(TREASURE_TYPES.potion.hpRestore, adv.maxHp - adv.hp);
      adv.hp = Math.min(adv.maxHp, adv.hp + TREASURE_TYPES.potion.hpRestore);
      logEvent(gameState, `Drank a Potion! (+${restored} HP)`);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Monster AI — single monster (called per-frame for step-based animation)
// ---------------------------------------------------------------------------
export function runSingleMonsterTurn(monster, grid, gameState) {
  const adv = gameState.adventurer;
  if (!monster.alive) return;
  if (monster.justSpawned) { monster.justSpawned = false; return; }
  if (isAdjacentCoords(monster.row, monster.col, adv.row, adv.col)) return;

  const path = bfs(grid, monster, adv, { forEntity: 'monster', adjacentGoal: true });
  if (!path || path.length === 0) {
    // Can't reach adventurer — move to a random passable neighbour instead
    const dirs = [[-1,0],[1,0],[0,-1],[0,1]].sort(() => Math.random() - 0.5);
    for (const [dr, dc] of dirs) {
      const nr = monster.row + dr, nc = monster.col + dc;
      const nc2 = getCell(grid, nr, nc);
      if (nc2 && !nc2.locked && !nc2.entity) {
        removeEntity(grid, monster.row, monster.col);
        monster.row = nr; monster.col = nc;
        placeEntity(grid, nr, nc, 'monster', monster);
        break;
      }
    }
    return;
  }

  const step = path[0];
  const cell = getCell(grid, step.row, step.col);
  if (!cell || cell.locked || cell.entity) return;

  removeEntity(grid, monster.row, monster.col);
  monster.row = step.row;
  monster.col = step.col;
  placeEntity(grid, monster.row, monster.col, 'monster', monster);
}

// ---------------------------------------------------------------------------
// Monster AI turn (all monsters — kept for completeness)
// ---------------------------------------------------------------------------
export function runMonstersTurn(grid, gameState) {
  for (const monster of grid.monsters) {
    runSingleMonsterTurn(monster, grid, gameState);
  }
}

// ---------------------------------------------------------------------------
// Combat resolution
// ---------------------------------------------------------------------------
export function resolveCombat(grid, gameState) {
  const adv = gameState.adventurer;
  if (!adv.alive) return;

  for (const monster of grid.monsters) {
    if (!monster.alive) continue;
    if (!isAdjacentCoords(adv.row, adv.col, monster.row, monster.col)) continue;

    // Adventurer attacks monster
    const dmgToMonster = Math.max(1, adventurerAttack(adv) - monster.defense);
    monster.hp -= dmgToMonster;
    logEvent(gameState, `Hit ${monster.type} for ${dmgToMonster} dmg (${Math.max(0,monster.hp)} HP left)`);

    if (monster.hp <= 0) {
      monster.alive = false;
      removeEntity(grid, monster.row, monster.col);
      gameState.score += monster.xpValue;
      logEvent(gameState, `${capitalize(monster.type)} defeated! +${monster.xpValue} pts`);
      continue;
    }

    // Monster counter-attacks
    const dmgToAdv = Math.max(1, monster.attack - adventurerDefense(adv));
    adv.hp -= dmgToAdv;
    logEvent(gameState, `${capitalize(monster.type)} hits for ${dmgToAdv} dmg (${Math.max(0,adv.hp)} HP left)`);

    if (adv.hp <= 0) {
      adv.alive = false;
      gameState.phase = 'GAME_OVER';
      logEvent(gameState, 'The adventurer has fallen!');
      return;
    }
  }

  // Remove dead monsters from array
  grid.monsters = grid.monsters.filter(m => m.alive);
}

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------
export function logEvent(gameState, message) {
  gameState.eventLog.unshift(message);
  if (gameState.eventLog.length > LOG_MAX) {
    gameState.eventLog.length = LOG_MAX;
  }
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
