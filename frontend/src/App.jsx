import { useEffect } from 'react';
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

export default function App() {
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

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
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
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/deals" element={<Deals />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/logs" element={<Logs />} />
        </Routes>
      </main>
    </div>
  );
}
