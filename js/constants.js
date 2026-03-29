// Grid dimensions — 10x10
export const COLS = 10;
export const ROWS = 10;
export const BASE_CELL_SIZE = 50; // px, larger cells for smaller grid

// Canvas layout (landscape)
export const HUD_WIDTH = 200;

// Colors
export const COLORS = {
  red:    '#E74C3C',
  blue:   '#3498DB',
  green:  '#2ECC71',
  yellow: '#F1C40F',
};
export const COLOR_NAMES = ['red', 'blue', 'green', 'yellow'];

// Color dark variants for borders
export const COLORS_DARK = {
  red:    '#A93226',
  blue:   '#1F618D',
  green:  '#1A8A4A',
  yellow: '#B7950B',
};

// Cluster clear threshold
export const CLUSTER_MIN_SIZE = 6;

// Tetromino shapes — each piece has 4 rotations.
// Each rotation is an array of [dRow, dCol] offsets relative to piece.row/piece.col.
export const TETROMINOES = {
  I: [
    [[1,0],[1,1],[1,2],[1,3]],
    [[0,2],[1,2],[2,2],[3,2]],
    [[2,0],[2,1],[2,2],[2,3]],
    [[0,1],[1,1],[2,1],[3,1]],
  ],
  O: [
    [[0,1],[0,2],[1,1],[1,2]],
    [[0,1],[0,2],[1,1],[1,2]],
    [[0,1],[0,2],[1,1],[1,2]],
    [[0,1],[0,2],[1,1],[1,2]],
  ],
  T: [
    [[0,1],[1,0],[1,1],[1,2]],
    [[0,1],[1,1],[1,2],[2,1]],
    [[1,0],[1,1],[1,2],[2,1]],
    [[0,1],[1,0],[1,1],[2,1]],
  ],
  S: [
    [[0,1],[0,2],[1,0],[1,1]],
    [[0,1],[1,1],[1,2],[2,2]],
    [[1,1],[1,2],[2,0],[2,1]],
    [[0,0],[1,0],[1,1],[2,1]],
  ],
  Z: [
    [[0,0],[0,1],[1,1],[1,2]],
    [[0,2],[1,1],[1,2],[2,1]],
    [[1,0],[1,1],[2,1],[2,2]],
    [[0,1],[1,0],[1,1],[2,0]],
  ],
  J: [
    [[0,0],[1,0],[1,1],[1,2]],
    [[0,1],[0,2],[1,1],[2,1]],
    [[1,0],[1,1],[1,2],[2,2]],
    [[0,1],[1,1],[2,0],[2,1]],
  ],
  L: [
    [[0,2],[1,0],[1,1],[1,2]],
    [[0,1],[1,1],[2,1],[2,2]],
    [[1,0],[1,1],[1,2],[2,0]],
    [[0,0],[0,1],[1,1],[2,1]],
  ],
};
export const TETROMINO_TYPES = ['I','O','T','S','Z','J','L'];

// Font Awesome 6 Free Solid — font family and per-entity icon codepoints
export const FA_FONT   = '"Font Awesome 6 Free"';
export const FA_WEIGHT = '900';

export const FA_ICONS = {
  adventurer: '\uf554',  // fa-person-hiking
  stairs:     '\ue289',  // fa-stairs
  dragon:     '\uf6d5',  // fa-dragon       (red)
  ghost:      '\uf6e2',  // fa-ghost        (blue)
  spaghetti:  '\uf72c',  // fa-spider       (green — tentacles = noodles)
  skull:      '\uf54c',  // fa-skull        (yellow)
  gold:       '\uf51e',  // fa-coins
  sword:      '\uf66d',  // fa-khanda       (ceremonial double-edged sword)
  armor:      '\uf132',  // fa-shield
  potion:     '\uf0c3',  // fa-flask
};

// Each piece colour spawns a specific monster type
export const COLOR_MONSTER = {
  red:    'dragon',
  blue:   'ghost',
  green:  'spaghetti',
  yellow: 'skull',
};

// Monster stats — attack & defense are randomised per instance (0..level)
export const MONSTER_STATS = {
  dragon:    { hp: 8,  xpValue: 40, glyph: FA_ICONS.dragon,    color: '#E74C3C' },
  ghost:     { hp: 3,  xpValue: 10, glyph: FA_ICONS.ghost,     color: '#5DADE2' },
  spaghetti: { hp: 5,  xpValue: 20, glyph: FA_ICONS.spaghetti, color: '#2ECC71' },
  skull:     { hp: 4,  xpValue: 15, glyph: FA_ICONS.skull,     color: '#F1C40F' },
};

// Adventurer base stats
export const ADVENTURER_BASE = { hp: 30, maxHp: 30, attack: 3, defense: 1 };

// Treasure types — sword/armor each give +1 to ATK/DEF, stackable
export const TREASURE_TYPES = {
  gold:   { glyph: FA_ICONS.gold,   color: '#F1C40F', description: 'Gold' },
  sword:  { glyph: FA_ICONS.sword,  color: '#ECF0F1', description: 'Sword (+1 ATK)', attackBonus: 1 },
  armor:  { glyph: FA_ICONS.armor,  color: '#95A5A6', description: 'Shield (+1 DEF)', defenseBonus: 1 },
  potion: { glyph: FA_ICONS.potion, color: '#E91E63', description: 'Potion (+10 HP)', hpRestore: 10 },
};

// Scoring
export const SCORE = {
  clusterCell:   5,
  clusterBonus:  50,
  levelComplete: 500,
};

// Adventurer moves per turn
export const ADVENTURER_MOVES = 1;

// Event log max entries
export const LOG_MAX = 8;

// Flash animation duration (ms)
export const FLASH_DURATION = 400;
