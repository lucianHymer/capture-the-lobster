# Handoff — Plugin Architecture Session (April 4, 2026)

This document captures the current state of the codebase, key architectural decisions made during this session, open questions, and what needs to happen next. Read this alongside ARCHITECTURE.md and CLAUDE.md.

---

## What Was Built Today

### Plugin Architecture (10 phases of refactor)
- `@lobster/platform` — generic game server framework: types, plugin loader, lobby pipeline, phase-aware MCP, Merkle proofs
- `@lobster/games-ctl` — CtL as a game plugin implementing `CoordinationGame` interface
- `@lobster/plugin-chat` — Tier 2 (client-side) chat plugin using typed relay
- `@lobster/plugin-elo` — Tier 3 (server-side) ELO rating plugin
- Old `packages/engine/` and `packages/coordination/` deleted entirely

### Typed Relay
- Server-side message routing between agents, routes by **scope only** (team/all/agentId)
- Does NOT filter by pluginId or type — agents get all scoped data
- Client-side pipeline matches incoming relay data to plugins by capability type
- `GameRelay` class in `packages/server/src/typed-relay.ts`, 14 tests

### CLI Refactored
- Removed game-specific commands (propose-team, accept-team, choose-class)
- `move` is phase-generic — server validates by current phase
- `guide` command for dynamic playbook
- `tool` command for generic plugin tool invocation
- `state` and `wait` run client-side pipeline over relay messages
- Pipeline runner in `packages/cli/src/pipeline.ts`

### MCP Updates
- `get_guide` replaces `get_rules` — dynamic, phase-aware, shows available tools
- `submit_move` accepts both direction arrays (gameplay) and action objects (lobby phases)
- `get_state` and `wait_for_update` return relay messages alongside game state
- Spectator WebSocket includes delayed relay messages

---

## Key Architectural Decisions

### 1. Plugin Tiers (CRITICAL — get this right)
- **Tier 1 (Private)**: Client-only, no data leaves the agent's machine
- **Tier 2 (Relayed)**: Client code, data flows through server's typed relay. **Most plugins are this.** Chat is Tier 2.
- **Tier 3 (Integrated)**: Server-side, authoritative. Game plugins, ELO.

### 2. Relay Routes by Scope Only
The relay is a dumb pipe. It doesn't know about plugins, types, or subscriptions. It routes by `scope` field: `team` → teammates, `all` → everyone, `<agentId>` → DM. Every agent gets ALL scoped data. Their client-side pipeline decides what to do with it.

### 3. Capability Types are the Interop Contract
The `type` field on relay messages is the capability type from the schema registry (e.g. `"messaging"`, not `"chat-message"`). This is what `consumes`/`provides` reference in the pipeline. Two different chat plugins that both produce `type: "messaging"` are automatically compatible. The `pluginId` field is metadata for provenance, NOT used for routing or matching.

### 4. Pipeline Runs Client-Side
The topological sort pipeline (producer → mapper → enricher → filter) runs on the agent's machine, not the server. Two agents with different plugins see different things. The server just stores and routes raw relay data.

### 5. Engine Runs Live, Framework Handles Lifecycle
The game engine (`GameManager`) runs directly during gameplay for performance and direct state access. The framework (`GameFramework`) handles lifecycle events at game boundaries: Merkle tree construction, payout computation, on-chain settlement. The bridge is in `packages/server/src/coordination.ts`.

**Open question from Lucian**: Is this the right abstraction? He wants the architecture to be clean enough that other game developers can copy it as the archetypal example. The current split works but may be confusing — having both GameManager (direct) and GameFramework (lifecycle) doing different things. Need to think about whether this should be unified so game developers only interact with one interface.

### 6. MCP Tools as Submit-Move Wrappers
MCP tools like `propose_team`, `choose_class` should be wrappers around `submit_move`. Game plugins declare which actions become MCP tools during which phases. Under the hood, same validation, same code path. The specific MCP tools exist for agent discoverability (agents can see what actions are available), but they call the same logic as `submit_move({action: "propose-team", ...})`.

### 7. Chat as a First-Class Platform Shortcut
`coga chat` is a top-level command even though chat is "just a plugin." It's universal enough to deserve a shortcut. Internally, it should look for the first installed plugin that handles outgoing messages (a plugin that provides the "messaging" capability), not hardcode `basic-chat`.

---

## Open Questions (For Next Session)

### 1. Unify GameManager and GameFramework?
Currently the server uses GameManager directly for the game loop and GameFramework only at game finish for Merkle trees/payouts. Lucian wants this to be clean enough for other developers to copy. Should we:
- Make GameFramework hold a live GameManager internally (not snapshots)?
- Or document the current split clearly as the intended pattern?
- The concern: the `CaptureTheLobsterPlugin` serializes/deserializes through `CtlState` snapshots, which is wasteful for a live game loop. But the snapshot model is what makes deterministic replay work.

### 2. Plugin-Declared MCP Tools
How exactly should game plugins declare which actions become MCP tools? Current `LobbyPhase` has a `tools` field. But the server still hardcodes the specific MCP tools (`propose_team`, etc.). Need to make the MCP tool generation dynamic from the phase's tool declarations.

### 3. Client-Side Plugin Discovery & Config
The plan says `~/.coordination/plugins.yaml` for plugin config. This isn't built yet. The CLI currently has `basic-chat` hardcoded as a default plugin. Need:
- `plugins.yaml` format
- `coga plugins` command to list installed plugins
- npm install flow for third-party plugins

### 4. Schema Registry
On-chain schema registry for capability types isn't built. Currently the types ("messaging", "agents", "agent-tags") are just strings with no formal schema. For interop to work, these need to be registered with their data shapes.

### 5. Chat Plugin — Full Relay-Native Flow
Chat currently dual-writes: goes through both the old `GameManager.submitChat()` AND the typed relay. The old path should be removed once the spectator UI reads chat from relay messages instead of from `game.teamMessages`. The frontend (`GamePage.tsx`) needs to be updated to read from `relayMessages` in the spectator state.

---

## What Works Right Now

- **Server starts**, creates lobbies, bots play full games
- **Spectator UI** renders hex grid, units, fog of war, chat, kill feed
- **External agents** connect via MCP at capturethelobster.com/mcp
- **Typed relay** routes messages by scope, included in state responses
- **Client-side pipeline** runs in CLI over relay messages
- **Phase-generic move** works for both lobby actions and gameplay
- **Dynamic guide** shows game rules + phase-appropriate tools
- **178+ tests** pass across all packages
- **Live** at capturethelobster.com

## What Doesn't Work Yet

- Plugin config (`~/.coordination/plugins.yaml`) — hardcoded defaults
- Schema registry — types are informal strings
- Full relay-native chat — still dual-writes through old GameManager path
- Dynamic MCP tool generation from phase declarations
- Third-party plugin install flow
- `coga chat` doesn't use plugin discovery (hardcoded basic-chat)

---

## File Map (Current)

```
ARCHITECTURE.md          — Plugin tiers, typed relay, client-side pipeline, CLI surface (AUTHORITATIVE for data architecture)
GAME_ENGINE_PLAN.md      — Full platform vision: identity, economics, on-chain layer (AUTHORITATIVE for vision)
CLAUDE.md                — Dev guide: build commands, known issues, file map
HANDOFF.md               — This document
README.md                — Player-facing pitch
docs/archive/            — Stale docs (DESIGN.md, TECHNICAL-SPEC.md, PLAYER-INTEGRATION.md, REFACTOR_PLAN.md)
skills/coordination-games/
  SKILL.md               — Agent skill file (entry point)
  capture-the-lobster.md — CtL game rules reference
  CLI_REFERENCE.md       — Full CLI command table

packages/platform/       — @lobster/platform (types, plugin loader, lobby pipeline, MCP, Merkle)
packages/games/capture-the-lobster/ — @lobster/games-ctl (hex, combat, fog, movement, game engine)
packages/plugins/basic-chat/ — @lobster/plugin-chat (Tier 2 client-side chat)
packages/plugins/elo/    — @lobster/plugin-elo (Tier 3 server-side ELO)
packages/server/         — Express server, WebSocket, MCP, typed relay, bot harness
packages/web/            — React frontend
packages/cli/            — coga CLI with pipeline runner
packages/contracts/      — Solidity contracts
```

---

## Starting Prompt for Next Session

```
Read these files in order:
1. CLAUDE.md — Build commands, package structure, known issues
2. ARCHITECTURE.md — Plugin tiers, typed relay, client-side pipeline, CLI/MCP surface
3. HANDOFF.md — What was built, decisions made, open questions, what's next

Key context: The plugin architecture is built and working. CtL runs as a game
plugin with a typed relay for data routing, client-side pipeline for message
processing, and phase-generic CLI/MCP interface. Open questions center around
unifying the GameManager/GameFramework split and making the architecture clean
enough for other game developers to copy as a reference implementation.
```
