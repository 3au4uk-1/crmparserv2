import { useEffect, useState } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import Dashboard from './pages/Dashboard';
import Deals from './pages/Deals';
import Settings from './pages/Settings';
import Logs from './pages/Logs';
import Login from './pages/Login';
import { useAuthStatus, setAuthToken } from './api';

const navItems = [
  { to: '/', label: 'Дашборд', icon: '◻' },
  { to: '/deals', label: 'Сделки', icon: '◻' },
  { to: '/settings', label: 'Настройки', icon: '◻' },
  { to: '/logs', label: 'Логи', icon: '◻' },
];

function SidebarNav({ onNavigate }) {
  return (
    <>
      <div className="p-4 border-b border-gray-200">
        <h1 className="text-lg font-semibold text-gray-800">CRM Parser</h1>
        <p className="text-xs text-gray-500">Отдел брендинга</p>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

export default function App() {
  const [navOpen, setNavOpen] = useState(false);
  const { data: authStatus, isLoading, isError } = useAuthStatus();
  const qc = useQueryClient();

  useEffect(() => {
    function onLogout() {
      setAuthToken(null);
      qc.invalidateQueries({ queryKey: ['auth-status'] });
    }
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, [qc]);

  const needsLogin =
    authStatus?.required &&
    !authStatus?.authenticated &&
    !isLoading &&
    !isError;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-500">
        Загрузка...
      </div>
    );
  }

  if (needsLogin) {
    return <Login />;
  }

  const closeNav = () => setNavOpen(false);

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="hidden md:flex w-56 bg-white border-r border-gray-200 flex-col">
        <SidebarNav />
      </aside>

      <div className="flex flex-1 flex-col min-w-0">
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="p-2 -ml-2 rounded-md text-gray-600 hover:bg-gray-100"
            aria-label="Открыть меню"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-semibold text-gray-800">CRM Parser</h1>
            <p className="text-xs text-gray-500">Отдел брендинга</p>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/deals" element={<Deals />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/logs" element={<Logs />} />
          </Routes>
        </main>
      </div>

      {navOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={closeNav}
            aria-hidden="true"
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-56 bg-white border-r border-gray-200 flex flex-col md:hidden">
            <SidebarNav onNavigate={closeNav} />
          </aside>
        </>
      )}
    </div>
  );
}
