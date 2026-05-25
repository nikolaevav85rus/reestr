import { CATEGORY_CONFIG } from '../constants';

export type GroupingRequestBase = {
  id: string;
  organization_id: string;
  organization?: { name?: string | null } | null;
  direction?: { category?: { id?: string | null; name?: string | null } | null } | null;
  budget_item?: { category?: string | null } | null;
  amount: number;
  payment_date?: string | null;
};

export type GroupedRequestRow<T extends GroupingRequestBase> = T & {
  key: string;
  _type: 'request';
};

export type CategoryGroupRow<T extends GroupingRequestBase> = {
  key: string;
  _type: 'category';
  _catKey: string;
  amount: number;
  _count: number;
  children: Array<GroupedRequestRow<T>>;
};

export type DirectionCategoryGroupRow<T extends GroupingRequestBase> = {
  key: string;
  _type: 'dircat';
  _name: string;
  amount: number;
  _count: number;
  children: Array<CategoryGroupRow<T>>;
};

export type OrganizationGroupRow<T extends GroupingRequestBase> = {
  key: string;
  _type: 'org';
  _name: string;
  amount: number;
  _count: number;
  children: Array<DirectionCategoryGroupRow<T>>;
};

export type RegistryGroupRow<T extends GroupingRequestBase> =
  | OrganizationGroupRow<T>
  | DirectionCategoryGroupRow<T>
  | CategoryGroupRow<T>;

export type RegistryTableRow<T extends GroupingRequestBase> =
  | T
  | GroupedRequestRow<T>
  | RegistryGroupRow<T>;

type DirectionCategoryGroupBucket<T extends GroupingRequestBase> =
  Omit<DirectionCategoryGroupRow<T>, 'children'> & {
    _catMap: Map<string, CategoryGroupRow<T>>;
  };

type OrganizationGroupBucket<T extends GroupingRequestBase> =
  Omit<OrganizationGroupRow<T>, 'children'> & {
    _dcMap: Map<string, DirectionCategoryGroupBucket<T>>;
  };

export type PaymentRegistryGroupingOptions = {
  unknownOrganizationName?: string;
  noDirectionCategoryId?: string;
  unknownDirectionCategoryName?: string;
  defaultBudgetCategoryKey?: string;
};

const DEFAULT_OPTIONS: Required<PaymentRegistryGroupingOptions> = {
  unknownOrganizationName: '—',
  noDirectionCategoryId: '__none__',
  unknownDirectionCategoryName: 'Без категории ЦФО',
  defaultBudgetCategoryKey: 'OTHER',
};

export function buildPaymentRegistryGroupedRows<T extends GroupingRequestBase>(
  requests: T[],
  options?: PaymentRegistryGroupingOptions,
): Array<OrganizationGroupRow<T>> {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const byOrg = new Map<string, OrganizationGroupBucket<T>>();

  for (const request of requests) {
    const orgId = request.organization_id;
    const orgName = request.organization?.name ?? resolved.unknownOrganizationName;
    const dirCatId = request.direction?.category?.id ?? resolved.noDirectionCategoryId;
    const dirCatName = request.direction?.category?.name ?? resolved.unknownDirectionCategoryName;
    const ddsCatKey = request.budget_item?.category ?? resolved.defaultBudgetCategoryKey;

    if (!byOrg.has(orgId)) {
      byOrg.set(orgId, {
        key: `org-${orgId}`,
        _type: 'org',
        _name: orgName,
        amount: 0,
        _count: 0,
        _dcMap: new Map<string, DirectionCategoryGroupBucket<T>>(),
      });
    }

    const orgRow = byOrg.get(orgId);
    if (!orgRow) continue;
    orgRow.amount += request.amount;
    orgRow._count += 1;

    if (!orgRow._dcMap.has(dirCatId)) {
      orgRow._dcMap.set(dirCatId, {
        key: `org-${orgId}-dc-${dirCatId}`,
        _type: 'dircat',
        _name: dirCatName,
        amount: 0,
        _count: 0,
        _catMap: new Map<string, CategoryGroupRow<T>>(),
      });
    }

    const directionCategoryRow = orgRow._dcMap.get(dirCatId);
    if (!directionCategoryRow) continue;
    directionCategoryRow.amount += request.amount;
    directionCategoryRow._count += 1;

    if (!directionCategoryRow._catMap.has(ddsCatKey)) {
      directionCategoryRow._catMap.set(ddsCatKey, {
        key: `org-${orgId}-dc-${dirCatId}-cat-${ddsCatKey}`,
        _type: 'category',
        _catKey: ddsCatKey,
        amount: 0,
        _count: 0,
        children: [],
      });
    }

    const categoryRow = directionCategoryRow._catMap.get(ddsCatKey);
    if (!categoryRow) continue;
    categoryRow.amount += request.amount;
    categoryRow._count += 1;
    categoryRow.children.push({ ...request, key: request.id, _type: 'request' });
  }

  const categoryLabel = (categoryKey: string) => CATEGORY_CONFIG[categoryKey]?.label ?? categoryKey;

  return Array.from(byOrg.values())
    .sort((a, b) => a._name.localeCompare(b._name, 'ru'))
    .map((organization): OrganizationGroupRow<T> => ({
      key: organization.key,
      _type: organization._type,
      _name: organization._name,
      amount: organization.amount,
      _count: organization._count,
      children: Array.from(organization._dcMap.values())
        .sort((a, b) => a._name.localeCompare(b._name, 'ru'))
        .map((directionCategory): DirectionCategoryGroupRow<T> => ({
          key: directionCategory.key,
          _type: directionCategory._type,
          _name: directionCategory._name,
          amount: directionCategory.amount,
          _count: directionCategory._count,
          children: Array.from(directionCategory._catMap.values())
            .sort((a, b) => categoryLabel(a._catKey).localeCompare(categoryLabel(b._catKey), 'ru'))
            .map((category): CategoryGroupRow<T> => ({
              key: category.key,
              _type: category._type,
              _catKey: category._catKey,
              amount: category.amount,
              _count: category._count,
              children: [...category.children].sort(
                (a, b) => (a.payment_date ?? '').localeCompare(b.payment_date ?? ''),
              ),
            })),
        })),
    }));
}
