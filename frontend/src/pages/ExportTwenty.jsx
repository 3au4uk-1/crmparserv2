import { useEffect, useMemo, useState } from 'react';
import {
  downloadTwentyExportFile,
  useActiveTwentyExportJob,
  useStartTwentyExport,
  useTwentyExportColumns,
  useTwentyExportJob,
} from '../api';
import PageHeader from '../components/ui/PageHeader';

const COLUMNS_STORAGE_KEY = 'export-twenty-columns';
const DEALS_SHEET_STORAGE_KEY = 'export-twenty-include-deals-sheet';
const RESTORATION_STORAGE_KEY = 'export-twenty-include-restoration';

function isJobRunning(status) {
  return status === 'queued' || status === 'running';
}

function readStoredJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function mergeColumnSelection(catalogKeys, stored) {
  if (!Array.isArray(stored)) return catalogKeys;
  return catalogKeys.filter((key) => stored.includes(key));
}

export default function ExportTwenty() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [includeDealsSheet, setIncludeDealsSheet] = useState(() =>
    Boolean(readStoredJson(DEALS_SHEET_STORAGE_KEY))
  );
  const [includeRestoration, setIncludeRestoration] = useState(() =>
    Boolean(readStoredJson(RESTORATION_STORAGE_KEY))
  );
  const [selectedColumns, setSelectedColumns] = useState([]);
  const [columnsReady, setColumnsReady] = useState(false);
  const [jobId, setJobId] = useState('');
  const [startError, setStartError] = useState('');
  const [downloadError, setDownloadError] = useState('');

  const { data: columnsPayload } = useTwentyExportColumns();
  const catalog = columnsPayload?.columns ?? [];
  const catalogKeys = useMemo(() => catalog.map((col) => col.key), [catalog]);

  const startExport = useStartTwentyExport();
  const { data: activeJob } = useActiveTwentyExportJob();
  const { data: job, error: jobError } = useTwentyExportJob(jobId, { enabled: !!jobId });

  useEffect(() => {
    if (!catalogKeys.length) return;
    setSelectedColumns(mergeColumnSelection(catalogKeys, readStoredJson(COLUMNS_STORAGE_KEY)));
    setColumnsReady(true);
  }, [catalogKeys]);

  useEffect(() => {
    if (!columnsReady) return;
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(selectedColumns));
  }, [selectedColumns, columnsReady]);

  useEffect(() => {
    localStorage.setItem(DEALS_SHEET_STORAGE_KEY, JSON.stringify(includeDealsSheet));
  }, [includeDealsSheet]);

  useEffect(() => {
    localStorage.setItem(RESTORATION_STORAGE_KEY, JSON.stringify(includeRestoration));
  }, [includeRestoration]);

  useEffect(() => {
    if (!activeJob?.jobId || jobId) return;
    setJobId(activeJob.jobId);
    setFrom(activeJob.from || '');
    setTo(activeJob.to || '');
    setIncludeCancelled(Boolean(activeJob.includeCancelled));
    setIncludeRestoration(Boolean(activeJob.includeRestoration));
    if (Array.isArray(activeJob.columns) && activeJob.columns.length) {
      setSelectedColumns(activeJob.columns);
    }
    if (activeJob.includeDealsSheet != null) {
      setIncludeDealsSheet(Boolean(activeJob.includeDealsSheet));
    }
  }, [activeJob, jobId]);

  const status = job?.status;
  const running = startExport.isPending || isJobRunning(status);
  const pagesFetched = job?.progress?.pagesFetched ?? 0;
  const lineItemsFetched = job?.progress?.lineItemsFetched ?? 0;
  const rowsWritten = job?.progress?.rowsWritten ?? 0;
  const allSelected = catalogKeys.length > 0 && selectedColumns.length === catalogKeys.length;

  function toggleColumn(key) {
    setSelectedColumns((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    );
  }

  function onSubmit(e) {
    e.preventDefault();
    setStartError('');
    setDownloadError('');

    if (!from || !to) {
      setStartError('Укажите диапазон дат');
      return;
    }
    if (!selectedColumns.length) {
      setStartError('Выберите хотя бы одну колонку');
      return;
    }

    startExport.mutate(
      { from, to, includeCancelled, includeRestoration, includeDealsSheet, columns: selectedColumns },
      {
        onSuccess: (data) => setJobId(data.jobId),
        onError: (err) => {
          if (err.response?.status === 409) {
            setStartError('Выгрузка Twenty уже выполняется');
            return;
          }
          if (err.response?.status === 503) {
            setStartError('Twenty CRM не настроен');
            return;
          }
          setStartError(err.response?.data?.error || err.message || 'Не удалось запустить выгрузку');
        },
      }
    );
  }

  async function onDownload() {
    if (!jobId) return;
    setDownloadError('');
    try {
      await downloadTwentyExportFile(jobId, job?.from || from, job?.to || to);
    } catch (err) {
      setDownloadError(err.response?.data?.error || err.message || 'Не удалось скачать файл');
    }
  }

  return (
    <div>
      <PageHeader
        title="Выгрузка Twenty"
        description="Выгрузка брендинговых позиций из Twenty CRM в Excel за выбранный период"
      />

      <section className="surface p-5 md:p-6 mb-6" aria-labelledby="export-twenty-form-heading">
        <div className="mb-5">
          <h2 id="export-twenty-form-heading" className="text-base font-semibold text-ink">
            Параметры выгрузки
          </h2>
          <p className="text-sm text-ink-muted mt-1 max-w-2xl">
            В файл попадают только позиции брендинга, сумма сделки считается по ним. Декор и МК не выгружаются. Выберите диапазон дат, колонки и укажите, нужно ли включить отменённые заказы.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-5">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-ink-muted font-medium">С</span>
              <input
                type="date"
                value={from}
                required
                onChange={(e) => setFrom(e.target.value)}
                className="input-field w-auto min-w-[10rem]"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-ink-muted font-medium">По</span>
              <input
                type="date"
                value={to}
                required
                onChange={(e) => setTo(e.target.value)}
                className="input-field w-auto min-w-[10rem]"
              />
            </label>

            <label className="flex items-center gap-2 pb-2 text-sm text-ink-muted">
              <input
                type="checkbox"
                checked={includeCancelled}
                onChange={(e) => setIncludeCancelled(e.target.checked)}
              />
              включая отмены
            </label>

            <label className="flex items-center gap-2 pb-2 text-sm text-ink-muted">
              <input
                type="checkbox"
                checked={includeRestoration}
                onChange={(e) => setIncludeRestoration(e.target.checked)}
              />
              включая реставрацию
            </label>

            <label className="flex items-center gap-2 pb-2 text-sm text-ink-muted">
              <input
                type="checkbox"
                checked={includeDealsSheet}
                onChange={(e) => setIncludeDealsSheet(e.target.checked)}
              />
              лист «Сделки» без позиций
            </label>
          </div>

          {catalog.length > 0 && (
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-ink">Колонки</legend>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary text-sm py-1 px-2"
                  onClick={() => setSelectedColumns(allSelected ? [] : catalogKeys)}
                >
                  {allSelected ? 'Снять все' : 'Выбрать все'}
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {catalog.map((col) => (
                  <label key={col.key} className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={selectedColumns.includes(col.key)}
                      onChange={() => toggleColumn(col.key)}
                    />
                    {col.header}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <button type="submit" disabled={running} className="btn-primary shrink-0">
            {running ? 'Выгрузка выполняется...' : 'Сформировать'}
          </button>
        </form>

        {startError && (
          <p className="mt-4 text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md">
            {startError}
          </p>
        )}
      </section>

      {jobId && (
        <section className="surface p-5 md:p-6" aria-live="polite">
          <h2 className="text-base font-semibold text-ink mb-1">Статус выгрузки</h2>
          <p className="text-sm text-ink-muted mb-4">
            ID задачи: <span className="tabular-nums">{jobId}</span>
          </p>

          {(running || status === 'completed') && (
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <div className="rounded-md bg-canvas px-3 py-2">
                <dt className="text-xs text-ink-muted">Страниц получено</dt>
                <dd className="font-medium tabular-nums text-ink">{pagesFetched}</dd>
              </div>
              <div className="rounded-md bg-canvas px-3 py-2">
                <dt className="text-xs text-ink-muted">Позиций получено</dt>
                <dd className="font-medium tabular-nums text-ink">{lineItemsFetched}</dd>
              </div>
              <div className="rounded-md bg-canvas px-3 py-2">
                <dt className="text-xs text-ink-muted">Строк записано</dt>
                <dd className="font-medium tabular-nums text-ink">{rowsWritten}</dd>
              </div>
            </dl>
          )}

          {status === 'completed' && (
            <div className="space-y-3">
              {rowsWritten === 0 && (
                <p className="text-sm text-[#9a6b00] bg-[#fff4d6] px-3 py-2 rounded-md">
                  За выбранный период заказы не найдены. Excel будет содержать только заголовки.
                </p>
              )}
              <button type="button" onClick={onDownload} className="btn-secondary">
                Скачать Excel
              </button>
            </div>
          )}

          {status === 'failed' && (
            <p className="text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md">
              {job?.error || 'Выгрузка завершилась с ошибкой'}
            </p>
          )}

          {jobError && (
            <p className="mt-3 text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md">
              {jobError.response?.data?.error || jobError.message || 'Не удалось получить статус выгрузки'}
            </p>
          )}

          {downloadError && (
            <p className="mt-3 text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md">
              {downloadError}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
