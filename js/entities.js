import { ADVENTURER_BASE, MONSTER_STATS, TREASURE_TYPES, ADVENTURER_MOVES, LOG_MAX } from './constants.js?v=4';
import { placeEntity, removeEntity, getCell } from './grid.js?v=4';
import { bfs, findNearest, isAdjacentCoords } from './pathfinding.js?v=4';

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
    sword: null,   // { attackBonus }
    armor: null,   // { defenseBonus }
    alive: true,
  };
}

export function adventurerAttack(adv) {
  return adv.attack + (adv.sword ? adv.sword.attackBonus : 0);
}

export function adventurerDefense(adv) {
  return adv.defense + (adv.armor ? adv.armor.defenseBonus : 0);
}

// ---------------------------------------------------------------------------
// Monster
// ---------------------------------------------------------------------------
export function createMonster(monsterType, row, col) {
  const stats = MONSTER_STATS[monsterType];
  return {
    type: monsterType,
    row, col,
    hp: stats.hp,
    maxHp: stats.hp,
    attack: stats.attack,
    defense: stats.defense,
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
  // Priority 1: adjacent treasure (only if not blocked by a wall)
  for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    const nr = adv.row + dr, nc = adv.col + dc;
    const cell = getCell(grid, nr, nc);
    if (cell && !cell.locked && cell.entity === 'treasure') return { row: nr, col: nc };
  }

  // Gather all visible treasures and stairs as targets
  const targets = [];
  for (const t of grid.treasures) {
    if (!t.collected) targets.push({ row: t.row, col: t.col, priority: 2 });
  }
  if (grid.stairs) targets.push({ row: grid.stairs.row, col: grid.stairs.col, priority: 3 });

  // Killable monsters (adventurer can kill them before they kill us)
  for (const m of grid.monsters) {
    if (!m.alive) continue;
    const dmgToM = Math.max(1, adventurerAttack(adv) - m.defense);
    const dmgToAdv = Math.max(1, m.attack - adventurerDefense(adv));
    const turnsToKillM = Math.ceil(m.hp / dmgToM);
    const turnsToKillAdv = Math.ceil(adv.hp / dmgToAdv);
    if (turnsToKillM < turnsToKillAdv) {
      targets.push({ row: m.row, col: m.col, priority: 1.5 });
    }
  }

  if (targets.length === 0) return null;

  const result = findNearest(grid, adv, targets, { forEntity: 'adventurer' });
  if (!result || result.path.length === 0) {
    // If we can't reach any target, try stairs directly
    if (grid.stairs) {
      const stairPath = bfs(grid, adv, grid.stairs, { forEntity: 'adventurer' });
      if (stairPath && stairPath.length > 0) return stairPath[0];
    }
    return null;
  }
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
  removeEntity(grid, treasure.row, treasure.col);

  switch (treasure.type) {
    case 'gold':
      adv.gold += treasure.value;
      gameState.score += treasure.value;
      logEvent(gameState, `Found ${treasure.value} gold!`);
      break;
    case 'sword':
      if (!adv.sword || treasure.value > (adv.sword?.attackBonus ?? 0)) {
        adv.sword = { attackBonus: TREASURE_TYPES.sword.attackBonus };
        logEvent(gameState, 'Found a Sword! (+3 ATK)');
      } else {
        adv.gold += 5; gameState.score += 5;
        logEvent(gameState, 'Found a Sword (already equipped).');
      }
      break;
    case 'armor':
      if (!adv.armor) {
        adv.armor = { defenseBonus: TREASURE_TYPES.armor.defenseBonus };
        logEvent(gameState, 'Found Armor! (+2 DEF)');
      } else {
        adv.gold += 5; gameState.score += 5;
        logEvent(gameState, 'Found Armor (already equipped).');
      }
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
// Monster AI turn
// ---------------------------------------------------------------------------
export function runMonstersTurn(grid, gameState) {
  const adv = gameState.adventurer;
  for (const monster of grid.monsters) {
    if (!monster.alive) continue;
    if (monster.justSpawned) { monster.justSpawned = false; continue; } // wait one turn before moving
    if (isAdjacentCoords(monster.row, monster.col, adv.row, adv.col)) continue; // will fight in combat step

    const path = bfs(grid, monster, adv, { forEntity: 'monster', adjacentGoal: true });
    if (!path || path.length === 0) continue;

    const step = path[0];
    // Ensure step is not a wall, another monster, or the adventurer
    const cell = getCell(grid, step.row, step.col);
    if (!cell || cell.locked || cell.entity === 'monster' || cell.entity === 'adventurer') continue;

    removeEntity(grid, monster.row, monster.col);
    monster.row = step.row;
    monster.col = step.col;
    placeEntity(grid, monster.row, monster.col, 'monster', monster);
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
