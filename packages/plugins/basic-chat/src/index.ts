/**
 * Basic Chat Plugin — provides team/all chat messaging for games.
 *
 * Implements ToolPlugin with:
 * - Phase-aware routing (lobby=all, game=team)
 * - Per-agent message cursor tracking (prevents duplicates)
 * - Extensible message tags for pipeline enrichment
 */

import type { ToolPlugin, AgentInfo, Message, PluginContext } from '@lobster/platform';

interface ChatState {
  messages: Message[];
  cursors: Map<string, number>; // agentId -> last seen index
  phase: 'lobby' | 'pre_game' | 'in_progress' | 'finished';
  teamAssignments: Map<string, string>; // agentId -> team
}

export function createBasicChatPlugin(): ToolPlugin & { _state: ChatState } {
  const state: ChatState = {
    messages: [],
    cursors: new Map(),
    phase: 'lobby',
    teamAssignments: new Map(),
  };

  return {
    id: 'basic-chat',
    version: '0.1.0',
    modes: [{ name: 'messaging', consumes: [], provides: ['messaging'] }],
    purity: 'stateful',

    tools: [
      {
        name: 'chat',
        description: 'Send a message to your team (during game) or all players (during lobby)',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'The message to send' },
          },
          required: ['message'],
        },
      },
    ],

    init(ctx: PluginContext) {
      // Initialize cursor for this player
      state.cursors.set(ctx.playerId, 0);
    },

    handleData(mode: string, inputs: Map<string, any>): Map<string, any> {
      return new Map([['messaging', [...state.messages]]]);
    },

    handleCall(tool: string, args: unknown, caller: AgentInfo): unknown {
      if (tool !== 'chat') return { error: `Unknown tool: ${tool}` };

      const { message } = args as { message: string };
      if (!message || typeof message !== 'string') {
        return { error: 'message is required and must be a string' };
      }

      // Determine scope based on phase
      const scope: 'team' | 'all' =
        state.phase === 'lobby' ? 'all' : 'team';

      const msg: Message = {
        from: parseInt(caller.id, 10) || 0,
        body: message,
        turn: 0, // set by caller context
        scope,
        tags: { source: 'basic-chat' },
      };

      state.messages.push(msg);

      return { success: true, scope };
    },

    // Expose state for testing and external access
    _state: state,
  };
}

/**
 * Get new messages for an agent since their last cursor position.
 * Advances the cursor. Filters by team scope during gameplay.
 */
export function getNewMessages(
  plugin: ReturnType<typeof createBasicChatPlugin>,
  agentId: string,
  agentTeam?: string,
): Message[] {
  const state = plugin._state;
  const cursor = state.cursors.get(agentId) ?? 0;
  const allMessages = state.messages.slice(cursor);

  // Advance cursor
  state.cursors.set(agentId, state.messages.length);

  // During gameplay, filter to team messages only
  if (state.phase === 'in_progress' && agentTeam) {
    return allMessages.filter((msg) => {
      if (msg.scope === 'all') return true;
      // Check if sender is on same team
      const senderTeam = state.teamAssignments.get(String(msg.from));
      return senderTeam === agentTeam;
    });
  }

  return allMessages;
}

/**
 * Set the game phase (affects message routing).
 */
export function setPhase(
  plugin: ReturnType<typeof createBasicChatPlugin>,
  phase: ChatState['phase'],
): void {
  plugin._state.phase = phase;
}

/**
 * Set team assignments for team-scoped messaging.
 */
export function setTeams(
  plugin: ReturnType<typeof createBasicChatPlugin>,
  teams: Map<string, string>,
): void {
  plugin._state.teamAssignments = teams;
}

/** Singleton-compatible export. */
export const BasicChatPlugin = createBasicChatPlugin();
