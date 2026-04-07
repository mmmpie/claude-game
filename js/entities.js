import { ADVENTURER_BASE, MONSTER_STATS, TREASURE_TYPES, ADVENTURER_MOVES, LOG_MAX } from './constants.js?v=28';
import { placeEntity, removeEntity, getCell } from './grid.js?v=28';
import { bfs, findNearest, isAdjacentCoords } from './pathfinding.js?v=28';
import { getPieceCells, isValidPlacement } from './tetromino.js?v=28';

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
    inventory: [],  // items looted while roaming; dropped on death
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

  const blocked = activePieceBlocked(gameState);
  let movesLeft = ADVENTURER_MOVES;
  let moved = false;

  while (movesLeft > 0) {
    const step = computeNextStep(adv, grid, gameState, blocked);
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

function computeNextStep(adv, grid, gameState, blocked) {
  // Always grab adjacent treasure for free (it's literally in our path)
  for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    const nr = adv.row + dr, nc = adv.col + dc;
    if (blocked.has(nr * 1000 + nc)) continue;
    const cell = getCell(grid, nr, nc);
    if (cell && !cell.locked && cell.entity === 'treasure') {
      adv.currentGoal = { row: nr, col: nc };
      return { row: nr, col: nc };
    }
  }

  // Primary goal: stairs (head there directly if a path exists)
  if (grid.stairs) {
    const stairPath = bfs(grid, adv, grid.stairs, { forEntity: 'adventurer', blockedCells: blocked });
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

  if (targets.length === 0) { adv.currentGoal = null; return randomStep(adv, grid, blocked); }

  const result = findNearest(grid, adv, targets, { forEntity: 'adventurer', blockedCells: blocked });
  if (!result || result.path.length === 0) { adv.currentGoal = null; return randomStep(adv, grid, blocked); }

  adv.currentGoal = { row: result.target.row, col: result.target.col };
  return result.path[0];
}

// Returns a Set of row*1000+col keys for cells occupied by the active piece
// when it sits in a legal position, otherwise an empty Set.
function activePieceBlocked(gameState) {
  const piece = gameState?.activePiece;
  if (!piece || !isValidPlacement(piece, gameState.grid)) return new Set();
  return new Set(getPieceCells(piece).map(({ row, col }) => row * 1000 + col));
}

function randomStep(entity, grid, blocked = new Set(), canStepOnTreasure = false) {
  const dirs = [[-1,0],[1,0],[0,-1],[0,1]].sort(() => Math.random() - 0.5);
  for (const [dr, dc] of dirs) {
    const nr = entity.row + dr, nc = entity.col + dc;
    if (blocked.has(nr * 1000 + nc)) continue;
    const cell = getCell(grid, nr, nc);
    if (!cell || cell.locked) continue;
    if (!cell.entity) return { row: nr, col: nc };
    if (canStepOnTreasure && cell.entity === 'treasure') return { row: nr, col: nc };
  }
  return null;
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
// Monster loot — collect and drop
// ---------------------------------------------------------------------------

// Called when a monster steps onto a treasure cell.
// Swords and armor buff the monster; potions heal it (consumed, not dropped);
// gold is simply carried and dropped on death.
function monsterCollectTreasure(monster, treasure, grid, gameState) {
  if (!treasure || treasure.collected) return;
  treasure.collected = true;
  // The monster has already moved onto the cell, so the entity slot is now
  // 'monster' — the treasure reference is gone from the grid already.

  switch (treasure.type) {
    case 'sword':
      monster.attack += TREASURE_TYPES.sword.attackBonus;
      logEvent(gameState, `${capitalize(monster.type)} grabbed a Sword! (ATK↑)`);
      monster.inventory.push({ type: 'sword', value: 0 });
      break;
    case 'armor':
      monster.defense += TREASURE_TYPES.armor.defenseBonus;
      logEvent(gameState, `${capitalize(monster.type)} grabbed a Shield! (DEF↑)`);
      monster.inventory.push({ type: 'armor', value: 0 });
      break;
    case 'potion':
      monster.hp = Math.min(monster.maxHp, monster.hp + TREASURE_TYPES.potion.hpRestore);
      logEvent(gameState, `${capitalize(monster.type)} drank a Potion! (HP restored)`);
      // Potions are consumed — nothing to drop.
      break;
    case 'gold':
      logEvent(gameState, `${capitalize(monster.type)} grabbed ${treasure.value} gold!`);
      monster.inventory.push({ type: 'gold', value: treasure.value });
      break;
  }
}

// Drops everything in the monster's inventory into the nearest free cells.
function monsterDropInventory(monster, grid, gameState) {
  if (!monster.inventory || monster.inventory.length === 0) return;

  // The monster's cell was just cleared by removeEntity; try it first, then neighbours.
  const candidates = [
    { row: monster.row,     col: monster.col     },
    { row: monster.row - 1, col: monster.col     },
    { row: monster.row + 1, col: monster.col     },
    { row: monster.row,     col: monster.col - 1 },
    { row: monster.row,     col: monster.col + 1 },
  ];

  for (const item of monster.inventory) {
    for (const { row, col } of candidates) {
      const cell = getCell(grid, row, col);
      if (!cell || cell.locked || cell.entity) continue;
      const t = createTreasure(item.type, item.value, row, col);
      grid.treasures.push(t);
      placeEntity(grid, row, col, 'treasure', t);
      logEvent(gameState, `${capitalize(monster.type)} dropped ${TREASURE_TYPES[item.type].description}!`);
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

  const blocked = activePieceBlocked(gameState);
  const path = bfs(grid, monster, adv, { forEntity: 'monster', adjacentGoal: true, blockedCells: blocked });
  if (!path || path.length === 0) {
    const step = randomStep(monster, grid, blocked, true);
    if (step) {
      const destCell = getCell(grid, step.row, step.col);
      const loot = destCell?.entity === 'treasure' ? destCell.entityRef : null;
      removeEntity(grid, monster.row, monster.col);
      monster.row = step.row; monster.col = step.col;
      placeEntity(grid, monster.row, monster.col, 'monster', monster);
      if (loot) monsterCollectTreasure(monster, loot, grid, gameState);
    }
    return;
  }

  const step = path[0];
  const destCell = getCell(grid, step.row, step.col);
  if (!destCell || destCell.locked || (destCell.entity && destCell.entity !== 'treasure')) return;

  const loot = destCell.entity === 'treasure' ? destCell.entityRef : null;
  removeEntity(grid, monster.row, monster.col);
  monster.row = step.row;
  monster.col = step.col;
  placeEntity(grid, monster.row, monster.col, 'monster', monster);
  if (loot) monsterCollectTreasure(monster, loot, grid, gameState);
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
      monsterDropInventory(monster, grid, gameState);
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
