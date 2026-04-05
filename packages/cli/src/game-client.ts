/**
 * GameClient — shared REST API wrapper with client-side pipeline.
 *
 * Used by both the CLI MCP server and (eventually) the bot harness.
 * Wraps ApiClient for REST calls to /api/player/* endpoints and runs
 * the client-side plugin pipeline over relay messages in responses.
 */

import { ApiClient } from "./api-client.js";
import { processState } from "./pipeline.js";

export class GameClient {
  private api: ApiClient;
  private token: string | null = null;

  constructor(serverUrl: string, token?: string) {
    this.api = new ApiClient(serverUrl);
    if (token) {
      this.token = token;
      this.api.setAuthToken(token);
    }
  }

  /** Get the current auth token (if any). */
  getToken(): string | null {
    return this.token;
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  /** Simple signin (display name, dev mode). */
  async signin(name: string): Promise<{ token: string; agentId: string; name: string; reconnected?: boolean }> {
    const result = await this.api.post('/api/player/signin', { name });
    this.token = result.token;
    this.api.setAuthToken(result.token);
    return result;
  }

  /** Challenge-response auth (wallet-based). */
  async authChallenge(): Promise<{ nonce: string; expiresIn: number }> {
    return this.api.post('/api/player/auth/challenge');
  }

  /** Verify a signed challenge. */
  async authVerify(nonce: string, signature: string, address: string, name: string): Promise<{ token: string; agentId: string; name: string }> {
    const result = await this.api.post('/api/player/auth/verify', { nonce, signature, address, name });
    this.token = result.token;
    this.api.setAuthToken(result.token);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Game operations — REST + pipeline
  // ---------------------------------------------------------------------------

  /** Get the dynamic game guide/playbook. */
  async getGuide(): Promise<any> {
    return this.api.get('/api/player/guide');
  }

  /** Get current game/lobby state (fog-filtered, with pipeline processing). */
  async getState(): Promise<any> {
    const raw = await this.api.get('/api/player/state');
    return this.processResponse(raw);
  }

  /** Long-poll for next event (turn change, chat, phase change). */
  async waitForUpdate(): Promise<any> {
    const raw = await this.api.get('/api/player/wait');
    return this.processResponse(raw);
  }

  /** Submit a gameplay move (direction path). */
  async submitMove(path: string[]): Promise<any> {
    return this.api.post('/api/player/move', { path });
  }

  /** Submit a lobby-phase action (propose-team, accept-team, leave-team, choose-class). */
  async submitAction(action: string, target?: string, cls?: string): Promise<any> {
    const body: Record<string, any> = { action };
    if (target) body.target = target;
    if (cls) body.class = cls;
    return this.api.post('/api/player/move', body);
  }

  /** Send a chat message (routed by server based on current phase). */
  async chat(message: string): Promise<any> {
    return this.api.post('/api/player/chat', { message });
  }

  // ---------------------------------------------------------------------------
  // Lobby operations
  // ---------------------------------------------------------------------------

  /** List available lobbies. */
  async listLobbies(): Promise<any> {
    return this.api.get('/api/lobbies');
  }

  /** Join an existing lobby. */
  async joinLobby(lobbyId: string): Promise<any> {
    return this.api.post('/api/player/lobby/join', { lobbyId });
  }

  /** Create a new lobby (auto-joins the creator). */
  async createLobby(teamSize?: number): Promise<any> {
    return this.api.post('/api/player/lobby/create', { teamSize });
  }

  // ---------------------------------------------------------------------------
  // Team operations
  // ---------------------------------------------------------------------------

  /** Invite an agent to your team. */
  async proposeTeam(agentId: string): Promise<any> {
    return this.api.post('/api/player/team/propose', { agentId });
  }

  /** Accept a team invite. */
  async acceptTeam(teamId: string): Promise<any> {
    return this.api.post('/api/player/team/accept', { teamId });
  }

  /** Leave your current team. */
  async leaveTeam(): Promise<any> {
    return this.api.post('/api/player/team/leave');
  }

  /** Choose your unit class (rogue, knight, mage). */
  async chooseClass(cls: string): Promise<any> {
    return this.api.post('/api/player/class', { class: cls });
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  /** Get ELO leaderboard. */
  async getLeaderboard(limit?: number, offset?: number): Promise<any> {
    const params = new URLSearchParams();
    if (limit != null) params.set('limit', String(limit));
    if (offset != null) params.set('offset', String(offset));
    const qs = params.toString();
    return this.api.get(`/api/player/leaderboard${qs ? '?' + qs : ''}`);
  }

  /** Get your own stats. */
  async getMyStats(): Promise<any> {
    return this.api.get('/api/player/stats');
  }

  // ---------------------------------------------------------------------------
  // Pipeline processing
  // ---------------------------------------------------------------------------

  /**
   * Run the client-side plugin pipeline over relay messages in a response.
   * If the response contains relayMessages, processes them and merges
   * pipeline output back into the response.
   */
  private processResponse(raw: any): any {
    if (raw && raw.relayMessages && Array.isArray(raw.relayMessages) && raw.relayMessages.length > 0) {
      const output = processState(raw);
      return {
        ...raw,
        messages: output.messages,
        pipelineOutput: Object.fromEntries(output.pipelineOutput),
      };
    }
    return raw;
  }
}
