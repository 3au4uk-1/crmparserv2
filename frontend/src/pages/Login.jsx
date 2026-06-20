import { useState } from 'react';
import { useLogin, useAuthStatus } from '../api';

export default function Login() {
  const { data: authStatus } = useAuthStatus();
  const login = useLogin();
  const [password, setPassword] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    login.mutate(password);
  }

  return (
    <div className="min-h-dvh bg-canvas flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint mb-2">
            Отдел брендинга
          </p>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-ink">
            CRM Parser
          </h1>
          <p className="text-sm text-ink-muted mt-2">
            Введите пароль для доступа к панели
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="surface p-6"
        >
          <label className="block text-sm font-medium text-ink-muted mb-1.5">
            Пароль
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-field mb-4"
            placeholder="••••••••"
            autoFocus
            disabled={login.isPending}
          />

          {login.isError && (
            <p className="text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md mb-4">
              {login.error.message}
            </p>
          )}

          <button
            type="submit"
            disabled={login.isPending || !password}
            className="btn-primary w-full"
          >
            {login.isPending ? 'Вход...' : 'Войти'}
          </button>

          {authStatus?.required === false && (
            <p className="text-xs text-ink-faint mt-4 text-center">Авторизация отключена</p>
          )}
        </form>
      </div>
    </div>
  );
}
