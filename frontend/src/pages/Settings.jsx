import { useState, useEffect } from 'react';
import {
  useSettings,
  useUpdateSetting,
  useKeywords,
  useUpdateKeywords,
  useCompanies,
  useClearParsingData,
} from '../api';

function Section({ title, children }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      {children}
    </div>
  );
}

export default function Settings() {
  const { data: settings } = useSettings();
  const { data: keywords } = useKeywords();
  const { data: companies } = useCompanies();
  const updateSetting = useUpdateSetting();
  const updateKeywords = useUpdateKeywords();
  const clearParsingData = useClearParsingData();

  const [newKeyword, setNewKeyword] = useState('');
  const [cookieValue, setCookieValue] = useState('');

  useEffect(() => {
    if (settings?.crm_cookies) setCookieValue(settings.crm_cookies);
  }, [settings?.crm_cookies]);

  function addKeyword() {
    if (!newKeyword.trim()) return;
    const updated = [...(keywords || []), newKeyword.trim()];
    updateKeywords.mutate(updated);
    setNewKeyword('');
  }

  function removeKeyword(kw) {
    updateKeywords.mutate((keywords || []).filter(k => k !== kw));
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-800 mb-4">Настройки</h2>

      <Section title="Авторизация CRM">
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Режим авторизации</label>
            <select
              value={settings?.auth_mode || 'auto'}
              onChange={e => updateSetting.mutate({ key: 'auth_mode', value: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full max-w-xs"
            >
              <option value="auto">Автоматический (login/password)</option>
              <option value="cookies">Cookie fallback</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Cookies (для fallback-режима)</label>
            <textarea
              value={cookieValue}
              onChange={e => setCookieValue(e.target.value)}
              onBlur={() => updateSetting.mutate({ key: 'crm_cookies', value: cookieValue })}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full h-20 font-mono"
              placeholder="filter-closed=true; PHPSESSID=... (из Network → Cookie, одной строкой)"
            />
          </div>
        </div>
      </Section>

      <Section title="Ключевые слова брендинга">
        <div className="flex flex-wrap gap-2 mb-3">
          {(keywords || []).map(kw => (
            <span key={kw} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-1 rounded-md text-sm">
              {kw}
              <button onClick={() => removeKeyword(kw)} className="text-blue-400 hover:text-red-500">&times;</button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newKeyword}
            onChange={e => setNewKeyword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addKeyword()}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm flex-1 max-w-xs"
            placeholder="Новое ключевое слово..."
          />
          <button onClick={addKeyword} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700">
            Добавить
          </button>
        </div>
      </Section>

      <Section title="Расписание парсинга">
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Cron-выражение</label>
            <input
              defaultValue={settings?.parse_schedule || '0 18 * * *'}
              onBlur={e => updateSetting.mutate({ key: 'parse_schedule', value: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full max-w-xs font-mono"
            />
            <p className="text-xs text-gray-400 mt-1">По умолчанию: 0 18 * * * (каждый день в 18:00)</p>
          </div>
        </div>
      </Section>

      <Section title="Режим апрува">
        <select
          value={settings?.approval_mode || 'manual'}
          onChange={e => updateSetting.mutate({ key: 'approval_mode', value: e.target.value })}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full max-w-xs"
        >
          <option value="manual">Ручной — все сделки в очередь</option>
          <option value="semi">Полуавтоматический — keyword_match автоматически</option>
          <option value="auto">Автоапрув — всё автоматически</option>
        </select>
      </Section>

      <Section title="LLM">
        <div className="space-y-3 max-w-md">
          <div>
            <label className="block text-sm text-gray-600 mb-1">API URL</label>
            <input
              defaultValue={settings?.llm_api_url || ''}
              onBlur={e => updateSetting.mutate({ key: 'llm_api_url', value: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full font-mono"
              placeholder="https://api.openai.com/v1/chat/completions"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">API Key</label>
            <input
              type="password"
              defaultValue={settings?.llm_api_key || ''}
              onBlur={e => updateSetting.mutate({ key: 'llm_api_key', value: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full font-mono"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Модель</label>
            <input
              defaultValue={settings?.llm_model || ''}
              onBlur={e => updateSetting.mutate({ key: 'llm_model', value: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full font-mono"
              placeholder="gpt-4o-mini"
            />
          </div>
        </div>
      </Section>

      <Section title="Twenty CRM">
        <p className="text-xs text-gray-500 mb-3">
          Если TWENTY_API_URL и TWENTY_API_TOKEN заданы в .env или docker-compose, они имеют приоритет над полями ниже.
        </p>
        <div className="space-y-3 max-w-md">
          <div>
            <label className="block text-sm text-gray-600 mb-1">API URL</label>
            <input
              defaultValue={settings?.twenty_api_url || ''}
              onBlur={e => updateSetting.mutate({ key: 'twenty_api_url', value: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full font-mono"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">API Token</label>
            <input
              type="password"
              defaultValue={settings?.twenty_api_token || ''}
              onBlur={e => updateSetting.mutate({ key: 'twenty_api_token', value: e.target.value })}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full font-mono"
            />
          </div>
        </div>
      </Section>

      <Section title="Данные парсинга">
        <p className="text-sm text-gray-600 mb-3">
          Удаляет все сделки, позиции и логи парсинга/синхронизации. Настройки и справочники сохраняются.
        </p>
        <button
          onClick={() => {
            if (!confirm('Удалить все данные парсинга? Это действие нельзя отменить.')) return;
            clearParsingData.mutate();
          }}
          disabled={clearParsingData.isPending}
          className="px-4 py-2 bg-red-600 text-white text-sm rounded-md hover:bg-red-700 disabled:opacity-50"
        >
          {clearParsingData.isPending ? 'Очистка...' : 'Очистить данные парсинга'}
        </button>
        {clearParsingData.isSuccess && (
          <p className="text-sm text-green-600 mt-2">
            Удалено: {clearParsingData.data.deleted.deals} сделок,{' '}
            {clearParsingData.data.deleted.parseRuns} записей парсинга
          </p>
        )}
        {clearParsingData.isError && (
          <p className="text-sm text-red-600 mt-2">{clearParsingData.error.message}</p>
        )}
      </Section>

      <Section title="Справочник компаний">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase">
              <th className="p-2">Код</th>
              <th className="p-2">Полное название</th>
              <th className="p-2">Twenty ID</th>
            </tr>
          </thead>
          <tbody>
            {(companies || []).map(c => (
              <tr key={c.id} className="border-t border-gray-100">
                <td className="p-2 font-mono">{c.code}</td>
                <td className="p-2">{c.full_name}</td>
                <td className="p-2 text-gray-400 text-xs font-mono">{c.twenty_id || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
