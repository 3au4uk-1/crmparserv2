import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  useSettings,
  useUpdateSetting,
  useKeywords,
  useUpdateKeywords,
  useDecorKeywords,
  useUpdateDecorKeywords,
  useMkKeywords,
  useUpdateMkKeywords,
  useCompanies,
  useCreateCompany,
  useClearParsingData,
  useBlacklist,
  useAddBlacklistItem,
  useRemoveBlacklistItem,
  useDecorBlacklist,
  useAddDecorBlacklistItem,
  useRemoveDecorBlacklistItem,
  useMkBlacklist,
  useAddMkBlacklistItem,
  useRemoveMkBlacklistItem,
  useRestorationList,
  useAddRestorationItem,
  useRemoveRestorationItem,
  useNeNasheBrandingList,
  useAddNeNasheBrandingItem,
  useRemoveNeNasheBrandingItem,
  useNeNasheDecorMkList,
  useAddNeNasheDecorMkItem,
  useRemoveNeNasheDecorMkItem,
  useTipRules,
  useAddTipRule,
  useRemoveTipRule,
  useStartBulkResync,
  useActiveBulkResyncJob,
  useBulkResyncJob,
  fetchBulkResyncPreview,
  useStartProductStreamBackfill,
  useActiveProductStreamBackfillJob,
  useProductStreamBackfillJob,
  fetchProductStreamBackfillPreview,
  useStartRestoreMissingTwenty,
  useActiveRestoreMissingTwentyJob,
  useRestoreMissingTwentyJob,
  fetchRestoreMissingTwentyPreview,
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

const PARSING_DIRECTIONS = [
  { id: 'branding', label: 'Брендинг и производство' },
  { id: 'decor_mk', label: 'Декор и МК' },
];

const TIP_ZONES = [
  {
    tip: 'PODRYAD',
    title: 'Подряд',
    description: 'Eligible-позиции из списка попадают в Twenty с типом «подряд». Не eligible — не синкаются.',
    placeholder: 'Флаги односторонние на виндеры, флаги двусторонние',
    colorClass: 'bg-pastel-blue-bg text-pastel-blue-text',
    details: [
      { value: 'GLAV_PRINT', label: 'Глав принт' },
      { value: 'PASHA_VINDER', label: 'Паша виндер' },
      { value: 'ZARYA', label: 'Заря' },
      { value: 'LIZA_SUKNO', label: 'Лиза сукно' },
      { value: 'KUVALDIN_KLISHE', label: 'Кувалдин клише' },
      { value: 'SVOE', label: 'Своё' },
    ],
  },
  {
    tip: 'BANNERA',
    title: 'Баннера',
    description: 'Eligible-позиции из списка попадают в Twenty с типом «баннер». Не eligible — не синкаются.',
    placeholder: 'Баннер 3x6, баннер 2x1',
    colorClass: 'bg-pastel-green-bg text-pastel-green-text',
    details: [
      { value: 'KTO_EDET', label: 'кто едет?' },
      { value: 'YURA', label: 'Юра' },
      { value: 'MAGA', label: 'Мага' },
      { value: 'TOPILSKIY', label: 'Топильский' },
    ],
  },
  {
    tip: 'PROIZVODSTVO',
    title: 'Производство',
    description: 'Правила для позиций собственного производства.',
    placeholder: 'Ролл-ап, поп-ап, промо-стойка',
    colorClass: 'bg-pastel-blue-bg text-pastel-blue-text',
    details: [
      { value: 'ROLL_UP', label: 'Ролл-ап' },
      { value: 'POP_UP', label: 'Поп-ап' },
      { value: 'PROMO_STOYKA', label: 'Промо-стойка' },
      { value: 'PROIZVODSTVO_DRUGOE', label: 'Другое' },
    ],
  },
  {
    tip: 'PLENKA',
    title: 'Плёнка',
    description: 'Правила для позиций с плёнкой.',
    placeholder: 'Оклейка, плёнка',
    colorClass: 'bg-pastel-yellow-bg text-pastel-yellow-text',
    details: [
      { value: 'NASHI', label: 'Наши' },
      { value: 'NE_NASHI', label: 'Не наши' },
    ],
  },
  {
    tip: 'RESTAVRACIYA',
    title: 'Рест. плёнка',
    description: 'Правила для позиций реставрации плёнки.',
    placeholder: 'Реставрация плёнки',
    colorClass: 'bg-pastel-red-bg text-pastel-red-text',
    details: [
      { value: 'NASHI', label: 'Наши' },
      { value: 'NE_NASHI', label: 'Не наши' },
    ],
  },
];

function isBulkResyncRunning(status) {
  return status === 'queued' || status === 'running';
}

function BulkResyncPanel() {
  const [jobId, setJobId] = useState('');
  const [startError, setStartError] = useState('');

  const startBulkResync = useStartBulkResync();
  const { data: activeJob } = useActiveBulkResyncJob();
  const { data: job, error: jobError } = useBulkResyncJob(jobId, { enabled: !!jobId });

  useEffect(() => {
    if (!activeJob?.jobId || jobId) return;
    setJobId(activeJob.jobId);
  }, [activeJob, jobId]);

  const status = job?.status || activeJob?.status;
  const running = startBulkResync.isPending || isBulkResyncRunning(status);
  const details = job || activeJob || {};

  async function onStartBulkResync() {
    setStartError('');
    try {
      const preview = await fetchBulkResyncPreview();
      const count = preview?.count ?? 0;
      if (count === 0) {
        setStartError('Нет синхронизированных сделок для пересинхронизации');
        return;
      }
      const confirmed = window.confirm(
        `Будет пересинхронизировано ${count} сделок. Актуальные фильтры (блеклист, реставрация, подряд, баннера) будут применены в Twenty. Продолжить?`,
      );
      if (!confirmed) return;

      startBulkResync.mutate(undefined, {
        onSuccess: (data) => {
          if (data?.jobId) setJobId(String(data.jobId));
        },
        onError: (err) => {
          if (err.response?.status === 409) {
            setStartError('Массовая пересинхронизация уже выполняется');
            return;
          }
          setStartError(
            err.response?.data?.error || err.message || 'Не удалось запустить пересинхронизацию',
          );
        },
      });
    } catch (err) {
      setStartError(err.response?.data?.error || err.message || 'Не удалось получить количество сделок');
    }
  }

  return (
    <div className="mt-6 pt-6 border-t border-border">
      <h4 className="text-sm font-semibold text-ink mb-1">Применить фильтры к синхронизированным сделкам</h4>
      <p className="text-xs text-ink-muted mb-3 max-w-xl leading-relaxed">
        Пересинхронизирует все сделки с Twenty, применяя текущие списки блеклиста, реставрации, подряда и баннера.
        В отличие от обычной пересинхронизации, обновляет и удаляет позиции на любой стадии в Twenty.
      </p>
      <button type="button" onClick={onStartBulkResync} disabled={running} className="btn-secondary">
        {running ? 'Пересинхронизация выполняется…' : 'Применить фильтры ко всем синхронизированным сделкам'}
      </button>

      {(jobId || activeJob?.jobId) && (
        <div className="mt-4 space-y-1 text-sm text-ink-muted">
          <p>
            Статус: <span className="font-medium text-ink">{status || 'unknown'}</span>
          </p>
          <p>
            Прогресс:{' '}
            <span className="font-medium tabular-nums text-ink">
              {details.dealsDone ?? 0} / {details.dealsTotal ?? 0}
            </span>
          </p>
          <p>
            Обновлено: <span className="font-medium tabular-nums text-ink">{details.dealsUpdated ?? 0}</span>
            {' · '}
            Ошибок: <span className="font-medium tabular-nums text-ink">{details.dealsFailed ?? 0}</span>
          </p>
          {Array.isArray(details.errors) && details.errors.length > 0 && (
            <ul className="mt-2 text-xs text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md space-y-1">
              {details.errors.map((entry) => (
                <li key={`${entry.dealId}-${entry.error}`}>
                  Сделка #{entry.dealId}: {entry.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {startError && (
        <p className="mt-3 text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md">{startError}</p>
      )}
      {jobError && (
        <p className="mt-3 text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md">
          {jobError.response?.data?.error || jobError.message || 'Не удалось получить статус задачи'}
        </p>
      )}
    </div>
  );
}

function ProductStreamBackfillPanel() {
  const [jobId, setJobId] = useState('');
  const [startError, setStartError] = useState('');

  const startBackfill = useStartProductStreamBackfill();
  const { data: activeJob } = useActiveProductStreamBackfillJob();
  const { data: job, error: jobError } = useProductStreamBackfillJob(jobId, { enabled: !!jobId });

  useEffect(() => {
    if (!activeJob?.jobId || jobId) return;
    setJobId(activeJob.jobId);
  }, [activeJob, jobId]);

  const status = job?.status || activeJob?.status;
  const running = startBackfill.isPending || isBulkResyncRunning(status);
  const details = job || activeJob || {};

  async function onStartBackfill() {
    setStartError('');
    try {
      const preview = await fetchProductStreamBackfillPreview();
      const count = preview?.count ?? 0;
      if (count === 0) {
        setStartError('Нет синхронизированных сделок для обновления потоков');
        return;
      }
      const confirmed = window.confirm(
        `${count} сделок с Twenty. Набор потоков будет перезаписан по текущим ключевым словам. Позиции не удаляются. Продолжить?`,
      );
      if (!confirmed) return;

      startBackfill.mutate(undefined, {
        onSuccess: (data) => {
          if (data?.jobId) setJobId(String(data.jobId));
        },
        onError: (err) => {
          if (err.response?.status === 409) {
            setStartError('Обновление потоков или другая тяжёлая синхронизация Twenty уже выполняется');
            return;
          }
          setStartError(
            err.response?.data?.error || err.message || 'Не удалось запустить обновление потоков',
          );
        },
      });
    } catch (err) {
      setStartError(err.response?.data?.error || err.message || 'Не удалось получить количество сделок');
    }
  }

  return (
    <div className="mt-6 pt-6 border-t border-border">
      <h4 className="text-sm font-semibold text-ink mb-1">Вернуть потоки на доски</h4>
      <p className="text-xs text-ink-muted mb-3 max-w-xl leading-relaxed">
        Пересчитает брендинг, декор и МК у позиций, уже лежащих в Twenty. Пересечения снова видны на обеих досках.
        Позиции не удаляются.
      </p>
      <button type="button" onClick={onStartBackfill} disabled={running} className="btn-secondary">
        {running ? 'Обновление потоков выполняется…' : 'Вернуть потоки на все синхронизированные сделки'}
      </button>

      {(jobId || activeJob?.jobId) && (
        <div className="mt-4 space-y-1 text-sm text-ink-muted">
          <p>
            Статус: <span className="font-medium text-ink">{status || 'unknown'}</span>
          </p>
          <p>
            Прогресс:{' '}
            <span className="font-medium tabular-nums text-ink">
              {details.dealsDone ?? 0} / {details.dealsTotal ?? 0}
            </span>
          </p>
          <p>
            Обновлено: <span className="font-medium tabular-nums text-ink">{details.dealsUpdated ?? 0}</span>
            {' · '}
            Ошибок: <span className="font-medium tabular-nums text-ink">{details.dealsFailed ?? 0}</span>
          </p>
          {Array.isArray(details.errors) && details.errors.length > 0 && (
            <ul className="mt-2 text-xs text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md space-y-1">
              {details.errors.map((entry) => (
                <li key={`${entry.dealId}-${entry.error}`}>
                  Сделка #{entry.dealId}: {entry.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {startError && (
        <p className="mt-3 text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md">{startError}</p>
      )}
      {jobError && (
        <p className="mt-3 text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md">
          {jobError.response?.data?.error || jobError.message || 'Не удалось получить статус задачи'}
        </p>
      )}
    </div>
  );
}

function RestoreMissingTwentyPanel() {
  const [jobId, setJobId] = useState('');
  const [startError, setStartError] = useState('');

  const startRestore = useStartRestoreMissingTwenty();
  const { data: activeJob } = useActiveRestoreMissingTwentyJob();
  const { data: job, error: jobError } = useRestoreMissingTwentyJob(jobId, { enabled: !!jobId });

  useEffect(() => {
    if (!activeJob?.jobId || jobId) return;
    setJobId(activeJob.jobId);
  }, [activeJob, jobId]);

  const status = job?.status || activeJob?.status;
  const running = startRestore.isPending || isBulkResyncRunning(status);
  const details = job || activeJob || {};

  async function onStartRestore() {
    setStartError('');
    try {
      const preview = await fetchRestoreMissingTwentyPreview();
      const count = preview?.count ?? 0;
      if (count === 0) {
        setStartError('Нет синхронизированных сделок для проверки');
        return;
      }
      const confirmed = window.confirm(
        `Будет проверено ${count} сделок с twenty_id. Отсутствующие в Twenty будут созданы заново. Продолжить?`,
      );
      if (!confirmed) return;

      startRestore.mutate(undefined, {
        onSuccess: (data) => {
          if (data?.jobId) setJobId(String(data.jobId));
        },
        onError: (err) => {
          if (err.response?.status === 409) {
            setStartError(
              err.response?.data?.error || 'Другая задача синхронизации с Twenty уже выполняется',
            );
            return;
          }
          setStartError(
            err.response?.data?.error || err.message || 'Не удалось запустить восстановление',
          );
        },
      });
    } catch (err) {
      setStartError(err.response?.data?.error || err.message || 'Не удалось получить количество сделок');
    }
  }

  return (
    <div className="mt-6 pt-6 border-t border-border">
      <h4 className="text-sm font-semibold text-ink mb-1">Восстановить отсутствующие в Twenty</h4>
      <p className="text-xs text-ink-muted mb-3 max-w-xl leading-relaxed">
        Проверит все локальные сделки с twenty_id и создаст в Twenty те, которые были удалены.
        Если сделка уже есть по номеру брони, будет привязана к существующей записи.
      </p>
      <button type="button" onClick={onStartRestore} disabled={running} className="btn-secondary">
        {running ? 'Проверка выполняется…' : 'Проверить и восстановить'}
      </button>

      {(jobId || activeJob?.jobId) && (
        <div className="mt-4 space-y-1 text-sm text-ink-muted">
          <p>
            Статус: <span className="font-medium text-ink">{status || 'unknown'}</span>
          </p>
          <p>
            Прогресс:{' '}
            <span className="font-medium tabular-nums text-ink">
              {details.dealsDone ?? 0} / {details.dealsTotal ?? 0}
            </span>
          </p>
          <p>
            Восстановлено:{' '}
            <span className="font-medium tabular-nums text-ink">{details.dealsRestored ?? 0}</span>
            {' · '}
            Пропущено: <span className="font-medium tabular-nums text-ink">{details.dealsSkipped ?? 0}</span>
            {' · '}
            Ошибок: <span className="font-medium tabular-nums text-ink">{details.dealsFailed ?? 0}</span>
          </p>
          {Array.isArray(details.errors) && details.errors.length > 0 && (
            <ul className="mt-2 text-xs text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md space-y-1">
              {details.errors.map((entry) => (
                <li key={`${entry.dealId}-${entry.error}`}>
                  Сделка #{entry.dealId}: {entry.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {startError && (
        <p className="mt-3 text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md">{startError}</p>
      )}
      {jobError && (
        <p className="mt-3 text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md">
          {jobError.response?.data?.error || jobError.message || 'Не удалось получить статус задачи'}
        </p>
      )}
    </div>
  );
}

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

function DirectionGroup({ title, description, children }) {
  return (
    <div className="mb-8 last:mb-4">
      <header className="mb-4 pb-3 border-b border-border">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {description && (
          <p className="text-sm text-ink-muted mt-1 max-w-3xl leading-relaxed">{description}</p>
        )}
      </header>
      {children}
    </div>
  );
}

function FieldLabel({ children }) {
  return <label className="block text-sm font-medium text-ink-muted mb-1.5">{children}</label>;
}

function parseCommaSeparatedInput(text) {
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

async function addPatternsFromInput(text, matchType, mutateAsync, extraPayload = {}) {
  const patterns = parseCommaSeparatedInput(text);
  if (patterns.length === 0) {
    return { added: 0, duplicates: [], failures: [] };
  }

  const duplicates = [];
  const failures = [];
  let added = 0;

  for (const pattern of patterns) {
    try {
      await mutateAsync({ pattern, matchType, ...extraPayload });
      added += 1;
    } catch (err) {
      if (err.response?.status === 409) {
        duplicates.push(pattern);
      } else {
        failures.push({
          pattern,
          message: err.response?.data?.error || err.message || 'ошибка добавления',
        });
      }
    }
  }

  return { added, duplicates, failures };
}

function formatPatternAddResult({ added, duplicates, failures }, duplicateLabel) {
  const parts = [];
  if (duplicates.length > 0) {
    parts.push(`${duplicateLabel}: ${duplicates.join(', ')}`);
  }
  if (failures.length > 0) {
    parts.push(failures.map((entry) => `«${entry.pattern}» — ${entry.message}`).join('; '));
  }
  if (parts.length === 0 && added > 0) {
    return '';
  }
  if (added > 0) {
    parts.unshift(added === 1 ? 'Добавлено 1 значение' : `Добавлено ${added} значений`);
  }
  return parts.join('. ');
}

function TipRulesSection({
  zone,
  rules,
  addTipRule,
  removeTipRule,
  patternListBusy,
  handleAddPatterns,
}) {
  const [pattern, setPattern] = useState('');
  const [matchType, setMatchType] = useState('exact');
  const [tipDetail, setTipDetail] = useState('');
  const [error, setError] = useState('');
  const detailLabels = new Map(zone.details.map((detail) => [detail.value, detail.label]));
  const listKey = `tip-${zone.tip}`;

  return (
    <Section
      title={zone.title}
      description={`${zone.description} Можно добавить одно значение или несколько через запятую.`}
    >
      <div className="flex flex-wrap gap-2 mb-4">
        {rules.map((entry) => (
          <span
            key={entry.id}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm ${zone.colorClass}`}
          >
            {entry.pattern}
            <span className="text-xs opacity-70">
              ({entry.matchType === 'exact' ? 'точное' : 'фрагмент'} ·{' '}
              {entry.tipDetail ? detailLabels.get(entry.tipDetail) || entry.tipDetail : 'по умолчанию'})
            </span>
            <button
              onClick={() => removeTipRule.mutate(entry.id)}
              className="opacity-60 hover:opacity-100 transition-opacity"
              aria-label={`Удалить из списка ${zone.title.toLowerCase()}`}
            >
              &times;
            </button>
          </span>
        ))}
      </div>
      {error && (
        <p className="text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md mb-3">{error}</p>
      )}
      <div className="flex flex-wrap gap-2 items-end max-w-4xl">
        <textarea
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
          rows={2}
          className="input-field flex-1 min-w-[12rem]"
          placeholder={zone.placeholder}
        />
        <select
          value={matchType}
          onChange={(event) => setMatchType(event.target.value)}
          className="select-field"
        >
          <option value="exact">Точное</option>
          <option value="substring">Фрагмент</option>
        </select>
        <select
          value={tipDetail}
          onChange={(event) => setTipDetail(event.target.value)}
          className="select-field"
          aria-label={`Детализация типа ${zone.title}`}
        >
          <option value="">По умолчанию</option>
          {zone.details.map((detail) => (
            <option key={detail.value} value={detail.value}>
              {detail.label}
            </option>
          ))}
        </select>
        <button
          onClick={() =>
            handleAddPatterns({
              listKey,
              text: pattern,
              matchType,
              mutateAsync: addTipRule.mutateAsync,
              extraPayload: { tip: zone.tip, tipDetail: tipDetail || null },
              setError,
              clearInput: () => setPattern(''),
              duplicateLabel: `Уже в списке «${zone.title}»`,
            })
          }
          disabled={!pattern.trim() || patternListBusy === listKey || addTipRule.isPending}
          className="btn-primary btn-sm"
        >
          Добавить
        </button>
      </div>
    </Section>
  );
}

export default function Settings() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('auth');

  useEffect(() => {
    if (searchParams.get('tab') === 'telegram') navigate('/telegram', { replace: true });
  }, [searchParams, navigate]);

  const { data: settings } = useSettings();
  const { data: keywords } = useKeywords();
  const { data: decorKeywords } = useDecorKeywords();
  const { data: mkKeywords } = useMkKeywords();
  const { data: blacklist } = useBlacklist();
  const { data: decorBlacklist } = useDecorBlacklist();
  const { data: mkBlacklist } = useMkBlacklist();
  const { data: restorationList } = useRestorationList();
  const { data: neNasheBrandingList } = useNeNasheBrandingList();
  const { data: neNasheDecorMkList } = useNeNasheDecorMkList();
  const { data: tipRules } = useTipRules();
  const { data: companies } = useCompanies();
  const updateSetting = useUpdateSetting();
  const updateKeywords = useUpdateKeywords();
  const updateDecorKeywords = useUpdateDecorKeywords();
  const updateMkKeywords = useUpdateMkKeywords();
  const addBlacklistItem = useAddBlacklistItem();
  const removeBlacklistItem = useRemoveBlacklistItem();
  const addDecorBlacklistItem = useAddDecorBlacklistItem();
  const removeDecorBlacklistItem = useRemoveDecorBlacklistItem();
  const addMkBlacklistItem = useAddMkBlacklistItem();
  const removeMkBlacklistItem = useRemoveMkBlacklistItem();
  const addRestorationItem = useAddRestorationItem();
  const removeRestorationItem = useRemoveRestorationItem();
  const addNeNasheBrandingItem = useAddNeNasheBrandingItem();
  const removeNeNasheBrandingItem = useRemoveNeNasheBrandingItem();
  const addNeNasheDecorMkItem = useAddNeNasheDecorMkItem();
  const removeNeNasheDecorMkItem = useRemoveNeNasheDecorMkItem();
  const addTipRule = useAddTipRule();
  const removeTipRule = useRemoveTipRule();
  const clearParsingData = useClearParsingData();
  const createCompany = useCreateCompany();

  const [newKeyword, setNewKeyword] = useState('');
  const [newDecorKeyword, setNewDecorKeyword] = useState('');
  const [newMkKeyword, setNewMkKeyword] = useState('');
  const [newCompanyCode, setNewCompanyCode] = useState('');
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newBlacklistPattern, setNewBlacklistPattern] = useState('');
  const [newBlacklistMatchType, setNewBlacklistMatchType] = useState('exact');
  const [blacklistError, setBlacklistError] = useState('');
  const [newDecorBlacklistPattern, setNewDecorBlacklistPattern] = useState('');
  const [newDecorBlacklistMatchType, setNewDecorBlacklistMatchType] = useState('exact');
  const [decorBlacklistError, setDecorBlacklistError] = useState('');
  const [newMkBlacklistPattern, setNewMkBlacklistPattern] = useState('');
  const [newMkBlacklistMatchType, setNewMkBlacklistMatchType] = useState('exact');
  const [mkBlacklistError, setMkBlacklistError] = useState('');
  const [newRestorationPattern, setNewRestorationPattern] = useState('');
  const [newRestorationMatchType, setNewRestorationMatchType] = useState('exact');
  const [restorationError, setRestorationError] = useState('');
  const [newNeNasheBrandingPattern, setNewNeNasheBrandingPattern] = useState('');
  const [newNeNasheBrandingMatchType, setNewNeNasheBrandingMatchType] = useState('exact');
  const [neNasheBrandingError, setNeNasheBrandingError] = useState('');
  const [newNeNasheDecorMkPattern, setNewNeNasheDecorMkPattern] = useState('');
  const [newNeNasheDecorMkMatchType, setNewNeNasheDecorMkMatchType] = useState('exact');
  const [neNasheDecorMkError, setNeNasheDecorMkError] = useState('');
  const [parsingDirection, setParsingDirection] = useState('branding');
  const [patternListBusy, setPatternListBusy] = useState(null);
  const [cookieValue, setCookieValue] = useState('');

  useEffect(() => {
    if (settings?.crm_cookies) setCookieValue(settings.crm_cookies);
  }, [settings?.crm_cookies]);

  function addKeyword() {
    const parsed = parseCommaSeparatedInput(newKeyword);
    if (parsed.length === 0) return;
    updateKeywords.mutate(mergeKeywords(keywords, parsed));
    setNewKeyword('');
  }

  function addDecorKeyword() {
    const parsed = parseCommaSeparatedInput(newDecorKeyword);
    if (parsed.length === 0) return;
    updateDecorKeywords.mutate(mergeKeywords(decorKeywords, parsed));
    setNewDecorKeyword('');
  }

  function addMkKeyword() {
    const parsed = parseCommaSeparatedInput(newMkKeyword);
    if (parsed.length === 0) return;
    updateMkKeywords.mutate(mergeKeywords(mkKeywords, parsed));
    setNewMkKeyword('');
  }

  async function handleAddPatterns({
    listKey,
    text,
    matchType,
    mutateAsync,
    setError,
    clearInput,
    duplicateLabel,
    extraPayload,
  }) {
    setPatternListBusy(listKey);
    setError('');
    try {
      const result = await addPatternsFromInput(text, matchType, mutateAsync, extraPayload);
      if (result.added > 0) clearInput();
      const message = formatPatternAddResult(result, duplicateLabel);
      if (message) setError(message);
    } finally {
      setPatternListBusy(null);
    }
  }

  function removeKeyword(kw) {
    updateKeywords.mutate((keywords || []).filter(k => k !== kw));
  }

  function removeDecorKeyword(kw) {
    updateDecorKeywords.mutate((decorKeywords || []).filter((k) => k !== kw));
  }

  function removeMkKeyword(kw) {
    updateMkKeywords.mutate((mkKeywords || []).filter((k) => k !== kw));
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
          <nav
            className="flex gap-1 overflow-x-auto pb-1 mb-6 border-b border-border"
            aria-label="Направление парсинга"
          >
            {PARSING_DIRECTIONS.map((direction) => (
              <button
                key={direction.id}
                type="button"
                onClick={() => setParsingDirection(direction.id)}
                className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors duration-200 ${
                  parsingDirection === direction.id
                    ? 'border-ink text-ink'
                    : 'border-transparent text-ink-muted hover:text-ink'
                }`}
              >
                {direction.label}
              </button>
            ))}
          </nav>

          {parsingDirection === 'branding' && (
          <DirectionGroup
            title="Брендинг и производство"
            description="Ключевые слова, блеклист, «Не наше», реставрация и правила типов для основного потока и печати."
          >
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
            description="Позиции в блеклисте не попадают в Twenty автоматически. Ручная галочка в сделке перебивает блеклист. Можно добавить одно значение или несколько через запятую."
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
              <textarea
                value={newBlacklistPattern}
                onChange={(e) => setNewBlacklistPattern(e.target.value)}
                rows={2}
                className="input-field flex-1 min-w-[12rem]"
                placeholder="Стойка указатель напольная А4, стойка ролл-ап"
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
                onClick={() => handleAddPatterns({
                  listKey: 'blacklist',
                  text: newBlacklistPattern,
                  matchType: newBlacklistMatchType,
                  mutateAsync: addBlacklistItem.mutateAsync,
                  setError: setBlacklistError,
                  clearInput: () => setNewBlacklistPattern(''),
                  duplicateLabel: 'Уже в блеклисте',
                })}
                disabled={!newBlacklistPattern.trim() || patternListBusy === 'blacklist' || addBlacklistItem.isPending}
                className="btn-danger btn-sm"
              >
                Добавить
              </button>
            </div>
          </Section>

          <Section
            title="Не наше (брендинг)"
            description="Позиции из списка синкаются с суммой 0 ₽; tipDetail «Не наши» не затрагивается. Можно добавить одно значение или несколько через запятую."
          >
            <div className="flex flex-wrap gap-2 mb-4">
              {(neNasheBrandingList || []).map((entry) => (
                <span
                  key={entry.id}
                  className="inline-flex items-center gap-1.5 bg-pastel-gray-bg text-pastel-gray-text px-2.5 py-1 rounded-md text-sm"
                >
                  {entry.sourceName || entry.pattern}
                  <span className="text-xs opacity-70">
                    ({entry.matchType === 'exact' ? 'точное' : 'фрагмент'})
                  </span>
                  <button
                    onClick={() => removeNeNasheBrandingItem.mutate(entry.id)}
                    className="opacity-60 hover:opacity-100 transition-opacity"
                    aria-label="Удалить из списка «Не наше (брендинг)»"
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
            {neNasheBrandingError && (
              <p className="text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md mb-3">{neNasheBrandingError}</p>
            )}
            <div className="flex flex-wrap gap-2 items-end max-w-2xl">
              <textarea
                value={newNeNasheBrandingPattern}
                onChange={(e) => setNewNeNasheBrandingPattern(e.target.value)}
                rows={2}
                className="input-field flex-1 min-w-[12rem]"
                placeholder="Пример позиции «не наше»"
              />
              <select
                value={newNeNasheBrandingMatchType}
                onChange={(e) => setNewNeNasheBrandingMatchType(e.target.value)}
                className="select-field"
              >
                <option value="exact">Точное</option>
                <option value="substring">Фрагмент</option>
              </select>
              <button
                onClick={() => handleAddPatterns({
                  listKey: 'ne-nashe-branding',
                  text: newNeNasheBrandingPattern,
                  matchType: newNeNasheBrandingMatchType,
                  mutateAsync: addNeNasheBrandingItem.mutateAsync,
                  setError: setNeNasheBrandingError,
                  clearInput: () => setNewNeNasheBrandingPattern(''),
                  duplicateLabel: 'Уже в списке «Не наше (брендинг)»',
                })}
                disabled={!newNeNasheBrandingPattern.trim() || patternListBusy === 'ne-nashe-branding' || addNeNasheBrandingItem.isPending}
                className="btn-primary btn-sm"
              >
                Добавить
              </button>
            </div>
          </Section>

          <Section
            title="Реставрация"
            description="Eligible-позиции из списка попадают в Twenty с суммой 0 ₽. Не eligible — не синкаются. Стадия не меняется. Можно добавить одно значение или несколько через запятую."
          >
            <div className="flex flex-wrap gap-2 mb-4">
              {(restorationList || []).map((entry) => (
                <span
                  key={entry.id}
                  className="inline-flex items-center gap-1.5 bg-pastel-yellow-bg text-pastel-yellow-text px-2.5 py-1 rounded-md text-sm"
                >
                  {entry.sourceName || entry.pattern}
                  <span className="text-xs opacity-70">
                    ({entry.matchType === 'exact' ? 'точное' : 'фрагмент'})
                  </span>
                  <button
                    onClick={() => removeRestorationItem.mutate(entry.id)}
                    className="opacity-60 hover:opacity-100 transition-opacity"
                    aria-label="Удалить из списка реставрации"
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
            {restorationError && (
              <p className="text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md mb-3">{restorationError}</p>
            )}
            <div className="flex flex-wrap gap-2 items-end max-w-2xl">
              <textarea
                value={newRestorationPattern}
                onChange={(e) => setNewRestorationPattern(e.target.value)}
                rows={2}
                className="input-field flex-1 min-w-[12rem]"
                placeholder="Колесо фортуны, колесо удачи"
              />
              <select
                value={newRestorationMatchType}
                onChange={(e) => setNewRestorationMatchType(e.target.value)}
                className="select-field"
              >
                <option value="exact">Точное</option>
                <option value="substring">Фрагмент</option>
              </select>
              <button
                onClick={() => handleAddPatterns({
                  listKey: 'restoration',
                  text: newRestorationPattern,
                  matchType: newRestorationMatchType,
                  mutateAsync: addRestorationItem.mutateAsync,
                  setError: setRestorationError,
                  clearInput: () => setNewRestorationPattern(''),
                  duplicateLabel: 'Уже в списке реставрации',
                })}
                disabled={!newRestorationPattern.trim() || patternListBusy === 'restoration' || addRestorationItem.isPending}
                className="btn-primary btn-sm"
              >
                Добавить
              </button>
            </div>
          </Section>

          {TIP_ZONES.map((zone) => (
            <TipRulesSection
              key={zone.tip}
              zone={zone}
              rules={(tipRules || []).filter((entry) => entry.tip === zone.tip)}
              addTipRule={addTipRule}
              removeTipRule={removeTipRule}
              patternListBusy={patternListBusy}
              handleAddPatterns={handleAddPatterns}
            />
          ))}
          </DirectionGroup>
          )}

          {parsingDirection === 'decor_mk' && (
          <DirectionGroup
            title="Декор и МК"
            description="Ключевые слова, блеклисты и «Не наше» для доски «МК и Декор»."
          >
          <Section
            title="Ключевые слова декора"
            description="Позиции с совпадением попадают в поток «Декор» на доске «МК и Декор». Можно добавить одно слово или несколько через запятую."
          >
            <div className="flex flex-wrap gap-2 mb-4">
              {(decorKeywords || []).map((kw) => (
                <span key={kw} className="inline-flex items-center gap-1.5 bg-pastel-green-bg text-pastel-green-text px-2.5 py-1 rounded-md text-sm">
                  {kw}
                  <button
                    onClick={() => removeDecorKeyword(kw)}
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
                value={newDecorKeyword}
                onChange={(e) => setNewDecorKeyword(e.target.value)}
                rows={2}
                className="input-field flex-1"
                placeholder="декор, оформление, витрина"
              />
              <button
                onClick={addDecorKeyword}
                disabled={!newDecorKeyword.trim()}
                className="btn-primary btn-sm shrink-0"
              >
                Добавить
              </button>
            </div>
          </Section>

          <Section
            title="Ключевые слова МК"
            description="Позиции с совпадением попадают в поток «МК» на доске «МК и Декор». Можно добавить одно слово или несколько через запятую."
          >
            <div className="flex flex-wrap gap-2 mb-4">
              {(mkKeywords || []).map((kw) => (
                <span key={kw} className="inline-flex items-center gap-1.5 bg-pastel-yellow-bg text-pastel-yellow-text px-2.5 py-1 rounded-md text-sm">
                  {kw}
                  <button
                    onClick={() => removeMkKeyword(kw)}
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
                value={newMkKeyword}
                onChange={(e) => setNewMkKeyword(e.target.value)}
                rows={2}
                className="input-field flex-1"
                placeholder="мк, монтажная конструкция"
              />
              <button
                onClick={addMkKeyword}
                disabled={!newMkKeyword.trim()}
                className="btn-primary btn-sm shrink-0"
              >
                Добавить
              </button>
            </div>
          </Section>

          <Section
            title="Блеклист декора"
            description="Позиции в блеклисте не попадают в поток «Декор». Можно добавить одно значение или несколько через запятую."
          >
            <div className="flex flex-wrap gap-2 mb-4">
              {(decorBlacklist || []).map((entry) => (
                <span
                  key={entry.id}
                  className="inline-flex items-center gap-1.5 bg-pastel-red-bg text-pastel-red-text px-2.5 py-1 rounded-md text-sm"
                >
                  {entry.sourceName || entry.pattern}
                  <span className="text-xs opacity-70">
                    ({entry.matchType === 'exact' ? 'точное' : 'фрагмент'})
                  </span>
                  <button
                    onClick={() => removeDecorBlacklistItem.mutate(entry.id)}
                    className="opacity-60 hover:opacity-100 transition-opacity"
                    aria-label="Удалить из блеклиста декора"
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
            {decorBlacklistError && (
              <p className="text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md mb-3">{decorBlacklistError}</p>
            )}
            <div className="flex flex-wrap gap-2 items-end max-w-2xl">
              <textarea
                value={newDecorBlacklistPattern}
                onChange={(e) => setNewDecorBlacklistPattern(e.target.value)}
                rows={2}
                className="input-field flex-1 min-w-[12rem]"
                placeholder="Пример позиции декора"
              />
              <select
                value={newDecorBlacklistMatchType}
                onChange={(e) => setNewDecorBlacklistMatchType(e.target.value)}
                className="select-field"
              >
                <option value="exact">Точное</option>
                <option value="substring">Фрагмент</option>
              </select>
              <button
                onClick={() => handleAddPatterns({
                  listKey: 'decor-blacklist',
                  text: newDecorBlacklistPattern,
                  matchType: newDecorBlacklistMatchType,
                  mutateAsync: addDecorBlacklistItem.mutateAsync,
                  setError: setDecorBlacklistError,
                  clearInput: () => setNewDecorBlacklistPattern(''),
                  duplicateLabel: 'Уже в блеклисте декора',
                })}
                disabled={!newDecorBlacklistPattern.trim() || patternListBusy === 'decor-blacklist' || addDecorBlacklistItem.isPending}
                className="btn-danger btn-sm"
              >
                Добавить
              </button>
            </div>
          </Section>

          <Section
            title="Блеклист МК"
            description="Позиции в блеклисте не попадают в поток «МК». Можно добавить одно значение или несколько через запятую."
          >
            <div className="flex flex-wrap gap-2 mb-4">
              {(mkBlacklist || []).map((entry) => (
                <span
                  key={entry.id}
                  className="inline-flex items-center gap-1.5 bg-pastel-red-bg text-pastel-red-text px-2.5 py-1 rounded-md text-sm"
                >
                  {entry.sourceName || entry.pattern}
                  <span className="text-xs opacity-70">
                    ({entry.matchType === 'exact' ? 'точное' : 'фрагмент'})
                  </span>
                  <button
                    onClick={() => removeMkBlacklistItem.mutate(entry.id)}
                    className="opacity-60 hover:opacity-100 transition-opacity"
                    aria-label="Удалить из блеклиста МК"
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
            {mkBlacklistError && (
              <p className="text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md mb-3">{mkBlacklistError}</p>
            )}
            <div className="flex flex-wrap gap-2 items-end max-w-2xl">
              <textarea
                value={newMkBlacklistPattern}
                onChange={(e) => setNewMkBlacklistPattern(e.target.value)}
                rows={2}
                className="input-field flex-1 min-w-[12rem]"
                placeholder="Пример позиции МК"
              />
              <select
                value={newMkBlacklistMatchType}
                onChange={(e) => setNewMkBlacklistMatchType(e.target.value)}
                className="select-field"
              >
                <option value="exact">Точное</option>
                <option value="substring">Фрагмент</option>
              </select>
              <button
                onClick={() => handleAddPatterns({
                  listKey: 'mk-blacklist',
                  text: newMkBlacklistPattern,
                  matchType: newMkBlacklistMatchType,
                  mutateAsync: addMkBlacklistItem.mutateAsync,
                  setError: setMkBlacklistError,
                  clearInput: () => setNewMkBlacklistPattern(''),
                  duplicateLabel: 'Уже в блеклисте МК',
                })}
                disabled={!newMkBlacklistPattern.trim() || patternListBusy === 'mk-blacklist' || addMkBlacklistItem.isPending}
                className="btn-danger btn-sm"
              >
                Добавить
              </button>
            </div>
          </Section>

          <Section
            title="Не наше (декор/МК)"
            description="Позиции из списка синкаются с суммой 0 ₽; tipDetail «Не наши» не затрагивается. Можно добавить одно значение или несколько через запятую."
          >
            <div className="flex flex-wrap gap-2 mb-4">
              {(neNasheDecorMkList || []).map((entry) => (
                <span
                  key={entry.id}
                  className="inline-flex items-center gap-1.5 bg-pastel-gray-bg text-pastel-gray-text px-2.5 py-1 rounded-md text-sm"
                >
                  {entry.sourceName || entry.pattern}
                  <span className="text-xs opacity-70">
                    ({entry.matchType === 'exact' ? 'точное' : 'фрагмент'})
                  </span>
                  <button
                    onClick={() => removeNeNasheDecorMkItem.mutate(entry.id)}
                    className="opacity-60 hover:opacity-100 transition-opacity"
                    aria-label="Удалить из списка «Не наше (декор/МК)»"
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
            {neNasheDecorMkError && (
              <p className="text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md mb-3">{neNasheDecorMkError}</p>
            )}
            <div className="flex flex-wrap gap-2 items-end max-w-2xl">
              <textarea
                value={newNeNasheDecorMkPattern}
                onChange={(e) => setNewNeNasheDecorMkPattern(e.target.value)}
                rows={2}
                className="input-field flex-1 min-w-[12rem]"
                placeholder="Пример позиции «не наше»"
              />
              <select
                value={newNeNasheDecorMkMatchType}
                onChange={(e) => setNewNeNasheDecorMkMatchType(e.target.value)}
                className="select-field"
              >
                <option value="exact">Точное</option>
                <option value="substring">Фрагмент</option>
              </select>
              <button
                onClick={() => handleAddPatterns({
                  listKey: 'ne-nashe-decor-mk',
                  text: newNeNasheDecorMkPattern,
                  matchType: newNeNasheDecorMkMatchType,
                  mutateAsync: addNeNasheDecorMkItem.mutateAsync,
                  setError: setNeNasheDecorMkError,
                  clearInput: () => setNewNeNasheDecorMkPattern(''),
                  duplicateLabel: 'Уже в списке «Не наше (декор/МК)»',
                })}
                disabled={!newNeNasheDecorMkPattern.trim() || patternListBusy === 'ne-nashe-decor-mk' || addNeNasheDecorMkItem.isPending}
                className="btn-primary btn-sm"
              >
                Добавить
              </button>
            </div>
          </Section>
          </DirectionGroup>
          )}

          <Section
            title="Расписание парсинга"
            description="Автообновление зашито в сервер. Ручной парсинг — на странице «Парсинг»."
          >
            <ul className="text-sm text-ink-muted space-y-1.5 max-w-lg list-disc pl-5">
              <li>Будни 9:00–21:00 — каждый час, +7 дней</li>
              <li>Будни 22:00 — +14 дней</li>
              <li>Каждый день 2:00 — +4 дня (ночной лёгкий прогон)</li>
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
              <BulkResyncPanel />
              <ProductStreamBackfillPanel />
              <RestoreMissingTwentyPanel />
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

          <Section
            title="Производство — фреза"
            description="ID Google-таблицы очереди фрезы. Пока пусто — цикл экспорта/readback не активен (номинально)."
          >
            <div className="space-y-4 max-w-2xl">
              <div>
                <FieldLabel>freza_sheet_id</FieldLabel>
                <input
                  defaultValue={settings?.freza_sheet_id || ''}
                  onBlur={(e) =>
                    updateSetting.mutate({ key: 'freza_sheet_id', value: e.target.value })
                  }
                  className="input-field font-mono"
                  placeholder="оставьте пустым или вставьте spreadsheet id / URL"
                />
              </div>
            </div>
          </Section>

          <Section title="Расходы">
            <div className="space-y-4 max-w-2xl">
              <div>
                <FieldLabel>expense_sheet_field_team</FieldLabel>
                <input
                  defaultValue={settings?.expense_sheet_field_team || ''}
                  onBlur={(e) =>
                    updateSetting.mutate({ key: 'expense_sheet_field_team', value: e.target.value })
                  }
                  className="input-field font-mono"
                  placeholder="https://docs.google.com/spreadsheets/..."
                />
              </div>
              <div>
                <FieldLabel>expense_sheet_printing</FieldLabel>
                <input
                  defaultValue={settings?.expense_sheet_printing || ''}
                  onBlur={(e) =>
                    updateSetting.mutate({ key: 'expense_sheet_printing', value: e.target.value })
                  }
                  className="input-field font-mono"
                  placeholder="https://docs.google.com/spreadsheets/..."
                />
              </div>
              <div>
                <FieldLabel>expense_sheet_milling</FieldLabel>
                <input
                  defaultValue={settings?.expense_sheet_milling || ''}
                  onBlur={(e) =>
                    updateSetting.mutate({ key: 'expense_sheet_milling', value: e.target.value })
                  }
                  className="input-field font-mono"
                  placeholder="https://docs.google.com/spreadsheets/..."
                />
              </div>
              <div>
                <FieldLabel>expense_sheet_logistics</FieldLabel>
                <input
                  defaultValue={settings?.expense_sheet_logistics || ''}
                  onBlur={(e) =>
                    updateSetting.mutate({ key: 'expense_sheet_logistics', value: e.target.value })
                  }
                  className="input-field font-mono"
                  placeholder="https://docs.google.com/spreadsheets/..."
                />
              </div>
              <div>
                <FieldLabel>expense_sheet_beznal</FieldLabel>
                <input
                  defaultValue={settings?.expense_sheet_beznal || ''}
                  onBlur={(e) =>
                    updateSetting.mutate({ key: 'expense_sheet_beznal', value: e.target.value })
                  }
                  className="input-field font-mono"
                  placeholder="https://docs.google.com/spreadsheets/..."
                />
              </div>
              <div>
                <FieldLabel>expense_sync_schedule</FieldLabel>
                <input
                  defaultValue={settings?.expense_sync_schedule || ''}
                  onBlur={(e) =>
                    updateSetting.mutate({ key: 'expense_sync_schedule', value: e.target.value })
                  }
                  className="input-field font-mono"
                  placeholder="0 */2 * * *"
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
