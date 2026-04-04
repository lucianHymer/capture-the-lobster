/**
 * Integration test: Full game lifecycle through the framework.
 *
 * Verifies that CtL runs as a plugin with the chat and ELO plugins
 * through the GameFramework, PluginLoader, and LobbyPipeline.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  GameFramework,
  PluginLoader,
  LobbyPipeline,
  getAvailableTools,
  generateGuide,
} from '@lobster/coordination';
import type { ToolPlugin, AgentInfo } from '@lobster/coordination';
import { CaptureTheLobsterPlugin, TeamFormationPhase, ClassSelectionPhase } from '@lobster/engine';
import { createBasicChatPlugin, setPhase, setTeams, getNewMessages } from '@lobster/plugin-chat';
import { createEloPlugin } from '@lobster/plugin-elo';

describe('Full game lifecycle', () => {
  let eloPlugin: ReturnType<typeof createEloPlugin>;

  afterEach(() => {
    if (eloPlugin) eloPlugin.tracker.close();
  });

  it('runs a complete CtL game through the framework', async () => {
    // 1. Create framework, register CtL plugin
    const framework = new GameFramework({ turnTimeoutMs: 5000 });
    framework.registerGame(CaptureTheLobsterPlugin);
    expect(framework.listGameTypes()).toContain('capture-the-lobster');

    // 2. Create plugin loader with chat + ELO
    const loader = new PluginLoader();
    const chatPlugin = createBasicChatPlugin();
    eloPlugin = createEloPlugin(':memory:');
    loader.register(chatPlugin);
    loader.register(eloPlugin);
    expect(loader.listPlugins()).toContain('basic-chat');
    expect(loader.listPlugins()).toContain('elo');

    // 3. Set up players
    const players: AgentInfo[] = [
      { id: 'p1', handle: 'alice', team: 'A' },
      { id: 'p2', handle: 'bob', team: 'A' },
      { id: 'p3', handle: 'carol', team: 'B' },
      { id: 'p4', handle: 'dave', team: 'B' },
    ];

    // 4. Run lobby pipeline (team formation + class selection)
    const pipeline = new LobbyPipeline([
      TeamFormationPhase,
      ClassSelectionPhase,
    ]);
    await pipeline.start(players, { teamSize: 2 });
    expect(pipeline.isComplete()).toBe(true);

    const lobbyResult = pipeline.getResult();
    expect(lobbyResult.groups.length).toBeGreaterThanOrEqual(1);
    expect(lobbyResult.metadata.classPicks).toBeDefined();

    // 5. Create a game room through the framework
    const game = CaptureTheLobsterPlugin;
    const classPicks = lobbyResult.metadata.classPicks;
    const config = {
      mapSeed: 'integration-test',
      teamSize: 2,
      turnLimit: 5,
      players: [
        { id: 'p1', team: 'A' as const, unitClass: classPicks['p1'] ?? 'rogue' },
        { id: 'p2', team: 'A' as const, unitClass: classPicks['p2'] ?? 'knight' },
        { id: 'p3', team: 'B' as const, unitClass: classPicks['p3'] ?? 'mage' },
        { id: 'p4', team: 'B' as const, unitClass: classPicks['p4'] ?? 'rogue' },
      ],
    };

    const room = framework.createRoom(
      'capture-the-lobster',
      config,
      ['p1', 'p2', 'p3', 'p4'],
    );
    expect(room.phase).toBe('in_progress');
    expect(room.turn).toBe(1);

    // 6. Verify chat plugin works during game
    setPhase(chatPlugin, 'in_progress');
    setTeams(chatPlugin, new Map([['1', 'A'], ['2', 'A'], ['3', 'B'], ['4', 'B']]));
    chatPlugin.handleCall!('chat', { message: 'rush flag!' }, { id: '1', handle: 'alice', team: 'A' });
    const chatData = chatPlugin.handleData('messaging', new Map());
    expect(chatData.get('messaging')).toHaveLength(1);

    // 7. Build plugin pipeline and execute
    const pluginPipeline = loader.buildPipeline(['basic-chat', 'elo']);
    const pipelineResult = pluginPipeline.execute(new Map());
    expect(pipelineResult.has('messaging')).toBe(true);
    expect(pipelineResult.has('leaderboard')).toBe(true);

    // 8. Submit moves for a turn (empty paths = stand still)
    for (const id of ['p1', 'p2', 'p3', 'p4']) {
      framework.submitMove(room.roomId, id, { path: [] });
    }

    // 9. Resolve turn
    const turnData = framework.resolveTurn(room.roomId);
    expect(turnData).not.toBeNull();
    expect(room.turn).toBe(2);

    // 10. Run a few more turns until game ends or we hit turn limit
    for (let i = 0; i < 10 && room.phase === 'in_progress'; i++) {
      for (const id of ['p1', 'p2', 'p3', 'p4']) {
        framework.submitMove(room.roomId, id, { path: [] });
      }
      framework.resolveTurn(room.roomId);
    }

    // Game should be finished (turn limit of 5)
    expect(room.phase).toBe('finished');

    // 11. Verify outcome
    const result = framework.finishGame(room.roomId);
    expect(result).not.toBeNull();
    expect(result!.result.gameType).toBe('capture-the-lobster');
    expect(result!.result.movesRoot).toBeTruthy();
    expect(result!.result.players).toHaveLength(4);

    // 12. Payouts should be zero-sum
    const payoutTotal = [...result!.payouts.values()].reduce((a, b) => a + b, 0);
    expect(payoutTotal).toBe(0);
  });

  it('chat plugin delivers team-scoped messages', () => {
    const chat = createBasicChatPlugin();
    setPhase(chat, 'in_progress');
    setTeams(chat, new Map([['1', 'A'], ['2', 'A'], ['3', 'B']]));

    chat.init!({ gameType: 'test', gameId: 'g1', turnCursor: 0, relay: { send() {}, receive() { return []; } }, playerId: '1' });
    chat.init!({ gameType: 'test', gameId: 'g1', turnCursor: 0, relay: { send() {}, receive() { return []; } }, playerId: '3' });

    chat.handleCall!('chat', { message: 'A only' }, { id: '1', handle: 'alice', team: 'A' });
    chat.handleCall!('chat', { message: 'B only' }, { id: '3', handle: 'carol', team: 'B' });

    const aliceMsgs = getNewMessages(chat, '1', 'A');
    expect(aliceMsgs).toHaveLength(1);
    expect(aliceMsgs[0].body).toBe('A only');

    const carolMsgs = getNewMessages(chat, '3', 'B');
    expect(carolMsgs).toHaveLength(1);
    expect(carolMsgs[0].body).toBe('B only');
  });

  it('plugin pipeline processes data in correct order', () => {
    const loader = new PluginLoader();

    const chat = createBasicChatPlugin();
    chat.handleCall!('chat', { message: 'test' }, { id: '1', handle: 'test' });
    loader.register(chat);

    // Mock enricher that adds tags
    const enricher: ToolPlugin = {
      id: 'enricher',
      version: '0.1.0',
      modes: [{ name: 'enrich', consumes: ['messaging'], provides: ['enriched'] }],
      purity: 'pure',
      handleData(mode, inputs) {
        const msgs = inputs.get('messaging') ?? [];
        return new Map([['enriched', msgs.map((m: any) => ({ ...m, enriched: true }))]]);
      },
    };
    loader.register(enricher);

    const pipeline = loader.buildPipeline(['basic-chat', 'enricher']);
    expect(pipeline.steps[0].plugin.id).toBe('basic-chat');
    expect(pipeline.steps[1].plugin.id).toBe('enricher');

    const result = pipeline.execute(new Map());
    expect(result.get('messaging')).toHaveLength(1);
    expect(result.get('enriched')).toHaveLength(1);
    expect(result.get('enriched')[0].enriched).toBe(true);
  });

  it('MCP tools change based on game phase', () => {
    const chat = createBasicChatPlugin();
    const plugins: ToolPlugin[] = [chat];

    // Lobby phase
    const lobbyTools = getAvailableTools('lobby', plugins);
    const lobbyNames = lobbyTools.map((t) => t.name);
    expect(lobbyNames).toContain('get_guide');
    expect(lobbyNames).toContain('chat');
    expect(lobbyNames).not.toContain('submit_move');

    // Team formation phase
    const teamTools = getAvailableTools('team-formation', plugins);
    const teamNames = teamTools.map((t) => t.name);
    expect(teamNames).toContain('propose_team');
    expect(teamNames).toContain('chat');
    expect(teamNames).not.toContain('submit_move');

    // Game phase
    const gameTools = getAvailableTools('in_progress', plugins);
    const gameNames = gameTools.map((t) => t.name);
    expect(gameNames).toContain('submit_move');
    expect(gameNames).toContain('get_state');
    expect(gameNames).toContain('chat');
    expect(gameNames).not.toContain('propose_team');
  });

  it('generates dynamic guide with plugin info', () => {
    const chat = createBasicChatPlugin();
    const guide = generateGuide({
      gameType: 'Capture the Lobster',
      gameRules: 'Hex grid capture-the-flag. First team to capture wins.',
      activePlugins: [chat],
      phase: 'in_progress',
      playerState: { elo: 1250, team: 'A' },
    });

    expect(guide).toContain('Capture the Lobster');
    expect(guide).toContain('in_progress');
    expect(guide).toContain('basic-chat');
    expect(guide).toContain('`chat`');
    expect(guide).toContain('1250');
  });
});
