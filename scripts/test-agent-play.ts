/**
 * Test: spawn a Claude agent that plays Capture the Lobster
 * via the external MCP endpoint. This simulates what any
 * external player (OpenClaw, Claude Code, etc.) would experience.
 */

import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:5173';

async function main() {
  // 1. Create a lobby with an external slot
  console.log('Creating lobby...');
  const lobbyRes = await fetch(`${SERVER_URL}/api/lobbies/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamSize: 2, externalSlots: 1 }),
  });
  const { lobbyId } = await lobbyRes.json() as any;
  console.log(`Lobby created: ${lobbyId}`);

  // 2. Register as external agent
  console.log('Registering...');
  const regRes = await fetch(`${SERVER_URL}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lobbyId }),
  });
  const { token, agentId } = await regRes.json() as any;
  console.log(`Registered as ${agentId}, token: ${token}`);

  // 3. Create a wrapper MCP server that proxies to our HTTP endpoint
  //    This is needed because the SDK expects an in-process MCP server,
  //    but our game tools are on the HTTP endpoint.
  const mcpServer = createSdkMcpServer({
    name: 'lobster-game',
    version: '0.1.0',
    tools: [
      tool('get_lobby', 'Get the current lobby state', {}, async () => {
        const res = await mcpCall('get_lobby', {});
        return { content: [{ type: 'text' as const, text: res }] };
      }),
      tool('lobby_chat', 'Send a message to the lobby', {
        message: z.string(),
      }, async ({ message }) => {
        const res = await mcpCall('lobby_chat', { message });
        return { content: [{ type: 'text' as const, text: res }] };
      }),
      tool('propose_team', 'Invite an agent to your team', {
        agentId: z.string(),
      }, async ({ agentId: targetId }) => {
        const res = await mcpCall('propose_team', { agentId: targetId });
        return { content: [{ type: 'text' as const, text: res }] };
      }),
      tool('accept_team', 'Accept a team invitation', {
        teamId: z.string(),
      }, async ({ teamId }) => {
        const res = await mcpCall('accept_team', { teamId });
        return { content: [{ type: 'text' as const, text: res }] };
      }),
      tool('get_team_state', 'Get your team composition and class picks', {}, async () => {
        const res = await mcpCall('get_team_state', {});
        return { content: [{ type: 'text' as const, text: res }] };
      }),
      tool('choose_class', 'Pick your class', {
        unitClass: z.enum(['rogue', 'knight', 'mage']),
      }, async ({ unitClass }) => {
        const res = await mcpCall('choose_class', { class: unitClass });
        return { content: [{ type: 'text' as const, text: res }] };
      }),
      tool('team_chat', 'Send a message to your team', {
        message: z.string(),
      }, async ({ message }) => {
        const res = await mcpCall('team_chat', { message });
        return { content: [{ type: 'text' as const, text: res }] };
      }),
      tool('get_game_state', 'Get the game state from your perspective', {}, async () => {
        const res = await mcpCall('get_game_state', {});
        return { content: [{ type: 'text' as const, text: res }] };
      }),
      tool('submit_move', 'Submit your movement path', {
        path: z.array(z.string()),
      }, async ({ path }) => {
        const res = await mcpCall('submit_move', { path });
        return { content: [{ type: 'text' as const, text: res }] };
      }),
    ],
  });

  // MCP HTTP call helper
  let sessionId: string | null = null;

  async function mcpCall(toolName: string, args: Record<string, any>): Promise<string> {
    // Initialize if needed
    if (!sessionId) {
      const initRes = await fetch(`${SERVER_URL}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 0,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test-agent', version: '0.1' },
          },
        }),
      });
      const initText = await initRes.text();
      const match = initText.match(/Mcp-Session-Id:\s*(\S+)/i) || [];
      // Extract session from response headers
      sessionId = initRes.headers.get('mcp-session-id') || 'default';
    }

    const res = await fetch(`${SERVER_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${token}`,
        ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Math.floor(Math.random() * 10000),
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
    });

    const text = await res.text();
    // Parse SSE response
    const dataLine = text.split('\n').find(l => l.startsWith('data: '));
    if (dataLine) {
      const json = JSON.parse(dataLine.slice(6));
      if (json.result?.content?.[0]?.text) {
        return json.result.content[0].text;
      }
      if (json.error) {
        return JSON.stringify(json.error);
      }
    }
    return text;
  }

  // 4. Launch the agent!
  console.log('\nLaunching Claude agent to play the game...\n');

  const GAME_PROMPT = `You are playing "Capture the Lobster" — a team-based capture-the-flag game for AI agents on a hex grid.

You just joined a lobby. Here's what to do:

## Phase 1: Lobby
1. Call get_lobby to see who's in the lobby
2. Use lobby_chat to introduce yourself and discuss strategy
3. Use propose_team to invite someone to team up with you
4. If someone invites you, accept with accept_team

## Phase 2: Pre-game (after teams form)
1. Call get_team_state to see your team
2. Use team_chat to discuss class composition
3. Use choose_class to pick rogue, knight, or mage
   - Rogue: Speed 3, Vision 4, beats Mage, dies to Knight
   - Knight: Speed 2, Vision 2, beats Rogue, dies to Mage
   - Mage: Speed 1, Vision 3, Range 2, beats Knight, dies to Rogue

## Phase 3: Game
Keep looping:
1. Call get_game_state to see the board
2. Use team_chat to share what you see
3. Use submit_move with directions (N/NE/SE/S/SW/NW)
4. Repeat until game over

## Strategy
- Rogues run for the flag — they're fast
- Knights guard the base and chase rogues
- Mages control space with ranged attacks
- COMMUNICATE! Your teammates can't see what you see

Start now! Check the lobby and begin.`;

  const q = query({
    prompt: GAME_PROMPT,
    options: {
      model: 'haiku',
      tools: [],
      mcpServers: { 'lobster-game': mcpServer },
      allowedTools: [
        'mcp__lobster-game__get_lobby',
        'mcp__lobster-game__lobby_chat',
        'mcp__lobster-game__propose_team',
        'mcp__lobster-game__accept_team',
        'mcp__lobster-game__get_team_state',
        'mcp__lobster-game__choose_class',
        'mcp__lobster-game__team_chat',
        'mcp__lobster-game__get_game_state',
        'mcp__lobster-game__submit_move',
      ],
      maxTurns: 50,
      persistSession: false,
      cwd: '/tmp',
    },
  });

  for await (const msg of q) {
    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'text') {
          console.log(`[Agent]: ${block.text}`);
        } else if (block.type === 'tool_use') {
          console.log(`[Tool]: ${block.name}(${JSON.stringify(block.input).slice(0, 100)})`);
        }
      }
    }
  }

  console.log('\nGame finished!');
}

main().catch(console.error);
