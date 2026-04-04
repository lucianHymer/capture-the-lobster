# Plugin Architecture Refactor Plan

**Status:** Plan only — do not execute until Lucian reviews.

This document maps the current codebase to the plugin architecture described in GAME_ENGINE_PLAN.md. It covers four areas: CoordinationGame + LobbyConfig, ToolPlugin introduction, CLI/MCP split, and package restructuring.

---

## 1. CoordinationGame Gains LobbyConfig + Phase Composition

### Current State

`CoordinationGame<TConfig, TState, TMove, TOutcome>` in `packages/coordination/src/types.ts` has:
- `gameType`, `version`, `moveSchema`
- `createInitialState`, `validateMove`, `resolveTurn`, `isOver`, `getOutcome`
- `entryCost`, `computePayouts`

Lobby logic lives entirely in `packages/engine/src/lobby.ts` as `LobbyManager` — a monolithic class that handles forming, pre-game, and starting phases with hardcoded CtL assumptions (team proposals, class selection, auto-merge).

`LobbyRunner` in `packages/server/src/lobby-runner.ts` orchestrates bots through the lobby. It directly calls `LobbyManager` methods and has CtL-specific bot prompts.

### Changes

**A. Add `lobby` and plugin declarations to `CoordinationGame` interface**

File: `packages/coordination/src/types.ts`

```typescript
// ADD to CoordinationGame interface:

  /** Lobby flow declaration — how players get from queue to game */
  lobby: LobbyConfig;

  /** Tool plugins this game requires (must be installed to play) */
  requiredPlugins: string[];

  /** Tool plugins this game recommends (suggested, not required) */
  recommendedPlugins: string[];
```

**B. Define `LobbyConfig` and `LobbyPhase` types**

File: `packages/coordination/src/types.ts` (add below existing `LobbyConfig`)

The current `LobbyConfig` interface (`teamSize, numTeams, timeoutMs, gameType`) is too simple. Replace with:

```typescript
/** Lobby flow configuration — ordered pipeline of pre-game phases. */
interface LobbyConfig {
  queueType: 'open' | 'stake-tiered' | 'invite';
  phases: LobbyPhaseConfig[];
  matchmaking: MatchmakingConfig;
}

interface LobbyPhaseConfig {
  /** Phase plugin ID (e.g. "queue", "shuffle", "team-formation", "class-selection") */
  phaseId: string;
  /** Phase-specific config (timeout, constraints, etc.) */
  config: Record<string, any>;
}

interface MatchmakingConfig {
  /** Min/max players needed to start */
  minPlayers: number;
  maxPlayers: number;
  /** Team size (players per team) */
  teamSize: number;
  /** Number of teams */
  numTeams: number;
  /** Queue timeout before auto-fill or cancel */
  queueTimeoutMs: number;
}

/** A lobby phase plugin — defines one stage of the lobby pipeline. */
interface LobbyPhase<TPhaseState = any> {
  /** Unique phase ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Initialize phase state */
  init(players: LobbyPlayer[], config: Record<string, any>): TPhaseState;
  /** Process a player action within this phase */
  handleAction(state: TPhaseState, playerId: string, action: string, data: any): TPhaseState;
  /** Check if this phase is complete */
  isComplete(state: TPhaseState): boolean;
  /** Get the result when complete (passed to next phase or game creation) */
  getResult(state: TPhaseState): Record<string, any>;
  /** Optional: MCP tools available during this phase */
  tools?: ToolDefinition[];
}
```

**C. Update the CtL plugin with lobby flow**

File: `packages/engine/src/plugin.ts`

Add to `CaptureTheLobsterPlugin`:

```typescript
  lobby: {
    queueType: 'open',
    phases: [
      { phaseId: 'queue', config: { timeoutMs: 120000 } },
      { phaseId: 'team-formation', config: { timeoutMs: 120000, allowProposals: true } },
      { phaseId: 'class-selection', config: { timeoutMs: 60000, classes: ['rogue', 'knight', 'mage'] } },
    ],
    matchmaking: {
      minPlayers: 4,
      maxPlayers: 12,
      teamSize: 2, // default, overridden by lobby creation
      numTeams: 2,
      queueTimeoutMs: 120000,
    },
  },
  requiredPlugins: ['basic-chat'],
  recommendedPlugins: ['shared-vision', 'map-annotations'],
```

**D. Extract CtL-specific lobby phases from LobbyManager**

Current `LobbyManager` (410 lines) has three logical phases hardcoded together. Extract into separate `LobbyPhase` implementations:

| Current code (lobby.ts) | Becomes | Location |
|---|---|---|
| `addAgent`, `proposeTeam`, `acceptTeam`, `autoMergeTeams`, `lobbyChat` (lines 60-280) | `TeamFormationPhase` | `packages/games/capture-the-lobster/phases/team-formation.ts` |
| `startPreGame`, `chooseClass`, `getTeamState`, `teamChat` (lines 280-400) | `ClassSelectionPhase` | `packages/games/capture-the-lobster/phases/class-selection.ts` |
| `createGame` (lines 400-410) | Stays in plugin — called by platform after phases complete | `packages/games/capture-the-lobster/plugin.ts` |

Platform-provided phases (generic, reusable):

| Phase | Location |
|---|---|
| `QueuePhase` — collect players, timeout, ready-check | `packages/platform/phases/queue.ts` |
| `ShufflePhase` — random sub-lobbies from queue | `packages/platform/phases/shuffle.ts` |
| `RandomPairingPhase` — pair opponents (for OATHBREAKER) | `packages/platform/phases/random-pairing.ts` |

**E. Update `GameFramework` to run phase pipelines**

File: `packages/coordination/src/server/framework.ts`

Add a `LobbyRoom` concept alongside `GameRoom`:

```typescript
interface LobbyRoom {
  lobbyId: string;
  gameType: string;
  players: LobbyPlayer[];
  currentPhaseIndex: number;
  phases: LobbyPhase[];
  phaseStates: any[];
  config: LobbyConfig;
}
```

`GameFramework` gains:
- `createLobby(gameType, config)` — instantiate phases from the game plugin's `lobby.phases`
- `advancePhase(lobbyId)` — check `isComplete`, call `getResult`, init next phase
- `handleLobbyAction(lobbyId, playerId, action, data)` — delegate to current phase
- Phase registry: `registerPhase(id, PhaseClass)` — platform + game-specific phases

---

## 2. ToolPlugin Introduction

### Current State

There is no `ToolPlugin` interface. Tool-like behaviors are hardcoded:

| Current behavior | Location | Lines |
|---|---|---|
| Chat (team messaging) | `mcp-http.ts` tool handler + `GameManager.submitChat` + `LobbyManager.lobbyChat/teamChat` | mcp-http.ts:659-695, game.ts:~200, lobby.ts:~230-270 |
| ELO tracking | `elo.ts` — standalone SQLite tracker | 222 lines |
| Game state (fog-filtered) | `game.ts:getStateForAgent` + `fog.ts:buildVisibleState` | game.ts:~130-200, fog.ts:136 lines |
| Leaderboard | `mcp-http.ts` tool handler + `elo.ts:getLeaderboard` | mcp-http.ts:~800-830 |
| Wait for update | `mcp-http.ts` — custom polling/wake system | mcp-http.ts:~700-780 |

### Changes

**A. Define `ToolPlugin` interface**

File: `packages/coordination/src/types.ts`

```typescript
/** Tool plugin interface — extends agent capabilities during gameplay. */
interface ToolPlugin {
  /** Unique plugin ID (matches npm package name convention: coordination-plugin-*) */
  id: string;
  version: string;

  /** Plugin can operate in multiple modes (different consumes/provides combos) */
  modes: PluginMode[];

  /** Pure plugins are cacheable per turn; stateful must re-run */
  purity: 'pure' | 'stateful';

  /** MCP tools this plugin exposes to agents (optional) */
  tools?: ToolDefinition[];

  /** Initialize plugin with context (called once per game) */
  init?(ctx: PluginContext): void;

  /** Passive: process data through the pipeline */
  handleData(mode: string, inputs: Map<string, any>): Map<string, any>;

  /** Active: agent explicitly calls a plugin tool */
  handleCall?(tool: string, args: unknown, caller: AgentInfo): unknown;
}

interface PluginMode {
  name: string;
  consumes: string[];   // capability types needed as input
  provides: string[];   // capability types produced as output
}

interface PluginContext {
  gameType: string;
  gameId: string;
  turnCursor: number;   // platform controls visibility
  relay: RelayClient;    // for sending typed data through the server
  playerId: string;
}

interface AgentInfo {
  id: string;
  handle: string;
  team?: string;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, any>;  // JSON Schema
}
```

**B. Migrate chat to a `basic-chat` plugin**

Current chat is scattered across three files. Consolidate into one plugin:

Source files to extract from:
- `mcp-http.ts:659-695` — chat tool handler (phase-aware routing)
- `game.ts` — `submitChat`, `teamMessages` storage, message filtering
- `lobby.ts` — `lobbyChat`, `teamChat`, `preGameChat` storage

New file: `packages/plugins/basic-chat/index.ts`

```typescript
export const BasicChatPlugin: ToolPlugin = {
  id: 'basic-chat',
  version: '0.1.0',
  modes: [
    { name: 'messaging', consumes: [], provides: ['messaging'] },
  ],
  purity: 'stateful',  // messages accumulate
  tools: [
    {
      name: 'chat',
      description: 'Send a message to your team',
      inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
    },
  ],
  // handleData: produce Message[] from stored messages
  // handleCall: route chat to appropriate scope (team/all) based on game phase
};
```

The `Message` type from the plan:

```typescript
interface Message {
  from: number;          // agent ID
  body: string;
  turn: number;
  scope: 'team' | 'all';
  tags: Record<string, any>;  // plugins enrich this
}
```

**C. Migrate ELO to an analytics plugin**

Current: `packages/server/src/elo.ts` (222 lines, SQLite-backed)

New: `packages/plugins/elo/index.ts`

This is a **Private** tier plugin (server-side analytics, no agent-facing tools during gameplay). It hooks into game completion events, not the turn pipeline.

```typescript
export const EloPlugin: ToolPlugin = {
  id: 'elo-tracker',
  version: '0.1.0',
  modes: [],  // no pipeline participation — event-driven
  purity: 'stateful',
  tools: [
    { name: 'get_leaderboard', description: 'Get ELO rankings', inputSchema: { ... } },
    { name: 'get_my_stats', description: 'Get your ELO stats', inputSchema: { ... } },
  ],
  // handleCall: proxy to EloTracker methods
  // init: open SQLite DB, register for game-completion events
};
```

**D. Plugin loader and pipeline wiring**

New file: `packages/platform/plugins/loader.ts`

```typescript
class PluginLoader {
  private registry: Map<string, ToolPlugin> = new Map();

  register(plugin: ToolPlugin): void;
  
  /** Build the pipeline for a game — topological sort on consumes/provides */
  buildPipeline(gameType: string, activePlugins: string[]): PluginPipeline;
  
  /** Get MCP tools for active plugins */
  getTools(activePlugins: string[]): ToolDefinition[];
}

class PluginPipeline {
  /** Run all plugins in order for a turn */
  execute(turnData: Map<string, any>): Map<string, any>;
}
```

Ordering rules (from plan):
1. Producers first (no `consumes`)
2. Topological sort on dependency graph
3. Independent providers of same capability run in parallel, merge outputs
4. Cycles = error

---

## 3. CLI vs MCP Tool Split

### Current State

All tools are MCP tools, exposed via `mcp-http.ts`. There's no CLI. The current tool set:

| Tool | Category | Should be... |
|---|---|---|
| `signin` | Auth | CLI (one-time setup) |
| `get_rules` | Info | MCP (becomes `get_guide`) |
| `get_leaderboard` | Browse | CLI |
| `get_my_stats` | Browse | CLI |
| `list_lobbies` | Browse | CLI |
| `create_lobby` | Lobby | CLI |
| `join_lobby` | Lobby | CLI → transitions to MCP |
| `propose_team` | Lobby | MCP (during lobby phase) |
| `accept_team` | Lobby | MCP (during lobby phase) |
| `leave_team` | Lobby | MCP (during lobby phase) |
| `choose_class` | Pre-game | MCP (during pre-game phase) |
| `chat` | Gameplay | MCP (plugin tool, not platform) |
| `submit_move` | Gameplay | MCP |
| `get_state` | Gameplay | MCP |
| `wait_for_update` | Gameplay | MCP |

### Target Split

**MCP tools (the game loop — tight, ~5-8 tools during play):**

```
get_guide(game)       — dynamic context (rules + plugins + tools + status)
get_state()           — fog-filtered game state
submit_move(move)     — signed move
wait_for_update()     — block until next turn
+ active plugin tools — chat(), attest(), get_reputation() (only when active)
```

Phase-specific tools appear/disappear based on lobby phase:
- During `team-formation`: `propose_team`, `accept_team`, `leave_team`
- During `class-selection`: `choose_class`
- During `in_progress`: `submit_move`, `get_state`

**CLI commands (setup, admin, browsing):**

```
coordination status          — identity + vibes + current state
coordination register <name> — one-time setup
coordination balance         — vibes balance
coordination fund            — show deposit address
coordination withdraw        — cashout
coordination games           — list available game types
coordination lobbies         — list open lobbies
coordination join <id>       — join a lobby (transitions to MCP game loop)
coordination guide <game>    — dynamic context guide (also available as MCP tool)
coordination plugins         — list installed plugins
```

### Migration Steps

**A. Create `packages/cli/` package** (new)

This is the `coordination` npm package. Two modes:
- Skill mode (bash commands, primary for Claude Code)
- MCP mode (`coordination serve --stdio` for Claude Desktop)

The CLI is a new package — doesn't exist yet. It wraps the HTTP API for browsing/admin and serves as the MCP entry point for gameplay.

**B. Move browse/admin tools out of `mcp-http.ts`**

Current `mcp-http.ts` (1010 lines) handles everything. Split:

| Remove from mcp-http.ts | Move to |
|---|---|
| `signin` tool handler | CLI auth flow (challenge-response) |
| `get_leaderboard` tool | CLI `coordination leaderboard` → HTTP API call |
| `get_my_stats` tool | CLI `coordination status` → HTTP API call |
| `list_lobbies` tool | CLI `coordination lobbies` → HTTP API call |
| `create_lobby` tool | CLI `coordination create-lobby` → HTTP API call |
| `join_lobby` tool | CLI `coordination join` → HTTP API call, then switch to MCP mode |

**C. Make `get_rules` dynamic → `get_guide`**

Current `get_rules` returns a static rules string. Replace with dynamic guide:

```typescript
function generateGuide(game: string, playerPlugins: string[], playerState: any): string {
  const gamePlugin = registry.getGame(game);
  const activePlugins = resolvePlugins(playerPlugins, game);
  return [
    gamePlugin.rules,
    gamePlugin.lobbyGuide,
    ...activePlugins.flatMap(p => p.tools?.map(formatToolHelp) ?? []),
    gamePlugin.strategyTips,
    formatPlayerStatus(playerState),
  ].join('\n');
}
```

**D. Phase-aware tool visibility in MCP**

`mcp-http.ts` currently exposes all tools regardless of game state. Change to:

```typescript
function getAvailableTools(phase: string, activePlugins: ToolPlugin[]): ToolDefinition[] {
  const platformTools = PHASE_TOOLS[phase] ?? [];  // phase-specific platform tools
  const pluginTools = activePlugins.flatMap(p => p.tools ?? []);
  return [...platformTools, ...pluginTools];
}

const PHASE_TOOLS = {
  'team-formation': [propose_team, accept_team, leave_team, chat],
  'class-selection': [choose_class, chat],
  'in_progress': [get_state, submit_move, wait_for_update],
};
```

---

## 4. Package Structure Changes

### Current Structure

```
packages/
  engine/src/          — CtL game logic (hex, combat, fog, map, game, lobby, plugin)
  server/src/          — Express server, MCP, bots, ELO, lobby runner
  coordination/src/    — CoordinationGame interface, framework, auth, balance, merkle
  web/src/             — React frontend
```

### Target Structure

```
packages/
  platform/            — Generic game server framework (extracted from server + coordination)
    src/
      framework.ts     — GameFramework (from coordination/server/framework.ts)
      lobby.ts         — LobbyRoom, phase pipeline runner (NEW)
      mcp.ts           — Generic MCP transport, phase-aware tool visibility (from server/mcp-http.ts)
      spectator.ts     — WebSocket spectator feed (from server/api.ts)
      relay.ts         — Typed data relay for plugin communication (NEW)
      auth.ts          — Wallet-based auth (from coordination/server/auth.ts)
      balance.ts       — Vibes ($VIBE) tracking (from coordination/server/balance.ts)
      merkle.ts        — Merkle tree construction (from coordination/merkle.ts)
      types.ts         — All shared types (from coordination/types.ts)
      phases/           — Platform-provided lobby phases
        queue.ts
        shuffle.ts
        random-pairing.ts
        ready-check.ts
      plugins/
        loader.ts      — Plugin registry, pipeline builder, topological sort (NEW)

  games/
    capture-the-lobster/
      src/
        plugin.ts      — CaptureTheLobsterPlugin (from engine/plugin.ts, gains lobby config)
        hex.ts         — unchanged (from engine/hex.ts)
        los.ts         — unchanged
        combat.ts      — unchanged
        fog.ts         — unchanged
        map.ts         — unchanged
        movement.ts    — unchanged
        game.ts        — GameManager (from engine/game.ts, loses chat responsibility)
        phases/
          team-formation.ts  — extracted from engine/lobby.ts
          class-selection.ts — extracted from engine/lobby.ts

  plugins/
    basic-chat/
      index.ts         — Chat plugin (extracted from mcp-http.ts + game.ts + lobby.ts)
    elo/
      index.ts         — ELO tracker plugin (from server/elo.ts)

  cli/                 — NEW: coordination CLI + MCP server
    src/
      index.ts         — CLI entry point
      commands/        — CLI command handlers
        status.ts
        register.ts
        lobbies.ts
        join.ts
        guide.ts
        balance.ts
        plugins.ts
      mcp-serve.ts     — MCP stdio server mode
      skill.md         — Claude Code skill file

  web/src/             — stays, gains generic game renderer architecture
    components/
      HexGrid.tsx      — CtL-specific renderer (unchanged for now)
    pages/
      HomePage.tsx     — Platform landing (just revamped)
```

### Migration Order

This should be done in phases to avoid breaking the running game:

**Phase A: Types + interfaces (non-breaking)**
1. Add `LobbyConfig`, `LobbyPhase`, `ToolPlugin` types to `coordination/types.ts`
2. Add `lobby`, `requiredPlugins`, `recommendedPlugins` to `CoordinationGame` interface
3. Update `CaptureTheLobsterPlugin` in `engine/plugin.ts` with lobby config
4. All existing code continues to work — new fields are additive

**Phase B: Extract lobby phases (parallel to existing code)**
1. Create `TeamFormationPhase` and `ClassSelectionPhase` as `LobbyPhase` implementations
2. They wrap the existing `LobbyManager` methods internally
3. Add phase pipeline runner to `GameFramework`
4. Old `LobbyRunner` continues to work alongside new path

**Phase C: Extract chat plugin (parallel)**
1. Create `basic-chat` plugin with the `ToolPlugin` interface
2. It wraps existing chat storage/routing
3. MCP tools gain plugin-aware tool injection
4. Old chat tools continue to work

**Phase D: Package restructure**
1. Move engine files to `packages/games/capture-the-lobster/`
2. Move framework code to `packages/platform/`
3. Create `packages/plugins/` with extracted plugins
4. Update all import paths, tsconfig references, npm workspace config
5. This is the big breaking change — do it in one PR

**Phase E: CLI package**
1. Create `packages/cli/` with `coordination` binary
2. Move browse/admin tools out of `mcp-http.ts`
3. Implement `coordination guide` (dynamic)
4. Add skill.md for Claude Code

---

## Files That Change (Summary)

| File | Action | Notes |
|---|---|---|
| `packages/coordination/src/types.ts` | **Modify** | Add ToolPlugin, LobbyPhase, LobbyConfig, PluginMode, Message types |
| `packages/coordination/src/server/framework.ts` | **Modify** | Add LobbyRoom, phase pipeline, plugin loader |
| `packages/engine/src/plugin.ts` | **Modify** | Add lobby config, required/recommended plugins |
| `packages/engine/src/lobby.ts` | **Extract from** | Split into TeamFormationPhase + ClassSelectionPhase |
| `packages/engine/src/game.ts` | **Modify** | Remove chat responsibility (delegate to plugin) |
| `packages/server/src/mcp-http.ts` | **Modify** | Phase-aware tool visibility, plugin tool injection, remove admin tools |
| `packages/server/src/api.ts` | **Modify** | Use framework lobby pipeline instead of direct LobbyManager |
| `packages/server/src/elo.ts` | **Extract to** | `packages/plugins/elo/` |
| `packages/server/src/lobby-runner.ts` | **Modify** | Use phase pipeline for bot orchestration |
| `packages/plugins/basic-chat/index.ts` | **New** | Chat as ToolPlugin |
| `packages/plugins/elo/index.ts` | **New** | ELO as ToolPlugin |
| `packages/platform/` | **New** | Extracted framework + phases + plugin loader |
| `packages/games/capture-the-lobster/` | **New** | CtL game plugin + phases (moved from engine) |
| `packages/cli/` | **New** | coordination CLI + MCP server |

---

## Key Risks

1. **Breaking the live game.** The server at capturethelobster.com runs the current code. Package restructure (Phase D) must be done carefully — ideally one PR with all import path changes.

2. **LobbyManager is tightly coupled.** The forming→pre_game→starting flow has implicit state transitions that the phase pipeline must replicate exactly. Extract-and-wrap (keep LobbyManager internally, expose via LobbyPhase interface) is safer than rewrite.

3. **Chat is everywhere.** Messages flow through lobby.ts, game.ts, and mcp-http.ts with per-agent cursors for deduplication. The basic-chat plugin must replicate this cursor behavior or agents will see duplicate messages.

4. **Bot orchestration depends on LobbyManager directly.** `lobby-runner.ts` and `claude-bot.ts` call LobbyManager methods by name. They need to be updated to use the phase pipeline, or kept as a testing harness that bypasses the framework.

5. **npm workspace config.** Adding 4+ new packages to the workspace requires updating root `package.json` and dealing with the existing `--include=dev` workaround.
