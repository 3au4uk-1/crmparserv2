import { useEffect, useState } from 'react';
import {
  useCompanies,
  useStartExport,
  useActiveExportJob,
  useExportJob,
  downloadExportFile,
} from '../api';
import PageHeader from '../components/ui/PageHeader';

function isJobRunning(status) {
  return status === 'queued' || status === 'running';
}

export default function Export() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [company, setCompany] = useState('');
  const [jobId, setJobId] = useState('');
  const [startError, setStartError] = useState('');
  const [downloadError, setDownloadError] = useState('');

  const { data: companies } = useCompanies();
  const startExport = useStartExport();
  const { data: activeJob } = useActiveExportJob();
  const { data: job, error: jobError } = useExportJob(jobId, { enabled: !!jobId });

  useEffect(() => {
    if (!activeJob?.jobId || jobId) return;
    setJobId(activeJob.jobId);
    setFrom(activeJob.from || '');
    setTo(activeJob.to || '');
    setCompany(activeJob.company || '');
  }, [activeJob, jobId]);

  const status = job?.status;
  const running = startExport.isPending || isJobRunning(status);
  const eventsTotal = job?.progress?.eventsTotal ?? 0;
  const eventsDone = job?.progress?.eventsDone ?? 0;
  const dealsMatched = job?.progress?.dealsMatched ?? 0;
  const progressPercent =
    eventsTotal > 0 ? Math.min(100, Math.round((eventsDone / eventsTotal) * 100)) : 0;

  function onSubmit(e) {
    e.preventDefault();
    setStartError('');
    setDownloadError('');

    if (!from || !to) {
      setStartError('Укажите диапазон дат');
      return;
    }

    startExport.mutate(
      {
        from,
        to,
        company: company || undefined,
      },
      {
        onSuccess: (data) => setJobId(data.jobId),
        onError: (err) => {
          if (err.response?.status === 409) {
            setStartError('Парсинг или выгрузка уже выполняется');
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
      await downloadExportFile(jobId, job?.from || from, job?.to || to);
    } catch (err) {
      setDownloadError(err.response?.data?.error || err.message || 'Не удалось скачать файл');
    }
  }

  return (
    <div>
      <PageHeader
        title="Выгрузка"
        description="Историческая выгрузка сделок в Excel из календаря CRM за выбранный период"
      />

      <section className="surface p-5 md:p-6 mb-6" aria-labelledby="export-form-heading">
        <div className="mb-5">
          <h2 id="export-form-heading" className="text-base font-semibold text-ink">
            Параметры выгрузки
          </h2>
          <p className="text-sm text-ink-muted mt-1 max-w-2xl">
            Выберите диапазон дат и, при необходимости, ограничьте результат по компании.
          </p>
        </div>

        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-4">
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

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-ink-muted font-medium">Компания</span>
            <select
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className="select-field min-w-[10rem]"
            >
              <option value="">Все</option>
              {(companies || []).map((c) => (
                <option key={c.id} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>
          </label>

          <button type="submit" disabled={running} className="btn-primary shrink-0">
            {running ? 'Выгрузка выполняется...' : 'Запустить выгрузку'}
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
          <p className="text-sm text-ink-muted mb-4">ID задачи: <span className="tabular-nums">{jobId}</span></p>

          {(running || status === 'completed') && (
            <p className="text-sm text-ink mb-3">
              Обработано <span className="font-medium tabular-nums">{eventsDone}</span> из{' '}
              <span className="font-medium tabular-nums">{eventsTotal}</span> событий, найдено{' '}
              <span className="font-medium tabular-nums">{dealsMatched}</span> сделок
            </p>
          )}

          {running && (
            <div className="w-full h-2 rounded-full bg-border/60 overflow-hidden mb-4">
              <div
                className="h-full bg-accent transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}

          {status === 'completed' && (
            <div className="space-y-3">
              {dealsMatched === 0 && (
                <p className="text-sm text-[#9a6b00] bg-[#fff4d6] px-3 py-2 rounded-md">
                  За выбранный период подходящие сделки не найдены. Excel будет содержать только заголовки.
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
