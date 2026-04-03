import {
  GameManager,
  GameState,
  Direction,
  ALL_DIRECTIONS,
  Hex,
  hexDistance,
  getNeighbor,
  hexToString,
  UnitClass,
  CLASS_SPEED,
  beats,
  TurnRecord,
} from '@lobster/engine';

// ---------------------------------------------------------------------------
// Bot interface
// ---------------------------------------------------------------------------

export interface Bot {
  id: string;
  team: 'A' | 'B';
  unitClass: UnitClass;

  /** Given the game state visible to this bot, decide a movement path. */
  decideMove(state: GameState): Direction[];

  /** Return a chat message, or null for silence. */
  decideChat(state: GameState): string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Build a set of valid (non-wall) hex keys from visible tiles. */
function visibleGroundSet(state: GameState): Set<string> {
  const s = new Set<string>();
  for (const t of state.visibleTiles) {
    if (t.type !== 'wall') {
      s.add(hexToString({ q: t.q, r: t.r }));
    }
  }
  return s;
}

/**
 * Greedy direction picker: returns the direction from `from` that brings
 * us closest to `target`, only considering directions whose target hex is
 * in the `valid` set. Returns null if no valid direction reduces distance
 * (or all neighbors are walls).
 */
function bestDirection(
  from: Hex,
  target: Hex,
  valid: Set<string>,
): Direction | null {
  let bestDir: Direction | null = null;
  let bestDist = hexDistance(from, target);

  for (const dir of shuffle(ALL_DIRECTIONS)) {
    const next = getNeighbor(from, dir);
    const key = hexToString(next);
    if (!valid.has(key)) continue;

    const d = hexDistance(next, target);
    if (d < bestDist) {
      bestDist = d;
      bestDir = dir;
    }
  }
  return bestDir;
}

/**
 * Build a greedy path of up to `steps` toward `target`, each step picking
 * the best valid direction. Stops early if stuck.
 */
function greedyPath(
  from: Hex,
  target: Hex,
  steps: number,
  valid: Set<string>,
): Direction[] {
  const path: Direction[] = [];
  let current = from;

  for (let i = 0; i < steps; i++) {
    const dir = bestDirection(current, target, valid);
    if (!dir) break;
    path.push(dir);
    current = getNeighbor(current, dir);
    if (hexDistance(current, target) === 0) break;
  }

  return path;
}

/**
 * Approximate direction label (compass) from one hex to another.
 */
function compassDirection(from: Hex, to: Hex): string {
  const dq = to.q - from.q;
  const dr = to.r - from.r;
  // Convert axial offset to rough label
  if (dr < 0 && dq === 0) return 'north';
  if (dr > 0 && dq === 0) return 'south';
  if (dq > 0 && dr < 0) return 'northeast';
  if (dq > 0 && dr >= 0) return 'southeast';
  if (dq < 0 && dr > 0) return 'southwest';
  if (dq < 0 && dr <= 0) return 'northwest';
  return 'nearby';
}

// ---------------------------------------------------------------------------
// RandomBot
// ---------------------------------------------------------------------------

const RANDOM_CHAT = [
  'Glub glub!',
  'Has anyone seen the lobster?',
  'I have no idea what I am doing.',
  'Moving randomly, what could go wrong?',
  'Are we winning?',
  'I smell crab cakes.',
  'Leroy Jenkins!',
  'The treasure is mine!',
  'Where even am I?',
  'Left? Right? ...Yes.',
];

export class RandomBot implements Bot {
  id: string;
  team: 'A' | 'B';
  unitClass: UnitClass;

  constructor(id: string, team: 'A' | 'B', unitClass: UnitClass) {
    this.id = id;
    this.team = team;
    this.unitClass = unitClass;
  }

  decideMove(state: GameState): Direction[] {
    if (!state.yourUnit.alive) return [];

    const speed = CLASS_SPEED[this.unitClass];
    const steps = Math.floor(Math.random() * (speed + 1)); // 0..speed
    if (steps === 0) return [];

    const valid = visibleGroundSet(state);
    const path: Direction[] = [];
    let current = state.yourUnit.position;

    for (let i = 0; i < steps; i++) {
      // Try random directions, fall back to hold
      const dirs = shuffle(ALL_DIRECTIONS);
      let moved = false;
      for (const dir of dirs) {
        const next = getNeighbor(current, dir);
        if (valid.has(hexToString(next))) {
          path.push(dir);
          current = next;
          moved = true;
          break;
        }
      }
      if (!moved) break; // stuck — stop here
    }

    return path;
  }

  decideChat(_state: GameState): string | null {
    if (Math.random() < 0.1) {
      return pick(RANDOM_CHAT);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// SmartBot
// ---------------------------------------------------------------------------

export class SmartBot implements Bot {
  id: string;
  team: 'A' | 'B';
  unitClass: UnitClass;
  mapRadius: number;

  constructor(id: string, team: 'A' | 'B', unitClass: UnitClass, mapRadius: number = 5) {
    this.id = id;
    this.team = team;
    this.unitClass = unitClass;
    this.mapRadius = mapRadius;
  }

  decideMove(state: GameState): Direction[] {
    // Dead — hold (will respawn next turn)
    if (!state.yourUnit.alive) return [];

    const speed = CLASS_SPEED[this.unitClass];
    const valid = visibleGroundSet(state);
    const pos = state.yourUnit.position;

    // Locate things from visible tiles
    const enemyUnits: { pos: Hex; unitClass: UnitClass }[] = [];
    let enemyFlagHex: Hex | null = null;
    let ownFlagHex: Hex | null = null;

    for (const t of state.visibleTiles) {
      const tHex: Hex = { q: t.q, r: t.r };
      // Enemy units
      if (t.unit && t.unit.team !== this.team) {
        enemyUnits.push({ pos: tHex, unitClass: t.unit.unitClass });
      }
      // Flags
      if (t.flag) {
        if (t.flag.team === this.team) {
          ownFlagHex = tHex;
        } else {
          enemyFlagHex = tHex;
        }
      }
    }

    // --- Priority 1: Carrying enemy flag — go home ---
    if (state.yourUnit.carryingFlag) {
      // Own flag location is the capture point. If we can see it, pathfind
      // toward it. Otherwise head toward own base side.
      const target = ownFlagHex ?? this.ownBaseFallback();
      return greedyPath(pos, target, speed, valid);
    }

    // --- Priority 2: Enemy flag visible and not carried — grab it ---
    if (
      enemyFlagHex &&
      (state.enemyFlag.status === 'at_base' ||
        state.enemyFlag.status === 'unknown')
    ) {
      return greedyPath(pos, enemyFlagHex, speed, valid);
    }

    // --- Priority 3: Class-specific behaviour ---
    switch (this.unitClass) {
      case 'rogue':
        return this.rogueLogic(pos, speed, valid, enemyUnits);
      case 'knight':
        return this.knightLogic(pos, speed, valid, enemyUnits, ownFlagHex);
      case 'mage':
        return this.mageLogic(pos, speed, valid, enemyUnits);
    }
  }

  // --- Class strategies ---

  private rogueLogic(
    pos: Hex,
    speed: number,
    valid: Set<string>,
    enemies: { pos: Hex; unitClass: UnitClass }[],
  ): Direction[] {
    // Aggressive: chase mages (we beat them), flee knights (they beat us)
    const mages = enemies.filter((e) => e.unitClass === 'mage');
    const knights = enemies.filter((e) => e.unitClass === 'knight');

    if (mages.length > 0) {
      // Chase closest mage
      const closest = mages.reduce((a, b) =>
        hexDistance(pos, a.pos) <= hexDistance(pos, b.pos) ? a : b,
      );
      return greedyPath(pos, closest.pos, speed, valid);
    }

    if (knights.length > 0) {
      // Flee from closest knight — move in opposite direction
      const closest = knights.reduce((a, b) =>
        hexDistance(pos, a.pos) <= hexDistance(pos, b.pos) ? a : b,
      );
      return this.fleeFrom(pos, closest.pos, speed, valid);
    }

    // Default: move toward enemy base
    return greedyPath(pos, this.enemyBaseFallback(), speed, valid);
  }

  private knightLogic(
    pos: Hex,
    speed: number,
    valid: Set<string>,
    enemies: { pos: Hex; unitClass: UnitClass }[],
    ownFlagHex: Hex | null,
  ): Direction[] {
    // Guard: chase rogues, avoid mages, patrol near own flag
    const rogues = enemies.filter((e) => e.unitClass === 'rogue');
    const mages = enemies.filter((e) => e.unitClass === 'mage');

    if (rogues.length > 0) {
      const closest = rogues.reduce((a, b) =>
        hexDistance(pos, a.pos) <= hexDistance(pos, b.pos) ? a : b,
      );
      return greedyPath(pos, closest.pos, speed, valid);
    }

    if (mages.length > 0) {
      const closest = mages.reduce((a, b) =>
        hexDistance(pos, a.pos) <= hexDistance(pos, b.pos) ? a : b,
      );
      return this.fleeFrom(pos, closest.pos, speed, valid);
    }

    // Patrol: move toward own flag area or center
    const target = ownFlagHex ?? { q: 0, r: 0 };
    if (hexDistance(pos, target) <= 2) {
      // Already near base — wander randomly 1 step
      const dirs = shuffle(ALL_DIRECTIONS);
      for (const dir of dirs) {
        const next = getNeighbor(pos, dir);
        if (valid.has(hexToString(next))) return [dir];
      }
      return [];
    }
    return greedyPath(pos, target, speed, valid);
  }

  private mageLogic(
    pos: Hex,
    speed: number,
    valid: Set<string>,
    enemies: { pos: Hex; unitClass: UnitClass }[],
  ): Direction[] {
    // Stay back, chase knights (we beat them), flee rogues
    const knights = enemies.filter((e) => e.unitClass === 'knight');
    const rogues = enemies.filter((e) => e.unitClass === 'rogue');

    if (rogues.length > 0) {
      const closest = rogues.reduce((a, b) =>
        hexDistance(pos, a.pos) <= hexDistance(pos, b.pos) ? a : b,
      );
      // Only flee if close
      if (hexDistance(pos, closest.pos) <= 3) {
        return this.fleeFrom(pos, closest.pos, speed, valid);
      }
    }

    if (knights.length > 0) {
      const closest = knights.reduce((a, b) =>
        hexDistance(pos, a.pos) <= hexDistance(pos, b.pos) ? a : b,
      );
      return greedyPath(pos, closest.pos, speed, valid);
    }

    // Default: move toward center
    return greedyPath(pos, { q: 0, r: 0 }, speed, valid);
  }

  // --- Movement helpers ---

  private fleeFrom(
    pos: Hex,
    threat: Hex,
    speed: number,
    valid: Set<string>,
  ): Direction[] {
    // Move in the direction that maximizes distance from threat
    const path: Direction[] = [];
    let current = pos;

    for (let i = 0; i < speed; i++) {
      let bestDir: Direction | null = null;
      let bestDist = hexDistance(current, threat);

      for (const dir of shuffle(ALL_DIRECTIONS)) {
        const next = getNeighbor(current, dir);
        if (!valid.has(hexToString(next))) continue;
        const d = hexDistance(next, threat);
        if (d > bestDist) {
          bestDist = d;
          bestDir = dir;
        }
      }
      if (!bestDir) break;
      path.push(bestDir);
      current = getNeighbor(current, bestDir);
    }
    return path;
  }

  private ownBaseFallback(): Hex {
    // Team A base is south (high r), Team B base is north (low r)
    // Use radius-1 since flags are placed 1 hex inward from edge
    const r = (this.mapRadius || 5) - 1;
    return this.team === 'A' ? { q: 0, r } : { q: 0, r: -r };
  }

  private enemyBaseFallback(): Hex {
    const r = (this.mapRadius || 5) - 1;
    return this.team === 'A' ? { q: 0, r: -r } : { q: 0, r: r };
  }

  // --- Chat ---

  decideChat(state: GameState): string | null {
    if (!state.yourUnit.alive) {
      return 'Down! Respawning next turn.';
    }

    // Carrying flag — always report
    if (state.yourUnit.carryingFlag) {
      return 'I have their flag! Heading home.';
    }

    const pos = state.yourUnit.position;
    const parts: string[] = [];

    // Report position
    parts.push(`I'm at (${pos.q},${pos.r})`);

    // Report visible enemies
    for (const t of state.visibleTiles) {
      if (t.unit && t.unit.team !== this.team) {
        const dir = compassDirection(pos, { q: t.q, r: t.r });
        parts.push(`${t.unit.unitClass} to the ${dir}`);
      }
    }

    // Report enemy flag if visible
    for (const t of state.visibleTiles) {
      if (t.flag && t.flag.team !== this.team) {
        const dir = compassDirection(pos, { q: t.q, r: t.r });
        parts.push(`enemy flag ${dir}`);
      }
    }

    if (parts.length === 1) {
      parts.push('no enemies visible');
    }

    return parts.join('. ') + '.';
  }
}

// ---------------------------------------------------------------------------
// runBotGame — play a complete game with bots (blocking)
// ---------------------------------------------------------------------------

export function runBotGame(
  game: GameManager,
  bots: Bot[],
): { winner: 'A' | 'B' | null; turns: number; history: TurnRecord[] } {
  while (!game.isGameOver()) {
    for (const bot of bots) {
      const state = game.getStateForAgent(bot.id);

      // Chat first
      const chatMsg = bot.decideChat(state);
      if (chatMsg) game.submitChat(bot.id, chatMsg);

      // Then move
      const path = bot.decideMove(state);
      game.submitMove(bot.id, path);
    }

    // Resolve turn
    game.resolveTurn();
  }

  return {
    winner: game.winner,
    turns: game.turn,
    history: game.getTurnHistory(),
  };
}

// ---------------------------------------------------------------------------
// createBots — create Bot instances for a player list
// ---------------------------------------------------------------------------

export function createBots(
  players: { id: string; team: 'A' | 'B'; unitClass: UnitClass }[],
  smart?: boolean,
): Bot[] {
  return players.map((p) =>
    smart
      ? new SmartBot(p.id, p.team, p.unitClass)
      : new RandomBot(p.id, p.team, p.unitClass),
  );
}
