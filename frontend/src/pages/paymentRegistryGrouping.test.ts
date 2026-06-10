import { describe, it, expect } from 'vitest';
import {
  buildPaymentRegistryGroupedRows,
  type GroupingRequestBase,
} from './paymentRegistryGrouping';

const makeRequest = (overrides: Partial<GroupingRequestBase> & Pick<GroupingRequestBase, 'id' | 'organization_id' | 'amount'>): GroupingRequestBase => ({
  ...overrides,
});

describe('buildPaymentRegistryGroupedRows', () => {
  it('groups requests by organization -> direction category -> budget category', () => {
    const requests: GroupingRequestBase[] = [
      makeRequest({
        id: 'r1',
        organization_id: 'org-a',
        organization: { name: 'Альфа' },
        direction: { category: { id: 'dc1', name: 'Операционные' } },
        budget_item: { category: 'TAXES' },
        amount: 100,
        payment_date: '2026-06-01',
      }),
      makeRequest({
        id: 'r2',
        organization_id: 'org-a',
        organization: { name: 'Альфа' },
        direction: { category: { id: 'dc1', name: 'Операционные' } },
        budget_item: { category: 'TAXES' },
        amount: 50,
        payment_date: '2026-06-02',
      }),
    ];

    const rows = buildPaymentRegistryGroupedRows(requests);

    expect(rows).toHaveLength(1);
    const org = rows[0];
    expect(org._type).toBe('org');
    expect(org._name).toBe('Альфа');
    expect(org.amount).toBe(150);
    expect(org._count).toBe(2);

    expect(org.children).toHaveLength(1);
    const dc = org.children[0];
    expect(dc._type).toBe('dircat');
    expect(dc._name).toBe('Операционные');
    expect(dc.amount).toBe(150);

    expect(dc.children).toHaveLength(1);
    const cat = dc.children[0];
    expect(cat._type).toBe('category');
    expect(cat._catKey).toBe('TAXES');
    expect(cat.amount).toBe(150);
    expect(cat._count).toBe(2);

    // Leaf rows carry the request key and are sorted by payment_date asc.
    expect(cat.children.map((c) => c.id)).toEqual(['r1', 'r2']);
    expect(cat.children[0].key).toBe('r1');
    expect(cat.children[0]._type).toBe('request');
  });

  it('sorts organizations by name (ru locale) and keeps separate org buckets', () => {
    const requests: GroupingRequestBase[] = [
      makeRequest({ id: 'r1', organization_id: 'org-b', organization: { name: 'Бета' }, amount: 10 }),
      makeRequest({ id: 'r2', organization_id: 'org-a', organization: { name: 'Альфа' }, amount: 20 }),
    ];

    const rows = buildPaymentRegistryGroupedRows(requests);

    expect(rows.map((r) => r._name)).toEqual(['Альфа', 'Бета']);
    expect(rows.map((r) => r.key)).toEqual(['org-org-a', 'org-org-b']);
  });

  it('falls back to defaults for missing org name, direction category and budget category', () => {
    const requests: GroupingRequestBase[] = [
      makeRequest({ id: 'r1', organization_id: 'org-x', amount: 5 }),
    ];

    const rows = buildPaymentRegistryGroupedRows(requests);

    expect(rows[0]._name).toBe('—');
    const dc = rows[0].children[0];
    expect(dc._name).toBe('Без категории ЦФО');
    expect(dc.key).toBe('org-org-x-dc-__none__');
    expect(dc.children[0]._catKey).toBe('OTHER');
  });

  it('honors custom grouping option labels (edge: overrides)', () => {
    const requests: GroupingRequestBase[] = [
      makeRequest({ id: 'r1', organization_id: 'org-x', amount: 5 }),
    ];

    const rows = buildPaymentRegistryGroupedRows(requests, {
      unknownOrganizationName: 'НЕТ ОРГ',
      unknownDirectionCategoryName: 'НЕТ ЦФО',
      defaultBudgetCategoryKey: 'SALARY',
    });

    expect(rows[0]._name).toBe('НЕТ ОРГ');
    expect(rows[0].children[0]._name).toBe('НЕТ ЦФО');
    expect(rows[0].children[0].children[0]._catKey).toBe('SALARY');
  });

  it('returns an empty array for no requests (edge)', () => {
    expect(buildPaymentRegistryGroupedRows([])).toEqual([]);
  });
});
