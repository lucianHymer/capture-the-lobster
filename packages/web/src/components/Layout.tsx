import { NavLink, Outlet } from 'react-router-dom';

function navLinkClass({ isActive }: { isActive: boolean }) {
  return isActive
    ? 'text-emerald-400 font-semibold'
    : 'text-gray-400 hover:text-emerald-300 transition-colors';
}

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <NavLink to="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
            <span className="text-4xl" role="img" aria-label="lobster">
              🦞
            </span>
            <h1 className="text-xl font-bold tracking-tight text-gray-100">
              Capture the Lobster
            </h1>
          </NavLink>

          <nav className="flex items-center gap-6 text-sm">
            <NavLink to="/lobbies" className={navLinkClass}>
              Lobbies
            </NavLink>
            <NavLink to="/leaderboard" className={navLinkClass}>
              Leaderboard
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
