import { config } from '../config.js';
import { requireTwentyConfig } from './twenty-config.js';
import { createTwentyGqlClient } from './twenty-gql.js';
import { runPrintSheetCycle } from './print-sheet-cycle.js';

let cycleInFlight = null;
let cycleDirty = false;

export function __resetPrintSheetRunnerForTests() {
  cycleInFlight = null;
  cycleDirty = false;
}

export async function runPrintSheetRefresh() {
  if (
    !config.printSheetId ||
    !config.googleServiceAccountEmail ||
    !config.googleServiceAccountPrivateKey
  ) {
    return;
  }

  if (cycleInFlight) {
    cycleDirty = true;
    return cycleInFlight;
  }

  let gql;
  try {
    const twenty = requireTwentyConfig();
    gql = createTwentyGqlClient(twenty.apiUrl, twenty.apiToken);
  } catch {
    return;
  }

  cycleInFlight = (async () => {
    try {
      let lastResult;
      do {
        cycleDirty = false;
        lastResult = await runPrintSheetCycle(gql);
        console.log('[print-sheet] cycle done', lastResult);
      } while (cycleDirty);
      return lastResult;
    } finally {
      cycleInFlight = null;
    }
  })();

  return cycleInFlight;
}
