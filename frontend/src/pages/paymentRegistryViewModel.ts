import dayjs from 'dayjs';

export type MarkedFilter = 'all' | 'marked' | 'unmarked';

export type RegistryClientFilters = {
  paymentDateFrom: string | null;
  paymentDateTo: string | null;
  counterparty: string;
  description: string;
  category?: string;
  budgetItem?: string;
  amountFrom?: number;
  amountTo?: number;
  approval?: string;
  payment?: string;
  marked: MarkedFilter;
};

type BudgetItemRef = {
  category?: string | null;
};

export type RegistryRequestBase = {
  payment_date?: string | null;
  counterparty?: string | null;
  description?: string | null;
  note?: string | null;
  budget_item?: BudgetItemRef | null;
  budget_item_id?: string;
  amount: number;
  approval_status: string;
  payment_status: string;
  is_marked_for_deletion?: boolean;
  organization_id: string;
};

export type DateTabbedDay<T extends { payment_date?: string | null }> = {
  key: string;
  label: string;
  count: number;
  rows: T[];
};

export type DateTabbedMonth<T extends { payment_date?: string | null }> = {
  key: string;
  label: string;
  count: number;
  days: DateTabbedDay<T>[];
};

export function filterRegistryRequests<T extends RegistryRequestBase>(
  requests: T[],
  filters: RegistryClientFilters,
): T[] {
  return requests.filter((request) => {
    if (filters.paymentDateFrom && request.payment_date && request.payment_date < filters.paymentDateFrom) return false;
    if (filters.paymentDateTo && request.payment_date && request.payment_date > filters.paymentDateTo) return false;
    if (filters.counterparty && !request.counterparty?.toLowerCase().includes(filters.counterparty.toLowerCase())) return false;
    if (filters.description && !request.description?.toLowerCase().includes(filters.description.toLowerCase()) && !request.note?.toLowerCase().includes(filters.description.toLowerCase())) return false;
    if (filters.category && request.budget_item?.category !== filters.category) return false;
    if (filters.budgetItem && request.budget_item_id !== filters.budgetItem) return false;
    if (filters.amountFrom !== undefined && request.amount < filters.amountFrom) return false;
    if (filters.amountTo !== undefined && request.amount > filters.amountTo) return false;
    if (filters.approval && request.approval_status !== filters.approval) return false;
    if (filters.payment && request.payment_status !== filters.payment) return false;
    if (filters.marked === 'marked' && !request.is_marked_for_deletion) return false;
    if (filters.marked === 'unmarked' && request.is_marked_for_deletion) return false;
    return true;
  });
}

export function buildDateTabbedMonths<T extends { payment_date?: string | null }>(
  requests: T[],
): DateTabbedMonth<T>[] {
  const byMonth = new Map<string, { key: string; label: string; count: number; days: Map<string, DateTabbedDay<T>> }>();
  const sorted = [...requests].sort((a, b) => (a.payment_date ?? '').localeCompare(b.payment_date ?? ''));

  for (const request of sorted) {
    if (!request.payment_date) continue;
    const date = dayjs(request.payment_date);
    const monthKey = date.format('YYYY-MM');
    const dayKey = date.format('YYYY-MM-DD');
    const month = byMonth.get(monthKey) ?? {
      key: monthKey,
      label: new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(date.toDate()),
      count: 0,
      days: new Map<string, DateTabbedDay<T>>(),
    };
    const day = month.days.get(dayKey) ?? {
      key: dayKey,
      label: date.format('DD.MM.YYYY'),
      count: 0,
      rows: [],
    };

    month.count += 1;
    day.count += 1;
    day.rows.push(request);
    month.days.set(dayKey, day);
    byMonth.set(monthKey, month);
  }

  return [...byMonth.values()].map((month) => ({
    key: month.key,
    label: month.label,
    count: month.count,
    days: [...month.days.values()],
  }));
}

export function getDisplayedRequests<T extends { payment_date?: string | null }>(
  isDayTabbed: boolean,
  filteredRequests: T[],
  dateTabbedMonths: DateTabbedMonth<T>[],
  activeMonthKey?: string,
  activeDayKey?: string,
): T[] {
  if (!isDayTabbed) return filteredRequests;
  const month = dateTabbedMonths.find((item) => item.key === activeMonthKey);
  const day = month?.days.find((item) => item.key === activeDayKey);
  return day?.rows ?? [];
}

export function resolveActiveDateTabKeys<T extends { payment_date?: string | null }>(
  isDayTabbed: boolean,
  dateTabbedMonths: DateTabbedMonth<T>[],
  activeMonthKey?: string,
  activeDayKey?: string,
): { activeMonthKey?: string; activeDayKey?: string } {
  if (!isDayTabbed || !dateTabbedMonths.length) {
    return { activeMonthKey: undefined, activeDayKey: undefined };
  }

  const month = dateTabbedMonths.find((item) => item.key === activeMonthKey) ?? dateTabbedMonths[0];
  const day = month.days.find((item) => item.key === activeDayKey) ?? month.days[0];
  return {
    activeMonthKey: month.key,
    activeDayKey: day?.key,
  };
}

export function getPaymentTotalsByOrganization<T extends RegistryRequestBase>(
  dashboardDaySelected: boolean,
  displayedRequests: T[],
): Record<string, number> {
  if (!dashboardDaySelected) return {};
  const totals: Record<string, number> = {};
  for (const request of displayedRequests) {
    if (!request.organization_id) continue;
    if (request.is_marked_for_deletion) continue;
    const approvalStatus = String(request.approval_status ?? '');
    const paymentStatus = String(request.payment_status ?? '');
    if (approvalStatus === 'REJECTED' || approvalStatus === 'CANCELLED') continue;
    if (paymentStatus === 'CANCELLED') continue;
    totals[request.organization_id] = (totals[request.organization_id] ?? 0) + Number(request.amount ?? 0);
  }
  // Round each accumulated total to 2 decimals so float artifacts from summing
  // many amounts don't bleed into the liquidity (Профицит/Дефицит) comparison.
  for (const orgId of Object.keys(totals)) {
    totals[orgId] = Math.round(totals[orgId] * 100) / 100;
  }
  return totals;
}
