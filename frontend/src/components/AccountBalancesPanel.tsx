import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import {
  App as AntdApp,
  Button,
  Card,
  DatePicker,
  Empty,
  Form,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  ReloadOutlined,
  UpOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import apiClient from '../api/apiClient';
import { getErrorMessage } from '../utils/errorMessage';

const { Text } = Typography;

type OrganizationOption = {
  id: string;
  name: string;
};

type BankAccount = {
  id: string;
  organization_id: string;
  bank_name: string;
  account_number: string;
  is_active: boolean;
  organization?: OrganizationOption;
};

type DailyBalance = {
  id: string;
  balance_date: string;
  amount: number;
  opening_balance?: number | null;
  organization_id?: string;
  bank_account_id?: string;
  organization?: OrganizationOption;
  bank_account?: {
    id: string;
    bank_name: string;
    account_number: string;
    is_active: boolean;
    organization_id?: string;
  };
};

type BalanceRow = {
  key: string;
  organizationId: string;
  organizationName: string;
  isGroup?: boolean;
  groupTotal?: number;
  bankName?: string;
  accountNumber?: string;
  isAccountActive?: boolean;
  balanceDate?: string;
  openingBalance?: number;
  balanceId?: string;
  raw?: DailyBalance;
  children?: BalanceRow[];
};

type Props = {
  contextKey: 'dashboard' | 'cashier';
  userId?: string;
  canView: boolean;
  canManage: boolean;
  organizations: OrganizationOption[];
  dateFrom?: string | null;
  dateTo?: string | null;
  organizationId?: string;
  defaultExpanded: boolean;
  compact?: boolean;
  daySelected?: boolean;
  paymentTotalsByOrganization?: Record<string, number>;
};

const formatAmount = (value: number | null | undefined): string => (
  `${(value ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`
);

const AccountBalancesPanel: React.FC<Props> = ({
  contextKey,
  userId,
  canView,
  canManage,
  organizations,
  dateFrom,
  dateTo,
  organizationId,
  defaultExpanded,
  compact = false,
  daySelected = false,
  paymentTotalsByOrganization = {},
}) => {
  const { message: messageApi } = AntdApp.useApp();
  const storageKey = `ui_balances_panel_${contextKey}_${userId ?? 'default'}`;
  const [expanded, setExpanded] = useState<boolean>(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved === null) return defaultExpanded;
    return saved === 'true';
  });

  const [expandedOrgKeys, setExpandedOrgKeys] = useState<React.Key[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [balances, setBalances] = useState<DailyBalance[]>([]);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [balanceModalOpen, setBalanceModalOpen] = useState(false);
  const [editingBalance, setEditingBalance] = useState<DailyBalance | null>(null);
  const [balanceSaving, setBalanceSaving] = useState(false);
  const [deletingBalanceId, setDeletingBalanceId] = useState<string | null>(null);
  const [balanceForm] = Form.useForm();

  useEffect(() => {
    localStorage.setItem(storageKey, String(expanded));
  }, [expanded, storageKey]);

  const hasExplicitDateFilter = !!dateFrom || !!dateTo;
  const effectiveDateFrom = hasExplicitDateFilter
    ? (dateFrom ?? dateTo ?? null)
    : dayjs().subtract(6, 'day').format('YYYY-MM-DD');
  const effectiveDateTo = hasExplicitDateFilter
    ? (dateTo ?? dateFrom ?? null)
    : dayjs().format('YYYY-MM-DD');

  const effectiveDateLabel = useMemo(() => {
    if (effectiveDateFrom && effectiveDateTo && effectiveDateFrom === effectiveDateTo) {
      return `на ${dayjs(effectiveDateFrom).format('DD.MM.YYYY')}`;
    }
    if (effectiveDateFrom && effectiveDateTo) {
      return `${dayjs(effectiveDateFrom).format('DD.MM.YYYY')} — ${dayjs(effectiveDateTo).format('DD.MM.YYYY')}`;
    }
    if (effectiveDateFrom) return `с ${dayjs(effectiveDateFrom).format('DD.MM.YYYY')}`;
    if (effectiveDateTo) return `по ${dayjs(effectiveDateTo).format('DD.MM.YYYY')}`;
    return 'за все даты';
  }, [effectiveDateFrom, effectiveDateTo]);

  const accountMap = useMemo(() => {
    const map = new Map<string, BankAccount>();
    for (const account of accounts) map.set(account.id, account);
    return map;
  }, [accounts]);

  const organizationMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const org of organizations) map.set(org.id, org.name);
    return map;
  }, [organizations]);

  const closeBalanceModal = () => {
    setBalanceModalOpen(false);
    setEditingBalance(null);
    balanceForm.resetFields();
  };

  const loadAccounts = useCallback(async () => {
    if (!canView) return;
    setLoadingAccounts(true);
    try {
      const response = await apiClient.get('/balances/accounts');
      setAccounts(response.data ?? []);
    } catch (error: unknown) {
      messageApi.error(getErrorMessage(error, 'Не удалось загрузить расчетные счета'));
    } finally {
      setLoadingAccounts(false);
    }
  }, [canView, messageApi]);

  const loadBalances = useCallback(async () => {
    if (!canView) return;
    setLoadingBalances(true);
    try {
      const params = new URLSearchParams();
      if (effectiveDateFrom) params.set('date_from', effectiveDateFrom);
      if (effectiveDateTo) params.set('date_to', effectiveDateTo);
      if (organizationId) params.set('organization_id', organizationId);
      const query = params.toString();
      const response = await apiClient.get(`/balances/daily${query ? `?${query}` : ''}`);
      setBalances(response.data ?? []);
    } catch (error: unknown) {
      messageApi.error(getErrorMessage(error, 'Не удалось загрузить остатки на утро'));
    } finally {
      setLoadingBalances(false);
    }
  }, [canView, effectiveDateFrom, effectiveDateTo, messageApi, organizationId]);

  useEffect(() => {
    if (!canView || !expanded) return;
    void loadBalances();
  }, [canView, expanded, loadBalances]);

  useEffect(() => {
    if (!canView || (!expanded && !canManage)) return;
    void loadAccounts();
  }, [canManage, canView, expanded, loadAccounts]);

  const openCreateBalanceModal = () => {
    const defaultOrganizationId = organizationId ?? organizations[0]?.id;
    const defaultDate = effectiveDateTo ?? effectiveDateFrom ?? dayjs().format('YYYY-MM-DD');
    setEditingBalance(null);
    balanceForm.setFieldsValue({
      balance_date: dayjs(defaultDate),
      organization_id: defaultOrganizationId,
      amount: undefined,
      bank_account_id: undefined,
    });
    setBalanceModalOpen(true);
  };

  const openEditBalanceModal = (row: BalanceRow) => {
    if (!row.raw) return;
    const current = row.raw;
    const selectedAccountId = current.bank_account?.id ?? current.bank_account_id;
    const fallbackAccount = selectedAccountId ? accountMap.get(selectedAccountId) : undefined;
    const selectedOrganizationId = current.organization?.id
      ?? current.organization_id
      ?? current.bank_account?.organization_id
      ?? fallbackAccount?.organization_id
      ?? organizationId
      ?? organizations[0]?.id;

    setEditingBalance(current);
    balanceForm.setFieldsValue({
      balance_date: dayjs(current.balance_date),
      organization_id: selectedOrganizationId,
      bank_account_id: selectedAccountId,
      amount: Number(current.amount ?? current.opening_balance ?? 0),
    });
    setBalanceModalOpen(true);
  };

  const submitBalance = async (values: any) => {
    setBalanceSaving(true);
    const payload = {
      balance_date: values.balance_date.format('YYYY-MM-DD'),
      bank_account_id: values.bank_account_id,
      amount: Number(values.amount),
    };

    try {
      if (editingBalance) {
        await apiClient.put(`/balances/daily/${editingBalance.id}`, payload);
        messageApi.success('Остаток обновлен');
      } else {
        await apiClient.post('/balances/daily', {
          ...payload,
          organization_id: values.organization_id,
        });
        messageApi.success('Остаток сохранен');
      }
      closeBalanceModal();
      await loadBalances();
    } catch (error: unknown) {
      const status = (error as { response?: { status?: number } } | null | undefined)?.response?.status;
      const detail = getErrorMessage(error, 'Не удалось сохранить остаток');
      messageApi.error(detail);
      if (status === 404) {
        messageApi.warning('Запись уже удалена или недоступна. Список обновлен.');
        closeBalanceModal();
        await loadBalances();
      }
    } finally {
      setBalanceSaving(false);
    }
  };

  const deleteBalance = async (row: BalanceRow) => {
    if (!row.raw) return;
    setDeletingBalanceId(row.raw.id);
    try {
      await apiClient.delete(`/balances/daily/${row.raw.id}`);
      messageApi.success('Остаток удален');
      await loadBalances();
    } catch (error: unknown) {
      const status = (error as { response?: { status?: number } } | null | undefined)?.response?.status;
      const detail = getErrorMessage(error, 'Не удалось удалить остаток');
      if (status === 404) {
        messageApi.warning('Запись уже удалена или недоступна. Список обновлен.');
        await loadBalances();
      } else {
        messageApi.error(detail);
      }
    } finally {
      setDeletingBalanceId(null);
    }
  };

  const selectedBalanceOrganizationId = Form.useWatch('organization_id', balanceForm);
  const selectedBalanceAccountId = Form.useWatch('bank_account_id', balanceForm);
  const accountOptionsForBalance = useMemo(() => (
    accounts
      .filter(account => account.organization_id === selectedBalanceOrganizationId)
      .map(account => ({
        value: account.id,
        label: `${account.bank_name} · ${account.account_number}`,
      }))
  ), [accounts, selectedBalanceOrganizationId]);

  useEffect(() => {
    if (!selectedBalanceAccountId) return;
    if (!accountOptionsForBalance.some(option => option.value === selectedBalanceAccountId)) {
      balanceForm.setFieldValue('bank_account_id', undefined);
    }
  }, [accountOptionsForBalance, balanceForm, selectedBalanceAccountId]);

  const flatRows = useMemo<BalanceRow[]>(() => balances.map((item) => {
    const accountId = item.bank_account?.id ?? item.bank_account_id;
    const account = item.bank_account ?? (accountId ? accountMap.get(accountId) : undefined);
    const organizationIdValue = item.organization?.id
      ?? item.organization_id
      ?? account?.organization_id
      ?? `org:${item.id}`;
    const organizationName = item.organization?.name
      ?? organizationMap.get(organizationIdValue)
      ?? '—';

    return {
      key: item.id,
      organizationId: organizationIdValue,
      organizationName,
      bankName: account?.bank_name ?? '—',
      accountNumber: account?.account_number ?? '—',
      isAccountActive: account?.is_active ?? true,
      balanceDate: item.balance_date,
      openingBalance: Number(item.amount ?? item.opening_balance ?? 0),
      balanceId: item.id,
      raw: item,
    };
  }), [accountMap, balances, organizationMap]);

  const groupedRows = useMemo<BalanceRow[]>(() => {
    const grouped = new Map<string, { name: string; rows: BalanceRow[] }>();
    for (const row of flatRows) {
      const current = grouped.get(row.organizationId) ?? { name: row.organizationName, rows: [] };
      current.rows.push(row);
      grouped.set(row.organizationId, current);
    }

    return [...grouped.entries()]
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([orgId, value]) => ({
        key: `group:${orgId}`,
        organizationId: orgId,
        organizationName: value.name,
        isGroup: true,
        groupTotal: Math.round(value.rows.reduce((sum, row) => sum + (row.openingBalance ?? 0), 0) * 100) / 100,
        children: [...value.rows].sort((a, b) => (b.balanceDate ?? '').localeCompare(a.balanceDate ?? '')),
      }));
  }, [flatRows]);

  useEffect(() => {
    setExpandedOrgKeys((prev) => {
      const validKeys = new Set(groupedRows.map((row) => row.key));
      return prev.filter((key) => validKeys.has(String(key)));
    });
  }, [groupedRows]);

  const totalsByOrganization = useMemo(() => (
    groupedRows.map((group) => ({
      organizationId: group.organizationId,
      organizationName: group.organizationName,
      total: group.groupTotal ?? 0,
    }))
  ), [groupedRows]);

  const mergedColumnsCount = canManage ? 6 : 5;
  const columnWidths = canManage
    ? {
        organization: '18%',
        bank: '22%',
        account: '22%',
        date: '10%',
        amount: '12%',
        actions: '16%',
      }
    : {
        organization: '20%',
        bank: '26%',
        account: '26%',
        date: '12%',
        amount: '16%',
      };

  const getGroupTitleCellProps = (row: BalanceRow) => (row.isGroup ? { colSpan: mergedColumnsCount } : {});
  const getGroupHiddenCellProps = (row: BalanceRow) => (row.isGroup ? { colSpan: 0 } : {});

  const renderGroupTitle = (row: BalanceRow) => {
    const total = row.groupTotal ?? 0;
    const paymentTotal = paymentTotalsByOrganization[row.organizationId] ?? 0;
    // Round before the >= 0 comparison so a sub-kopeck float artifact can't
    // flip the Профицит/Дефицит tag.
    const liquidity = Math.round((total - paymentTotal) * 100) / 100;

    return (
      <Space size={10} wrap style={{ width: '100%', justifyContent: 'space-between' }}>
        <Space size={10} wrap>
          <Text strong>{row.organizationName}</Text>
          <Text type="secondary">остаток {formatAmount(total)}</Text>
        </Space>
        {daySelected ? (
          liquidity >= 0 ? (
            <Tag color="success">Профицит {formatAmount(liquidity)}</Tag>
          ) : (
            <Tag color="error">Дефицит {formatAmount(Math.abs(liquidity))}</Tag>
          )
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>Выберите день</Text>
        )}
      </Space>
    );
  };

  if (!canView) return null;

  return (
    <div style={{ width: '100%' }}>
      <Card
        size="small"
        style={{ marginBottom: 12, width: '100%' }}
        styles={expanded ? undefined : { body: { display: 'none' } }}
        title={(
          <Space size={8}>
            <Text strong>Остатки по счетам</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>{effectiveDateLabel}</Text>
          </Space>
        )}
        extra={(
          <Space size={4}>
            {canManage && (
              <Button size="small" icon={<WalletOutlined />} onClick={openCreateBalanceModal}>
                Внести остатки
              </Button>
            )}
            <Button
              size="small"
              type="text"
              icon={<ReloadOutlined />}
              onClick={() => { void Promise.all([loadAccounts(), loadBalances()]); }}
              aria-label="Обновить остатки"
            />
            <Button
              size="small"
              type="default"
              icon={expanded ? <UpOutlined /> : <DownOutlined />}
              onClick={() => setExpanded(v => !v)}
            >
              {expanded ? 'Свернуть' : 'Развернуть'}
            </Button>
          </Space>
        )}
      >
        {expanded && (
          <Space orientation="vertical" size={10} style={{ width: '100%' }}>
            {!hasExplicitDateFilter && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                Фильтр даты не задан, показаны последние 7 дней.
              </Text>
            )}
            {compact && totalsByOrganization.length > 0 && (
              <Space wrap size={[8, 8]}>
                {totalsByOrganization.map((item) => (
                  <Tag key={item.organizationId} color="blue">
                    {item.organizationName}: {formatAmount(item.total)}
                  </Tag>
                ))}
              </Space>
            )}
            <div style={{ width: '100%' }}>
              <Table
                rowKey="key"
                style={{ width: '100%' }}
                tableLayout="fixed"
                dataSource={groupedRows}
                loading={loadingBalances}
                size="small"
                pagination={false}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет остатков за выбранный период" /> }}
                expandable={{
                  expandedRowKeys: expandedOrgKeys,
                  onExpand: (isExpanded, record) => {
                    if (!record.isGroup) return;
                    setExpandedOrgKeys((prev) => {
                      if (isExpanded) return [...prev, record.key];
                      return prev.filter((key) => key !== record.key);
                    });
                  },
                  showExpandColumn: true,
                  columnWidth: 36,
                  expandRowByClick: true,
                  rowExpandable: (row) => !!row.children?.length,
                }}
                columns={[
                  {
                    title: 'Организация',
                    dataIndex: 'organizationName',
                    key: 'organizationName',
                    width: columnWidths.organization,
                    onCell: getGroupTitleCellProps,
                    render: (_: string, row: BalanceRow) => (
                      row.isGroup ? renderGroupTitle(row) : <Text type="secondary">{row.organizationName}</Text>
                    ),
                  },
                  {
                    title: 'Банк',
                    dataIndex: 'bankName',
                    key: 'bankName',
                    width: columnWidths.bank,
                    onCell: getGroupHiddenCellProps,
                    render: (value: string, row: BalanceRow) => (
                      row.isGroup ? null : (
                        <Space size={6}>
                        <span title={value}>{value}</span>
                        {!row.isAccountActive && <Tag color="default">Неактивный</Tag>}
                        </Space>
                      )
                    ),
                  },
                  {
                    title: 'Расчетный счет',
                    dataIndex: 'accountNumber',
                    key: 'accountNumber',
                    width: columnWidths.account,
                    onCell: getGroupHiddenCellProps,
                    render: (value: string, row: BalanceRow) => (row.isGroup ? null : <span title={value}>{value}</span>),
                  },
                  {
                    title: 'Дата',
                    dataIndex: 'balanceDate',
                    key: 'balanceDate',
                    width: columnWidths.date,
                    onCell: getGroupHiddenCellProps,
                    render: (value: string, row: BalanceRow) => (
                      row.isGroup ? null : (value ? dayjs(value).format('DD.MM.YYYY') : '—')
                    ),
                  },
                  {
                    title: 'Остаток',
                    dataIndex: 'openingBalance',
                    key: 'openingBalance',
                    width: columnWidths.amount,
                    align: 'right' as const,
                    onCell: getGroupHiddenCellProps,
                    render: (value: number, row: BalanceRow) => (row.isGroup ? null : <Text strong>{formatAmount(value)}</Text>),
                  },
                  ...(canManage ? [{
                    title: 'Действия',
                    key: 'actions',
                    width: columnWidths.actions,
                    align: 'right' as const,
                    onCell: getGroupHiddenCellProps,
                    render: (_: unknown, row: BalanceRow) => {
                      if (row.isGroup || !row.raw) return null;
                      return (
                        <Space size="small">
                          <Button
                            type="link"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => openEditBalanceModal(row)}
                          >
                            Редактировать
                          </Button>
                          <Popconfirm
                            title="Удалить остаток?"
                            description={`${row.accountNumber ?? 'Счет'} · ${row.balanceDate ? dayjs(row.balanceDate).format('DD.MM.YYYY') : ''}`}
                            okText="Удалить"
                            cancelText="Отмена"
                            okButtonProps={{ danger: true, loading: deletingBalanceId === row.balanceId }}
                            onConfirm={() => { void deleteBalance(row); }}
                          >
                            <Button
                              type="link"
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              loading={deletingBalanceId === row.balanceId}
                            >
                              Удалить
                            </Button>
                          </Popconfirm>
                        </Space>
                      );
                    },
                  }] : []),
                ]}
              />
            </div>
          </Space>
        )}
      </Card>

      <Modal
        open={balanceModalOpen}
        title={editingBalance ? 'Редактировать остаток' : 'Внести остатки'}
        onCancel={closeBalanceModal}
        onOk={() => balanceForm.submit()}
        okText="Сохранить"
        cancelText="Отменить"
        confirmLoading={balanceSaving}
        forceRender
        destroyOnHidden
      >
        <Form layout="vertical" form={balanceForm} onFinish={submitBalance}>
          <Form.Item name="balance_date" label="Дата" rules={[{ required: true, message: 'Укажите дату' }]}>
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          <Form.Item name="organization_id" label="Организация" rules={[{ required: true, message: 'Выберите организацию' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={organizations.map(org => ({ value: org.id, label: org.name }))}
            />
          </Form.Item>
          <Form.Item name="bank_account_id" label="Расчетный счет" rules={[{ required: true, message: 'Выберите расчетный счет' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={accountOptionsForBalance}
              loading={loadingAccounts}
              placeholder={selectedBalanceOrganizationId ? 'Выберите расчетный счет' : 'Сначала выберите организацию'}
            />
          </Form.Item>
          <Form.Item name="amount" label="Остаток на утро" rules={[{ required: true, message: 'Укажите сумму остатка' }]}>
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              precision={2}
              formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default AccountBalancesPanel;
