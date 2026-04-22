import { type APIRequestContext } from '@playwright/test';
import { getJson, type AuthSession } from './api';

type Organization = {
  id: string;
  name: string;
  payment_group_id: string;
};

type Direction = {
  id: string;
  name: string;
};

type BudgetItem = {
  id: string;
  name: string;
  category: string;
  is_active?: boolean;
};

type CalendarDay = {
  date: string;
  payment_group_id: string;
  day_type: string;
};

type DayTypeRule = {
  day_type: string;
  allowed_category: string;
};

export type Scenario = {
  name: string;
  expectedAllowed: boolean;
  dayType: string;
  date: string;
  organization: Organization;
  direction: Direction;
  budgetItem: BudgetItem;
};

export type ReferenceData = {
  organizations: Organization[];
  directions: Direction[];
  budgetItems: BudgetItem[];
  rules: DayTypeRule[];
  scenarios: Scenario[];
};

function monthWindow() {
  const result: Array<{ year: number; month: number }> = [];
  const cursor = new Date();

  for (let i = 0; i < 4; i += 1) {
    result.push({ year: cursor.getFullYear(), month: cursor.getMonth() + 1 });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return result;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export async function loadReferenceData(
  api: APIRequestContext,
  session: AuthSession,
): Promise<ReferenceData> {
  const organizations = await getJson<Organization[]>(api, session, '/dict/organizations');
  const directions = await getJson<Direction[]>(api, session, '/dict/directions');
  const budgetItems = await getJson<BudgetItem[]>(api, session, '/dict/budget_items?active_only=true');
  const rules = await getJson<DayTypeRule[]>(api, session, '/calendar/rules');

  if (organizations.length === 0) throw new Error('No organizations in dictionaries.');
  if (directions.length === 0) throw new Error('No CFO/directions in dictionaries.');
  if (budgetItems.length === 0) throw new Error('No active budget items in dictionaries.');

  const direction = directions[0];
  const byRule = new Map<string, Set<string>>();
  for (const rule of rules) {
    if (!byRule.has(rule.day_type)) byRule.set(rule.day_type, new Set());
    byRule.get(rule.day_type)!.add(rule.allowed_category);
  }

  const scenarios: Scenario[] = [];
  const seenNames = new Set<string>();
  const currentDate = todayIso();

  for (const organization of organizations.filter((o) => o.payment_group_id)) {
    const calendarDays: CalendarDay[] = [];
    for (const { year, month } of monthWindow()) {
      const days = await getJson<CalendarDay[]>(
        api,
        session,
        `/calendar/calendar?group_id=${organization.payment_group_id}&year=${year}&month=${month}`,
      );
      calendarDays.push(...days.filter((d) => d.date !== currentDate));
    }

    for (const day of calendarDays) {
      if (day.day_type === 'PAYMENT' && !seenNames.has('PAYMENT allowed')) {
        scenarios.push({
          name: 'PAYMENT allowed',
          expectedAllowed: true,
          dayType: day.day_type,
          date: day.date,
          organization,
          direction,
          budgetItem: budgetItems[0],
        });
        seenNames.add('PAYMENT allowed');
      }

      if (day.day_type !== 'PAYMENT') {
        const allowedCategories = byRule.get(day.day_type) ?? new Set<string>();
        const allowedBudgetItem = budgetItems.find((item) => allowedCategories.has(item.category));
        const blockedBudgetItem = budgetItems.find((item) => !allowedCategories.has(item.category));

        if (allowedBudgetItem && !seenNames.has(`${day.day_type} allowed by matrix`)) {
          scenarios.push({
            name: `${day.day_type} allowed by matrix`,
            expectedAllowed: true,
            dayType: day.day_type,
            date: day.date,
            organization,
            direction,
            budgetItem: allowedBudgetItem,
          });
          seenNames.add(`${day.day_type} allowed by matrix`);
        }

        if (blockedBudgetItem && !seenNames.has(`${day.day_type} blocked by matrix`)) {
          scenarios.push({
            name: `${day.day_type} blocked by matrix`,
            expectedAllowed: false,
            dayType: day.day_type,
            date: day.date,
            organization,
            direction,
            budgetItem: blockedBudgetItem,
          });
          seenNames.add(`${day.day_type} blocked by matrix`);
        }
      }
    }

    if (
      seenNames.has('PAYMENT allowed') &&
      ['NON_PAYMENT', 'HOLIDAY', 'SALARY_DAY'].some((type) => seenNames.has(`${type} blocked by matrix`))
    ) {
      break;
    }
  }

  return {
    organizations,
    directions,
    budgetItems,
    rules,
    scenarios,
  };
}

export function makeRequestPayload(scenario: Scenario, testMarker: string, amount = 1234.56) {
  return {
    amount,
    description: `${testMarker} payment purpose`,
    note: `${testMarker} regression note`,
    payment_date: scenario.date,
    organization_id: scenario.organization.id,
    direction_id: scenario.direction.id,
    budget_item_id: scenario.budgetItem.id,
    counterparty: `${testMarker} counterparty`,
  };
}

export function findScenario(referenceData: ReferenceData, predicate: (scenario: Scenario) => boolean) {
  return referenceData.scenarios.find(predicate);
}

export function requireScenario(referenceData: ReferenceData, predicate: (scenario: Scenario) => boolean, name: string) {
  const scenario = referenceData.scenarios.find(predicate);
  if (!scenario) throw new Error(`No calendar/dictionary data found for scenario: ${name}`);
  return scenario!;
}
