let syncContext = null;

export function beginTwentySyncContext(ctx) {
  syncContext = { ...ctx, startedAt: Date.now() };
}

export function endTwentySyncContext() {
  syncContext = null;
}

export function getTwentySyncContext() {
  return syncContext;
}

export function parseGqlOperation(query) {
  const match = String(query).match(/\b(query|mutation)\s+(\w+)/i);
  return match ? `${match[1]} ${match[2]}` : 'gql';
}

export function summarizeGqlVariables(variables) {
  if (!variables || typeof variables !== 'object') return {};

  const summary = {};
  if (variables.id) summary.id = variables.id;
  if (variables.oppId) summary.oppId = variables.oppId;
  if (variables.name) summary.name = String(variables.name).slice(0, 80);
  if (variables.lastName) summary.lastName = variables.lastName;
  if (variables.input && typeof variables.input === 'object') {
    const input = variables.input;
    summary.input = {
      name: input.name ? String(input.name).slice(0, 80) : undefined,
      amountMicros: input.amount?.amountMicros,
      companyId: input.companyId,
      pointOfContactId: input.pointOfContactId,
      opportunityId: input.opportunityId,
      warehouseItemId: input.warehouseItemId,
    };
    Object.keys(summary.input).forEach((k) => summary.input[k] === undefined && delete summary.input[k]);
  }
  return summary;
}

function formatMeta(meta) {
  if (!meta || Object.keys(meta).length === 0) return '';
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return '';
  }
}

export function logTwenty(level, message, meta = {}) {
  const ctx = syncContext
    ? { dealId: syncContext.dealId, twentyId: syncContext.twentyId, ...meta }
    : meta;
  const line = `[twenty-sync] ${new Date().toISOString()} ${message}${formatMeta(ctx)}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function logTwentyStep(step, meta = {}) {
  logTwenty('info', `step: ${step}`, meta);
}
