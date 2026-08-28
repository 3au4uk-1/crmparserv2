import { gql } from '../twenty-gql.js';
import { requireTwentyConfig } from '../twenty-config.js';
import { formatCrmDateTime, toInputDate } from '../../utils/crm-dates.js';
import {
  createTask as createTaskDefault,
  createTaskTarget as createTaskTargetDefault,
  findOpenTasksByKindAndLineItem as findOpenDefault,
} from '../twenty-tasks.js';
import { needsOfficePhotoTask, shouldSkipCancelled } from './select.js';
import { calendarYmd, shiftYmd } from './window.js';

const PAGE_SIZE = 200;

const OFFICE_PHOTO_LINE_ITEMS = `
  query OfficePhotoLineItems($filter: DealLineItemFilterInput, $first: Int!, $after: String) {
    dealLineItems(filter: $filter, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id name tip stage
          opportunity { id name stage loadDate }
        }
      }
    }
  }
`;

export function officePhotoTitle(tip, name) {
  const kind = tip === 'PODRYAD' ? 'подряд' : 'баннер';
  return `Сфотографировать ${kind}: ${name}`;
}

export function officePhotoBody({ opportunityName, loadDateYmd, tip }) {
  const kind = tip === 'PODRYAD' ? 'подряда' : 'баннера';
  return `${opportunityName}\n${loadDateYmd}\nПриложите фото ${kind}`;
}

function dayStartIso(ymd) {
  const [year, month, day] = ymd.split('-').map(Number);
  return formatCrmDateTime(new Date(year, month - 1, day, 0, 0, 0));
}

function officePhotoFilter(now) {
  const todayYmd = calendarYmd(now);
  return {
    and: [
      {
        or: [{ tip: { eq: 'BANNERA' } }, { tip: { eq: 'PODRYAD' } }],
      },
      {
        opportunity: {
          and: [
            { loadDate: { gte: dayStartIso(todayYmd) } },
            { loadDate: { lt: dayStartIso(shiftYmd(todayYmd, 2)) } },
          ],
        },
      },
    ],
  };
}

function defaultGqlImpl(query, variables) {
  const { apiUrl, apiToken } = requireTwentyConfig();
  return gql(apiUrl, apiToken, query, variables);
}

async function fetchLineItems(gqlImpl, filter) {
  const items = [];
  let after = null;

  for (;;) {
    const resp = await gqlImpl(OFFICE_PHOTO_LINE_ITEMS, { filter, first: PAGE_SIZE, after });
    const connection = resp.data?.data?.dealLineItems;
    if (!connection) {
      throw new Error('Twenty GraphQL response is missing dealLineItems');
    }

    const edges = connection.edges ?? [];
    for (const edge of edges) {
      if (edge?.node) items.push(edge.node);
    }

    const pageInfo = connection.pageInfo;
    if (pageInfo?.hasNextPage) {
      if (!pageInfo.endCursor) {
        throw new Error('Twenty GraphQL response has hasNextPage but is missing endCursor for dealLineItems');
      }
      after = pageInfo.endCursor;
      continue;
    }
    break;
  }

  return items;
}

export async function runOfficePhotoTasks({
  now = new Date(),
  gqlImpl = defaultGqlImpl,
  findOpenTasksByKindAndLineItem = findOpenDefault,
  createTask = createTaskDefault,
  createTaskTarget = createTaskTargetDefault,
} = {}) {
  const todayYmd = calendarYmd(now);
  const tomorrowYmd = shiftYmd(todayYmd, 1);
  const items = await fetchLineItems(gqlImpl, officePhotoFilter(now));
  const result = { created: 0, skipped: 0, errors: [] };

  for (const item of items) {
    try {
      const opportunity = item.opportunity ?? {};
      if (
        shouldSkipCancelled({
          opportunityStage: opportunity.stage,
          lineItemStage: item.stage,
        })
      ) {
        result.skipped += 1;
        continue;
      }

      const loadDateYmd = toInputDate(opportunity.loadDate);
      const openTasks = await findOpenTasksByKindAndLineItem({
        taskKind: 'OFFICE_PHOTO',
        lineItemId: item.id,
      });
      if (
        !needsOfficePhotoTask({
          tip: item.tip,
          loadDateYmd,
          tomorrowYmd,
          todayYmd,
          hasOpenTask: openTasks.length > 0,
        })
      ) {
        result.skipped += 1;
        continue;
      }

      const task = await createTask({
        title: officePhotoTitle(item.tip, item.name),
        taskKind: 'OFFICE_PHOTO',
        dueAt: dayStartIso(loadDateYmd),
        body: officePhotoBody({
          opportunityName: opportunity.name,
          loadDateYmd,
          tip: item.tip,
        }),
      });
      await createTaskTarget({ taskId: task.id, dealLineItemId: item.id });
      result.created += 1;
    } catch (err) {
      console.error(`[office-photo] item ${item?.id} failed:`, err.message);
      result.errors.push({ id: item?.id, error: err.message });
    }
  }

  return result;
}
