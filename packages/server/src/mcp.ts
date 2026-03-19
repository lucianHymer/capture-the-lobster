import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { GameManager, Direction } from '@lobster/engine';
import type { UnitClass } from '@lobster/engine';

// ----- Lobby stub types (lobby.ts is a stub — define minimal interfaces here) -----

export interface LobbyAgent {
  id: string;
  name: string;
  ready: boolean;
}

export interface LobbyTeam {
  id: string;
  members: string[];
  pending: string[]; // invited but not yet accepted
}

export interface LobbyChatMessage {
  from: string;
  message: string;
  timestamp: number;
}

export interface LobbyState {
  agents: LobbyAgent[];
  teams: LobbyTeam[];
  chat: LobbyChatMessage[];
  timeRemainingSeconds: number;
}

/**
 * Minimal LobbyManager interface.
 * The real implementation will come from @lobster/engine once lobby.ts is fleshed out.
 */
export interface LobbyManager {
  getState(): LobbyState;
  chat(agentId: string, message: string): void;
  proposeTeam(fromAgentId: string, toAgentId: string): { success: boolean; teamId?: string; error?: string };
  acceptTeam(agentId: string, teamId: string): { success: boolean; error?: string };
  chooseClass(agentId: string, unitClass: UnitClass): { success: boolean; error?: string };
  getTeamState(agentId: string): {
    teamId: string;
    members: { id: string; unitClass: UnitClass | null; ready: boolean }[];
  } | null;
  phase: 'lobby' | 'pre_game' | 'in_progress';
}

// ----- Helpers -----

const VALID_DIRECTIONS: Direction[] = ['N', 'NE', 'SE', 'S', 'SW', 'NW'];

function isValidDirection(d: string): d is Direction {
  return VALID_DIRECTIONS.includes(d as Direction);
}

function jsonResult(data: unknown): { content: { type: 'text'; text: string }[] } {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true as const,
  };
}

// ----- MCP Server -----

export class LobsterMCPServer {
  private mcpServer: McpServer;
  private lobbyManager: LobbyManager | null = null;
  private gameManager: GameManager | null = null;
  private agentId: string;

  constructor(agentId: string) {
    this.agentId = agentId;

    this.mcpServer = new McpServer({
      name: 'capture-the-lobster',
      version: '0.1.0',
    });

    this.registerTools();
  }

  setLobby(lobby: LobbyManager): void {
    this.lobbyManager = lobby;
  }

  setGame(game: GameManager): void {
    this.gameManager = game;
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
  }

  private registerTools(): void {
    // ==================== Lobby Phase Tools ====================

    // 1. get_lobby
    this.mcpServer.tool(
      'get_lobby',
      'Get the current lobby state: connected agents, teams, chat messages, and time remaining before the game starts.',
      {},
      async () => {
        if (!this.lobbyManager) {
          return errorResult('No lobby available. Game has not been created yet.');
        }
        return jsonResult(this.lobbyManager.getState());
      },
    );

    // 2. lobby_chat
    this.mcpServer.tool(
      'lobby_chat',
      'Send a public chat message visible to all agents in the lobby. Use this to communicate, coordinate, or negotiate before the game starts.',
      { message: z.string().describe('The message to send to the lobby chat') },
      async ({ message }) => {
        if (!this.lobbyManager) {
          return errorResult('No lobby available.');
        }
        if (this.lobbyManager.phase !== 'lobby') {
          return errorResult('Lobby chat is only available during the lobby phase.');
        }
        this.lobbyManager.chat(this.agentId, message);
        return jsonResult({ success: true });
      },
    );

    // 3. propose_team
    this.mcpServer.tool(
      'propose_team',
      'Invite another agent to form a team with you. The other agent must accept before the team is confirmed. Teams of 2 compete together in the game.',
      { agentId: z.string().describe('The ID of the agent you want to invite to your team') },
      async ({ agentId: targetAgentId }) => {
        if (!this.lobbyManager) {
          return errorResult('No lobby available.');
        }
        if (this.lobbyManager.phase !== 'lobby') {
          return errorResult('Team proposals are only available during the lobby phase.');
        }
        const result = this.lobbyManager.proposeTeam(this.agentId, targetAgentId);
        if (!result.success) {
          return errorResult(result.error ?? 'Failed to propose team.');
        }
        return jsonResult({ success: true, teamId: result.teamId });
      },
    );

    // 4. accept_team
    this.mcpServer.tool(
      'accept_team',
      'Accept an invitation to join a team. You must have a pending invitation for this team.',
      { teamId: z.string().describe('The ID of the team invitation to accept') },
      async ({ teamId }) => {
        if (!this.lobbyManager) {
          return errorResult('No lobby available.');
        }
        if (this.lobbyManager.phase !== 'lobby') {
          return errorResult('Team acceptance is only available during the lobby phase.');
        }
        const result = this.lobbyManager.acceptTeam(this.agentId, teamId);
        if (!result.success) {
          return errorResult(result.error ?? 'Failed to accept team.');
        }
        return jsonResult({ success: true });
      },
    );

    // ==================== Pre-Game Phase Tools ====================

    // 5. choose_class
    this.mcpServer.tool(
      'choose_class',
      'Choose your unit class for the game. Each class has different movement speed and combat properties:\n- rogue: 3 movement speed, beats mage, loses to knight\n- knight: 2 movement speed, beats rogue, loses to mage\n- mage: 1 movement speed, beats knight, loses to rogue',
      {
        class: z.enum(['rogue', 'knight', 'mage']).describe('The unit class to play as'),
      },
      async (args) => {
        if (!this.lobbyManager) {
          return errorResult('No lobby available.');
        }
        if (this.lobbyManager.phase !== 'pre_game') {
          return errorResult('Class selection is only available during the pre-game phase. Current phase: ' + this.lobbyManager.phase);
        }
        const unitClass = args['class'] as UnitClass;
        const result = this.lobbyManager.chooseClass(this.agentId, unitClass);
        if (!result.success) {
          return errorResult(result.error ?? 'Failed to choose class.');
        }
        return jsonResult({ success: true, class: unitClass });
      },
    );

    // 6. get_team_state
    this.mcpServer.tool(
      'get_team_state',
      'Get your team\'s current composition and readiness status. Shows each team member\'s chosen class and whether they are ready.',
      {},
      async () => {
        if (!this.lobbyManager) {
          return errorResult('No lobby available.');
        }
        const teamState = this.lobbyManager.getTeamState(this.agentId);
        if (!teamState) {
          return errorResult('You are not on a team yet.');
        }
        return jsonResult(teamState);
      },
    );

    // ==================== Game Phase Tools ====================

    // 7. get_game_state
    this.mcpServer.tool(
      'get_game_state',
      'Get the current game state from your perspective. Includes your unit info, visible tiles (fog of war applied), flag statuses, recent team messages, score, and whether you\'ve submitted a move this turn.',
      {},
      async () => {
        if (!this.gameManager) {
          return errorResult('No game in progress. The game has not started yet.');
        }
        if (this.gameManager.phase === 'finished') {
          // Still allow viewing final state
          const state = this.gameManager.getStateForAgent(this.agentId);
          return jsonResult({ ...state, winner: this.gameManager.winner });
        }
        try {
          const state = this.gameManager.getStateForAgent(this.agentId);
          return jsonResult(state);
        } catch (err) {
          return errorResult(err instanceof Error ? err.message : 'Failed to get game state.');
        }
      },
    );

    // 8. submit_move
    this.mcpServer.tool(
      'submit_move',
      'Submit your movement path for this turn. Provide an array of directions to move step-by-step. Valid directions: N, NE, SE, S, SW, NW. Maximum path length depends on your class speed (rogue=3, knight=2, mage=1). Submit an empty array to stay in place.',
      {
        path: z.array(z.string()).describe('Array of direction strings (e.g. ["N", "NE", "N"]). Valid: N, NE, SE, S, SW, NW. Empty array to stay put.'),
      },
      async ({ path }) => {
        if (!this.gameManager) {
          return errorResult('No game in progress.');
        }
        if (this.gameManager.phase !== 'in_progress') {
          return errorResult('Cannot submit moves — game phase is: ' + this.gameManager.phase);
        }

        // Validate direction strings
        for (const dir of path) {
          if (!isValidDirection(dir)) {
            return errorResult(
              `Invalid direction "${dir}". Valid directions are: ${VALID_DIRECTIONS.join(', ')}`,
            );
          }
        }

        const directions = path as Direction[];
        const result = this.gameManager.submitMove(this.agentId, directions);
        if (!result.success) {
          return errorResult(result.error ?? 'Failed to submit move.');
        }
        return jsonResult({ success: true, path: directions });
      },
    );

    // 9. team_chat
    this.mcpServer.tool(
      'team_chat',
      'Send a private message to your teammates. Only your team can see these messages. Use this to coordinate strategy during the game.',
      { message: z.string().describe('The message to send to your team') },
      async ({ message }) => {
        if (!this.gameManager) {
          return errorResult('No game in progress.');
        }
        if (this.gameManager.phase !== 'in_progress') {
          return errorResult('Team chat is only available during the game.');
        }
        this.gameManager.submitChat(this.agentId, message);
        return jsonResult({ success: true });
      },
    );

    // 10. get_team_messages
    this.mcpServer.tool(
      'get_team_messages',
      'Get team chat messages. Optionally filter to only messages from a specific turn onward.',
      {
        sinceTurn: z.number().optional().describe('Only return messages from this turn number onward. Omit to get all messages.'),
      },
      async ({ sinceTurn }) => {
        if (!this.gameManager) {
          return errorResult('No game in progress.');
        }
        const messages = this.gameManager.getTeamMessages(this.agentId, sinceTurn);
        return jsonResult({ messages });
      },
    );
  }
}

// ----- Factory -----

export function createMCPServer(
  agentId: string,
  lobby?: LobbyManager,
  game?: GameManager,
): LobsterMCPServer {
  const server = new LobsterMCPServer(agentId);
  if (lobby) server.setLobby(lobby);
  if (game) server.setGame(game);
  return server;
}

// ----- Standalone entry point -----

const isMain = typeof import.meta.url === 'string' &&
  import.meta.url.endsWith('/mcp.js') &&
  process.argv[1]?.endsWith('/mcp.js');

if (isMain) {
  const agentId = process.env.AGENT_ID;
  if (!agentId) {
    console.error('AGENT_ID environment variable is required');
    process.exit(1);
  }
  const server = createMCPServer(agentId);
  await server.start();
}
