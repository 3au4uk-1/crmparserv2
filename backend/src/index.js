import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { errorHandler } from './middleware/error-handler.js';
import { initDb } from './db/connection.js';
import { migrate } from './db/migrate.js';
import dealsRouter from './routes/deals.js';
import parsingRouter from './routes/parsing.js';
import settingsRouter from './routes/settings.js';
import logsRouter from './routes/logs.js';
import blacklistRouter from './routes/blacklist.js';
import restorationRouter from './routes/restoration.js';
import neNasheBrandingRouter from './routes/ne-nashe-branding.js';
import neNasheDecorMkRouter from './routes/ne-nashe-decor-mk.js';
import podryadRouter from './routes/podryad.js';
import bannerRouter from './routes/banner.js';
import tipRulesRouter from './routes/tip-rules.js';
import exportRouter from './routes/export.js';
import exportTwentyRouter from './routes/export-twenty.js';
import expensesRouter from './routes/expenses.js';
import authRouter from './routes/auth.js';
import twentyRouter from './routes/twenty.js';
import telegramRouter from './routes/telegram.js';
import { appAuthMiddleware } from './middleware/app-auth.js';
import { initScheduler } from './services/scheduler.js';
import { initPrintSheetCron } from './services/print-sheet-cron.js';
import { initExpenseSyncCron } from './services/expense-sync-cron.js';
import { initTelegramPolling } from './telegram/polling.js';
import { initUserbotReconcile } from './telegram/userbot/reconcile.js';
import { initMentionForwarding } from './telegram/userbot/mention-forward.js';
import { recoverStaleParseRuns } from './services/parser.js';
import { recoverStaleRestoreMissingTwentyJobs } from './services/restore-missing-twenty-jobs.js';
import { runFreeEntryDuplicateRepairIfNeeded } from './services/free-entry-duplicate-repair.js';
import { runOpportunityAmountRecalcIfNeeded } from './services/opportunity-amount-recalc.js';
import { getDb } from './db/connection.js';
import { registerDefaultTelegramHooks } from './telegram/register-default-hooks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

if (config.twentyAppCorsOrigin) {
  app.use('/api/twenty', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', config.twentyAppCorsOrigin);
    res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
}

app.use('/api/twenty', twentyRouter);
app.use('/api/auth', authRouter);
app.use('/api', appAuthMiddleware);
app.use('/api/deals', dealsRouter);
app.use('/api/parsing', parsingRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/logs', logsRouter);
app.use('/api/blacklist', blacklistRouter);
app.use('/api/restoration', restorationRouter);
app.use('/api/ne-nashe-branding', neNasheBrandingRouter);
app.use('/api/ne-nashe-decor-mk', neNasheDecorMkRouter);
app.use('/api/podryad', podryadRouter);
app.use('/api/banner', bannerRouter);
app.use('/api/tip-rules', tipRulesRouter);
app.use('/api/export/twenty', exportTwentyRouter);
app.use('/api/export', exportRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/telegram', telegramRouter);

app.use(express.static(path.join(__dirname, '../public')));

app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use(errorHandler);

async function start() {
  initDb();
  migrate();
  registerDefaultTelegramHooks();
  recoverStaleParseRuns(getDb());
  recoverStaleRestoreMissingTwentyJobs(getDb());
  initScheduler();
  initPrintSheetCron();
  initExpenseSyncCron();
  initTelegramPolling();
  initUserbotReconcile();
  initMentionForwarding();
  app.listen(config.port, () => {
    console.log(`CRM Parser running on port ${config.port}`);
    setImmediate(async () => {
      try {
        await runFreeEntryDuplicateRepairIfNeeded();
      } catch (err) {
        console.error('[free-entry-repair] failed:', err.message);
      }
      try {
        await runOpportunityAmountRecalcIfNeeded();
      } catch (err) {
        console.error('[opportunity-amount-recalc] startup failed', err);
      }
    });
  });
}

start();

export default app;
