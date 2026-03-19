import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import HexGrid from '../components/HexGrid';
import type {
  SpectatorGameState,
  VisibleTile,
  KillEvent,
  ChatMessage,
} from '../types';

// ---------------------------------------------------------------------------
// Mock replay data generator — 15 turns of an interesting game
// ---------------------------------------------------------------------------

interface ReplayData {
  gameId: string;
  mapRadius: number;
  turns: number;
  winner: 'A' | 'B' | null;
  turnStates: SpectatorGameState[];
}

function generateBaseTiles(mapRadius: number): VisibleTile[] {
  const tiles: VisibleTile[] = [];
  for (let dq = -mapRadius; dq <= mapRadius; dq++) {
    for (
      let dr = Math.max(-mapRadius, -dq - mapRadius);
      dr <= Math.min(mapRadius, -dq + mapRadius);
      dr++
    ) {
      let type: VisibleTile['type'] = 'ground';
      if (dq === -5 && dr === 2) type = 'base_a';
      if (dq === -5 && dr === 3) type = 'base_a';
      if (dq === -4 && dr === 2) type = 'base_a';
      if (dq === 5 && dr === -2) type = 'base_b';
      if (dq === 5 && dr === -3) type = 'base_b';
      if (dq === 4 && dr === -2) type = 'base_b';

      const wallPositions = [
        '0,0', '1,0', '-1,1', '0,-1',
        '2,-3', '3,-3',
        '-2,4', '-3,4',
        '1,2', '1,3',
        '-1,-2', '-2,-1',
      ];
      if (wallPositions.includes(`${dq},${dr}`)) type = 'wall';

      tiles.push({ q: dq, r: dr, type });
    }
  }
  return tiles;
}

interface UnitDef {
  id: string;
  team: 'A' | 'B';
  unitClass: 'rogue' | 'knight' | 'mage';
  q: number;
  r: number;
  alive: boolean;
  carryingFlag: boolean;
}

function generateMockReplay(): ReplayData {
  const mapRadius = 6;
  const totalTurns = 15;
  const gameId = 'replay-demo';

  // Define unit starting positions
  const unitDefs: UnitDef[][] = [];

  // Turn 0 — initial positions
  const initialUnits: UnitDef[] = [
    { id: 'a1', team: 'A', unitClass: 'rogue', q: -4, r: 3, alive: true, carryingFlag: false },
    { id: 'a2', team: 'A', unitClass: 'knight', q: -5, r: 2, alive: true, carryingFlag: false },
    { id: 'a3', team: 'A', unitClass: 'mage', q: -3, r: 2, alive: true, carryingFlag: false },
    { id: 'a4', team: 'A', unitClass: 'rogue', q: -5, r: 3, alive: true, carryingFlag: false },
    { id: 'b1', team: 'B', unitClass: 'rogue', q: 4, r: -3, alive: true, carryingFlag: false },
    { id: 'b2', team: 'B', unitClass: 'knight', q: 5, r: -2, alive: true, carryingFlag: false },
    { id: 'b3', team: 'B', unitClass: 'mage', q: 3, r: -2, alive: true, carryingFlag: false },
    { id: 'b4', team: 'B', unitClass: 'knight', q: 5, r: -3, alive: true, carryingFlag: false },
  ];

  // Movement script for each turn — positions and events
  const turnScripts: {
    moves: Record<string, [number, number]>;
    kills?: { killer: string; victim: string; reason: string }[];
    flagPickup?: { unitId: string; flagTeam: 'A' | 'B' };
    flagDrop?: { flagTeam: 'A' | 'B'; q: number; r: number };
    flagCapture?: { team: 'A' | 'B' };
    chatA?: { from: string; message: string }[];
    chatB?: { from: string; message: string }[];
  }[] = [
    // Turn 0: starting positions (no moves)
    { moves: {} },
    // Turn 1: both teams advance
    {
      moves: { a1: [-3, 2], a4: [-4, 3], b1: [3, -2], b4: [4, -2] },
      chatA: [{ from: 'a1', message: 'Rogue moving up, scouting right' }],
      chatB: [{ from: 'b1', message: 'Heading toward their base' }],
    },
    // Turn 2: continued push
    {
      moves: { a1: [-2, 2], a3: [-2, 1], a2: [-4, 2], b1: [2, -1], b3: [2, -1], b4: [3, -1] },
      chatA: [{ from: 'a3', message: 'Mage covering mid corridor' }],
    },
    // Turn 3: a1 rogue pushes deep, b3 mage gets caught
    {
      moves: { a1: [-1, 2], a4: [-3, 3], b1: [1, -1], b2: [4, -2] },
      chatB: [{ from: 'b2', message: 'Knight holding flag position' }],
    },
    // Turn 4: a1 sneaks near B base, first kill — a3 mage kills b3 mage at range
    {
      moves: { a1: [0, 1], a3: [-1, 0] },
      kills: [{ killer: 'a3', victim: 'b3', reason: 'mage ranged kill on mage' }],
      chatA: [{ from: 'a3', message: 'Got their mage! Mid is clear' }],
      chatB: [{ from: 'b1', message: 'We lost our mage, regroup' }],
    },
    // Turn 5: a1 pushes toward flag, b1 chases
    {
      moves: { a1: [1, 1], b1: [0, 1], b4: [2, -1] },
      chatA: [{ from: 'a1', message: 'Almost at their flag!' }],
    },
    // Turn 6: a1 gets to B base, picks up flag!
    {
      moves: { a1: [2, 0], a2: [-3, 2] },
      flagPickup: { unitId: 'a1', flagTeam: 'B' },
      chatA: [
        { from: 'a1', message: 'GOT THE FLAG! Coming home' },
        { from: 'a2', message: 'Nice! Escorting from south' },
      ],
      chatB: [{ from: 'b2', message: 'They grabbed our flag! Chase them!' }],
    },
    // Turn 7: a1 retreats with flag, b1 gives chase; b4 knight kills a4 rogue
    {
      moves: { a1: [1, 1], a4: [-2, 3], b1: [1, 0], b4: [1, 0] },
      kills: [{ killer: 'b4', victim: 'a4', reason: 'knight beats rogue in melee' }],
      chatB: [{ from: 'b4', message: 'Took out their second rogue' }],
    },
    // Turn 8: tense chase continues
    {
      moves: { a1: [0, 1], a3: [0, 1], b1: [0, 1], b2: [3, -1] },
      chatA: [{ from: 'a3', message: 'I see their rogue behind you, covering' }],
    },
    // Turn 9: a3 mage kills b1 rogue who was chasing
    {
      moves: { a1: [-1, 2], b2: [2, 0] },
      kills: [{ killer: 'a3', victim: 'b1', reason: 'mage ranged kill on rogue' }],
      chatA: [{ from: 'a3', message: 'Rogue down! Path is clearing' }],
      chatB: [{ from: 'b2', message: 'Lost another one. I have to intercept' }],
    },
    // Turn 10: b2 knight tries to cut off a1
    {
      moves: { a1: [-2, 2], a2: [-2, 2], b2: [1, 1], b4: [0, 1] },
      chatB: [{ from: 'b4', message: 'Flanking from south, trying to cut off' }],
    },
    // Turn 11: a2 knight fights b4 knight — both clash, b4 dies (a2 had position)
    {
      moves: { a1: [-3, 3], b2: [0, 1] },
      kills: [{ killer: 'a2', victim: 'b4', reason: 'knight vs knight — positional advantage' }],
      chatA: [{ from: 'a2', message: 'Their knight is down, keep going!' }],
    },
    // Turn 12: only b2 left chasing, a1 almost home
    {
      moves: { a1: [-4, 3], a3: [-1, 2], b2: [-1, 2] },
      chatB: [{ from: 'b2', message: 'Last chance... charging in' }],
    },
    // Turn 13: b2 reaches a1 but a3 mage protects — kills b2
    {
      moves: { a1: [-4, 2] },
      kills: [{ killer: 'a3', victim: 'b2', reason: 'mage ranged kill protecting flag carrier' }],
      chatA: [
        { from: 'a3', message: 'Got the last one! Bring it home!' },
        { from: 'a1', message: 'Heading to base NOW' },
      ],
    },
    // Turn 14: a1 reaches base — CAPTURE!
    {
      moves: { a1: [-5, 2] },
      flagCapture: { team: 'A' },
      chatA: [{ from: 'a1', message: 'CAPTURED!! GG' }],
      chatB: [{ from: 'b2', message: 'gg well played' }],
    },
  ];

  // Build states from the script
  const allKills: KillEvent[] = [];
  const allChatA: ChatMessage[] = [];
  const allChatB: ChatMessage[] = [];
  let currentUnits = initialUnits.map((u) => ({ ...u }));
  let flagBOnGround: { q: number; r: number } | null = null;
  let flagBCaptured = false;
  let winner: 'A' | 'B' | null = null;

  const turnStates: SpectatorGameState[] = [];

  for (let turn = 0; turn < totalTurns; turn++) {
    const script = turnScripts[turn] || { moves: {} };

    // Apply moves
    for (const [unitId, [q, r]] of Object.entries(script.moves)) {
      const unit = currentUnits.find((u) => u.id === unitId);
      if (unit && unit.alive) {
        unit.q = q;
        unit.r = r;
      }
    }

    // Apply kills
    if (script.kills) {
      for (const kill of script.kills) {
        const victim = currentUnits.find((u) => u.id === kill.victim);
        const killer = currentUnits.find((u) => u.id === kill.killer);
        if (victim && killer) {
          victim.alive = false;
          allKills.push({
            killerId: kill.killer,
            killerClass: killer.unitClass,
            killerTeam: killer.team,
            victimId: kill.victim,
            victimClass: victim.unitClass,
            victimTeam: victim.team,
            reason: kill.reason,
            turn,
          });
          // If victim was carrying flag, drop it
          if (victim.carryingFlag) {
            victim.carryingFlag = false;
            flagBOnGround = { q: victim.q, r: victim.r };
          }
        }
      }
    }

    // Flag pickup
    if (script.flagPickup) {
      const unit = currentUnits.find((u) => u.id === script.flagPickup!.unitId);
      if (unit) {
        unit.carryingFlag = true;
        flagBOnGround = null;
      }
    }

    // Flag drop
    if (script.flagDrop) {
      flagBOnGround = { q: script.flagDrop.q, r: script.flagDrop.r };
    }

    // Flag capture
    if (script.flagCapture) {
      winner = script.flagCapture.team;
      flagBCaptured = true;
      // Remove flag from carrier
      const carrier = currentUnits.find((u) => u.carryingFlag);
      if (carrier) carrier.carryingFlag = false;
    }

    // Chat
    if (script.chatA) {
      for (const msg of script.chatA) {
        allChatA.push({ from: msg.from, message: msg.message, turn });
      }
    }
    if (script.chatB) {
      for (const msg of script.chatB) {
        allChatB.push({ from: msg.from, message: msg.message, turn });
      }
    }

    // Build tiles
    const tiles = generateBaseTiles(mapRadius);

    // Place alive units
    for (const unit of currentUnits) {
      if (!unit.alive) continue;
      const tile = tiles.find((t) => t.q === unit.q && t.r === unit.r);
      if (tile) {
        tile.unit = {
          id: unit.id,
          team: unit.team,
          unitClass: unit.unitClass,
          carryingFlag: unit.carryingFlag,
        };
      }
    }

    // Place flags
    // Flag A always at base (nobody picks it up in this game)
    const flagATile = tiles.find((t) => t.q === -5 && t.r === 2);
    if (flagATile) flagATile.flag = { team: 'A' };

    // Flag B — at base, on ground, carried, or captured
    if (!flagBCaptured) {
      const carrier = currentUnits.find((u) => u.carryingFlag && u.alive);
      if (!carrier) {
        if (flagBOnGround) {
          const dropTile = tiles.find(
            (t) => t.q === flagBOnGround!.q && t.r === flagBOnGround!.r,
          );
          if (dropTile) dropTile.flag = { team: 'B' };
        } else {
          // At base
          const flagBTile = tiles.find((t) => t.q === 5 && t.r === -2);
          if (flagBTile) flagBTile.flag = { team: 'B' };
        }
      }
      // If carried, the unit's carryingFlag handles the visual
    }

    // Determine flag status strings
    const carrierUnit = currentUnits.find((u) => u.carryingFlag && u.alive);
    let flagBStatus = 'At Base';
    if (flagBCaptured) {
      flagBStatus = 'Captured by Team A!';
    } else if (carrierUnit) {
      flagBStatus = `Carried by ${carrierUnit.team} ${carrierUnit.unitClass}`;
    } else if (flagBOnGround) {
      flagBStatus = `Dropped at (${flagBOnGround.q}, ${flagBOnGround.r})`;
    }

    const isFinished = turn === totalTurns - 1 || winner !== null;

    turnStates.push({
      turn,
      maxTurns: totalTurns,
      phase: isFinished ? 'finished' : turn === 0 ? 'pre_game' : 'in_progress',
      timeRemaining: 0,
      tiles,
      kills: allKills.filter((k) => k.turn <= turn),
      chatA: allChatA.filter((c) => c.turn <= turn),
      chatB: allChatB.filter((c) => c.turn <= turn),
      flagA: { status: 'At Base' },
      flagB: { status: flagBStatus },
      winner: isFinished ? winner : null,
      mapRadius,
    });
  }

  return {
    gameId,
    mapRadius,
    turns: totalTurns,
    winner,
    turnStates,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const CLASS_ICONS: Record<string, string> = {
  rogue: 'R',
  knight: 'K',
  mage: 'M',
};

function KillFeed({ kills }: { kills: KillEvent[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {kills.length === 0 && (
        <p className="text-gray-600 text-xs italic">No kills yet</p>
      )}
      {[...kills].reverse().map((k, i) => {
        const killerColor =
          k.killerTeam === 'A' ? 'text-blue-400' : 'text-red-400';
        const victimColor =
          k.victimTeam === 'A' ? 'text-blue-400' : 'text-red-400';
        return (
          <div
            key={i}
            className="text-xs flex items-center gap-1 text-gray-300"
          >
            <span className="text-gray-500 w-6 text-right shrink-0">
              T{k.turn}
            </span>
            <span className={`font-bold ${killerColor}`}>
              {CLASS_ICONS[k.killerClass]}
            </span>
            <span className="text-gray-500">&rarr;</span>
            <span
              className={`font-bold ${victimColor} line-through opacity-60`}
            >
              {CLASS_ICONS[k.victimClass]}
            </span>
            <span className="text-gray-600 text-[10px] truncate">
              {k.reason}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ChatLog({
  messages,
  team,
}: {
  messages: ChatMessage[];
  team: 'A' | 'B';
}) {
  const teamColor = team === 'A' ? 'text-blue-400' : 'text-red-400';
  return (
    <div className="flex flex-col gap-1">
      {messages.length === 0 && (
        <p className="text-gray-600 text-xs italic">No messages</p>
      )}
      {messages.map((m, i) => (
        <div key={i} className="text-xs">
          <span className="text-gray-500 mr-1">T{m.turn}</span>
          <span className={`font-semibold ${teamColor}`}>{m.from}:</span>{' '}
          <span className="text-gray-300">&ldquo;{m.message}&rdquo;</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReplayPage
// ---------------------------------------------------------------------------

export default function ReplayPage() {
  const { id } = useParams<{ id: string }>();
  const [currentTurn, setCurrentTurn] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<'A' | 'B' | 'all'>('all');
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Generate mock replay data
  const replay = useMemo(() => generateMockReplay(), []);

  const totalTurns = replay.turns;
  const turnState = replay.turnStates[currentTurn];

  // Auto-play logic
  useEffect(() => {
    if (isPlaying) {
      playIntervalRef.current = setInterval(() => {
        setCurrentTurn((prev) => {
          if (prev >= totalTurns - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 1500);
    } else {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    }
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    };
  }, [isPlaying, totalTurns]);

  // Navigation
  const goPrev = useCallback(() => {
    setIsPlaying(false);
    setCurrentTurn((prev) => Math.max(0, prev - 1));
  }, []);

  const goNext = useCallback(() => {
    setIsPlaying(false);
    setCurrentTurn((prev) => Math.min(totalTurns - 1, prev + 1));
  }, [totalTurns]);

  const togglePlay = useCallback(() => {
    // If at end, restart
    setCurrentTurn((prev) => {
      if (prev >= totalTurns - 1) {
        return 0;
      }
      return prev;
    });
    setIsPlaying((prev) => !prev);
  }, [totalTurns]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      } else if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goPrev, goNext, togglePlay]);

  // Fog-of-war computation for team perspectives
  const fogTiles = useMemo(() => {
    if (selectedTeam === 'all') return undefined;

    // Gather positions of alive units on the selected team
    const teamUnits: { q: number; r: number }[] = [];
    for (const tile of turnState.tiles) {
      if (tile.unit && tile.unit.team === selectedTeam) {
        teamUnits.push({ q: tile.q, r: tile.r });
      }
    }

    // Visibility radius of 3 hexes around each friendly unit
    const visibleKeys = new Set<string>();
    const viewRadius = 3;
    for (const { q: uq, r: ur } of teamUnits) {
      for (let dq = -viewRadius; dq <= viewRadius; dq++) {
        for (
          let dr = Math.max(-viewRadius, -dq - viewRadius);
          dr <= Math.min(viewRadius, -dq + viewRadius);
          dr++
        ) {
          visibleKeys.add(`${uq + dq},${ur + dr}`);
        }
      }
    }

    // Also always show friendly base tiles
    const baseTileType = selectedTeam === 'A' ? 'base_a' : 'base_b';
    for (const tile of turnState.tiles) {
      if (tile.type === baseTileType) {
        visibleKeys.add(`${tile.q},${tile.r}`);
      }
    }

    // fogTiles = everything NOT visible
    const fog = new Set<string>();
    for (const tile of turnState.tiles) {
      const key = `${tile.q},${tile.r}`;
      if (!visibleKeys.has(key)) {
        fog.add(key);
      }
    }

    return fog;
  }, [turnState, selectedTeam]);

  // Chat messages up to current turn
  const chatMessages = useMemo(() => {
    if (selectedTeam === 'A') return turnState.chatA;
    if (selectedTeam === 'B') return turnState.chatB;
    return [...turnState.chatA, ...turnState.chatB].sort(
      (a, b) => a.turn - b.turn,
    );
  }, [turnState, selectedTeam]);

  const chatTeamLabel =
    selectedTeam === 'all' ? 'All Chat' : `Team ${selectedTeam} Chat`;

  // Kill feed — current turn state already has kills filtered to <= turn
  const kills = turnState.kills;

  const teamButtons: { label: string; value: 'A' | 'B' | 'all' }[] = [
    { label: 'Team A', value: 'A' },
    { label: 'Team B', value: 'B' },
    { label: 'Full Reveal', value: 'all' },
  ];

  const isFinished = turnState.phase === 'finished';

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] -mx-6 -my-8 px-4 py-3 gap-2">
      {/* Top bar — title + scrubber */}
      <div className="flex flex-col bg-gray-900 rounded-lg px-4 py-2 shrink-0 gap-2">
        {/* Title row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">
              Replay{' '}
              <span className="font-mono text-emerald-400">
                {id ?? 'demo'}
              </span>
            </span>
            <span className="text-sm font-semibold text-gray-200">
              Turn {currentTurn}/{totalTurns - 1}
            </span>
          </div>

          {/* Winner banner */}
          {isFinished && replay.winner && (
            <span className="text-sm font-bold px-3 py-1 rounded bg-emerald-800 text-emerald-200 animate-pulse">
              {'🦞'} Team {replay.winner} Wins!
            </span>
          )}
          {isFinished && !replay.winner && (
            <span className="text-sm font-bold px-3 py-1 rounded bg-gray-700 text-gray-200">
              Draw!
            </span>
          )}
        </div>

        {/* Scrubber row */}
        <div className="flex items-center gap-3">
          {/* Prev */}
          <button
            onClick={goPrev}
            disabled={currentTurn === 0}
            className="px-2 py-1 text-sm rounded bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Previous turn (Left arrow)"
          >
            &#9664;
          </button>

          {/* Next */}
          <button
            onClick={goNext}
            disabled={currentTurn >= totalTurns - 1}
            className="px-2 py-1 text-sm rounded bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Next turn (Right arrow)"
          >
            &#9654;
          </button>

          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            className={`px-3 py-1 text-sm rounded font-semibold transition-colors ${
              isPlaying
                ? 'bg-emerald-700 text-emerald-100 hover:bg-emerald-600'
                : 'bg-emerald-800 text-emerald-200 hover:bg-emerald-700'
            }`}
            title="Play/Pause (Space)"
          >
            {isPlaying ? '⏸ Pause' : '▶▶ Play'}
          </button>

          {/* Slider */}
          <input
            type="range"
            min={0}
            max={totalTurns - 1}
            value={currentTurn}
            onChange={(e) => {
              setIsPlaying(false);
              setCurrentTurn(Number(e.target.value));
            }}
            className="flex-1 h-2 rounded-lg appearance-none cursor-pointer bg-gray-700
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-4
              [&::-webkit-slider-thumb]:h-4
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-emerald-500
              [&::-webkit-slider-thumb]:hover:bg-emerald-400
              [&::-webkit-slider-thumb]:transition-colors
              [&::-moz-range-thumb]:w-4
              [&::-moz-range-thumb]:h-4
              [&::-moz-range-thumb]:rounded-full
              [&::-moz-range-thumb]:bg-emerald-500
              [&::-moz-range-thumb]:border-0
              [&::-moz-range-thumb]:hover:bg-emerald-400"
          />

          {/* Turn label */}
          <span className="text-xs text-gray-400 tabular-nums w-14 text-right shrink-0">
            {currentTurn}/{totalTurns - 1}
          </span>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex gap-2 flex-1 min-h-0">
        {/* Hex grid */}
        <div className="flex-1 bg-gray-900/50 rounded-lg p-2 flex items-center justify-center min-w-0">
          <HexGrid
            tiles={turnState.tiles}
            fogTiles={fogTiles}
            mapRadius={replay.mapRadius}
            selectedTeam={selectedTeam}
          />
        </div>

        {/* Right sidebar */}
        <div className="w-56 shrink-0 flex flex-col gap-2">
          {/* Kill feed */}
          <div className="bg-gray-900 rounded-lg p-3 flex flex-col gap-2 max-h-[40%] overflow-hidden">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Kill Feed
            </h3>
            <div className="overflow-y-auto flex-1 scrollbar-thin">
              <KillFeed kills={kills} />
            </div>
          </div>

          {/* Chat log */}
          <div className="bg-gray-900 rounded-lg p-3 flex flex-col gap-2 flex-1 overflow-hidden">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              {chatTeamLabel}
            </h3>
            <div className="overflow-y-auto flex-1 scrollbar-thin">
              <ChatLog
                messages={chatMessages}
                team={selectedTeam === 'all' ? 'A' : selectedTeam}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar — perspective toggle + flag status */}
      <div className="flex items-center justify-between bg-gray-900 rounded-lg px-4 py-2 shrink-0">
        <div className="flex items-center gap-4">
          {/* Perspective toggle */}
          <div className="flex items-center gap-1">
            {teamButtons.map((btn) => (
              <button
                key={btn.value}
                onClick={() => setSelectedTeam(btn.value)}
                className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                  selectedTeam === btn.value
                    ? btn.value === 'A'
                      ? 'bg-blue-900/60 text-blue-300'
                      : btn.value === 'B'
                        ? 'bg-red-900/60 text-red-300'
                        : 'bg-emerald-900/60 text-emerald-300'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>

          {/* Flag A status */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-lg">{'🦞'}</span>
            <span className="text-blue-400 font-semibold">Flag A:</span>
            <span className="text-gray-300">{turnState.flagA.status}</span>
          </div>
        </div>

        {/* Flag B status */}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-red-400 font-semibold">Flag B:</span>
          <span className="text-gray-300">{turnState.flagB.status}</span>
          <span className="text-lg">{'🦞'}</span>
        </div>
      </div>
    </div>
  );
}
