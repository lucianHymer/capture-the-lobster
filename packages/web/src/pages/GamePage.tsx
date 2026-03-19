import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import HexGrid from '../components/HexGrid';
import type {
  SpectatorGameState,
  VisibleTile,
  KillEvent,
  ChatMessage,
} from '../types';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

function generateMockState(): SpectatorGameState {
  const mapRadius = 6;
  const tiles: VisibleTile[] = [];

  // Generate full hex grid
  for (let dq = -mapRadius; dq <= mapRadius; dq++) {
    for (
      let dr = Math.max(-mapRadius, -dq - mapRadius);
      dr <= Math.min(mapRadius, -dq + mapRadius);
      dr++
    ) {
      let type: VisibleTile['type'] = 'ground';

      // Bases
      if (dq === -5 && dr === 2) type = 'base_a';
      if (dq === -5 && dr === 3) type = 'base_a';
      if (dq === -4 && dr === 2) type = 'base_a';
      if (dq === 5 && dr === -2) type = 'base_b';
      if (dq === 5 && dr === -3) type = 'base_b';
      if (dq === 4 && dr === -2) type = 'base_b';

      // Walls — a cluster in the middle and some scattered
      const wallPositions = [
        '0,0', '1,0', '-1,1', '0,-1',
        '2,-3', '3,-3',
        '-2,4', '-3,4',
        '1,2', '1,3',
        '-1,-2', '-2,-1',
      ];
      if (wallPositions.includes(`${dq},${dr}`)) type = 'wall';

      const tile: VisibleTile = { q: dq, r: dr, type };
      tiles.push(tile);
    }
  }

  // Place units
  const unitPlacements: {
    q: number;
    r: number;
    team: 'A' | 'B';
    unitClass: 'rogue' | 'knight' | 'mage';
    carryingFlag?: boolean;
    id: string;
  }[] = [
    { q: -4, r: 3, team: 'A', unitClass: 'rogue', id: 'a1' },
    { q: -3, r: 2, team: 'A', unitClass: 'knight', id: 'a2' },
    { q: -2, r: 0, team: 'A', unitClass: 'mage', id: 'a3' },
    { q: 2, r: -1, team: 'A', unitClass: 'rogue', id: 'a4', carryingFlag: true },
    { q: 4, r: -3, team: 'B', unitClass: 'rogue', id: 'b1' },
    { q: 3, r: -2, team: 'B', unitClass: 'knight', id: 'b2' },
    { q: 2, r: 0, team: 'B', unitClass: 'mage', id: 'b3' },
    { q: -1, r: 2, team: 'B', unitClass: 'knight', id: 'b4' },
  ];

  for (const u of unitPlacements) {
    const tile = tiles.find((t) => t.q === u.q && t.r === u.r);
    if (tile) {
      tile.unit = {
        id: u.id,
        team: u.team,
        unitClass: u.unitClass,
        carryingFlag: u.carryingFlag,
      };
    }
  }

  // Place flags
  // Flag A is being carried by a4 (already shown via carryingFlag)
  // Flag B sits at its base
  const flagBTile = tiles.find((t) => t.q === 5 && t.r === -2);
  if (flagBTile) flagBTile.flag = { team: 'B' };

  // Flag A's home position (currently carried, so show flag icon at base dimmed — or not at all)
  // We won't place it on the map since it's carried.

  const kills: KillEvent[] = [
    {
      killerId: 'a1',
      killerClass: 'rogue',
      killerTeam: 'A',
      victimId: 'b5',
      victimClass: 'mage',
      victimTeam: 'B',
      reason: 'rogue beats mage in melee',
      turn: 3,
    },
    {
      killerId: 'b2',
      killerClass: 'knight',
      killerTeam: 'B',
      victimId: 'a5',
      victimClass: 'rogue',
      victimTeam: 'A',
      reason: 'knight beats rogue in melee',
      turn: 4,
    },
    {
      killerId: 'a3',
      killerClass: 'mage',
      killerTeam: 'A',
      victimId: 'b6',
      victimClass: 'knight',
      victimTeam: 'B',
      reason: 'mage ranged kill on knight at distance 2',
      turn: 5,
    },
  ];

  const chatA: ChatMessage[] = [
    { from: 'agent_a1', message: 'Pushing NE with flag', turn: 4 },
    { from: 'agent_a3', message: 'Covering mid, watch the knight', turn: 5 },
    { from: 'agent_a2', message: 'Moving to intercept', turn: 5 },
  ];

  const chatB: ChatMessage[] = [
    { from: 'agent_b2', message: 'They have our flag, chase!', turn: 4 },
    { from: 'agent_b3', message: 'Hold NE corridor', turn: 5 },
    { from: 'agent_b4', message: 'Flanking from south', turn: 5 },
  ];

  return {
    turn: 5,
    maxTurns: 30,
    phase: 'in_progress',
    timeRemaining: 18,
    tiles,
    kills,
    chatA,
    chatB,
    flagA: { status: 'Carried by A rogue' },
    flagB: { status: 'At Base' },
    winner: null,
    mapRadius,
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
        const killerColor = k.killerTeam === 'A' ? 'text-blue-400' : 'text-red-400';
        const victimColor = k.victimTeam === 'A' ? 'text-blue-400' : 'text-red-400';
        return (
          <div key={i} className="text-xs flex items-center gap-1 text-gray-300">
            <span className="text-gray-500 w-6 text-right shrink-0">T{k.turn}</span>
            <span className={`font-bold ${killerColor}`}>
              {CLASS_ICONS[k.killerClass]}
            </span>
            <span className="text-gray-500">&rarr;</span>
            <span className={`font-bold ${victimColor} line-through opacity-60`}>
              {CLASS_ICONS[k.victimClass]}
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
          <span className={`font-semibold ${teamColor}`}>{m.from}:</span>{' '}
          <span className="text-gray-300">&ldquo;{m.message}&rdquo;</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GamePage
// ---------------------------------------------------------------------------

export default function GamePage() {
  const { id } = useParams<{ id: string }>();
  const [selectedTeam, setSelectedTeam] = useState<'A' | 'B' | 'all'>('all');

  // Use mock data for now; will be replaced with useGameSocket(id)
  const gameState = useMemo(() => generateMockState(), []);

  const teamButtons: { label: string; value: 'A' | 'B' | 'all' }[] = [
    { label: 'All', value: 'all' },
    { label: 'Team A', value: 'A' },
    { label: 'Team B', value: 'B' },
  ];

  const chatMessages =
    selectedTeam === 'A'
      ? gameState.chatA
      : selectedTeam === 'B'
        ? gameState.chatB
        : [...gameState.chatA, ...gameState.chatB].sort(
            (a, b) => a.turn - b.turn,
          );

  const chatTeamLabel =
    selectedTeam === 'all' ? 'All Chat' : `Team ${selectedTeam} Chat`;

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] -mx-6 -my-8 px-4 py-3 gap-2">
      {/* Top bar */}
      <div className="flex items-center justify-between bg-gray-900 rounded-lg px-4 py-2 shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">
            Game{' '}
            <span className="font-mono text-emerald-400">{id ?? 'demo'}</span>
          </span>
          <span className="text-sm font-semibold text-gray-200">
            Turn {gameState.turn}/{gameState.maxTurns}
          </span>
          <span className="text-sm text-gray-400">
            <span className="tabular-nums">{gameState.timeRemaining}s</span>
          </span>
          {gameState.phase === 'finished' && (
            <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-800 text-emerald-200">
              FINISHED
              {gameState.winner && ` — Team ${gameState.winner} wins`}
            </span>
          )}
        </div>
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
                      : 'bg-gray-700 text-gray-100'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex gap-2 flex-1 min-h-0">
        {/* Hex grid — takes most of the space */}
        <div className="flex-1 bg-gray-900/50 rounded-lg p-2 flex items-center justify-center min-w-0">
          <HexGrid
            tiles={gameState.tiles}
            mapRadius={gameState.mapRadius}
            selectedTeam={selectedTeam}
          />
        </div>

        {/* Right sidebar */}
        <div className="w-52 shrink-0 flex flex-col gap-2">
          {/* Kill feed */}
          <div className="bg-gray-900 rounded-lg p-3 flex flex-col gap-2 max-h-[40%] overflow-hidden">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Kill Feed
            </h3>
            <div className="overflow-y-auto flex-1 scrollbar-thin">
              <KillFeed kills={gameState.kills} />
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

      {/* Bottom bar — flag status */}
      <div className="flex items-center justify-between bg-gray-900 rounded-lg px-4 py-2 shrink-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-2xl">🦞</span>
          <span className="text-blue-400 font-semibold">Team A Flag:</span>
          <span className="text-gray-300">{gameState.flagA.status}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-red-400 font-semibold">Team B Flag:</span>
          <span className="text-gray-300">{gameState.flagB.status}</span>
          <span className="text-2xl">🦞</span>
        </div>
      </div>
    </div>
  );
}
