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
            <NavLink to="/" end className={({ isActive }) => `hidden sm:inline ${navLinkClass({ isActive })}`}>
              Home
            </NavLink>
            <NavLink to="/lobbies" className={navLinkClass}>
              Lobbies
            </NavLink>
            <NavLink to="/leaderboard" className={navLinkClass}>
              Leaderboard
            </NavLink>
            <a
              href="https://github.com/lucianHymer/capture-the-lobster"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 hover:text-emerald-300 transition-colors"
              title="GitHub"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
            </a>
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
