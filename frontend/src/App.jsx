import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import Dashboard from './pages/Dashboard';
import Deals from './pages/Deals';
import Settings from './pages/Settings';
import Logs from './pages/Logs';
import Login from './pages/Login';
import { useAuthStatus, useParsingStatus, setAuthToken } from './api';
import { navIcons } from './components/ui/Icons';
import { IconMenu } from './components/ui/Icons';

const navItems = [
  { to: '/', label: 'Дашборд', end: true },
  { to: '/deals', label: 'Сделки' },
  { to: '/settings', label: 'Настройки' },
  { to: '/logs', label: 'Логи' },
];

function ParsingIndicator() {
  const { data: status } = useParsingStatus();

  if (!status?.inProgress) return null;

  return (
    <div className="mx-3 mb-2 px-3 py-2 rounded-md bg-pastel-blue-bg border border-pastel-blue-bg">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pastel-blue-text opacity-40" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-pastel-blue-text" />
        </span>
        <span className="text-xs font-medium text-pastel-blue-text">Парсинг выполняется</span>
      </div>
    </div>
  );
}

function SidebarNav({ onNavigate }) {
  const location = useLocation();

  return (
    <>
      <div className="px-5 py-6 border-b border-border">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint mb-1">
          Отдел брендинга
        </p>
        <h1 className="font-serif text-xl font-semibold tracking-tight text-ink">
          CRM Parser
        </h1>
      </div>

      <ParsingIndicator />

      <nav className="flex-1 px-3 py-4 space-y-0.5" aria-label="Основная навигация">
        {navItems.map((item) => {
          const Icon = navIcons[item.to];
          const isActive = item.end
            ? location.pathname === item.to
            : location.pathname.startsWith(item.to);

          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={`nav-link ${isActive ? 'nav-link-active' : 'nav-link-inactive'}`}
            >
              <Icon size={17} />
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-border">
        <p className="text-xs text-ink-faint leading-relaxed">
          Синхронизация сделок брендинга в Twenty CRM
        </p>
      </div>
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
      <div className="min-h-dvh bg-canvas flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-border border-t-ink animate-spin" />
          <p className="text-sm text-ink-muted">Загрузка приложения</p>
        </div>
      </div>
    );
  }

  if (needsLogin) {
    return <Login />;
  }

  const closeNav = () => setNavOpen(false);

  return (
    <div className="flex min-h-dvh bg-canvas">
      <a href="#main-content" className="skip-link">
        Перейти к содержимому
      </a>

      <aside className="hidden md:flex w-60 bg-surface border-r border-border flex-col shrink-0">
        <SidebarNav />
      </aside>

      <div className="flex flex-1 flex-col min-w-0">
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-surface border-b border-border sticky top-0 z-30">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="p-2 -ml-1 rounded-md text-ink-muted hover:text-ink hover:bg-black/[0.04] transition-colors"
            aria-label="Открыть меню"
          >
            <IconMenu />
          </button>
          <div>
            <h1 className="font-serif text-lg font-semibold text-ink">CRM Parser</h1>
            <p className="text-xs text-ink-faint">Отдел брендинга</p>
          </div>
        </header>

        <main id="main-content" className="flex-1 overflow-auto p-5 md:p-8">
          <div className="page-container">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/deals" element={<Deals />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/logs" element={<Logs />} />
            </Routes>
          </div>
        </main>
      </div>

      {navOpen && (
        <>
          <div
            className="fixed inset-0 bg-ink/20 backdrop-blur-[2px] z-40 md:hidden"
            onClick={closeNav}
            aria-hidden="true"
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-60 bg-surface border-r border-border flex flex-col md:hidden shadow-subtle">
            <SidebarNav onNavigate={closeNav} />
          </aside>
        </>
      )}
    </div>
  );
}
