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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white rounded-lg border border-gray-200 p-6 shadow-sm"
      >
        <h1 className="text-lg font-semibold text-gray-800 mb-1">CRM Parser</h1>
        <p className="text-sm text-gray-500 mb-4">Введите пароль для доступа</p>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full mb-3"
          placeholder="Пароль"
          autoFocus
          disabled={login.isPending}
        />

        {login.isError && (
          <p className="text-sm text-red-600 mb-3">{login.error.message}</p>
        )}

        <button
          type="submit"
          disabled={login.isPending || !password}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {login.isPending ? 'Вход...' : 'Войти'}
        </button>

        {authStatus?.required === false && (
          <p className="text-xs text-gray-400 mt-3 text-center">Авторизация отключена</p>
        )}
      </form>
    </div>
  );
}
