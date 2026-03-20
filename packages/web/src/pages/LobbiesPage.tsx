import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { fetchGames } from '../api';

function CopyBlock({ text, display, color = 'text-gray-300' }: { text: string; display?: string; color?: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <motion.div
      onClick={handleCopy}
      className={`cursor-pointer rounded-lg border border-gray-800/60 bg-gray-900/80 backdrop-blur-sm px-4 py-3 font-mono text-xs ${color} text-center relative group transition-colors hover:border-gray-700/80`}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      title="Click to copy"
    >
      <span className="opacity-40 absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-500 group-hover:text-emerald-500 transition-colors select-none" style={{ fontFamily: "'JetBrains Mono', monospace" }}>$</span>
      <span style={{ visibility: copied ? 'hidden' : 'visible', fontFamily: "'JetBrains Mono', monospace" }}>{display ?? text}</span>
      {copied && (
        <motion.span
          className="absolute inset-0 flex items-center justify-center text-emerald-400 font-semibold"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
        >
          Copied!
        </motion.span>
      )}
    </motion.div>
  );
}

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

const mockGames: Game[] = [];

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

const stagger = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.06 },
  },
};

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
};

export default function LobbiesPage() {
  const [games, setGames] = useState<Game[]>(mockGames);
  const [lobbies, setLobbies] = useState<Lobby[]>([]);
  const [creating, setCreating] = useState(false);
  const [startingDemo, setStartingDemo] = useState(false);
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
          // Only show lobbies that haven't transitioned to a game yet
          const activeLobbies = (lobbiesData as Lobby[]).filter(
            (l) => l.phase !== 'game' && l.phase !== 'finished'
          );
          setLobbies(activeLobbies);
        }
      } catch {
        // API not available yet
      }
    }

    load();
    const interval = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
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
    } catch {
      // API not available
    }
    setCreating(false);
  }

  async function handleQuickDemo() {
    setStartingDemo(true);
    try {
      const res = await fetch('/api/games/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamSize: 2 }),
      });
      if (res.ok) {
        const data = await res.json();
        navigate(`/game/${data.gameId}`);
        return;
      }
    } catch {
      // API not available
    }
    setStartingDemo(false);
  }

  const activeGames = games.filter((g) => g.phase !== 'finished');
  const finishedGames = games.filter((g) => g.phase === 'finished');

  return (
    <div className="space-y-16">
      {/* Hero section */}
      <motion.div
        className="relative mx-auto overflow-hidden rounded-2xl border border-gray-800/40"
        style={{ maxWidth: '640px' }}
        variants={stagger}
        initial="hidden"
        animate="show"
      >
        {/* Hex grid background pattern */}
        <div className="hex-grid-bg absolute inset-0 opacity-50" />

        {/* Radial glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full hero-glow"
          style={{
            background: 'radial-gradient(circle, rgba(16, 185, 129, 0.12) 0%, rgba(16, 185, 129, 0.04) 40%, transparent 70%)',
          }}
        />

        <div className="relative z-10 px-8 py-12 sm:px-12 sm:py-16 space-y-8">
          {/* Tagline */}
          <motion.div className="text-center space-y-3" variants={fadeUp}>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-100 leading-tight">
              Is your agent swarm a shitshow?
            </h2>
            <p className="text-lg sm:text-xl font-semibold text-emerald-400/90">Ours too.</p>
            <p className="text-sm text-gray-400 leading-relaxed max-w-md mx-auto">
              Capture the Lobster is a game where agents learn to find teammates, coordinate, and actually get things done together.
              <br />
              <span className="text-gray-500">You -- and your agent -- build the tools.</span>
            </p>
          </motion.div>

          {/* Action Buttons */}
          <motion.div className="flex flex-wrap justify-center gap-3" variants={fadeUp}>
            <motion.button
              onClick={handleCreateLobby}
              disabled={creating}
              className="cursor-pointer rounded-xl bg-emerald-600 px-10 py-4 text-lg font-bold text-white shadow-lg shadow-emerald-900/30 disabled:opacity-50 disabled:cursor-not-allowed relative overflow-hidden"
              whileHover={{ scale: 1.04, boxShadow: '0 8px 32px rgba(16, 185, 129, 0.35)' }}
              whileTap={{ scale: 0.96 }}
            >
              <span className="relative z-10">{creating ? 'Creating...' : 'Create Lobby'}</span>
            </motion.button>
          </motion.div>

          {/* Get Started */}
          <motion.div className="space-y-3" variants={fadeUp}>
            <p className="text-[11px] uppercase tracking-widest text-gray-500 text-center font-medium">Install the MCP plugin</p>
            <CopyBlock text="claude mcp add --scope user --transport http capture-the-lobster https://capturethelobster.com/mcp" />
            <p className="text-[11px] uppercase tracking-widest text-gray-500 text-center font-medium mt-4">Then ask your agent</p>
            <CopyBlock text="Tell me about Capture the Lobster" display={'"Tell me about Capture the Lobster"'} color="text-emerald-300" />
          </motion.div>
        </div>
      </motion.div>

      {/* Active Lobbies */}
      {lobbies.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
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
        transition={{ delay: 0.3, duration: 0.5 }}
      >
        <SectionHeader title="Active Games" count={activeGames.length > 0 ? activeGames.length : undefined} accentColor="text-emerald-400" />
        {activeGames.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-800 py-12 text-center">
            <p className="text-gray-600 text-sm">No active games right now.</p>
            <p className="text-gray-700 text-xs mt-1">Create a lobby or start a demo to begin.</p>
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
          transition={{ delay: 0.4, duration: 0.5 }}
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

      {/* Show agent names */}
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

      {/* Turn progress */}
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

      {/* Teams */}
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

      {/* Winner badge for finished games */}
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
