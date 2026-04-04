import { Hex, Direction, hexEquals, hexToString } from './hex.js';
import { UnitClass, CLASS_SPEED, MoveUnit, MoveSubmission, validatePath, resolveMovements } from './movement.js';
import { GameMap, TileType, getMapRadiusForTeamSize } from './map.js';
import { VisibleTile, FogUnit, buildVisibleState } from './fog.js';
import { CombatUnit, resolveCombat } from './combat.js';

export interface GameUnit {
  id: string;
  team: 'A' | 'B';
  unitClass: UnitClass;
  position: Hex;
  alive: boolean;
  carryingFlag: boolean;
}

export interface FlagState {
  team: 'A' | 'B';
  position: Hex;
  carried: boolean;
  carrierId?: string;
}

export interface TeamMessage {
  from: string;
  message: string;
  turn: number;
}

export interface TurnRecord {
  turn: number;
  moves: Map<string, Direction[]>;
  unitPositionsBefore: Map<string, Hex>;
  unitPositionsAfter: Map<string, Hex>;
  kills: { killerId: string; victimId: string; reason: string }[];
  flagEvents: string[];
  messages: TeamMessage[];
}

export type GamePhase = 'pre_game' | 'in_progress' | 'finished';

export interface GameState {
  turn: number;
  phase: GamePhase;
  yourUnit: {
    id: string;
    unitClass: UnitClass;
    position: Hex;
    carryingFlag: boolean;
    alive: boolean;
  };
  visibleTiles: VisibleTile[];
  yourFlag: { status: 'at_base' | 'carried' | 'unknown' };
  enemyFlag: { status: 'at_base' | 'carried_by_you' | 'carried_by_ally' | 'unknown' };
  messagesSinceLastCheck: TeamMessage[];
  timeRemainingSeconds: number;
  moveSubmitted: boolean;
  score: { yourTeam: number; enemyTeam: number };
}

export interface GameConfig {
  turnLimit?: number;
  turnTimerSeconds?: number;
  teamSize?: number;
}

/** Compute turn limit based on map radius */
export function getTurnLimitForRadius(radius: number): number {
  return 20 + (radius * 2);
}

const DEFAULT_CONFIG: Required<GameConfig> = {
  turnLimit: 30,
  turnTimerSeconds: 30,
  teamSize: 4,
};

export class GameManager {
  readonly gameId: string;
  readonly map: GameMap;
  readonly config: Required<GameConfig>;

  units: GameUnit[];
  flags: { A: FlagState[]; B: FlagState[] };
  turn: number;
  phase: GamePhase;
  winner: 'A' | 'B' | null;
  score: { A: number; B: number };

  moveSubmissions: Map<string, Direction[]>;
  teamMessages: { A: TeamMessage[]; B: TeamMessage[] };
  private turnHistory: TurnRecord[];
  private lastCheckedTurn: Map<string, number>;

  // Precomputed sets for performance
  private wallSet: Set<string>;
  private validTiles: Set<string>;

  constructor(
    gameId: string,
    map: GameMap,
    players: { id: string; team: 'A' | 'B'; unitClass: UnitClass }[],
    config?: GameConfig,
  ) {
    this.gameId = gameId;
    this.map = map;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Precompute wall set and valid tiles
    this.wallSet = new Set<string>();
    this.validTiles = new Set<string>();
    for (const [key, type] of map.tiles) {
      if (type === 'wall') {
        this.wallSet.add(key);
      } else {
        this.validTiles.add(key);
      }
    }

    // Create units at spawn positions — distribute across all bases
    const spawnIndexA = { current: 0 };
    const spawnIndexB = { current: 0 };

    // Flatten all spawns across bases for each team
    const allSpawnsA = map.bases.A.flatMap(b => b.spawns);
    const allSpawnsB = map.bases.B.flatMap(b => b.spawns);

    this.units = players.map((p) => {
      const spawns = p.team === 'A' ? allSpawnsA : allSpawnsB;
      const spawnIdx = p.team === 'A' ? spawnIndexA : spawnIndexB;
      const position = spawns[spawnIdx.current % spawns.length];
      spawnIdx.current++;

      return {
        id: p.id,
        team: p.team,
        unitClass: p.unitClass,
        position: { ...position },
        alive: true,
        carryingFlag: false,
      };
    });

    // Initialize flags at base positions (one flag per base)
    this.flags = {
      A: map.bases.A.map((base) => ({
        team: 'A' as const,
        position: { ...base.flag },
        carried: false,
      })),
      B: map.bases.B.map((base) => ({
        team: 'B' as const,
        position: { ...base.flag },
        carried: false,
      })),
    };

    this.turn = 0;
    this.phase = 'in_progress';
    this.winner = null;
    this.score = { A: 0, B: 0 };

    this.moveSubmissions = new Map();
    this.teamMessages = { A: [], B: [] };
    this.turnHistory = [];
    this.lastCheckedTurn = new Map();
  }

  getStateForAgent(agentId: string): GameState {
    const unit = this.units.find((u) => u.id === agentId);
    if (!unit) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    const team = unit.team;
    const enemyTeam: 'A' | 'B' = team === 'A' ? 'B' : 'A';

    // Build fog units for visibility calculation
    const fogUnits: FogUnit[] = this.units.map((u) => ({
      id: u.id,
      team: u.team,
      unitClass: u.unitClass,
      position: u.position,
      alive: u.alive,
    }));

    const viewer: FogUnit = {
      id: unit.id,
      team: unit.team,
      unitClass: unit.unitClass,
      position: unit.position,
      alive: unit.alive,
    };

    const flagsForFog = {
      A: this.flags.A.map(f => ({
        position: f.position,
        carried: f.carried,
        carrierId: f.carrierId,
      })),
      B: this.flags.B.map(f => ({
        position: f.position,
        carried: f.carried,
        carrierId: f.carrierId,
      })),
    };

    const visibleTiles = buildVisibleState(
      viewer,
      fogUnits,
      this.wallSet,
      this.map.tiles,
      flagsForFog,
    );

    // Determine your flag statuses (any flag carried = bad)
    const yourFlags = this.flags[team];
    let yourFlagStatus: 'at_base' | 'carried' | 'unknown' = 'at_base';
    for (const f of yourFlags) {
      if (f.carried) { yourFlagStatus = 'carried'; break; }
    }

    // Determine enemy flag status (best status across all enemy flags)
    const enemyFlags = this.flags[enemyTeam];
    let enemyFlagStatus: 'at_base' | 'carried_by_you' | 'carried_by_ally' | 'unknown' = 'unknown';
    for (const ef of enemyFlags) {
      if (ef.carried && ef.carrierId === agentId) {
        enemyFlagStatus = 'carried_by_you';
        break; // best possible
      } else if (ef.carried && ef.carrierId) {
        const carrier = this.units.find((u) => u.id === ef.carrierId);
        if (carrier && carrier.team === team) {
          enemyFlagStatus = 'carried_by_ally';
        }
      } else if (!ef.carried) {
        const enemyFlagKey = hexToString(ef.position);
        const isVisible = visibleTiles.some(
          (t) => hexToString({ q: t.q, r: t.r }) === enemyFlagKey,
        );
        if (isVisible && enemyFlagStatus === 'unknown') {
          enemyFlagStatus = 'at_base';
        }
      }
    }

    // Get messages since last check
    const lastCheck = this.lastCheckedTurn.get(agentId) ?? -1;
    const messages = this.teamMessages[team].filter((m) => m.turn > lastCheck);
    this.lastCheckedTurn.set(agentId, this.turn);

    return {
      turn: this.turn,
      phase: this.phase,
      yourUnit: {
        id: unit.id,
        unitClass: unit.unitClass,
        position: { ...unit.position },
        carryingFlag: unit.carryingFlag,
        alive: unit.alive,
      },
      visibleTiles,
      yourFlag: { status: yourFlagStatus },
      enemyFlag: { status: enemyFlagStatus },
      messagesSinceLastCheck: messages,
      timeRemainingSeconds: this.config.turnTimerSeconds,
      moveSubmitted: this.moveSubmissions.has(agentId),
      score: {
        yourTeam: this.score[team],
        enemyTeam: this.score[enemyTeam],
      },
    };
  }

  submitMove(agentId: string, path: Direction[]): { success: boolean; error?: string } {
    if (this.phase !== 'in_progress') {
      return { success: false, error: 'Game is not in progress' };
    }

    const unit = this.units.find((u) => u.id === agentId);
    if (!unit) {
      return { success: false, error: `Unknown agent: ${agentId}` };
    }

    if (!unit.alive) {
      return { success: false, error: 'Dead units cannot move' };
    }

    // Validate path length against class speed
    const moveUnit: MoveUnit = {
      id: unit.id,
      team: unit.team,
      unitClass: unit.unitClass,
      position: unit.position,
    };
    const validation = validatePath(moveUnit, path);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    this.moveSubmissions.set(agentId, path);
    return { success: true };
  }

  submitChat(agentId: string, message: string): void {
    const unit = this.units.find((u) => u.id === agentId);
    if (!unit) return;

    const msg: TeamMessage = {
      from: agentId,
      message,
      turn: this.turn,
    };
    this.teamMessages[unit.team].push(msg);
  }

  getTeamMessages(agentId: string, sinceTurn?: number): TeamMessage[] {
    const unit = this.units.find((u) => u.id === agentId);
    if (!unit) return [];

    const since = sinceTurn ?? 0;
    return this.teamMessages[unit.team].filter((m) => m.turn >= since);
  }

  allMovesSubmitted(): boolean {
    const aliveUnits = this.units.filter((u) => u.alive);
    return aliveUnits.every((u) => this.moveSubmissions.has(u.id));
  }

  resolveTurn(): TurnRecord {
    const currentTurn = this.turn;

    // 1. Record pre-move positions
    const unitPositionsBefore = new Map<string, Hex>();
    for (const unit of this.units) {
      unitPositionsBefore.set(unit.id, { ...unit.position });
    }

    // 2. Build MoveUnit and MoveSubmission arrays
    const moveUnits: MoveUnit[] = [];
    const submissions: MoveSubmission[] = [];

    for (const unit of this.units) {
      if (!unit.alive) continue;

      moveUnits.push({
        id: unit.id,
        team: unit.team,
        unitClass: unit.unitClass,
        position: { ...unit.position },
      });

      const path = this.moveSubmissions.get(unit.id) ?? [];
      submissions.push({ unitId: unit.id, path });
    }

    // Record moves for the turn record
    const moves = new Map<string, Direction[]>();
    for (const [id, path] of this.moveSubmissions) {
      moves.set(id, [...path]);
    }

    // 3. Resolve movements
    const moveResults = resolveMovements(moveUnits, submissions, this.validTiles);

    // 4. Update unit positions
    for (const result of moveResults) {
      const unit = this.units.find((u) => u.id === result.unitId)!;
      unit.position = { ...result.to };

      // If unit is carrying a flag, update flag position too
      if (unit.carryingFlag) {
        const enemyTeam: 'A' | 'B' = unit.team === 'A' ? 'B' : 'A';
        const carriedFlag = this.flags[enemyTeam].find(f => f.carrierId === unit.id);
        if (carriedFlag) {
          carriedFlag.position = { ...result.to };
        }
      }
    }

    // 5. Resolve combat
    const combatUnits: CombatUnit[] = this.units
      .filter((u) => u.alive)
      .map((u) => ({
        id: u.id,
        team: u.team,
        unitClass: u.unitClass,
        position: { ...u.position },
      }));

    const combatResult = resolveCombat(combatUnits, this.wallSet);

    // 6. Process deaths
    const flagEvents: string[] = [];

    for (const deadId of combatResult.deaths) {
      const unit = this.units.find((u) => u.id === deadId)!;
      unit.alive = false;

      // If carrying a flag, drop it back to its home base
      if (unit.carryingFlag) {
        unit.carryingFlag = false;
        const enemyTeam: 'A' | 'B' = unit.team === 'A' ? 'B' : 'A';
        // Find which enemy flag this unit was carrying
        const droppedFlag = this.flags[enemyTeam].find(f => f.carrierId === unit.id);
        if (droppedFlag) {
          droppedFlag.carried = false;
          droppedFlag.carrierId = undefined;
          // Return to the flag's original base position
          const baseIdx = this.flags[enemyTeam].indexOf(droppedFlag);
          droppedFlag.position = { ...this.map.bases[enemyTeam][baseIdx].flag };
          flagEvents.push(
            `${unit.id} died carrying ${enemyTeam}'s flag — flag returned to base`,
          );
        }
      }
    }

    // 7. Check flag pickups (one flag per unit)
    for (const unit of this.units) {
      if (!unit.alive || unit.carryingFlag) continue;

      const enemyTeam: 'A' | 'B' = unit.team === 'A' ? 'B' : 'A';
      for (const enemyFlag of this.flags[enemyTeam]) {
        if (
          !enemyFlag.carried &&
          hexEquals(unit.position, enemyFlag.position)
        ) {
          enemyFlag.carried = true;
          enemyFlag.carrierId = unit.id;
          unit.carryingFlag = true;
          flagEvents.push(`${unit.id} picked up ${enemyTeam}'s flag`);
          break; // one flag per unit
        }
      }
    }

    // 8. Check win condition — carrier reaches any of own base flag hexes
    let scored = false;
    for (const unit of this.units) {
      if (!unit.alive || !unit.carryingFlag) continue;

      // Check if at any of own team's base flag positions
      const homeBases = this.map.bases[unit.team];
      const atHome = homeBases.some(base => hexEquals(unit.position, base.flag));
      if (atHome) {
        this.score[unit.team]++;
        flagEvents.push(
          `${unit.id} captured the flag! Team ${unit.team} scores!`,
        );

        // Reset the captured flag
        const enemyTeam: 'A' | 'B' = unit.team === 'A' ? 'B' : 'A';
        const capturedFlag = this.flags[enemyTeam].find(f => f.carrierId === unit.id);
        if (capturedFlag) {
          const baseIdx = this.flags[enemyTeam].indexOf(capturedFlag);
          capturedFlag.carried = false;
          capturedFlag.carrierId = undefined;
          capturedFlag.position = { ...this.map.bases[enemyTeam][baseIdx].flag };
        }
        unit.carryingFlag = false;

        this.phase = 'finished';
        this.winner = unit.team;
        scored = true;
        break;
      }
    }

    // 9. Prepare for next turn
    // Respawn dead units at team spawn hexes (distribute across all bases)
    const spawnCountA = { current: 0 };
    const spawnCountB = { current: 0 };
    const allSpawnsA = this.map.bases.A.flatMap(b => b.spawns);
    const allSpawnsB = this.map.bases.B.flatMap(b => b.spawns);

    for (const unit of this.units) {
      if (unit.alive) continue;

      const spawns = unit.team === 'A' ? allSpawnsA : allSpawnsB;
      const counter = unit.team === 'A' ? spawnCountA : spawnCountB;
      unit.position = { ...spawns[counter.current % spawns.length] };
      counter.current++;
      unit.alive = true;
    }

    // Record post-move positions
    const unitPositionsAfter = new Map<string, Hex>();
    for (const unit of this.units) {
      unitPositionsAfter.set(unit.id, { ...unit.position });
    }

    // Collect messages for this turn
    const turnMessages = [
      ...this.teamMessages.A.filter((m) => m.turn === currentTurn),
      ...this.teamMessages.B.filter((m) => m.turn === currentTurn),
    ];

    // Build turn record
    const record: TurnRecord = {
      turn: currentTurn,
      moves,
      unitPositionsBefore,
      unitPositionsAfter,
      kills: combatResult.kills,
      flagEvents,
      messages: turnMessages,
    };
    this.turnHistory.push(record);

    // Clear move submissions
    this.moveSubmissions.clear();

    // Increment turn
    this.turn++;

    // Check turn limit (draw)
    if (!scored && this.turn > this.config.turnLimit) {
      this.phase = 'finished';
      this.winner = null;
    }

    return record;
  }

  getTurnHistory(): TurnRecord[] {
    return this.turnHistory;
  }

  isGameOver(): boolean {
    return this.phase === 'finished';
  }
}
