import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import {
  App as AntdApp, Button, Card, Col, DatePicker, Dropdown, Input, InputNumber,
  Modal, Row, Select, Space, Switch, Table, Tag, Tooltip, Typography, Tabs,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  ClearOutlined, DollarOutlined, DownloadOutlined, MoreOutlined,
  PaperClipOutlined, SettingOutlined,
} from '@ant-design/icons';
import apiClient from '../api/apiClient';
import { useAuthStore } from '../store/authStore';
import { CATEGORY_CONFIG, DATE_PICKER_LOCALE } from '../constants';
import ColSettingsDrawer from './ColSettingsDrawer';
import type { ColDef, ColSetting } from './ColSettingsDrawer';
import RequestDetailsCard from '../components/RequestDetailsCard';
import { exportRowsToExcel, formatDateRu, formatMoney, type ExcelColumn } from '../utils/excelExport';

const { Title, Text } = Typography;

const APPROVAL_CONFIG: Record<string, { label: string; color: string }> = {
  MEMO_REQUIRED: { label: 'Требует обоснования', color: 'orange' },
  PENDING_MEMO: { label: 'Вне бюджета', color: 'volcano' },
  APPROVED: { label: 'Согласовано', color: 'green' },
};

const PAYMENT_CONFIG: Record<string, { label: string; color: string }> = {
  UNPAID: { label: 'Не оплачено', color: 'default' },
  PAID: { label: 'Оплачено', color: 'green' },
};

const CONTRACT_KEY = (v: boolean | null) => v === null ? 'null' : String(v);
const CONTRACT_CONFIG: Record<string, { label: string; color: string }> = {
  'null': { label: 'Необработано', color: 'default' },
  'true': { label: 'Есть', color: 'green' },
  'false': { label: 'Нет', color: 'red' },
};
const MODAL_TOP_STYLE: React.CSSProperties = { top: 24 };
const REQUEST_MODAL_WIDTH = 'min(1180px, calc(100vw - 96px))';

const HISTORY_COLOR: Record<string, string> = {
  APPROVED: 'green',
  PAID: 'green',
  SUSPENDED: 'red',
  RESCHEDULED: 'green',
  REJECTED: 'red',
  CLARIFICATION: 'blue',
  POSTPONED: 'orange',
  MEMO_REQUIRED: 'orange',
  GATE_REJECTED: 'purple',
  OFF_BUDGET: 'orange',
  EOD_UNPAID: 'gray',
};

const COLUMN_DEFS: ColDef[] = [
  { key: 'payment_date', label: 'Дата оплаты', defaultWidth: 150, defaultVisible: true, required: true },
  { key: 'request_number', label: '№ заявки', defaultWidth: 120, defaultVisible: true },
  { key: 'file', label: 'Счёт', defaultWidth: 90, defaultVisible: true },
  { key: 'organization', label: 'Организация', defaultWidth: 150, defaultVisible: true },
  { key: 'direction', label: 'ЦФО', defaultWidth: 150, defaultVisible: true },
  { key: 'counterparty', label: 'Контрагент', defaultWidth: 170, defaultVisible: true },
  { key: 'description', label: 'Назначение платежа', defaultWidth: 220, defaultVisible: true },
  { key: 'note', label: 'Описание', defaultWidth: 180, defaultVisible: true },
  { key: 'creator', label: 'Инициатор', defaultWidth: 150, defaultVisible: true },
  { key: 'budget_item', label: 'Статья ДДС', defaultWidth: 170, defaultVisible: true },
  { key: 'amount', label: 'Сумма', defaultWidth: 130, defaultVisible: true, required: true },
  { key: 'payment_status', label: 'Оплата', defaultWidth: 120, defaultVisible: true },
  { key: 'contract_status', label: 'Договор', defaultWidth: 145, defaultVisible: true },
  { key: 'actions', label: 'Действия', defaultWidth: 110, defaultVisible: true, required: true },
];

function getDefaultColSettings(): ColSetting[] {
  return COLUMN_DEFS.map((d, i) => ({ key: d.key, visible: d.defaultVisible, order: i, width: Math.max(1, Math.round(d.defaultWidth / 10)) }));
}

function normalizeColSettingWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 10;
  return width > 40 ? Math.max(1, Math.round(width / 10)) : width;
}

function loadColSettings(userId?: string): ColSetting[] {
  try {
    const raw = localStorage.getItem(`ui_cashier_cols_${userId ?? 'default'}`);
    if (!raw) return getDefaultColSettings();
    const saved: ColSetting[] = JSON.parse(raw).map((s: ColSetting) => ({
      ...s,
      width: normalizeColSettingWidth(s.width),
    }));
    const existingKeys = new Set(saved.map(s => s.key));
    const maxOrder = saved.reduce((m, s) => Math.max(m, s.order), -1);
    let offset = 0;
    for (const d of COLUMN_DEFS) {
      if (!existingKeys.has(d.key)) {
        let order = maxOrder + (++offset);
        if (d.key === 'request_number') {
          const paymentDateOrder = saved.find(s => s.key === 'payment_date')?.order;
          if (paymentDateOrder !== undefined) {
            saved.forEach(s => {
              if (s.order > paymentDateOrder) s.order += 1;
            });
            order = paymentDateOrder + 1;
          }
        }
        if (d.key === 'file') {
          const requestNumberOrder = saved.find(s => s.key === 'request_number')?.order;
          if (requestNumberOrder !== undefined) {
            saved.forEach(s => {
              if (s.order > requestNumberOrder) s.order += 1;
            });
            order = requestNumberOrder + 1;
          }
        }
        saved.push({ key: d.key, visible: d.defaultVisible, order, width: Math.max(1, Math.round(d.defaultWidth / 10)) });
      }
    }
    return saved;
  } catch {
    return getDefaultColSettings();
  }
}

function saveColSettings(userId: string | undefined, settings: ColSetting[]): void {
  localStorage.setItem(`ui_cashier_cols_${userId ?? 'default'}`, JSON.stringify(settings));
}

type CashierFilterState = {
  date?: string | null;
  payment?: string;
  counterparty?: string;
  budgetItem?: string;
  amountFrom?: number;
  amountTo?: number;
};

function loadCashierFilters(userId?: string): CashierFilterState {
  try {
    const raw = localStorage.getItem(`ui_cashier_filters_${userId ?? 'default'}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCashierFilters(userId: string | undefined, filters: CashierFilterState): void {
  localStorage.setItem(`ui_cashier_filters_${userId ?? 'default'}`, JSON.stringify(filters));
}

function getRelativeWidth(key: string, settings: ColSetting[], secondaryKeys: Set<string>): string {
  const visible = settings.filter(s => s.visible && !secondaryKeys.has(s.key));
  const total = visible.reduce((sum, s) => sum + normalizeColSettingWidth(s.width), 0) || 1;
  const setting = visible.find(s => s.key === key);
  const weight = normalizeColSettingWidth(setting?.width ?? 10);
  return `${(weight / total) * 100}%`;
}

const textCellStyle: React.CSSProperties = {
  display: 'block',
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const wrapTextCellStyle: React.CSSProperties = {
  display: 'block',
  maxWidth: '100%',
  whiteSpace: 'normal',
  overflowWrap: 'break-word',
  wordBreak: 'normal',
  lineHeight: 1.35,
};

const smallCellStyle: React.CSSProperties = { fontSize: 12 };
const smallWrapTextCellStyle: React.CSSProperties = { ...wrapTextCellStyle, ...smallCellStyle };
const smallTextCellStyle: React.CSSProperties = { ...textCellStyle, ...smallCellStyle };
const smallLinkWrapTextCellStyle: React.CSSProperties = {
  ...smallWrapTextCellStyle,
  padding: 0,
  height: 'auto',
  fontWeight: 600,
  textAlign: 'left',
};
const nestedCellDividerStyle: React.CSSProperties = {
  borderTop: '1px solid #f0f0f0',
  marginTop: 5,
  paddingTop: 5,
};
const SMALL_FONT_COLUMN_KEYS = new Set(['payment_date', 'request_number', 'file', 'creator', 'direction', 'counterparty', 'note', 'description', 'amount']);
const STATUS_COLUMN_KEYS = new Set(['budget_item', 'payment_status', 'contract_status']);
const statusCellStyle: React.CSSProperties = {
  minWidth: 0,
  display: 'grid',
  gap: 5,
  justifyItems: 'center',
  alignItems: 'center',
  textAlign: 'center',
  fontSize: 12,
};
const statusTagStyle: React.CSSProperties = {
  minHeight: 20,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginInlineEnd: 0,
  fontSize: 12,
  lineHeight: 1.2,
  maxWidth: '100%',
  whiteSpace: 'normal',
  overflowWrap: 'break-word',
  wordBreak: 'normal',
  textAlign: 'center',
};
const secondaryStatusStyle: React.CSSProperties = {
  ...statusTagStyle,
};
const centeredPairCellStyle: React.CSSProperties = {
  minWidth: 0,
  display: 'grid',
  gap: 4,
  justifyItems: 'start',
  alignItems: 'start',
  textAlign: 'left',
  fontSize: 12,
};

const nativeTitleText = (value: string | null | undefined, style: React.CSSProperties = textCellStyle) => (
  value
    ? <span title={value} style={style}>{value}</span>
    : <Text type="secondary">—</Text>
);

const statusTag = (label: React.ReactNode, color: string, secondary = false) => (
  <Tag color={color} style={secondary ? secondaryStatusStyle : statusTagStyle}>{label}</Tag>
);

const CashierWorkspace: React.FC = () => {
  const { message: messageApi } = AntdApp.useApp();
  const user = useAuthStore(s => s.user);
  const permissions = useAuthStore(s => s.permissions);
  const canExport = permissions.includes('req_export_excel') || !!user?.is_superadmin;
  const canPay = permissions.includes('req_pay') || !!user?.is_superadmin;

  const [requests, setRequests] = useState<any[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [budgetItems, setBudgetItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeOrgId, setActiveOrgId] = useState<string>();
  const initialFilters = useMemo(() => loadCashierFilters(user?.id), [user?.id]);
  const [filterDate, setFilterDate] = useState<any>(() => initialFilters.date ? dayjs(initialFilters.date) : dayjs());
  const [filterPayment, setFilterPayment] = useState<string | undefined>(() => initialFilters.payment);
  const [filterCounterparty, setFilterCounterparty] = useState(() => initialFilters.counterparty ?? '');
  const [filterBudgetItem, setFilterBudgetItem] = useState<string | undefined>(() => initialFilters.budgetItem);
  const [filterAmountFrom, setFilterAmountFrom] = useState<number | undefined>(() => initialFilters.amountFrom);
  const [filterAmountTo, setFilterAmountTo] = useState<number | undefined>(() => initialFilters.amountTo);
  const [showFilters, setShowFilters] = useState<boolean>(() => {
    return localStorage.getItem('ui_cashier_show_filters') !== 'false';
  });
  const [colSettings, setColSettings] = useState<ColSetting[]>(() => loadColSettings(user?.id));
  const [colDrawerOpen, setColDrawerOpen] = useState(false);
  const [viewingRequest, setViewingRequest] = useState<any>(null);
  const [requestHistory, setRequestHistory] = useState<any[]>([]);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const [reqRes, orgRes, budgetRes] = await Promise.all([
        apiClient.get('/requests/all'),
        apiClient.get('/dict/organizations'),
        apiClient.get('/dict/budget_items?active_only=true'),
      ]);
      setRequests(reqRes.data);
      setOrganizations(orgRes.data);
      setBudgetItems(budgetRes.data);
    } catch {
      messageApi.error('Ошибка при загрузке рабочего пространства казначея');
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  useEffect(() => {
    if (!viewingRequest) { setRequestHistory([]); return; }
    apiClient.get(`/requests/${viewingRequest.id}/history`)
      .then(r => setRequestHistory(r.data))
      .catch(() => setRequestHistory([]));
  }, [viewingRequest]);

  const payableRequests = useMemo(() => requests.filter(r => (
    (r.approval_status === 'APPROVED' && r.payment_status === 'UNPAID') ||
    r.payment_status === 'PAID'
  )), [requests]);

  const filteredRequests = useMemo(() => payableRequests.filter(r => {
    if (filterDate && r.payment_date !== filterDate.format('YYYY-MM-DD')) return false;
    if (filterPayment && r.payment_status !== filterPayment) return false;
    if (filterCounterparty && !r.counterparty?.toLowerCase().includes(filterCounterparty.toLowerCase())) return false;
    if (filterBudgetItem && r.budget_item_id !== filterBudgetItem) return false;
    if (filterAmountFrom !== undefined && r.amount < filterAmountFrom) return false;
    if (filterAmountTo !== undefined && r.amount > filterAmountTo) return false;
    return true;
  }), [payableRequests, filterDate, filterPayment, filterCounterparty, filterBudgetItem, filterAmountFrom, filterAmountTo]);

  const orgTabs = useMemo(() => {
    const byOrg = new Map<string, { id: string; name: string; count: number; amount: number }>();
    for (const r of filteredRequests) {
      const id = r.organization_id;
      const name = r.organization?.name ?? organizations.find(o => o.id === id)?.name ?? '—';
      const item = byOrg.get(id) ?? { id, name, count: 0, amount: 0 };
      item.count += 1;
      item.amount += r.amount ?? 0;
      byOrg.set(id, item);
    }
    return [...byOrg.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredRequests, organizations]);

  useEffect(() => {
    if (!orgTabs.length) {
      setActiveOrgId(undefined);
    } else if (!activeOrgId || !orgTabs.some(tab => tab.id === activeOrgId)) {
      setActiveOrgId(orgTabs[0].id);
    }
  }, [orgTabs, activeOrgId]);

  const currentRows = useMemo(() => {
    if (!activeOrgId) return [];
    return filteredRequests.filter(r => r.organization_id === activeOrgId);
  }, [filteredRequests, activeOrgId]);

  const handlePay = async (requestId: string) => {
    try {
      await apiClient.post(`/requests/${requestId}/pay`);
      messageApi.success('Заявка оплачена');
      fetchRequests();
    } catch (e: any) {
      messageApi.error(e.response?.data?.detail || 'Ошибка оплаты');
    }
  };

  const openFile = async (requestId: string) => {
    try {
      const response = await apiClient.get(`/requests/${requestId}/file`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch {
      messageApi.error('Не удалось открыть файл счёта');
    }
  };

  const renderActions = (r: any) => {
    if (canPay && r.approval_status === 'APPROVED' && r.payment_status === 'UNPAID') {
      return (
        <Button
          size="small"
          type="primary"
          icon={<DollarOutlined />}
          data-row-action="true"
          onClick={(event) => {
            event.stopPropagation();
            handlePay(r.id);
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          Оплатить
        </Button>
      );
    }
    const menu: MenuProps = {
      items: [{ key: 'view', label: 'Открыть карточку' }],
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        setViewingRequest(r);
      },
    };
    return (
      <Dropdown menu={menu} trigger={['click']}>
        <span
          data-row-action="true"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <Button type="text" size="small" icon={<MoreOutlined />} aria-label="Дополнительные действия" />
        </span>
      </Dropdown>
    );
  };

  const columnRenderers: Record<string, any> = {
    payment_date: {
      dataIndex: 'payment_date',
      sorter: (a: any, b: any) => (a.payment_date ?? '').localeCompare(b.payment_date ?? ''),
      render: (v: string) => v ? <span style={smallTextCellStyle}>{formatDateRu(v)}</span> : <Text type="secondary">—</Text>,
    },
    request_number: {
      dataIndex: 'request_number',
      sorter: (a: any, b: any) => (a.request_number ?? '').localeCompare(b.request_number ?? ''),
      render: (v: string, r: any) => (
        <Button
          type="link"
          style={smallLinkWrapTextCellStyle}
          onClick={(event) => {
            event.stopPropagation();
            setViewingRequest(r);
          }}
        >
          {v || r.id?.slice(0, 8).toUpperCase() || '—'}
        </Button>
      ),
    },
    file: {
      sorter: (a: any, b: any) => (a.file_path ?? '').localeCompare(b.file_path ?? ''),
      align: 'center' as const,
      render: (_: any, r: any) => r.file_path ? (
        <Button
          type="link"
          size="small"
          icon={<PaperClipOutlined />}
          style={{ padding: 0, height: 'auto', fontSize: 12 }}
          onClick={(event) => {
            event.stopPropagation();
            openFile(r.id);
          }}
        >
          Открыть
        </Button>
      ) : <Text type="secondary">—</Text>,
    },
    organization: {
      sorter: (a: any, b: any) => (a.organization?.name ?? '').localeCompare(b.organization?.name ?? ''),
      render: (_: any, r: any) => nativeTitleText(r.organization?.name),
    },
    direction: {
      sorter: (a: any, b: any) => (a.direction?.name ?? '').localeCompare(b.direction?.name ?? ''),
      render: (_: any, r: any) => nativeTitleText(r.direction?.name, smallWrapTextCellStyle),
    },
    counterparty: {
      dataIndex: 'counterparty',
      ellipsis: false,
      sorter: (a: any, b: any) => (a.counterparty ?? '').localeCompare(b.counterparty ?? ''),
      render: (v: string) => nativeTitleText(v, smallWrapTextCellStyle),
    },
    description: {
      dataIndex: 'description',
      ellipsis: false,
      render: (v: string) => nativeTitleText(v, smallWrapTextCellStyle),
    },
    note: {
      dataIndex: 'note',
      ellipsis: false,
      render: (v: string) => nativeTitleText(v, smallWrapTextCellStyle),
    },
    creator: {
      sorter: (a: any, b: any) => (a.creator?.full_name ?? '').localeCompare(b.creator?.full_name ?? ''),
      render: (_: any, r: any) => r.creator?.full_name ? nativeTitleText(r.creator.full_name, smallWrapTextCellStyle) : <Text type="secondary">—</Text>,
    },
    budget_item: {
      sorter: (a: any, b: any) => (a.budget_item?.name ?? '').localeCompare(b.budget_item?.name ?? ''),
      render: (_: any, r: any) => {
        const cfg = r.budget_item?.category ? CATEGORY_CONFIG[r.budget_item.category] : null;
        return r.budget_item ? statusTag(r.budget_item.name, cfg?.color ?? 'default') : '—';
      },
    },
    amount: {
      dataIndex: 'amount',
      align: 'right' as const,
      sorter: (a: any, b: any) => a.amount - b.amount,
      render: (v: number) => <Text strong style={smallCellStyle}>{v.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽</Text>,
    },
    payment_status: {
      dataIndex: 'payment_status',
      sorter: (a: any, b: any) => (a.payment_status ?? '').localeCompare(b.payment_status ?? ''),
      render: (v: string) => {
        const cfg = PAYMENT_CONFIG[v] ?? { label: v, color: 'default' };
        return statusTag(cfg.label, cfg.color);
      },
    },
    contract_status: {
      dataIndex: 'contract_status',
      sorter: (a: any, b: any) => CONTRACT_KEY(a.contract_status).localeCompare(CONTRACT_KEY(b.contract_status)),
      render: (v: boolean | null) => {
        const cfg = CONTRACT_CONFIG[CONTRACT_KEY(v)];
        return statusTag(cfg.label, cfg.color, true);
      },
    },
    actions: { align: 'center' as const, render: (_: any, r: any) => renderActions(r) },
  };

  const secondaryColumnKeys = useMemo(
    () => new Set(colSettings.filter(s => s.pairedWith).map(s => s.pairedWith!)),
    [colSettings],
  );

  const columns = useMemo(() => colSettings
      .filter(s => s.visible)
      .filter(s => !secondaryColumnKeys.has(s.key))
      .sort((a, b) => a.order - b.order)
      .map(s => {
        const def = COLUMN_DEFS.find(d => d.key === s.key);
        const renderer = columnRenderers[s.key];
        if (!def || !renderer) return null;
        if (s.pairedWith) {
          const secondaryDef = COLUMN_DEFS.find(d => d.key === s.pairedWith);
          const secondaryRenderer = columnRenderers[s.pairedWith];
          const secondaryVisible = colSettings.find(item => item.key === s.pairedWith)?.visible;
          const isStatusPair = STATUS_COLUMN_KEYS.has(s.key) || STATUS_COLUMN_KEYS.has(s.pairedWith);
          if (secondaryDef && secondaryRenderer && secondaryVisible) {
            return {
              title: (
                <span style={{
                  ...(SMALL_FONT_COLUMN_KEYS.has(s.key) || SMALL_FONT_COLUMN_KEYS.has(s.pairedWith) ? smallCellStyle : {}),
                  ...(isStatusPair ? { display: 'block', textAlign: 'center' as const } : {}),
                }}>
                  {def.label} / {secondaryDef.label}
                </span>
              ),
              key: s.key,
              dataIndex: renderer.dataIndex,
              width: getRelativeWidth(s.key, colSettings, secondaryColumnKeys),
              ellipsis: renderer.ellipsis && secondaryRenderer.ellipsis,
              align: isStatusPair ? 'center' as const : renderer.align,
              sorter: renderer.sorter,
              render: (v: any, r: any) => (
                <div style={isStatusPair ? statusCellStyle : centeredPairCellStyle}>
                  <div>{renderer.render ? renderer.render(v, r) : v}</div>
                  <div style={{ ...nestedCellDividerStyle, width: '100%', display: 'flex', justifyContent: isStatusPair ? 'center' : 'flex-start' }}>
                    {secondaryRenderer.render
                      ? secondaryRenderer.render(r[secondaryRenderer.dataIndex ?? ''], r)
                      : r[secondaryRenderer.dataIndex ?? s.pairedWith!]}
                  </div>
                </div>
              ),
            };
          }
        }
        return {
          title: <span style={SMALL_FONT_COLUMN_KEYS.has(s.key) ? smallCellStyle : undefined}>{def.label}</span>,
          key: s.key,
          dataIndex: renderer.dataIndex,
          width: getRelativeWidth(s.key, colSettings, secondaryColumnKeys),
          ellipsis: renderer.ellipsis,
          align: STATUS_COLUMN_KEYS.has(s.key) ? 'center' as const : renderer.align,
          sorter: renderer.sorter,
          render: renderer.render,
        };
      })
      .filter(Boolean) as any[],
    [colSettings, secondaryColumnKeys, canPay],
  );

  const excelColumns: ExcelColumn[] = colSettings
    .filter(s => s.key !== 'actions')
    .filter(s => !secondaryColumnKeys.has(s.key))
    .map(s => ({
      key: s.key,
      label: COLUMN_DEFS.find(d => d.key === s.key)?.label ?? s.key,
      visible: s.visible,
      order: s.order,
      value: (r: any) => {
        if (s.key === 'payment_date') return formatDateRu(r.payment_date);
        if (s.key === 'file') return r.file_path ?? '';
        if (s.key === 'organization') return r.organization?.name;
        if (s.key === 'direction') return r.direction?.name;
        if (s.key === 'creator') return r.creator?.full_name;
        if (s.key === 'budget_item') return r.budget_item?.name;
        if (s.key === 'amount') return formatMoney(r.amount);
        if (s.key === 'payment_status') return PAYMENT_CONFIG[r.payment_status]?.label ?? r.payment_status;
        if (s.key === 'contract_status') return CONTRACT_CONFIG[CONTRACT_KEY(r.contract_status)]?.label;
        return r[s.key];
      },
    }));

  const exportCurrentView = () => {
    const orgName = orgTabs.find(tab => tab.id === activeOrgId)?.name ?? 'Реестр';
    exportRowsToExcel(currentRows, excelColumns, `cashier-registry-${dayjs().format('YYYYMMDD-HHmm')}`, orgName);
  };

  const resetFilters = () => {
    setFilterDate(dayjs());
    setFilterPayment(undefined);
    setFilterCounterparty('');
    setFilterBudgetItem(undefined);
    setFilterAmountFrom(undefined);
    setFilterAmountTo(undefined);
  };

  useEffect(() => {
    saveCashierFilters(user?.id, {
      date: filterDate?.format?.('YYYY-MM-DD') ?? null,
      payment: filterPayment,
      counterparty: filterCounterparty,
      budgetItem: filterBudgetItem,
      amountFrom: filterAmountFrom,
      amountTo: filterAmountTo,
    });
  }, [
    user?.id, filterDate, filterPayment, filterCounterparty,
    filterBudgetItem, filterAmountFrom, filterAmountTo,
  ]);

  const cashierTable = useMemo(() => (
    <Card styles={{ body: { padding: 0 } }}>
      <Tabs
        style={{ padding: '0 12px' }}
        activeKey={activeOrgId}
        onChange={setActiveOrgId}
        items={orgTabs.map(tab => ({
          key: tab.id,
          label: `${tab.name} (${tab.count})`,
          children: (
            <Table
              dataSource={filteredRequests.filter(r => r.organization_id === tab.id)}
              columns={columns}
              rowKey="id"
              loading={loading}
              size="small"
              bordered
              tableLayout="fixed"
              sticky={{ offsetHeader: 0 }}
              pagination={false}
            />
          ),
        }))}
      />
      {!orgTabs.length && (
        <div style={{ padding: 32, textAlign: 'center' }}>
          <Text type="secondary">Нет заявок по текущим фильтрам</Text>
        </div>
      )}
    </Card>
  ), [activeOrgId, columns, filteredRequests, loading, orgTabs]);

  return (
    <div style={{ padding: 16 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
        <Title level={3} style={{ margin: 0 }}>Рабочее пространство казначея</Title>
        <Space>
          <Space size={6}>
            <Text type="secondary" style={{ fontSize: 13 }}>Фильтры</Text>
            <Switch
              aria-label="Фильтры"
              checked={showFilters}
              onChange={v => {
                setShowFilters(v);
                localStorage.setItem('ui_cashier_show_filters', String(v));
              }}
              size="small"
            />
          </Space>
          {canExport && (
            <Button icon={<DownloadOutlined />} onClick={exportCurrentView} disabled={!currentRows.length}>
              Выгрузить Excel
            </Button>
          )}
          <Tooltip title="Настройка колонок">
            <Button icon={<SettingOutlined />} onClick={() => setColDrawerOpen(true)} />
          </Tooltip>
        </Space>
      </Row>

      {showFilters && (
      <Card size="small" style={{ marginBottom: 12 }}>
        <Row gutter={[8, 8]} align="middle" wrap>
          <Col>
            <DatePicker
              style={{ width: 150 }}
              format="DD.MM.YYYY"
              placeholder="Дата оплаты"
              value={filterDate}
              onChange={setFilterDate}
              allowClear
              locale={DATE_PICKER_LOCALE}
            />
          </Col>
          <Col>
            <Select
              style={{ width: 150 }}
              placeholder="Оплата"
              allowClear
              value={filterPayment}
              onChange={setFilterPayment}
              options={Object.entries(PAYMENT_CONFIG).map(([k, v]) => ({ value: k, label: <Tag color={v.color}>{v.label}</Tag> }))}
            />
          </Col>
          <Col>
            <Input style={{ width: 180 }} placeholder="Контрагент" value={filterCounterparty} onChange={e => setFilterCounterparty(e.target.value)} allowClear />
          </Col>
          <Col>
            <Select
              style={{ width: 180 }}
              placeholder="Статья ДДС"
              allowClear
              showSearch
              value={filterBudgetItem}
              filterOption={(i, o) => (o?.label ?? '').toString().toLowerCase().includes(i.toLowerCase())}
              options={budgetItems.map(b => ({ value: b.id, label: b.name }))}
              onChange={setFilterBudgetItem}
            />
          </Col>
          <Col><InputNumber style={{ width: 110 }} placeholder="Сумма от" value={filterAmountFrom} onChange={v => setFilterAmountFrom(v ?? undefined)} min={0} /></Col>
          <Col><InputNumber style={{ width: 110 }} placeholder="Сумма до" value={filterAmountTo} onChange={v => setFilterAmountTo(v ?? undefined)} min={0} /></Col>
          <Col>
            <Tooltip title="Сбросить фильтры">
              <Button icon={<ClearOutlined />} onClick={resetFilters} />
            </Tooltip>
          </Col>
        </Row>
      </Card>
      )}

      {cashierTable}

      <ColSettingsDrawer
        open={colDrawerOpen}
        onClose={() => setColDrawerOpen(false)}
        settings={colSettings}
        defs={COLUMN_DEFS}
        onChange={(s) => { setColSettings(s); saveColSettings(user?.id, s); }}
      />

      <Modal
        open={!!viewingRequest}
        onCancel={() => setViewingRequest(null)}
        footer={<Button onClick={() => setViewingRequest(null)}>Закрыть</Button>}
        title={`Заявка № ${viewingRequest?.request_number ?? viewingRequest?.id?.slice(0, 8).toUpperCase() ?? ''}`}
        width={REQUEST_MODAL_WIDTH}
        style={MODAL_TOP_STYLE}
        destroyOnHidden
      >
        {viewingRequest && (
          <RequestDetailsCard
            request={viewingRequest}
            history={requestHistory}
            approvalConfig={APPROVAL_CONFIG}
            paymentConfig={PAYMENT_CONFIG}
            contractConfig={CONTRACT_CONFIG}
            categoryConfig={CATEGORY_CONFIG}
            historyColor={HISTORY_COLOR}
            onOpenFile={(requestId) => openFile(requestId)}
            actions={renderActions(viewingRequest)}
          />
        )}
      </Modal>
      <style>{`
        .ant-table-wrapper .ant-table-content { overflow-x: hidden !important; overflow-y: visible !important; }
        .ant-table-wrapper .ant-table-content::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
};

export default CashierWorkspace;
