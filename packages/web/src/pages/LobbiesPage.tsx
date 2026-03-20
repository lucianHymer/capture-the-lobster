import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { fetchGames } from '../api';

interface Game {
  id: string;
  turn: number;
  maxTurns: number;
  phase: 'in_progress' | 'finished' | 'starting';
  winner?: string;
  teamsA: number;
  teamsB: number;
}

interface Lobby {
  lobbyId: string;
  phase: string;
  agents: any[];
  teams: Record<string, any>;
  gameId?: string;
}

function phaseBadge(phase: string) {
  switch (phase) {
    case 'in_progress':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/20">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Live
        </span>
      );
    case 'finished':
      return (
        <span className="inline-flex items-center rounded-full bg-gray-800/50 px-2.5 py-0.5 text-xs font-medium text-gray-500 ring-1 ring-inset ring-gray-700/30">
          Finished
        </span>
      );
    case 'starting':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-400 ring-1 ring-inset ring-amber-500/20">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
          Starting
        </span>
      );
    default:
      return null;
  }
}

export default function LobbiesPage() {
  const [games, setGames] = useState<Game[]>([]);
  const [lobbies, setLobbies] = useState<Lobby[]>([]);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [gamesData, lobbiesData] = await Promise.all([
          fetchGames(),
          fetch('/api/lobbies').then(r => r.json()).catch(() => []),
        ]);
        if (!cancelled) {
          const mapped = (gamesData as any[]).map((g: any) => ({
            id: g.id,
            turn: g.turn ?? 0,
            maxTurns: 30,
            phase: g.phase ?? 'in_progress',
            winner: g.winner,
            teamsA: Array.isArray(g.teams?.A) ? g.teams.A.length : (g.teamsA ?? 0),
            teamsB: Array.isArray(g.teams?.B) ? g.teams.B.length : (g.teamsB ?? 0),
          }));
          setGames(mapped);
          const activeLobbies = (lobbiesData as Lobby[]).filter(
            (l) => l.phase !== 'game' && l.phase !== 'finished'
          );
          setLobbies(activeLobbies);
        }
      } catch {}
    }

    load();
    const interval = setInterval(load, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  async function handleCreateLobby() {
    setCreating(true);
    try {
      const res = await fetch('/api/lobbies/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamSize: 2 }),
      });
      if (res.ok) {
        const data = await res.json();
        navigate(`/lobby/${data.lobbyId}`);
        return;
      }
    } catch {}
    setCreating(false);
  }

  const activeGames = games.filter((g) => g.phase !== 'finished');
  const finishedGames = games.filter((g) => g.phase === 'finished');

  return (
    <div className="space-y-12">
      {/* Create lobby button */}
      <div className="flex justify-end">
        <motion.button
          onClick={handleCreateLobby}
          disabled={creating}
          className="cursor-pointer rounded-lg px-5 py-2 text-sm font-medium text-emerald-400 hover:text-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          style={{ border: '1px solid rgba(52,211,153,0.25)', background: 'rgba(16,185,129,0.08)' }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          {creating ? 'Creating...' : 'Create Lobby'}
        </motion.button>
      </div>

      {/* Active Lobbies */}
      {lobbies.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <SectionHeader title="Active Lobbies" count={lobbies.length} accentColor="text-purple-400" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {lobbies.map((lobby, i) => (
              <motion.div
                key={lobby.lobbyId}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.4 }}
              >
                <LobbyCard lobby={lobby} onClick={() => navigate(`/lobby/${lobby.lobbyId}`)} />
              </motion.div>
            ))}
          </div>
        </motion.section>
      )}

      {/* Active Games */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.5 }}
      >
        <SectionHeader title="Active Games" count={activeGames.length > 0 ? activeGames.length : undefined} accentColor="text-emerald-400" />
        {activeGames.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-800 py-12 text-center">
            <p className="text-gray-600 text-sm">No active games right now.</p>
            <p className="text-gray-700 text-xs mt-1">Create a lobby to begin.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {activeGames.map((game, i) => (
              <motion.div
                key={game.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.4 }}
              >
                <GameCard game={game} onClick={() => navigate(`/game/${game.id}`)} />
              </motion.div>
            ))}
          </div>
        )}
      </motion.section>

      {/* Finished Games */}
      {finishedGames.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          <SectionHeader title="Recent Games" count={finishedGames.length} accentColor="text-gray-400" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {finishedGames.map((game, i) => (
              <motion.div
                key={game.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.4 }}
              >
                <GameCard game={game} onClick={() => navigate(`/game/${game.id}`)} />
              </motion.div>
            ))}
          </div>
        </motion.section>
      )}
    </div>
  );
}

function SectionHeader({ title, count, accentColor }: { title: string; count?: number; accentColor: string }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <h2 className="text-lg font-bold text-gray-200 tracking-tight">{title}</h2>
      {count !== undefined && (
        <span className={`text-xs font-mono font-medium ${accentColor} bg-gray-800/60 rounded-full px-2.5 py-0.5`}>
          {count}
        </span>
      )}
      <div className="flex-1 h-px bg-gradient-to-r from-gray-800 to-transparent" />
    </div>
  );
}

function lobbyPhaseBadge(phase: string) {
  switch (phase) {
    case 'forming':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-500/10 px-2.5 py-0.5 text-xs font-medium text-purple-400 ring-1 ring-inset ring-purple-500/20">
          <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
          Forming
        </span>
      );
    case 'pre_game':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-400 ring-1 ring-inset ring-amber-500/20">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
          Picking Classes
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center rounded-full bg-gray-800/50 px-2.5 py-0.5 text-xs font-medium text-gray-400 ring-1 ring-inset ring-gray-600/30">
          {phase}
        </span>
      );
  }
}

function LobbyCard({ lobby, onClick }: { lobby: Lobby; onClick: () => void }) {
  const teamCount = Object.keys(lobby.teams).length;
  const agentCount = lobby.agents.length;

  return (
    <button
      onClick={onClick}
      className="group cursor-pointer w-full rounded-xl border border-purple-900/30 bg-gray-900/70 backdrop-blur-sm p-5 text-left transition-all duration-200 hover:border-purple-700/50 hover:bg-gray-800/80 hover:shadow-lg hover:shadow-purple-900/10"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-xs text-gray-500 group-hover:text-gray-400 transition-colors">{lobby.lobbyId}</span>
        {lobbyPhaseBadge(lobby.phase)}
      </div>

      <div className="mb-2 text-sm text-gray-300">
        <span className="text-purple-400 font-semibold">{agentCount}</span> agents
        {teamCount > 0 && (
          <span className="ml-2">
            · <span className="text-purple-400 font-semibold">{teamCount}</span> teams formed
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        {lobby.agents.slice(0, 8).map((agent: any) => (
          <span
            key={agent.id}
            className="inline-block rounded-md bg-gray-800/80 px-1.5 py-0.5 text-xs text-gray-500 font-mono"
          >
            {agent.handle || agent.id}
          </span>
        ))}
      </div>
    </button>
  );
}

function GameCard({ game, onClick }: { game: Game; onClick: () => void }) {
  const progress = Math.round((game.turn / game.maxTurns) * 100);
  const isLive = game.phase === 'in_progress';

  return (
    <button
      onClick={onClick}
      className={`group cursor-pointer w-full rounded-xl border bg-gray-900/70 backdrop-blur-sm p-5 text-left transition-all duration-200 hover:shadow-lg ${
        isLive
          ? 'border-emerald-900/30 hover:border-emerald-700/40 hover:bg-gray-800/80 hover:shadow-emerald-900/10'
          : 'border-gray-800/50 hover:border-gray-700/60 hover:bg-gray-800/80 hover:shadow-gray-900/10'
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-xs text-gray-500 group-hover:text-gray-400 transition-colors">{game.id}</span>
        {phaseBadge(game.phase)}
      </div>

      <div className="mb-3">
        <div className="mb-1.5 flex justify-between text-xs text-gray-500">
          <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>Turn {game.turn}/{game.maxTurns}</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{progress}%</span>
        </div>
        <div className="h-1 w-full rounded-full bg-gray-800/80">
          <motion.div
            className="h-1 rounded-full"
            style={{
              width: `${progress}%`,
              background: isLive
                ? 'linear-gradient(90deg, #10b981, #34d399)'
                : 'linear-gradient(90deg, #4b5563, #6b7280)',
            }}
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-blue-500 shadow-sm shadow-blue-500/50" />
          <span className="text-blue-400 font-medium text-xs">Team A</span>
          <span className="font-mono text-gray-500 text-xs">{game.teamsA}</span>
        </div>
        <span className="text-gray-700 text-xs font-medium">vs</span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-gray-500 text-xs">{game.teamsB}</span>
          <span className="text-red-400 font-medium text-xs">Team B</span>
          <span className="inline-block h-2 w-2 rounded-full bg-red-500 shadow-sm shadow-red-500/50" />
        </div>
      </div>

      {game.phase === 'finished' && game.winner && (
        <div className="mt-3 pt-3 border-t border-gray-800/50 text-center">
          <span className="text-xs font-bold text-amber-400/90 uppercase tracking-wider">
            Winner: Team {game.winner}
          </span>
        </div>
      )}
    </button>
  );
}
