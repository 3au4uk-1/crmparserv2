import { useState, useEffect } from 'react';
import {
  useSettings,
  useUpdateSetting,
  useKeywords,
  useUpdateKeywords,
  useCompanies,
  useCreateCompany,
  useClearParsingData,
  useBlacklist,
  useAddBlacklistItem,
  useRemoveBlacklistItem,
} from '../api';
import PageHeader from '../components/ui/PageHeader';

const OPPORTUNITY_STAGES = [
  { value: 'NOVYY', label: 'Новый' },
  { value: 'V_RABOTE', label: 'В работе' },
  { value: 'V_PECHATI', label: 'В печати' },
  { value: 'OKLEYKA', label: 'Оклейка' },
  { value: 'RESTOVRACIYA', label: 'Реставрация' },
  { value: 'GOTOVO', label: 'Готово' },
  { value: 'OTMENA', label: 'Отмена' },
];

const TABS = [
  { id: 'auth', label: 'Авторизация' },
  { id: 'parsing', label: 'Парсинг' },
  { id: 'integrations', label: 'Интеграции' },
  { id: 'directories', label: 'Справочники' },
  { id: 'data', label: 'Данные' },
];

function Section({ title, description, children }) {
  return (
    <section className="surface p-5 md:p-6 mb-4">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        {description && (
          <p className="text-sm text-ink-muted mt-1 max-w-2xl leading-relaxed">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function FieldLabel({ children }) {
  return <label className="block text-sm font-medium text-ink-muted mb-1.5">{children}</label>;
}

function parseKeywordInput(text) {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function mergeKeywords(existing, incoming) {
  const seen = new Set((existing || []).map((kw) => kw.toLowerCase()));
  const result = [...(existing || [])];
  for (const kw of incoming) {
    const key = kw.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(kw);
    }
  }
  return result;
}

export default function Settings() {
  const [activeTab, setActiveTab] = useState('auth');

  const { data: settings } = useSettings();
  const { data: keywords } = useKeywords();
  const { data: blacklist } = useBlacklist();
  const { data: companies } = useCompanies();
  const updateSetting = useUpdateSetting();
  const updateKeywords = useUpdateKeywords();
  const addBlacklistItem = useAddBlacklistItem();
  const removeBlacklistItem = useRemoveBlacklistItem();
  const clearParsingData = useClearParsingData();
  const createCompany = useCreateCompany();

  const [newKeyword, setNewKeyword] = useState('');
  const [newCompanyCode, setNewCompanyCode] = useState('');
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newBlacklistPattern, setNewBlacklistPattern] = useState('');
  const [newBlacklistMatchType, setNewBlacklistMatchType] = useState('exact');
  const [blacklistError, setBlacklistError] = useState('');
  const [cookieValue, setCookieValue] = useState('');

  useEffect(() => {
    if (settings?.crm_cookies) setCookieValue(settings.crm_cookies);
  }, [settings?.crm_cookies]);

  function addKeyword() {
    const parsed = parseKeywordInput(newKeyword);
    if (parsed.length === 0) return;
    updateKeywords.mutate(mergeKeywords(keywords, parsed));
    setNewKeyword('');
  }

  function removeKeyword(kw) {
    updateKeywords.mutate((keywords || []).filter(k => k !== kw));
  }

  function addCompany() {
    createCompany.mutate(
      { code: newCompanyCode, full_name: newCompanyName },
      {
        onSuccess: () => {
          setNewCompanyCode('');
          setNewCompanyName('');
        },
      },
    );
  }

  return (
    <div>
      <PageHeader
        title="Настройки"
        description="Конфигурация парсинга, интеграций и справочников"
      />

      <nav className="flex gap-1 overflow-x-auto pb-1 mb-6 border-b border-border" aria-label="Разделы настроек">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors duration-200 ${
              activeTab === tab.id
                ? 'border-ink text-ink'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'auth' && (
        <Section title="Авторизация CRM">
          <div className="space-y-4 max-w-lg">
            <div>
              <FieldLabel>Режим авторизации</FieldLabel>
              <select
                value={settings?.auth_mode || 'auto'}
                onChange={e => updateSetting.mutate({ key: 'auth_mode', value: e.target.value })}
                className="select-field w-full max-w-xs"
              >
                <option value="auto">Автоматический (login/password)</option>
                <option value="cookies">Cookie fallback</option>
              </select>
            </div>
            <div>
              <FieldLabel>Cookies (для fallback-режима)</FieldLabel>
              <textarea
                value={cookieValue}
                onChange={e => setCookieValue(e.target.value)}
                onBlur={() => updateSetting.mutate({ key: 'crm_cookies', value: cookieValue })}
                className="input-field h-24 font-mono text-xs"
                placeholder="filter-closed=true; PHPSESSID=... (из Network → Cookie, одной строкой)"
              />
            </div>
          </div>
        </Section>
      )}

      {activeTab === 'parsing' && (
        <>
          <Section
            title="Ключевые слова брендинга"
            description="Можно добавить одно слово или несколько через запятую"
          >
            <div className="flex flex-wrap gap-2 mb-4">
              {(keywords || []).map(kw => (
                <span key={kw} className="inline-flex items-center gap-1.5 bg-pastel-blue-bg text-pastel-blue-text px-2.5 py-1 rounded-md text-sm">
                  {kw}
                  <button
                    onClick={() => removeKeyword(kw)}
                    className="opacity-60 hover:opacity-100 hover:text-pastel-red-text transition-opacity"
                    aria-label={`Удалить ${kw}`}
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2 items-start max-w-xl">
              <textarea
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                rows={2}
                className="input-field flex-1"
                placeholder="баннер, печать, наклейка, логотип"
              />
              <button
                onClick={addKeyword}
                disabled={!newKeyword.trim()}
                className="btn-primary btn-sm shrink-0"
              >
                Добавить
              </button>
            </div>
          </Section>

          <Section
            title="Блеклист позиций"
            description="Позиции в блеклисте не попадают в Twenty автоматически. Ручная галочка в сделке перебивает блеклист."
          >
            <div className="flex flex-wrap gap-2 mb-4">
              {(blacklist || []).map((entry) => (
                <span
                  key={entry.id}
                  className="inline-flex items-center gap-1.5 bg-pastel-red-bg text-pastel-red-text px-2.5 py-1 rounded-md text-sm"
                >
                  {entry.sourceName || entry.pattern}
                  <span className="text-xs opacity-70">
                    ({entry.matchType === 'exact' ? 'точное' : 'фрагмент'})
                  </span>
                  <button
                    onClick={() => removeBlacklistItem.mutate(entry.id)}
                    className="opacity-60 hover:opacity-100 transition-opacity"
                    aria-label="Удалить из блеклиста"
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
            {blacklistError && (
              <p className="text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md mb-3">{blacklistError}</p>
            )}
            <div className="flex flex-wrap gap-2 items-end max-w-2xl">
              <input
                type="text"
                value={newBlacklistPattern}
                onChange={(e) => setNewBlacklistPattern(e.target.value)}
                className="input-field flex-1 min-w-[12rem]"
                placeholder="Стойка указатель напольная А4"
              />
              <select
                value={newBlacklistMatchType}
                onChange={(e) => setNewBlacklistMatchType(e.target.value)}
                className="select-field"
              >
                <option value="exact">Точное</option>
                <option value="substring">Фрагмент</option>
              </select>
              <button
                onClick={() => {
                  setBlacklistError('');
                  addBlacklistItem.mutate(
                    { pattern: newBlacklistPattern, matchType: newBlacklistMatchType },
                    {
                      onSuccess: () => setNewBlacklistPattern(''),
                      onError: (err) => {
                        const msg = err.response?.status === 409
                          ? 'Уже в блеклисте'
                          : err.response?.data?.error || 'Ошибка добавления';
                        setBlacklistError(msg);
                      },
                    }
                  );
                }}
                disabled={!newBlacklistPattern.trim() || addBlacklistItem.isPending}
                className="btn-danger btn-sm"
              >
                Добавить
              </button>
            </div>
          </Section>

          <Section
            title="Расписание парсинга"
            description="Автообновление зашито в сервер. Ручной парсинг — на странице «Парсинг»."
          >
            <ul className="text-sm text-ink-muted space-y-1.5 max-w-lg list-disc pl-5">
              <li>Будни 9:00–21:00 — каждый час, +4 дня</li>
              <li>Будни 22:00 — +14 дней</li>
              <li>Каждый день 2:00 — +2 дня (ночной лёгкий прогон)</li>
              <li>Выходные — каждые 2 часа, +7 дней</li>
              <li>22:00–9:00 (кроме 2:00 и буднего 22:00) — без автообновлений</li>
            </ul>
          </Section>

          <Section title="Режим апрува">
            <select
              value={settings?.approval_mode || 'manual'}
              onChange={e => updateSetting.mutate({ key: 'approval_mode', value: e.target.value })}
              className="select-field w-full max-w-md"
            >
              <option value="manual">Ручной — все сделки в очередь</option>
              <option value="semi">Полуавтоматический — keyword_match автоматически</option>
              <option value="auto">Автоапрув — всё автоматически</option>
            </select>
          </Section>
        </>
      )}

      {activeTab === 'integrations' && (
        <>
          <Section title="LLM">
            <div className="space-y-4 max-w-md">
              <div>
                <FieldLabel>API URL</FieldLabel>
                <input
                  defaultValue={settings?.llm_api_url || ''}
                  onBlur={e => updateSetting.mutate({ key: 'llm_api_url', value: e.target.value })}
                  className="input-field font-mono"
                  placeholder="https://api.openai.com/v1/chat/completions"
                />
              </div>
              <div>
                <FieldLabel>API Key</FieldLabel>
                <input
                  type="password"
                  defaultValue={settings?.llm_api_key || ''}
                  onBlur={e => updateSetting.mutate({ key: 'llm_api_key', value: e.target.value })}
                  className="input-field font-mono"
                />
              </div>
              <div>
                <FieldLabel>Модель</FieldLabel>
                <input
                  defaultValue={settings?.llm_model || ''}
                  onBlur={e => updateSetting.mutate({ key: 'llm_model', value: e.target.value })}
                  className="input-field font-mono"
                  placeholder="gpt-4o-mini"
                />
              </div>
            </div>
          </Section>

          <Section
            title="Twenty CRM"
            description="Если TWENTY_API_URL и TWENTY_API_TOKEN заданы в .env или docker-compose, они имеют приоритет над полями ниже. Укажите GraphQL endpoint: https://your-domain/graphql"
          >
            <div className="space-y-4 max-w-md">
              <div>
                <FieldLabel>API URL</FieldLabel>
                <input
                  defaultValue={settings?.twenty_api_url || ''}
                  onBlur={e => updateSetting.mutate({ key: 'twenty_api_url', value: e.target.value })}
                  className="input-field font-mono"
                  placeholder="https://twenty.example.com/graphql"
                />
              </div>
              <div>
                <FieldLabel>API Token</FieldLabel>
                <input
                  type="password"
                  defaultValue={settings?.twenty_api_token || ''}
                  onBlur={e => updateSetting.mutate({ key: 'twenty_api_token', value: e.target.value })}
                  className="input-field font-mono"
                />
              </div>
              <div>
                <FieldLabel>Стадия новой сделки</FieldLabel>
                <select
                  value={settings?.opportunity_stage || 'NOVYY'}
                  onChange={e => updateSetting.mutate({ key: 'opportunity_stage', value: e.target.value })}
                  className="select-field w-full max-w-xs"
                >
                  {OPPORTUNITY_STAGES.map((stage) => (
                    <option key={stage.value} value={stage.value}>
                      {stage.label} ({stage.value})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-ink-faint mt-1.5">
                  В API Twenty передаётся код стадии, не подпись из интерфейса.
                </p>
              </div>
            </div>
          </Section>

          <Section title="Tony (crm.apihide.com)">
            <div className="space-y-4 max-w-md">
              <div>
                <FieldLabel>Base URL</FieldLabel>
                <input
                  defaultValue={settings?.tony_base_url || ''}
                  onBlur={e => updateSetting.mutate({ key: 'tony_base_url', value: e.target.value })}
                  className="input-field font-mono"
                  placeholder="https://crm.apihide.com"
                />
              </div>
              <div>
                <FieldLabel>Логин</FieldLabel>
                <input
                  defaultValue={settings?.tony_login || ''}
                  onBlur={e => updateSetting.mutate({ key: 'tony_login', value: e.target.value })}
                  className="input-field font-mono"
                />
              </div>
              <div>
                <FieldLabel>Пароль</FieldLabel>
                <input
                  type="password"
                  defaultValue={settings?.tony_password || ''}
                  onBlur={e => updateSetting.mutate({ key: 'tony_password', value: e.target.value })}
                  className="input-field font-mono"
                />
              </div>
            </div>
          </Section>
        </>
      )}

      {activeTab === 'directories' && (
        <Section title="Справочник компаний">
          <div className="flex flex-wrap gap-2 items-end mb-5 max-w-2xl">
            <div className="flex-1 min-w-[8rem]">
              <FieldLabel>Код</FieldLabel>
              <input
                type="text"
                value={newCompanyCode}
                onChange={(e) => setNewCompanyCode(e.target.value)}
                className="input-field font-mono"
                placeholder="ABC"
              />
            </div>
            <div className="flex-[2] min-w-[12rem]">
              <FieldLabel>Полное название</FieldLabel>
              <input
                type="text"
                value={newCompanyName}
                onChange={(e) => setNewCompanyName(e.target.value)}
                className="input-field"
                placeholder="ООО Пример"
              />
            </div>
            <button
              onClick={addCompany}
              disabled={!newCompanyCode.trim() || !newCompanyName.trim() || createCompany.isPending}
              className="btn-primary btn-sm"
            >
              Добавить
            </button>
          </div>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="data-table">
              <thead>
                <tr className="bg-surface-muted">
                  <th>Код</th>
                  <th>Полное название</th>
                  <th>Twenty ID</th>
                </tr>
              </thead>
              <tbody>
                {(companies || []).map(c => (
                  <tr key={c.id}>
                    <td className="font-mono text-sm">{c.code}</td>
                    <td>{c.full_name}</td>
                    <td className="text-ink-faint text-xs font-mono">{c.twenty_id || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {activeTab === 'data' && (
        <Section
          title="Данные парсинга"
          description="Удаляет все сделки, позиции и логи парсинга/синхронизации. Настройки и справочники сохраняются."
        >
          <button
            onClick={() => {
              if (!confirm('Удалить все данные парсинга? Это действие нельзя отменить.')) return;
              clearParsingData.mutate();
            }}
            disabled={clearParsingData.isPending}
            className="btn-danger"
          >
            {clearParsingData.isPending ? 'Очистка...' : 'Очистить данные парсинга'}
          </button>
          {clearParsingData.isSuccess && (
            <p className="text-sm text-pastel-green-text mt-3">
              Удалено: {clearParsingData.data.deleted.deals} сделок,{' '}
              {clearParsingData.data.deleted.parseRuns} записей парсинга
            </p>
          )}
          {clearParsingData.isError && (
            <p className="text-sm text-pastel-red-text mt-3">{clearParsingData.error.message}</p>
          )}
        </Section>
      )}
    </div>
  );
}
