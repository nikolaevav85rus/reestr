import { describe, it, expect } from 'vitest';
import {
  filterRegistryRequests,
  buildDateTabbedMonths,
  getDisplayedRequests,
  resolveActiveDateTabKeys,
  getPaymentTotalsByOrganization,
  type RegistryRequestBase,
  type RegistryClientFilters,
} from './paymentRegistryViewModel';

const baseFilters: RegistryClientFilters = {
  paymentDateFrom: null,
  paymentDateTo: null,
  counterparty: '',
  description: '',
  marked: 'all',
};

const makeRequest = (overrides: Partial<RegistryRequestBase> = {}): RegistryRequestBase => ({
  amount: 0,
  approval_status: 'APPROVED',
  payment_status: 'UNPAID',
  organization_id: 'org-1',
  ...overrides,
});

describe('filterRegistryRequests', () => {
  const requests: RegistryRequestBase[] = [
    makeRequest({ counterparty: 'ООО Ромашка', description: 'Аренда', payment_date: '2026-06-01', amount: 100 }),
    makeRequest({ counterparty: 'ИП Иванов', note: 'срочный платёж', payment_date: '2026-06-15', amount: 500 }),
    makeRequest({ counterparty: 'ООО Лютик', payment_date: '2026-07-01', amount: 1000, is_marked_for_deletion: true }),
  ];

  it('returns everything when filters are empty (happy path)', () => {
    expect(filterRegistryRequests(requests, baseFilters)).toHaveLength(3);
  });

  it('filters by counterparty case-insensitively', () => {
    const result = filterRegistryRequests(requests, { ...baseFilters, counterparty: 'ромашка' });
    expect(result).toHaveLength(1);
    expect(result[0].counterparty).toBe('ООО Ромашка');
  });

  it('matches description against both description and note fields', () => {
    expect(filterRegistryRequests(requests, { ...baseFilters, description: 'аренда' })).toHaveLength(1);
    expect(filterRegistryRequests(requests, { ...baseFilters, description: 'срочный' })).toHaveLength(1);
  });

  it('filters by payment date range and amount range', () => {
    const byDate = filterRegistryRequests(requests, {
      ...baseFilters,
      paymentDateFrom: '2026-06-10',
      paymentDateTo: '2026-06-30',
    });
    expect(byDate.map((r) => r.payment_date)).toEqual(['2026-06-15']);

    const byAmount = filterRegistryRequests(requests, { ...baseFilters, amountFrom: 200, amountTo: 600 });
    expect(byAmount.map((r) => r.amount)).toEqual([500]);
  });

  it('filters by marked-for-deletion state (edge)', () => {
    expect(filterRegistryRequests(requests, { ...baseFilters, marked: 'marked' })).toHaveLength(1);
    expect(filterRegistryRequests(requests, { ...baseFilters, marked: 'unmarked' })).toHaveLength(2);
  });
});

describe('buildDateTabbedMonths', () => {
  it('buckets requests by month then day and counts them', () => {
    const requests = [
      makeRequest({ payment_date: '2026-06-15' }),
      makeRequest({ payment_date: '2026-06-15' }),
      makeRequest({ payment_date: '2026-06-20' }),
      makeRequest({ payment_date: '2026-07-01' }),
    ];

    const months = buildDateTabbedMonths(requests);

    expect(months.map((m) => m.key)).toEqual(['2026-06', '2026-07']);
    const june = months[0];
    expect(june.count).toBe(3);
    expect(june.days.map((d) => d.key)).toEqual(['2026-06-15', '2026-06-20']);
    expect(june.days[0].count).toBe(2);
    expect(june.days[0].label).toBe('15.06.2026');
  });

  it('skips requests without a payment_date (edge)', () => {
    const months = buildDateTabbedMonths([makeRequest({ payment_date: null }), makeRequest({})]);
    expect(months).toEqual([]);
  });
});

describe('getDisplayedRequests + resolveActiveDateTabKeys', () => {
  const requests = [
    makeRequest({ payment_date: '2026-06-15', amount: 1 }),
    makeRequest({ payment_date: '2026-06-20', amount: 2 }),
  ];
  const months = buildDateTabbedMonths(requests);

  it('returns the full filtered list when not day-tabbed', () => {
    expect(getDisplayedRequests(false, requests, months)).toHaveLength(2);
  });

  it('returns only the active day rows when day-tabbed', () => {
    const keys = resolveActiveDateTabKeys(true, months);
    expect(keys.activeMonthKey).toBe('2026-06');
    expect(keys.activeDayKey).toBe('2026-06-15');

    const rows = getDisplayedRequests(true, requests, months, keys.activeMonthKey, keys.activeDayKey);
    expect(rows.map((r) => r.amount)).toEqual([1]);
  });

  it('clears active keys when not day-tabbed or no months (edge)', () => {
    expect(resolveActiveDateTabKeys(false, months)).toEqual({ activeMonthKey: undefined, activeDayKey: undefined });
    expect(resolveActiveDateTabKeys(true, [])).toEqual({ activeMonthKey: undefined, activeDayKey: undefined });
  });
});

describe('getPaymentTotalsByOrganization', () => {
  it('returns empty object when no dashboard day is selected (edge)', () => {
    expect(getPaymentTotalsByOrganization(false, [makeRequest({ amount: 100 })])).toEqual({});
  });

  it('sums approved/non-cancelled amounts per organization', () => {
    const requests = [
      makeRequest({ organization_id: 'org-1', amount: 100 }),
      makeRequest({ organization_id: 'org-1', amount: 50 }),
      makeRequest({ organization_id: 'org-2', amount: 200 }),
    ];
    expect(getPaymentTotalsByOrganization(true, requests)).toEqual({ 'org-1': 150, 'org-2': 200 });
  });

  it('excludes rejected, cancelled and marked-for-deletion requests', () => {
    const requests = [
      makeRequest({ organization_id: 'org-1', amount: 100 }),
      makeRequest({ organization_id: 'org-1', amount: 999, approval_status: 'REJECTED' }),
      makeRequest({ organization_id: 'org-1', amount: 999, approval_status: 'CANCELLED' }),
      makeRequest({ organization_id: 'org-1', amount: 999, payment_status: 'CANCELLED' }),
      makeRequest({ organization_id: 'org-1', amount: 999, is_marked_for_deletion: true }),
    ];
    expect(getPaymentTotalsByOrganization(true, requests)).toEqual({ 'org-1': 100 });
  });

  it('rounds accumulated totals to 2 decimals to avoid float artifacts (edge)', () => {
    const requests = [
      makeRequest({ organization_id: 'org-1', amount: 0.1 }),
      makeRequest({ organization_id: 'org-1', amount: 0.2 }),
    ];
    expect(getPaymentTotalsByOrganization(true, requests)).toEqual({ 'org-1': 0.3 });
  });
});
