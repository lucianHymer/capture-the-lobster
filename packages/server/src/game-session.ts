/**
 * CtlGameSession — CtL-specific game session wrapping the generic GameSession.
 *
 * Adds CtL-specific state accessors that api.ts uses for spectator views,
 * bot orchestration, etc. Also keeps legacy chat methods until we fully
 * migrate to relay-only chat.
 */

import { GameSession } from '@coordination-games/platform';
import {
  CtlGameState,
  GameUnit,
  FlagState,
  TeamMessage,
  TurnRecord,
  GamePhase,
  GameState,
  GameConfig,
  Direction,
  createGameState,
  submitMove as pureSubmitMove,
  submitChat as pureSubmitChat,
  allMovesSubmitted as pureAllMovesSubmitted,
  resolveTurn as pureResolveTurn,
  getStateForAgent as pureGetStateForAgent,
  getTeamMessages as pureGetTeamMessages,
  isGameOver as pureIsGameOver,
  CaptureTheLobsterPlugin,
  UnitClass,
  GameMap,
  getMapRadiusForTeamSize,
  getTurnLimitForRadius,
  getUnitVision,
} from '@coordination-games/game-ctl';
import type { CtlMove, CtlConfig } from '@coordination-games/game-ctl';

/**
 * CtL game session. Wraps the pure game functions with mutable state tracking.
 * Provides typed accessors for CtL-specific state (units, flags, map, etc.).
 */
export class CtlGameSession {
  private _state: CtlGameState;
  private _turnHistory: TurnRecord[] = [];
  readonly gameId: string;

  /** Track which agents have submitted moves this turn */
  private _submittedMoves = new Set<string>();

  constructor(state: CtlGameState, gameId: string) {
    this._state = state;
    this.gameId = gameId;
  }

  // --- State accessors ---

  get state(): CtlGameState { return this._state; }
  get turn(): number { return this._state.turn; }
  get phase(): GamePhase { return this._state.phase; }
  get winner(): 'A' | 'B' | null { return this._state.winner; }
  get score(): { A: number; B: number } { return this._state.score; }
  get units(): GameUnit[] { return this._state.units; }
  get flags(): { A: FlagState[]; B: FlagState[] } { return this._state.flags; }
  get config(): Required<GameConfig> { return this._state.config; }
  get teamMessages(): { A: TeamMessage[]; B: TeamMessage[] } { return this._state.teamMessages; }
  get mapRadius(): number { return this._state.mapRadius; }
  get mapTiles(): [string, string][] { return this._state.mapTiles; }
  get mapBases(): CtlGameState['mapBases'] { return this._state.mapBases; }

  get map(): { tiles: Map<string, string>; radius: number; bases: CtlGameState['mapBases'] } {
    return {
      tiles: new Map(this._state.mapTiles),
      radius: this._state.mapRadius,
      bases: this._state.mapBases,
    };
  }

  // --- Move tracking ---

  get moveSubmissions(): { has(id: string): boolean; size: number } {
    return {
      has: (id: string) => this._submittedMoves.has(id),
      size: this._submittedMoves.size,
    };
  }

  // --- Mutating operations ---

  submitMove(agentId: string, path: Direction[]): { success: boolean; error?: string } {
    const result = pureSubmitMove(this._state, agentId, path);
    if (result.success) {
      this._state = result.state;
      this._submittedMoves.add(agentId);
    }
    return { success: result.success, error: result.error };
  }

  /** Legacy: direct chat on game state. Use relay instead for new code. */
  submitChat(agentId: string, message: string): void {
    this._state = pureSubmitChat(this._state, agentId, message);
  }

  /** Legacy: get team messages from game state. Use relay instead for new code. */
  getTeamMessages(agentId: string, sinceTurn?: number): TeamMessage[] {
    return pureGetTeamMessages(this._state, agentId, sinceTurn);
  }

  allMovesSubmitted(): boolean {
    return pureAllMovesSubmitted(this._state);
  }

  resolveTurn(): TurnRecord {
    for (const unit of this._state.units) {
      if (unit.alive && !this._submittedMoves.has(unit.id)) {
        const result = pureSubmitMove(this._state, unit.id, []);
        this._state = result.state;
      }
    }

    const { state: newState, record } = pureResolveTurn(this._state);
    this._state = newState;
    this._turnHistory.push(record);
    this._submittedMoves.clear();
    return record;
  }

  getStateForAgent(agentId: string): GameState {
    return pureGetStateForAgent(this._state, agentId, this._submittedMoves);
  }

  isGameOver(): boolean {
    return pureIsGameOver(this._state);
  }

  getTurnHistory(): TurnRecord[] {
    return this._turnHistory;
  }

  // --- Static factory ---

  static create(
    gameId: string,
    map: GameMap,
    players: { id: string; team: 'A' | 'B'; unitClass: UnitClass }[],
    config?: GameConfig,
  ): CtlGameSession {
    const state = createGameState(map, players, config);
    return new CtlGameSession(state, gameId);
  }
}

// Re-export as GameSession for backwards compatibility with api.ts
export { CtlGameSession as GameSession };
