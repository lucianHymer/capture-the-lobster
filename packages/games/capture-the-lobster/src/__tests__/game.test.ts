import { describe, it, expect, beforeEach } from 'vitest';
import { GameManager, GameConfig, GameUnit } from '../game.js';
import { GameMap, TileType } from '../map.js';
import { Hex, hexToString, hexEquals } from '../hex.js';
import { UnitClass } from '../movement.js';
import { Direction } from '../hex.js';

/**
 * Build a small deterministic hex map (radius 3) for testing.
 *
 * Layout (flat-top axial, q right, r down-right):
 *
 *   Team B base: flag at (0,-3), spawns at (0,-2), (1,-3), (-1,-2), (1,-2)
 *   Center: (0,0)
 *   Team A base: flag at (0,3), spawns at (0,2), (-1,3), (1,2), (-1,2)
 *
 *   One wall at (2,0) and (-2,0) for LoS testing.
 */
function makeTestMap(): GameMap {
  const radius = 3;
  const tiles = new Map<string, TileType>();

  // Fill all hexes in radius 3 as ground
  for (let q = -radius; q <= radius; q++) {
    for (
      let r = Math.max(-radius, -q - radius);
      r <= Math.min(radius, -q + radius);
      r++
    ) {
      tiles.set(hexToString({ q, r }), 'ground');
    }
  }

  // Place bases
  const flagA: Hex = { q: 0, r: 3 };
  const flagB: Hex = { q: 0, r: -3 };

  tiles.set(hexToString(flagA), 'base_a');
  tiles.set(hexToString(flagB), 'base_b');

  // Spawns near each flag
  const spawnsA: Hex[] = [
    { q: 0, r: 2 },
    { q: -1, r: 3 },
    { q: 1, r: 2 },
    { q: -1, r: 2 },
  ];
  const spawnsB: Hex[] = [
    { q: 0, r: -2 },
    { q: 1, r: -3 },
    { q: -1, r: -2 },
    { q: 1, r: -2 },
  ];

  for (const s of spawnsA) tiles.set(hexToString(s), 'base_a');
  for (const s of spawnsB) tiles.set(hexToString(s), 'base_b');

  // Add two walls for LoS testing
  tiles.set(hexToString({ q: 2, r: 0 }), 'wall');
  tiles.set(hexToString({ q: -2, r: 0 }), 'wall');

  return {
    tiles,
    radius,
    bases: {
      A: { flag: flagA, spawns: spawnsA },
      B: { flag: flagB, spawns: spawnsB },
    },
  };
}

function makePlayers(teamSize = 1) {
  const classes: UnitClass[] = ['rogue', 'knight', 'mage', 'rogue'];
  const players: { id: string; team: 'A' | 'B'; unitClass: UnitClass }[] = [];
  for (let i = 0; i < teamSize; i++) {
    players.push({ id: `a${i}`, team: 'A', unitClass: classes[i % classes.length] });
    players.push({ id: `b${i}`, team: 'B', unitClass: classes[i % classes.length] });
  }
  return players;
}

describe('GameManager', () => {
  let map: GameMap;

  beforeEach(() => {
    map = makeTestMap();
  });

  describe('constructor', () => {
    it('creates units at spawn positions', () => {
      const players = makePlayers(2);
      const gm = new GameManager('g1', map, players);

      expect(gm.units).toHaveLength(4);
      // Team A units should be at spawnsA[0] and spawnsA[1]
      const a0 = gm.units.find((u) => u.id === 'a0')!;
      const a1 = gm.units.find((u) => u.id === 'a1')!;
      expect(hexEquals(a0.position, map.bases.A.spawns[0])).toBe(true);
      expect(hexEquals(a1.position, map.bases.A.spawns[1])).toBe(true);

      // Team B units at spawnsB[0] and spawnsB[1]
      const b0 = gm.units.find((u) => u.id === 'b0')!;
      const b1 = gm.units.find((u) => u.id === 'b1')!;
      expect(hexEquals(b0.position, map.bases.B.spawns[0])).toBe(true);
      expect(hexEquals(b1.position, map.bases.B.spawns[1])).toBe(true);
    });

    it('initializes flags at base positions', () => {
      const gm = new GameManager('g1', map, makePlayers(1));
      expect(hexEquals(gm.flags.A.position, map.bases.A.flag)).toBe(true);
      expect(hexEquals(gm.flags.B.position, map.bases.B.flag)).toBe(true);
      expect(gm.flags.A.carried).toBe(false);
      expect(gm.flags.B.carried).toBe(false);
    });

    it('applies default config values', () => {
      const gm = new GameManager('g1', map, makePlayers(1));
      expect(gm.config.turnLimit).toBe(30);
      expect(gm.config.turnTimerSeconds).toBe(30);
      expect(gm.config.teamSize).toBe(4);
    });

    it('starts in_progress phase at turn 0', () => {
      const gm = new GameManager('g1', map, makePlayers(1));
      expect(gm.phase).toBe('in_progress');
      expect(gm.turn).toBe(0);
      expect(gm.winner).toBeNull();
    });
  });

  describe('submitMove', () => {
    it('accepts a valid move', () => {
      const gm = new GameManager('g1', map, makePlayers(1));
      // a0 is a rogue at spawn (0,2), speed 3
      const result = gm.submitMove('a0', ['N']);
      expect(result.success).toBe(true);
    });

    it('rejects a move that exceeds speed', () => {
      // b0 is a rogue at (0,-2) with speed 3
      const gm = new GameManager('g1', map, makePlayers(1));
      const result = gm.submitMove('a0', ['N', 'N', 'N', 'N']); // 4 steps, rogue speed is 3
      expect(result.success).toBe(false);
      expect(result.error).toContain('speed limit');
    });

    it('rejects move from dead unit', () => {
      const gm = new GameManager('g1', map, makePlayers(1));
      const unit = gm.units.find((u) => u.id === 'a0')!;
      unit.alive = false;
      const result = gm.submitMove('a0', ['N']);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Dead');
    });

    it('rejects move when game is finished', () => {
      const gm = new GameManager('g1', map, makePlayers(1));
      gm.phase = 'finished';
      const result = gm.submitMove('a0', ['N']);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not in progress');
    });
  });

  describe('resolveTurn', () => {
    it('moves units to new positions', () => {
      const gm = new GameManager('g1', map, makePlayers(1));
      // a0 is rogue at (0,2), move N -> (0,1)
      gm.submitMove('a0', ['N']);
      const record = gm.resolveTurn();

      const a0 = gm.units.find((u) => u.id === 'a0')!;
      expect(hexEquals(a0.position, { q: 0, r: 1 })).toBe(true);
      expect(record.unitPositionsBefore.get('a0')).toEqual({ q: 0, r: 2 });
      expect(record.unitPositionsAfter.get('a0')).toEqual({ q: 0, r: 1 });
    });

    it('units without submissions stay in place', () => {
      const gm = new GameManager('g1', map, makePlayers(1));
      // Don't submit any moves
      const record = gm.resolveTurn();

      const a0 = gm.units.find((u) => u.id === 'a0')!;
      expect(hexEquals(a0.position, map.bases.A.spawns[0])).toBe(true);
    });

    it('resolves combat kills (rogue kills adjacent mage)', () => {
      // Set up: one rogue and one mage from opposite teams on adjacent hexes
      const players = [
        { id: 'rogue_a', team: 'A' as const, unitClass: 'rogue' as UnitClass },
        { id: 'mage_b', team: 'B' as const, unitClass: 'mage' as UnitClass },
      ];
      const gm = new GameManager('g1', map, players);

      // Place them adjacent: rogue at (0,0), mage at (0,1)
      const rogue = gm.units.find((u) => u.id === 'rogue_a')!;
      const mage = gm.units.find((u) => u.id === 'mage_b')!;
      rogue.position = { q: 0, r: 0 };
      mage.position = { q: 0, r: 1 };

      const record = gm.resolveTurn();

      // Rogue beats mage
      expect(record.kills.length).toBeGreaterThanOrEqual(1);
      expect(record.kills.some((k) => k.killerId === 'rogue_a' && k.victimId === 'mage_b')).toBe(
        true,
      );
    });

    it('dead unit respawns at base next turn', () => {
      const players = [
        { id: 'rogue_a', team: 'A' as const, unitClass: 'rogue' as UnitClass },
        { id: 'mage_b', team: 'B' as const, unitClass: 'mage' as UnitClass },
      ];
      const gm = new GameManager('g1', map, players);

      // Place them adjacent for combat
      gm.units.find((u) => u.id === 'rogue_a')!.position = { q: 0, r: 0 };
      gm.units.find((u) => u.id === 'mage_b')!.position = { q: 0, r: 1 };

      gm.resolveTurn();

      // After turn resolution, mage should have been killed then respawned
      const mage = gm.units.find((u) => u.id === 'mage_b')!;
      expect(mage.alive).toBe(true);
      // Should be at team B's first spawn
      expect(hexEquals(mage.position, map.bases.B.spawns[0])).toBe(true);
    });

    it('flag pickup — unit moves onto enemy flag hex', () => {
      const players = [
        { id: 'fast', team: 'A' as const, unitClass: 'rogue' as UnitClass },
        { id: 'far', team: 'B' as const, unitClass: 'rogue' as UnitClass },
      ];
      const gm = new GameManager('g1', map, players);

      // Place team A rogue right next to team B flag at (0,-3)
      gm.units.find((u) => u.id === 'fast')!.position = { q: 0, r: -2 };
      // Place team B far away so no combat
      gm.units.find((u) => u.id === 'far')!.position = { q: -1, r: 3 };

      // Move onto the flag
      gm.submitMove('fast', ['S']); // (0,-2) -> S -> (0,-1)... wait, need to go N to reach (0,-3)
      // Actually B flag is at (0,-3). Move N from (0,-2) -> (0,-3)
      gm.moveSubmissions.clear(); // reset
      gm.submitMove('fast', ['N']); // N goes (0,-2) -> (0,-3)

      const record = gm.resolveTurn();

      const unit = gm.units.find((u) => u.id === 'fast')!;
      // Note: after flag pickup the flag is carried, but then respawn logic runs.
      // The unit isn't dead, so it stays where it was.
      expect(record.flagEvents.some((e) => e.includes('picked up'))).toBe(true);
      expect(gm.flags.B.carried).toBe(true);
      expect(gm.flags.B.carrierId).toBe('fast');
      expect(unit.carryingFlag).toBe(true);
    });

    it('flag capture — carrier reaches home base, game ends', () => {
      const players = [
        { id: 'cap', team: 'A' as const, unitClass: 'rogue' as UnitClass },
        { id: 'def', team: 'B' as const, unitClass: 'rogue' as UnitClass },
      ];
      const gm = new GameManager('g1', map, players);

      // Give unit the flag and put it one step from home base
      const capUnit = gm.units.find((u) => u.id === 'cap')!;
      capUnit.position = { q: 0, r: 2 }; // one step N of base_a flag (0,3)
      capUnit.carryingFlag = true;
      gm.flags.B.carried = true;
      gm.flags.B.carrierId = 'cap';
      gm.flags.B.position = { ...capUnit.position };

      // Place defender far away
      gm.units.find((u) => u.id === 'def')!.position = { q: -3, r: 0 };

      // Move south to home base (0,3)
      gm.submitMove('cap', ['S']);

      const record = gm.resolveTurn();

      expect(gm.phase).toBe('finished');
      expect(gm.winner).toBe('A');
      expect(gm.score.A).toBe(1);
      expect(record.flagEvents.some((e) => e.includes('captured'))).toBe(true);
    });

    it('flag drop — carrier dies, flag returns to enemy base', () => {
      const players = [
        { id: 'carrier', team: 'A' as const, unitClass: 'mage' as UnitClass },
        { id: 'killer', team: 'B' as const, unitClass: 'rogue' as UnitClass },
      ];
      const gm = new GameManager('g1', map, players);

      // Carrier has B's flag
      const carrier = gm.units.find((u) => u.id === 'carrier')!;
      carrier.position = { q: 0, r: 0 };
      carrier.carryingFlag = true;
      gm.flags.B.carried = true;
      gm.flags.B.carrierId = 'carrier';
      gm.flags.B.position = { ...carrier.position };

      // Rogue adjacent — will kill mage
      const killer = gm.units.find((u) => u.id === 'killer')!;
      killer.position = { q: 0, r: 1 };

      const record = gm.resolveTurn();

      // Flag should be back at B's base
      expect(gm.flags.B.carried).toBe(false);
      expect(gm.flags.B.carrierId).toBeUndefined();
      expect(hexEquals(gm.flags.B.position, map.bases.B.flag)).toBe(true);
      expect(record.flagEvents.some((e) => e.includes('returned to base'))).toBe(true);
    });

    it('draw on turn limit', () => {
      const gm = new GameManager('g1', map, makePlayers(1), { turnLimit: 2 });

      // Resolve 3 turns (0, 1, 2) — after turn 2, turn becomes 3 which > 2
      gm.resolveTurn(); // turn 0 -> 1
      gm.resolveTurn(); // turn 1 -> 2
      gm.resolveTurn(); // turn 2 -> 3, exceeds limit

      expect(gm.phase).toBe('finished');
      expect(gm.winner).toBeNull();
      expect(gm.isGameOver()).toBe(true);
    });

    it('increments turn counter', () => {
      const gm = new GameManager('g1', map, makePlayers(1));
      expect(gm.turn).toBe(0);
      gm.resolveTurn();
      expect(gm.turn).toBe(1);
      gm.resolveTurn();
      expect(gm.turn).toBe(2);
    });

    it('clears move submissions after resolving', () => {
      const gm = new GameManager('g1', map, makePlayers(1));
      gm.submitMove('a0', ['N']);
      expect(gm.allMovesSubmitted()).toBe(false); // b0 hasn't submitted
      gm.submitMove('b0', ['S']);
      expect(gm.allMovesSubmitted()).toBe(true);
      gm.resolveTurn();
      expect(gm.allMovesSubmitted()).toBe(false); // cleared
    });
  });

  describe('getStateForAgent', () => {
    it('returns fog of war — only visible tiles', () => {
      const gm = new GameManager('g1', map, makePlayers(1));
      const state = gm.getStateForAgent('a0');

      // a0 is rogue (vision 4) at (0,2) — should see some tiles but not entire map
      expect(state.visibleTiles.length).toBeGreaterThan(0);
      expect(state.visibleTiles.length).toBeLessThan(map.tiles.size);
    });

    it('includes ally unit IDs but not enemy IDs', () => {
      const players = [
        { id: 'a0', team: 'A' as const, unitClass: 'rogue' as UnitClass },
        { id: 'a1', team: 'A' as const, unitClass: 'knight' as UnitClass },
        { id: 'b0', team: 'B' as const, unitClass: 'mage' as UnitClass },
      ];
      const gm = new GameManager('g1', map, players);

      // Place b0 near a0 so it's visible
      gm.units.find((u) => u.id === 'a0')!.position = { q: 0, r: 0 };
      gm.units.find((u) => u.id === 'a1')!.position = { q: 0, r: 1 };
      gm.units.find((u) => u.id === 'b0')!.position = { q: 1, r: 0 };

      const state = gm.getStateForAgent('a0');

      // Find ally tile
      const allyTile = state.visibleTiles.find(
        (t) => t.unit && t.unit.team === 'A' && t.unit.id === 'a1',
      );
      expect(allyTile).toBeDefined();
      expect(allyTile!.unit!.id).toBe('a1');

      // Find enemy tile — should NOT have id
      const enemyTile = state.visibleTiles.find(
        (t) => t.unit && t.unit.team === 'B',
      );
      expect(enemyTile).toBeDefined();
      expect(enemyTile!.unit!.id).toBeUndefined();
    });

    it('reports correct unit status', () => {
      const gm = new GameManager('g1', map, makePlayers(1));
      const state = gm.getStateForAgent('a0');

      expect(state.yourUnit.id).toBe('a0');
      expect(state.yourUnit.unitClass).toBe('rogue');
      expect(state.yourUnit.alive).toBe(true);
      expect(state.yourUnit.carryingFlag).toBe(false);
    });

    it('reports enemy flag as carried_by_you when agent carries it', () => {
      const gm = new GameManager('g1', map, makePlayers(1));
      const unit = gm.units.find((u) => u.id === 'a0')!;
      unit.carryingFlag = true;
      gm.flags.B.carried = true;
      gm.flags.B.carrierId = 'a0';

      const state = gm.getStateForAgent('a0');
      expect(state.enemyFlag.status).toBe('carried_by_you');
    });

    it('reports move submission status', () => {
      const gm = new GameManager('g1', map, makePlayers(1));
      let state = gm.getStateForAgent('a0');
      expect(state.moveSubmitted).toBe(false);

      gm.submitMove('a0', ['N']);
      state = gm.getStateForAgent('a0');
      expect(state.moveSubmitted).toBe(true);
    });
  });

  describe('submitChat + getTeamMessages', () => {
    it('stores and retrieves team messages correctly', () => {
      const gm = new GameManager('g1', map, makePlayers(2));

      gm.submitChat('a0', 'hello team');
      gm.submitChat('a1', 'roger that');
      gm.submitChat('b0', 'enemy spotted');

      // a0 should see team A messages only
      const aMessages = gm.getTeamMessages('a0');
      expect(aMessages).toHaveLength(2);
      expect(aMessages[0].message).toBe('hello team');
      expect(aMessages[1].message).toBe('roger that');

      // b0 should see team B messages only
      const bMessages = gm.getTeamMessages('b0');
      expect(bMessages).toHaveLength(1);
      expect(bMessages[0].message).toBe('enemy spotted');
    });

    it('filters messages by sinceTurn', () => {
      const gm = new GameManager('g1', map, makePlayers(1));

      gm.submitChat('a0', 'turn 0 msg');
      gm.resolveTurn(); // now turn 1
      gm.submitChat('a0', 'turn 1 msg');

      const allMessages = gm.getTeamMessages('a0', 0);
      expect(allMessages).toHaveLength(2);

      const recentMessages = gm.getTeamMessages('a0', 1);
      expect(recentMessages).toHaveLength(1);
      expect(recentMessages[0].message).toBe('turn 1 msg');
    });
  });

  describe('allMovesSubmitted', () => {
    it('returns true when all alive units have submitted', () => {
      const gm = new GameManager('g1', map, makePlayers(1));
      expect(gm.allMovesSubmitted()).toBe(false);

      gm.submitMove('a0', ['N']);
      expect(gm.allMovesSubmitted()).toBe(false);

      gm.submitMove('b0', ['S']);
      expect(gm.allMovesSubmitted()).toBe(true);
    });

    it('ignores dead units', () => {
      const gm = new GameManager('g1', map, makePlayers(1));
      gm.units.find((u) => u.id === 'b0')!.alive = false;

      gm.submitMove('a0', ['N']);
      expect(gm.allMovesSubmitted()).toBe(true);
    });
  });

  describe('getTurnHistory', () => {
    it('accumulates turn records', () => {
      const gm = new GameManager('g1', map, makePlayers(1));
      expect(gm.getTurnHistory()).toHaveLength(0);

      gm.resolveTurn();
      expect(gm.getTurnHistory()).toHaveLength(1);

      gm.resolveTurn();
      expect(gm.getTurnHistory()).toHaveLength(2);
    });
  });

  describe('isGameOver', () => {
    it('returns false during play', () => {
      const gm = new GameManager('g1', map, makePlayers(1));
      expect(gm.isGameOver()).toBe(false);
    });

    it('returns true after game ends', () => {
      const gm = new GameManager('g1', map, makePlayers(1), { turnLimit: 0 });
      gm.resolveTurn();
      expect(gm.isGameOver()).toBe(true);
    });
  });
});
