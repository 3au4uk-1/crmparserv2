export function errorHandler(err, req, res, next) {
  console.error(`[${new Date().toISOString()}] ${err.stack || err.message}`);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
}
