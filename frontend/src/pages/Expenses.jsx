import { useEffect, useState } from 'react';
import {
  useStartExpenseSync,
  useActiveExpenseJob,
  useExpenseJob,
  useUploadBeznal,
} from '../api';
import PageHeader from '../components/ui/PageHeader';

function isJobRunning(status) {
  return status === 'queued' || status === 'running';
}

export default function Expenses() {
  const [jobId, setJobId] = useState('');
  const [startError, setStartError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');

  const startSync = useStartExpenseSync();
  const uploadBeznal = useUploadBeznal();
  const { data: activeJob } = useActiveExpenseJob();
  const { data: job, error: jobError } = useExpenseJob(jobId, { enabled: !!jobId });

  useEffect(() => {
    if (!activeJob?.jobId || jobId) return;
    setJobId(activeJob.jobId);
  }, [activeJob, jobId]);

  const status = job?.status || activeJob?.status;
  const running = startSync.isPending || isJobRunning(status);
  const details = job?.progress || job || {};
  const dealsTargeted = details.deals_targeted ?? 0;
  const dealsUpdated = details.deals_updated ?? 0;
  const dealsWithExpenses = details.deals_with_expenses ?? 0;

  function onStartSync() {
    setStartError('');
    startSync.mutate(undefined, {
      onSuccess: (data) => {
        if (data?.jobId) setJobId(data.jobId);
      },
      onError: (err) => {
        if (err.response?.status === 409) {
          setStartError('Синхронизация расходов уже выполняется');
          return;
        }
        setStartError(err.response?.data?.error || err.message || 'Не удалось запустить синхронизацию');
      },
    });
  }

  function onUploadFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadError('');
    setUploadSuccess('');

    uploadBeznal.mutate(file, {
      onSuccess: () => {
        setUploadSuccess('Файл beznal успешно загружен');
        event.target.value = '';
      },
      onError: (err) => {
        setUploadError(err.response?.data?.error || err.message || 'Не удалось загрузить файл');
      },
    });
  }

  return (
    <div>
      <PageHeader title="Расходы" />

      <section className="surface p-5 md:p-6 mb-6" aria-labelledby="expense-sync-heading">
        <div className="mb-5">
          <h2 id="expense-sync-heading" className="text-base font-semibold text-ink">
            Синхронизация расходов
          </h2>
        </div>

        <button type="button" onClick={onStartSync} disabled={running} className="btn-primary">
          {running ? 'Синхронизация выполняется...' : 'Синхронизировать расходы в Twenty'}
        </button>

        {(jobId || activeJob?.jobId) && (
          <div className="mt-5 space-y-2 text-sm">
            <p className="text-ink-muted">
              ID задачи: <span className="tabular-nums">{jobId || activeJob?.jobId}</span>
            </p>
            <p className="text-ink">
              Статус: <span className="font-medium">{status || 'unknown'}</span>
            </p>
            <p className="text-ink">
              deals_targeted: <span className="font-medium tabular-nums">{dealsTargeted}</span>
            </p>
            <p className="text-ink">
              deals_updated: <span className="font-medium tabular-nums">{dealsUpdated}</span>
            </p>
            <p className="text-ink">
              deals_with_expenses:{' '}
              <span className="font-medium tabular-nums">{dealsWithExpenses}</span>
            </p>
            {job?.error && (
              <p className="text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md">
                error: {job.error}
              </p>
            )}
          </div>
        )}

        {startError && (
          <p className="mt-4 text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md">
            {startError}
          </p>
        )}
        {jobError && (
          <p className="mt-3 text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md">
            {jobError.response?.data?.error || jobError.message || 'Не удалось получить статус задачи'}
          </p>
        )}
      </section>

      <section className="surface p-5 md:p-6" aria-labelledby="beznal-upload-heading">
        <div className="mb-4">
          <h2 id="beznal-upload-heading" className="text-base font-semibold text-ink">
            Загрузка beznal xlsx
          </h2>
        </div>

        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={onUploadFile}
          className="input-field max-w-md file:mr-3 file:rounded-md file:border-0 file:bg-pastel-blue-bg file:px-3 file:py-1.5 file:text-sm file:text-pastel-blue-text"
        />

        {uploadSuccess && <p className="mt-3 text-sm text-pastel-green-text">{uploadSuccess}</p>}
        {uploadError && (
          <p className="mt-3 text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md">
            {uploadError}
          </p>
        )}
      </section>
    </div>
  );
}
