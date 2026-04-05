# Handoff — Stateless Engine Refactor (April 4, 2026)

This document captures the current architectural decisions and what's being built. Read alongside ARCHITECTURE.md and CLAUDE.md.

---

## Core Principle

**A game is `(state, moves) -> newState`.** That's it.

The engine provides a turn clock, typed relay, and verification layer. Game plugins implement pure functions — state in, state out, deterministic by construction. No mutable classes, no caching tricks, no reconstruction.

---

## Architecture Decision: Stateless Engine (Option A)

### Why

The game engine is the product. CtL is a proof of concept. We want the engine to be the cleanest possible abstraction so other game devs can implement `CoordinationGame` and get lobbies, signing, Merkle proofs, spectator feeds, and settlement for free.

A mutable `GameManager` class was the original implementation, but it created problems:
- The `CoordinationGame` interface expects immutable state objects, so the plugin had to wrap the mutable class with a `WeakMap<CtlState, GameManager>` cache — a fragile, leaky abstraction
- The server bypassed the framework entirely during gameplay, talking to GameManager directly, meaning determinism wasn't enforced and Merkle proofs were an afterthought
- Game devs copying this pattern would inherit the complexity

### What We're Doing

1. **GameManager becomes pure functions.** `resolveTurn(state, moves) -> newState` instead of `gm.resolveTurn()`. The helpers (combat, movement, fog, hex) are already functional — the class was just glue.

2. **The plugin becomes trivial.** `CaptureTheLobsterPlugin.resolveTurn` just calls the pure function. No WeakMap, no reconstruction, no cache.

3. **The server runs games through GameRoom.** `GameFramework.createRoom()`, `GameFramework.submitMove()`, `GameFramework.resolveTurn()`. The framework automatically records turn history, hashes states, builds Merkle trees.

4. **`coordination.ts` bridge gets deleted.** It existed to connect the direct GameManager to the framework at game-finish time. With games running through GameRoom, it's unnecessary.

### What a Game Dev Implements

```typescript
const MyGame: CoordinationGame<Config, State, Move, Outcome> = {
  gameType: 'my-game',
  version: '1.0.0',
  moveSchema: { ... },  // EIP-712 types for signed moves
  
  createInitialState(config) -> state,
  validateMove(state, playerId, move) -> boolean,
  resolveTurn(state, moves) -> newState,
  isOver(state) -> boolean,
  getOutcome(state) -> outcome,
  computePayouts(outcome, players) -> payouts,
}
```

Register it, and the platform handles everything else.

### What the Server Owns (Not the Game Plugin)

- Turn timing and deadlines
- Bot orchestration
- WebSocket spectator feeds
- Fog-of-war filtering for agent views (calls game's `getStateForAgent` or equivalent)
- Relay message routing
- ELO tracking

These are presentation and orchestration concerns. The game plugin is pure game logic.

---

## What Works Right Now

- **Plugin architecture** — CtL, chat, ELO all as separate packages
- **Typed relay** — routes messages by scope, included in state responses
- **Client-side pipeline** — runs in CLI over relay messages
- **Phase-generic move** — works for both lobby actions and gameplay
- **Dynamic guide** — shows game rules + phase-appropriate tools
- **178+ tests** pass across all packages
- **Live** at capturethelobster.com

## What Still Needs Work

- Plugin config (`~/.coordination/plugins.yaml`) — hardcoded defaults
- Schema registry — types are informal strings
- Full relay-native chat — still dual-writes through old path
- Dynamic MCP tool generation from phase declarations
- Third-party plugin install flow

---

## File Map

```
ARCHITECTURE.md          — Plugin tiers, typed relay, client-side pipeline (AUTHORITATIVE for data architecture)
GAME_ENGINE_PLAN.md      — Full platform vision: identity, economics, on-chain layer (AUTHORITATIVE for vision)
CLAUDE.md                — Dev guide: build commands, known issues, file map
HANDOFF.md               — This document

packages/platform/       — @coordination-games/platform (types, plugin loader, lobby pipeline, MCP, Merkle)
packages/games/capture-the-lobster/ — @coordination-games/game-ctl (pure game functions + plugin wrapper)
packages/plugins/basic-chat/ — @coordination-games/plugin-chat (Tier 2 client-side chat)
packages/plugins/elo/    — @coordination-games/plugin-elo (Tier 3 server-side ELO)
packages/server/         — Express server, WebSocket, MCP, typed relay, bot harness
packages/web/            — React frontend
packages/cli/            — coga CLI with pipeline runner
packages/contracts/      — Solidity contracts
```
