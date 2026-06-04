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
import { initScheduler } from './services/scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

app.use('/api/deals', dealsRouter);
app.use('/api/parsing', parsingRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/logs', logsRouter);

app.use(express.static(path.join(__dirname, '../public')));

app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use(errorHandler);

async function start() {
  initDb();
  migrate();
  initScheduler();
  app.listen(config.port, () => {
    console.log(`CRM Parser running on port ${config.port}`);
  });
}

start();

export default app;
