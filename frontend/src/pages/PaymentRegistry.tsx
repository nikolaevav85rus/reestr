import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import {
  Table, Tag, Button, Space, Typography, Card, Row, Col,
  Select, Input, Modal, Form, InputNumber, DatePicker,
  App as AntdApp, Alert, Popconfirm, Tooltip, Upload, Switch, Segmented, Dropdown, Tabs,
} from 'antd';
import type { MenuProps, UploadFile } from 'antd';
import {
  PlusOutlined, EditOutlined, CheckOutlined,
  CloseOutlined, ClockCircleOutlined,
  DollarOutlined, UploadOutlined, PaperClipOutlined,
  ClearOutlined, SendOutlined, ThunderboltOutlined, CopyOutlined,
  RestOutlined, SettingOutlined, MoreOutlined, DownloadOutlined,
  FileSearchOutlined,
} from '@ant-design/icons';
import apiClient from '../api/apiClient';
import { useAuthStore } from '../store/authStore';
import { useSearchParams } from 'react-router-dom';
import { CATEGORY_CONFIG, DATE_PICKER_LOCALE } from '../constants';
import {
  REQUEST_APPROVAL_CONFIG as APPROVAL_CONFIG,
  REQUEST_CONTRACT_CONFIG as CONTRACT_CONFIG,
  REQUEST_HISTORY_COLOR as HISTORY_COLOR,
  REQUEST_PAYMENT_CONFIG as PAYMENT_CONFIG,
  contractStatusKey as CONTRACT_KEY,
} from '../requestStatus';
import ColSettingsDrawer from './ColSettingsDrawer';
import type { ColDef, ColSetting } from './ColSettingsDrawer';
import RequestDetailsCard from '../components/RequestDetailsCard';
import AccountBalancesPanel from '../components/AccountBalancesPanel';
import { exportRowsToExcel, formatDateRu, formatMoney, type ExcelColumn } from '../utils/excelExport';
import { getErrorMessage } from '../utils/errorMessage';
import {
  appendMissingColumnSettings,
  buildUserScopedStorageKey,
  loadStoredColumnSettings,
  normalizeColSettingWidth,
  saveStoredColumnSettings,
} from '../utils/columnSettings';
import {
  buildDateTabbedMonths,
  filterRegistryRequests,
  getDisplayedRequests,
  getPaymentTotalsByOrganization,
  resolveActiveDateTabKeys,
  type RegistryClientFilters,
} from './paymentRegistryViewModel';
import {
  buildPaymentRegistryGroupedRows,
  type OrganizationGroupRow as BaseOrganizationGroupRow,
  type RegistryGroupRow as BaseRegistryGroupRow,
  type RegistryTableRow as BaseRegistryTableRow,
} from './paymentRegistryGrouping';
import {
  resolveRegistryActionDecision,
  type RegistryActionKey,
} from './paymentRegistryActions';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

type PaymentDateRange = [Dayjs | null, Dayjs | null];

const currentMonthRange = (): PaymentDateRange => [dayjs().startOf('month'), dayjs().endOf('month')];

type GatePreview = {
  allowed: boolean;
  reason?: string | null;
  reasons?: string[];
};

type PaymentStatus = string;
type ApprovalStatus = string;
type ContractStatus = boolean | null;

type OrganizationRef = {
  id: string;
  name: string;
  inn?: string | null;
};

type DirectionCategoryRef = {
  id?: string;
  name?: string;
};

type DirectionRef = {
  id?: string;
  name?: string;
  category?: DirectionCategoryRef | null;
};

type BudgetItemRef = {
  id: string;
  name: string;
  category?: string | null;
};

type UserRef = {
  id?: string;
  full_name?: string;
  ad_login?: string;
};

type RequestHistoryItem = {
  type: string;
  text: string;
  created_at: string;
};

type RequestRow = {
  id: string;
  request_number?: string | null;
  payment_date?: string | null;
  organization_id: string;
  organization?: OrganizationRef | null;
  direction_id?: string;
  direction?: DirectionRef | null;
  counterparty?: string | null;
  description?: string | null;
  note?: string | null;
  creator_id?: string;
  creator?: UserRef | null;
  budget_item_id?: string;
  budget_item?: BudgetItemRef | null;
  amount: number;
  approval_status: ApprovalStatus;
  payment_status: PaymentStatus;
  contract_status: ContractStatus;
  is_budgeted?: boolean | null;
  is_marked_for_deletion?: boolean;
  special_order?: boolean;
  gate_reason?: string | null;
  feo_note?: string | null;
  rejection_reason?: string | null;
  priority?: string | number | null;
  file_path?: string | null;
  created_at?: string;
  gate_approver?: UserRef | null;
  [key: string]: unknown;
};

type OrganizationGroupRow = BaseOrganizationGroupRow<RequestRow>;
type RegistryGroupRow = BaseRegistryGroupRow<RequestRow>;
type RegistryTableRow = BaseRegistryTableRow<RequestRow>;

// ─── Конфиг колонок ──────────────────────────────────────────────────────────

const COLUMN_DEFS: ColDef[] = [
  { key: 'payment_date',    label: 'Дата оплаты',        defaultWidth: 7,  defaultVisible: true,  required: true },
  { key: 'request_number',  label: '№ заявки',           defaultWidth: 9,  defaultVisible: true  },
  { key: 'organization',    label: 'Организация',         defaultWidth: 8,  defaultVisible: true  },
  { key: 'creator',         label: 'Инициатор',           defaultWidth: 10, defaultVisible: true,  defaultPairedWith: 'direction' },
  { key: 'direction',       label: 'Направление',         defaultWidth: 10, defaultVisible: true  },
  { key: 'counterparty',    label: 'Контрагент',          defaultWidth: 10, defaultVisible: true  },
  { key: 'note',            label: 'Описание',            defaultWidth: 30, defaultVisible: true,  defaultPairedWith: 'description' },
  { key: 'description',     label: 'Назначение платежа',  defaultWidth: 30, defaultVisible: true  },
  { key: 'amount',          label: 'Сумма',               defaultWidth: 9,  defaultVisible: true,  required: true },
  { key: 'approval_status', label: 'Согласование',        defaultWidth: 12, defaultVisible: true,  defaultPairedWith: 'contract_status' },
  { key: 'contract_status', label: 'Договор',             defaultWidth: 12, defaultVisible: true  },
  { key: 'budget_item',     label: 'Статья ДДС',          defaultWidth: 12, defaultVisible: true,  defaultPairedWith: 'is_budgeted' },
  { key: 'is_budgeted',     label: 'Бюджет',              defaultWidth: 12, defaultVisible: true  },
  { key: 'payment_status',  label: 'Оплата',              defaultWidth: 7,  defaultVisible: true  },
  { key: 'special_icon',    label: '⚡',                  defaultWidth: 5,  defaultVisible: true,  required: true },
  { key: 'actions',         label: 'Действия',            defaultWidth: 19, defaultVisible: true,  required: true },
];
const REGISTRY_COLS_PRESET_VERSION = 'registry-cols-20260422-v2';

function getDefaultColSettings(): ColSetting[] {
  return COLUMN_DEFS.map((d, i) => ({
    key: d.key,
    visible: d.defaultVisible,
    order: i,
    width: normalizeColSettingWidth(d.defaultWidth),
    pairedWith: d.defaultPairedWith,
  }));
}

function loadColSettings(userId?: string): ColSetting[] {
  const defaults = getDefaultColSettings();
  try {
    const storageKey = buildUserScopedStorageKey('ui_cols_', userId);
    const versionKey = `${storageKey}_preset_version`;

    if (localStorage.getItem(versionKey) !== REGISTRY_COLS_PRESET_VERSION) {
      saveStoredColumnSettings(storageKey, defaults);
      localStorage.setItem(versionKey, REGISTRY_COLS_PRESET_VERSION);
      return defaults;
    }

    const saved = loadStoredColumnSettings(storageKey, defaults, normalizeColSettingWidth);
    return appendMissingColumnSettings(
      [...saved],
      COLUMN_DEFS,
      (def, order) => ({
        key: def.key,
        visible: def.defaultVisible,
        order,
        width: normalizeColSettingWidth(def.defaultWidth),
        pairedWith: def.defaultPairedWith,
      }),
      ({ def, saved: draft, fallbackOrder }) => {
        if (def.key !== 'request_number') return fallbackOrder;
        const paymentDateOrder = draft.find((setting) => setting.key === 'payment_date')?.order;
        if (paymentDateOrder === undefined) return fallbackOrder;
        draft.forEach((setting) => {
          if (setting.order > paymentDateOrder) setting.order += 1;
        });
        return paymentDateOrder + 1;
      },
    );
  } catch {
    return defaults;
  }
}

function saveColSettings(userId: string | undefined, settings: ColSetting[]): void {
  const storageKey = buildUserScopedStorageKey('ui_cols_', userId);
  saveStoredColumnSettings(storageKey, settings);
  localStorage.setItem(`${storageKey}_preset_version`, REGISTRY_COLS_PRESET_VERSION);
}

type RegistryFilterState = {
  organization?: string;
  direction?: string;
  paymentDates?: [string | null, string | null] | null;
  counterparty?: string;
  description?: string;
  category?: string;
  budgetItem?: string;
  amountFrom?: number;
  amountTo?: number;
  approval?: string;
  payment?: string;
  marked?: 'all' | 'marked' | 'unmarked';
};

function loadRegistryFilters(userId?: string): RegistryFilterState {
  try {
    const raw = localStorage.getItem(`ui_registry_filters_${userId ?? 'default'}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveRegistryFilters(userId: string | undefined, filters: RegistryFilterState): void {
  localStorage.setItem(`ui_registry_filters_${userId ?? 'default'}`, JSON.stringify(filters));
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
const SMALL_FONT_COLUMN_KEYS = new Set(['payment_date', 'request_number', 'creator', 'direction', 'counterparty', 'note', 'description', 'amount']);
const STATUS_COLUMN_KEYS = new Set(['approval_status', 'contract_status', 'budget_item', 'is_budgeted', 'payment_status']);
const statusCellStyle: React.CSSProperties = {
  minWidth: 0,
  display: 'grid',
  gap: 5,
  justifyItems: 'center',
  alignItems: 'center',
  textAlign: 'center',
  fontSize: 12,
};
const pairedCellStyle: React.CSSProperties = {
  minWidth: 0,
  display: 'grid',
  gap: 4,
  justifyItems: 'start',
  alignItems: 'start',
  textAlign: 'left',
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
const statusSelectStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 128,
  fontSize: 12,
};

const statusSelectLabelStyle: React.CSSProperties = {
  display: 'block',
  minWidth: 0,
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textAlign: 'left',
};

const nativeTitleText = (value: string | null | undefined, style: React.CSSProperties = textCellStyle) => (
  value
    ? <span title={value} style={style}>{value}</span>
    : <Text type="secondary">—</Text>
);

const statusTag = (label: React.ReactNode, color: string, secondary = false) => (
  <Tag color={color} style={secondary ? secondaryStatusStyle : statusTagStyle}>{label}</Tag>
);

const statusSelectLabel = (label: React.ReactNode) => (
  <span style={statusSelectLabelStyle}>{label}</span>
);

function approvalStatusLabel(status: string): string {
  if (status === 'MEMO_REQUIRED') return 'Вне бюджета, требуется обоснование';
  if (status === 'PENDING_MEMO') return 'Вне бюджета, ожидание согласования';
  return APPROVAL_CONFIG[status]?.label ?? status;
}

function buildColumns(settings: ColSetting[], renderers: Record<string, any>, isGrouped: boolean): any[] {
  const secondaryKeys = new Set(settings.filter(s => s.pairedWith).map(s => s.pairedWith!));
  return settings
    .filter(s => s.visible)
    .filter(s => !(isGrouped && s.key === 'organization'))
    .sort((a, b) => a.order - b.order)
    .filter(s => !secondaryKeys.has(s.key))
    .map(s => {
      const def = COLUMN_DEFS.find(d => d.key === s.key);
      const rdr = renderers[s.key];
      if (!def || !rdr) return null;
      if (s.pairedWith) {
        const secDef = COLUMN_DEFS.find(d => d.key === s.pairedWith);
        const secRdr = renderers[s.pairedWith];
        const secVisible = settings.find(ss => ss.key === s.pairedWith)?.visible;
        const isStatusPair = STATUS_COLUMN_KEYS.has(s.key) || STATUS_COLUMN_KEYS.has(s.pairedWith);
        if (secDef && secRdr && secVisible) {
          return {
            title: (
              <span style={{
                ...(SMALL_FONT_COLUMN_KEYS.has(s.key) || SMALL_FONT_COLUMN_KEYS.has(s.pairedWith) ? smallCellStyle : {}),
                ...(isStatusPair ? { display: 'block', textAlign: 'center' as const } : {}),
              }}>
                {def.label} / {secDef.label}
              </span>
            ),
            key: s.key,
            dataIndex: rdr.dataIndex,
            width: getRelativeWidth(s.key, settings, secondaryKeys),
            align: isStatusPair ? 'center' as const : rdr.align,
            render: (v: any, r: any) => (
              <div style={isStatusPair ? statusCellStyle : pairedCellStyle}>
                <div>{rdr.render(v, r)}</div>
                <div style={{ ...nestedCellDividerStyle, color: '#888', width: '100%', display: 'flex', justifyContent: isStatusPair ? 'center' : 'flex-start' }}>
                  {secRdr.render(r[secRdr.dataIndex ?? ''], r)}
                </div>
              </div>
            ),
          };
        }
      }
      return {
        title: <span style={SMALL_FONT_COLUMN_KEYS.has(s.key) ? smallCellStyle : undefined}>{def.label}</span>,
        key: s.key,
        dataIndex: rdr.dataIndex,
        width: getRelativeWidth(s.key, settings, secondaryKeys),
        ellipsis: rdr.dataIndex ? rdr.ellipsis : undefined,
        align: STATUS_COLUMN_KEYS.has(s.key) ? 'center' as const : rdr.align,
        sorter: rdr.sorter,
        render: rdr.render,
      };
    })
    .filter(Boolean);
}

const MODAL_TOP_STYLE: React.CSSProperties = { top: 24 };
const REQUEST_MODAL_WIDTH = 'min(1180px, calc(100vw - 96px))';
const REQUEST_SMALL_MODAL_WIDTH = 'min(760px, calc(100vw - 96px))';
const requestFormBlockStyle: React.CSSProperties = {
  border: '1px solid #f0f0f0',
  borderRadius: 6,
  padding: 14,
  height: '100%',
  background: '#fff',
};
const requestFormBlockTitleStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 10,
  fontSize: 14,
  textTransform: 'uppercase',
  letterSpacing: 0.2,
};

// ─── Вспомогательные компоненты ─────────────────────────────────────────────

const ReasonModal: React.FC<{
  open: boolean; title: string;
  onOk: (reason: string) => void; onCancel: () => void;
}> = ({ open, title, onOk, onCancel }) => {
  const [value, setValue] = useState('');
  return (
    <Modal open={open} title={title}
      onCancel={() => { setValue(''); onCancel(); }}
      onOk={() => { onOk(value); setValue(''); }}
      okText="Подтвердить" cancelText="Отменить"
      width={REQUEST_SMALL_MODAL_WIDTH}
      style={MODAL_TOP_STYLE}
      destroyOnHidden
    >
      <Input.TextArea rows={3} placeholder="Укажите причину (необязательно)"
        value={value} onChange={e => setValue(e.target.value)} />
    </Modal>
  );
};

// ─── Основной компонент ─────────────────────────────────────────────────────

const PaymentRegistry: React.FC = () => {
  const { message: messageApi, notification, modal } = AntdApp.useApp();
  const user = useAuthStore(s => s.user);
  const permissions = useAuthStore(s => s.permissions);

  const isSuper = !!user?.is_superadmin;
  const hasUiPerm = (permission: string) => isSuper || permissions.includes(permission);
  const canViewAll      = hasUiPerm('req_view_all');
  const canCreate       = hasUiPerm('req_create');
  const canApprove      = hasUiPerm('req_approve');
  const canPay          = hasUiPerm('req_pay');
  const canContract     = hasUiPerm('req_set_contract');
  const canGateApprove  = hasUiPerm('gate_approve');
  const canMemoApprove  = hasUiPerm('memo_approve');
  const canEditAll      = hasUiPerm('req_edit_all');
  const canExportExcel  = hasUiPerm('req_export_excel');
  const canMarkDeletion = canEditAll || hasUiPerm('req_create');
  const canBalanceView  = hasUiPerm('account_balance_view');
  const canBalanceManage = hasUiPerm('account_balance_manage');

  // ─── Данные ─────────────────────────────────────────────────────────────
  const [requests, setRequests]         = useState<RequestRow[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationRef[]>([]);
  const [directions, setDirections]     = useState<DirectionRef[]>([]);
  const [budgetItems, setBudgetItems]   = useState<BudgetItemRef[]>([]);
  const [loading, setLoading]           = useState(false);
  const initialFilters = useMemo(() => loadRegistryFilters(user?.id), [user?.id]);

  // ─── Фильтры (сервер) ────────────────────────────────────────────────────
  const [filterOrg, setFilterOrg] = useState<string | undefined>(() => initialFilters.organization);
  const [filterDir, setFilterDir] = useState<string | undefined>(() => initialFilters.direction);

  // ─── Фильтры (клиент) ────────────────────────────────────────────────────
  const [filterPaymentDates, setFilterPaymentDates] = useState<PaymentDateRange | null>(() => {
    const saved = initialFilters.paymentDates;
    if (saved?.[0] || saved?.[1]) return [saved[0] ? dayjs(saved[0]) : null, saved[1] ? dayjs(saved[1]) : null];
    return currentMonthRange();
  });
  const [filterCounterparty, setFilterCounterparty] = useState(() => initialFilters.counterparty ?? '');
  const [filterDescription, setFilterDescription]   = useState(() => initialFilters.description ?? '');
  const [filterBudgetItem, setFilterBudgetItem]     = useState<string | undefined>(() => initialFilters.budgetItem);
  const [filterAmountFrom, setFilterAmountFrom]     = useState<number | undefined>(() => initialFilters.amountFrom);
  const [filterAmountTo, setFilterAmountTo]         = useState<number | undefined>(() => initialFilters.amountTo);
  const [isGrouped, setIsGrouped]                   = useState<boolean>(() => {
    return localStorage.getItem('ui_registry_grouped') === 'true';
  });
  const [isDayTabbed, setIsDayTabbed]               = useState<boolean>(() => {
    return localStorage.getItem('ui_registry_day_tabs') === 'true';
  });
  const [showFilters, setShowFilters]               = useState<boolean>(() => {
    return localStorage.getItem('ui_registry_show_filters') !== 'false';
  });
  const [expandLevel, setExpandLevel]               = useState<'org' | 'dircat' | 'cat' | 'req'>(() => {
    const saved = localStorage.getItem('ui_registry_expand_level');
    return (saved === 'org' || saved === 'dircat' || saved === 'cat' || saved === 'req') ? saved as any : 'dircat';
  });
  const [filterCategory, setFilterCategory]         = useState<string | undefined>(() => initialFilters.category);
  const [filterApproval, setFilterApproval]         = useState<string | undefined>(() => initialFilters.approval);
  const [filterPayment, setFilterPayment]           = useState<string | undefined>(() => initialFilters.payment);
  const [filterMarked, setFilterMarked]             = useState<'all' | 'marked' | 'unmarked'>(() => initialFilters.marked ?? 'all');
  const [colSettings, setColSettings]               = useState<ColSetting[]>(() => loadColSettings(user?.id));
  const [colDrawerOpen, setColDrawerOpen]           = useState(false);
  const [activeMonthKey, setActiveMonthKey]         = useState<string>();
  const [activeDayKey, setActiveDayKey]             = useState<string>();
  const filterDateFrom = filterPaymentDates?.[0]?.format?.('YYYY-MM-DD') ?? null;
  const filterDateTo = filterPaymentDates?.[1]?.format?.('YYYY-MM-DD') ?? null;

  const handleFilterPaymentDatesChange = (dates: PaymentDateRange | null) => {
    setFilterPaymentDates(dates);
  };

  const resetFilters = () => {
    setFilterOrg(undefined); setFilterDir(undefined);
    setFilterPaymentDates(currentMonthRange()); setFilterCounterparty('');
    setFilterDescription(''); setFilterCategory(undefined);
    setFilterBudgetItem(undefined);
    setFilterAmountFrom(undefined); setFilterAmountTo(undefined);
    setFilterApproval(undefined); setFilterPayment(undefined);
    setFilterMarked('all');
  };

  // ─── Модалка создания/редактирования ────────────────────────────────────
  useEffect(() => {
    saveRegistryFilters(user?.id, {
      organization: filterOrg,
      direction: filterDir,
      paymentDates: filterPaymentDates
        ? [
            filterPaymentDates[0]?.format?.('YYYY-MM-DD') ?? null,
            filterPaymentDates[1]?.format?.('YYYY-MM-DD') ?? null,
          ]
        : null,
      counterparty: filterCounterparty,
      description: filterDescription,
      category: filterCategory,
      budgetItem: filterBudgetItem,
      amountFrom: filterAmountFrom,
      amountTo: filterAmountTo,
      approval: filterApproval,
      payment: filterPayment,
      marked: filterMarked,
    });
  }, [
    user?.id, filterOrg, filterDir, filterPaymentDates, filterCounterparty,
    filterDescription, filterCategory, filterBudgetItem, filterAmountFrom,
    filterAmountTo, filterApproval, filterPayment, filterMarked,
  ]);

  const [isFormOpen, setIsFormOpen]         = useState(false);
  const [editingRequest, setEditingRequest] = useState<RequestRow | null>(null);
  const [isCopying, setIsCopying]           = useState(false);
  const [formLoading, setFormLoading]       = useState(false);
  const [form] = Form.useForm();
  const [fileList, setFileList]             = useState<UploadFile[]>([]);
  const [ocrLoading, setOcrLoading]         = useState(false);
  const [ocrResult, setOcrResult]           = useState<{ requirement: string | null; warnings: string[]; confidence: number; isInvoice: boolean } | null>(null);
  const [gatePreview, setGatePreview]       = useState<GatePreview | null>(null);
  const [gatePreviewLoading, setGatePreviewLoading] = useState(false);
  const gatePreviewSeq = useRef(0);
  const formOrganizationId = Form.useWatch('organization_id', form);
  const formBudgetItemId = Form.useWatch('budget_item_id', form);
  const formPaymentDate = Form.useWatch('payment_date', form);

  // ─── Модалка причины ─────────────────────────────────────────────────────
  const [reasonModal, setReasonModal] = useState<{
    open: boolean; title: string; action: string; requestId: string;
  }>({ open: false, title: '', action: '', requestId: '' });

  // ─── Модалка исключения из регламента ────────────────────────────────────
  const [gateModal, setGateModal] = useState<{
    open: boolean; type: 'approve' | 'reject'; requestId: string; violation: string;
  }>({ open: false, type: 'approve', requestId: '', violation: '' });

  // ─── Модалка отклонения memo ──────────────────────────────────────────────
  const [rejectMemoModal, setRejectMemoModal] = useState<{ open: boolean; requestId: string }>({ open: false, requestId: '' });

  // ─── Модалка переноса даты (PENDING_MEMO → DRAFT) ────────────────────────
  const [moveDraftModal, setMoveDraftModal] = useState<{ open: boolean; requestId: string }>({ open: false, requestId: '' });
  const [moveDraftDate, setMoveDraftDate] = useState<any>(null);
  const [postponeModal, setPostponeModal] = useState<{ open: boolean; requestId: string }>({ open: false, requestId: '' });
  const [postponeDate, setPostponeDate] = useState<any>(null);
  const [postponeReason, setPostponeReason] = useState('');

  // ─── Просмотр файла ──────────────────────────────────────────────────────
  const [filePreview, setFilePreview] = useState<{ url: string; name: string } | null>(null);

  // ─── Модалка просмотра заявки ─────────────────────────────────────────────
  const [viewingRequest, setViewingRequest] = useState<RequestRow | null>(null);
  const [requestHistory, setRequestHistory] = useState<RequestHistoryItem[]>([]);
  const mergeRequest = useCallback((request: Partial<RequestRow> & { id: string }) => {
    setRequests(prev => prev.map(r => r.id === request.id ? { ...r, ...request } : r));
    setViewingRequest((current) => current?.id === request.id ? { ...current, ...request } : current);
  }, []);

  useEffect(() => {
    if (!viewingRequest) { setRequestHistory([]); return; }
    apiClient.get<RequestHistoryItem[]>(`/requests/${viewingRequest.id}/history`)
      .then(r => setRequestHistory(r.data))
      .catch(() => setRequestHistory([]));
  }, [viewingRequest]);

  // ─── Загрузка справочников ───────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      apiClient.get<OrganizationRef[]>('/dict/organizations'),
      apiClient.get<DirectionRef[]>('/dict/directions'),
      apiClient.get<BudgetItemRef[]>('/dict/budget_items?active_only=true'),
    ]).then(([o, d, b]) => {
      setOrganizations(o.data);
      setDirections(d.data);
      setBudgetItems(b.data);
    });
  }, []);

  useEffect(() => {
    gatePreviewSeq.current += 1;
    const seq = gatePreviewSeq.current;

    if (!isFormOpen || !formOrganizationId || !formBudgetItemId || !formPaymentDate) {
      setGatePreview(null);
      setGatePreviewLoading(false);
      return;
    }

    setGatePreviewLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await apiClient.post<GatePreview>('/requests/gate_preview', {
          organization_id: formOrganizationId,
          budget_item_id: formBudgetItemId,
          payment_date: formPaymentDate.format('YYYY-MM-DD'),
        });
        if (gatePreviewSeq.current === seq) {
          setGatePreview(response.data);
        }
      } catch {
        if (gatePreviewSeq.current === seq) {
          setGatePreview(null);
        }
      } finally {
        if (gatePreviewSeq.current === seq) {
          setGatePreviewLoading(false);
        }
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [isFormOpen, formOrganizationId, formBudgetItemId, formPaymentDate]);

  // ─── Загрузка заявок ─────────────────────────────────────────────────────
  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterOrg) params.append('organization_id', filterOrg);
      if (filterDir) params.append('direction_id', filterDir);
      const r = await apiClient.get<RequestRow[]>(`/requests/all?${params}`);
      setRequests(r.data);
    } catch {
      messageApi.error('Ошибка при загрузке заявок');
    } finally {
      setLoading(false);
    }
  }, [filterOrg, filterDir]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  // ─── Открытие заявки по ?view= из уведомления ────────────────────────────
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const viewId = searchParams.get('view');
    if (!viewId || requests.length === 0) return;
    const found = requests.find((r) => r.id === viewId);
    if (found) {
      setViewingRequest(found);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, requests]);

  // ─── Клиентская фильтрация ───────────────────────────────────────────────
  const clientFilters = useMemo<RegistryClientFilters>(() => ({
    paymentDateFrom: filterPaymentDates?.[0]?.format('YYYY-MM-DD') ?? null,
    paymentDateTo: filterPaymentDates?.[1]?.format('YYYY-MM-DD') ?? null,
    counterparty: filterCounterparty,
    description: filterDescription,
    category: filterCategory,
    budgetItem: filterBudgetItem,
    amountFrom: filterAmountFrom,
    amountTo: filterAmountTo,
    approval: filterApproval,
    payment: filterPayment,
    marked: filterMarked,
  }), [
    filterPaymentDates,
    filterCounterparty,
    filterDescription,
    filterCategory,
    filterBudgetItem,
    filterAmountFrom,
    filterAmountTo,
    filterApproval,
    filterPayment,
    filterMarked,
  ]);

  const filteredRequests = useMemo(
    () => filterRegistryRequests(requests, clientFilters),
    [requests, clientFilters],
  );

  const dateTabbedMonths = useMemo(
    () => buildDateTabbedMonths(filteredRequests),
    [filteredRequests],
  );

  useEffect(() => {
    const next = resolveActiveDateTabKeys(isDayTabbed, dateTabbedMonths, activeMonthKey, activeDayKey);
    if (next.activeMonthKey !== activeMonthKey) setActiveMonthKey(next.activeMonthKey);
    if (next.activeDayKey !== activeDayKey) setActiveDayKey(next.activeDayKey);
  }, [isDayTabbed, dateTabbedMonths, activeMonthKey, activeDayKey]);

  const displayedRequests = useMemo(
    () => getDisplayedRequests(isDayTabbed, filteredRequests, dateTabbedMonths, activeMonthKey, activeDayKey),
    [isDayTabbed, filteredRequests, dateTabbedMonths, activeMonthKey, activeDayKey],
  );

  const balanceDayDate = isDayTabbed && activeDayKey ? activeDayKey : null;
  const balanceDateFrom = balanceDayDate ?? filterDateFrom;
  const balanceDateTo = balanceDayDate ?? filterDateTo;
  const dashboardDaySelected = isDayTabbed && !!activeDayKey;
  const paymentTotalsByOrganization = useMemo<Record<string, number>>(
    () => getPaymentTotalsByOrganization(dashboardDaySelected, displayedRequests),
    [dashboardDaySelected, displayedRequests],
  );

  const excelColumns: ExcelColumn<RequestRow>[] = useMemo(() => {
    const secondaryKeys = new Set(colSettings.filter(s => s.pairedWith).map(s => s.pairedWith!));
    return colSettings
      .filter(s => s.key !== 'actions' && s.key !== 'special_icon')
      .filter(s => !secondaryKeys.has(s.key))
      .map(s => ({
        key: s.key,
        label: COLUMN_DEFS.find(d => d.key === s.key)?.label ?? s.key,
        visible: s.visible,
        order: s.order,
        value: (r: RequestRow) => {
          if (s.key === 'payment_date') return formatDateRu(r.payment_date);
          if (s.key === 'organization') return r.organization?.name;
          if (s.key === 'direction') return r.direction?.name;
          if (s.key === 'creator') return r.creator?.full_name;
          if (s.key === 'budget_item') return r.budget_item?.name;
          if (s.key === 'amount') return formatMoney(r.amount);
          if (s.key === 'approval_status') return approvalStatusLabel(r.approval_status);
          if (s.key === 'payment_status') return PAYMENT_CONFIG[r.payment_status]?.label ?? r.payment_status;
          if (s.key === 'contract_status') return CONTRACT_CONFIG[CONTRACT_KEY(r.contract_status)]?.label;
          if (s.key === 'is_budgeted') return CONTRACT_CONFIG[CONTRACT_KEY(r.is_budgeted ?? null)]?.label;
          return r[s.key] as string | number | boolean | null | undefined;
        },
      }));
  }, [colSettings]);

  const exportCurrentView = () => {
    exportRowsToExcel(displayedRequests, excelColumns, `payment-registry-${dayjs().format('YYYYMMDD-HHmm')}`);
  };

  // ─── Группировка (org → dircat → ddsCat → request) ───────────────────────
  const groupedData = useMemo<OrganizationGroupRow[]>(
    () =>
      buildPaymentRegistryGroupedRows(displayedRequests, {
        unknownOrganizationName: '—',
        noDirectionCategoryId: '__none__',
        unknownDirectionCategoryName: 'Без категории ЦФО',
        defaultBudgetCategoryKey: 'OTHER',
      }),
    [displayedRequests],
  );

  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  useEffect(() => {
    if (!isGrouped) { setExpandedKeys([]); return; }
    const orgKeys = groupedData.map((o) => o.key);
    if (expandLevel === 'org') { setExpandedKeys([]); return; }
    const dcKeys = groupedData.flatMap((o) => o.children.map((dc) => dc.key));
    if (expandLevel === 'dircat') { setExpandedKeys(orgKeys); return; }
    if (expandLevel === 'cat') { setExpandedKeys([...orgKeys, ...dcKeys]); return; }
    const catKeys = groupedData.flatMap((o) =>
      o.children.flatMap((dc) => dc.children.map((c) => c.key))
    );
    setExpandedKeys([...orgKeys, ...dcKeys, ...catKeys]);
  }, [isGrouped, groupedData, expandLevel]);

  // ─── Распознавание счёта (OCR) ──────────────────────────────────────────
  const handleOcrRecognize = async (file: File) => {
    setOcrResult(null);
    setOcrLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await apiClient.post('/requests/ocr_recognize', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 180000,
      });
      const prefill = data?.prefill ?? {};
      const warnings: string[] = Array.isArray(data?.warnings) ? data.warnings : [];

      const fieldsToSet: Record<string, unknown> = {};
      if (prefill.amount != null) fieldsToSet.amount = prefill.amount;
      if (prefill.counterparty != null) fieldsToSet.counterparty = prefill.counterparty;
      if (prefill.description != null) fieldsToSet.description = prefill.description;
      if (prefill.note != null) fieldsToSet.note = prefill.note;
      // Организация-плательщик: подбираем по ИНН покупателя из счёта
      if (prefill.buyer_inn) {
        const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
        const buyerInn = digits(prefill.buyer_inn);
        const match = organizations.find(o => o.inn && digits(o.inn) === buyerInn);
        if (match) fieldsToSet.organization_id = match.id;
      }
      if (Object.keys(fieldsToSet).length > 0) form.setFieldsValue(fieldsToSet);

      // Файл уже прикреплён пользователем в поле «Файл» — повторно не трогаем.
      setOcrResult({
        requirement: prefill.payment_purpose_requirement ?? null,
        warnings,
        confidence: typeof prefill.confidence === 'number' ? prefill.confidence : 0,
        isInvoice: prefill.is_invoice === true,
      });
      messageApi.success('Счёт распознан, проверьте поля');
    } catch (e: unknown) {
      messageApi.error(getErrorMessage(e, 'Не удалось распознать счёт'));
    } finally {
      setOcrLoading(false);
    }
  };

  // ─── Сохранение формы ────────────────────────────────────────────────────
  const handleFormSubmit = async (values: any) => {
    setFormLoading(true);
    const pendingFile = fileList.find(f => f.originFileObj)?.originFileObj ?? null;
    try {
      const normalizedDescription = typeof values.description === 'string'
        ? values.description.trim()
        : values.description;
      const payload = {
        ...values,
        description: normalizedDescription,
        payment_date: values.payment_date?.format('YYYY-MM-DD') ?? null,
      };
      let requestId: string;
      if (editingRequest) {
        await apiClient.put(`/requests/${editingRequest.id}`, payload);
        requestId = editingRequest.id;
      } else {
        const r = await apiClient.post('/requests/', payload);
        requestId = r.data.id;
      }
      if (pendingFile) {
        const fd = new FormData();
        fd.append('file', pendingFile);
        await apiClient.post(`/requests/${requestId}/upload`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      messageApi.success(editingRequest ? 'Заявка обновлена' : 'Заявка создана');
      setIsFormOpen(false);
      setFileList([]);
      fetchRequests();
    } catch (error: unknown) {
      const msg = getErrorMessage(error, 'Ошибка при сохранении');
      notification.error({ message: 'Ошибка', description: msg, duration: 8 });
    } finally {
      setFormLoading(false);
    }
  };

  const openEdit = (record: RequestRow) => {
    setIsCopying(false);
    setOcrResult(null);
    setOcrLoading(false);
    setEditingRequest(record);
    form.setFieldsValue({
      ...record,
      organization_id: record.organization?.id ?? record.organization_id,
      direction_id:    record.direction?.id    ?? record.direction_id,
      budget_item_id:  record.budget_item?.id  ?? record.budget_item_id,
      payment_date:    record.payment_date ? dayjs(record.payment_date) : null,
    });
    setFileList(record.file_path ? [{ uid: '-1', name: record.file_path, status: 'done' as const }] : []);
    setIsFormOpen(true);
  };

  const openCreate = () => {
    setEditingRequest(null);
    setIsCopying(false);
    setOcrResult(null);
    setOcrLoading(false);
    form.resetFields();
    setFileList([]);
    setIsFormOpen(false);
    setTimeout(() => setIsFormOpen(true), 0);
  };

  const openCopy = (record: RequestRow) => {
    setEditingRequest(null);  // создаём новую, не редактируем
    setIsCopying(true);
    setOcrResult(null);
    setOcrLoading(false);
    form.resetFields();
    form.setFieldsValue({
      organization_id: record.organization?.id ?? record.organization_id,
      direction_id:    record.direction?.id    ?? record.direction_id,
      budget_item_id:  record.budget_item?.id  ?? record.budget_item_id,
      counterparty:    record.counterparty,
      description:     record.description,
      note:            record.note,
      amount:          record.amount,
      feo_note:        record.feo_note,
      priority:        record.priority,
      // payment_date намеренно не копируем
    });
    setFileList([]);  // файл не копируем
    setIsFormOpen(false);
    setTimeout(() => setIsFormOpen(true), 0);
  };

  // ─── Файл ────────────────────────────────────────────────────────────────
  const openFile = async (requestId: string, filename: string) => {
    try {
      const response = await apiClient.get(`/requests/${requestId}/file`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      if (filename.toLowerCase().endsWith('.pdf')) {
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      } else {
        setFilePreview({ url, name: filename });
      }
    } catch {
      messageApi.error('Не удалось открыть файл');
    }
  };


  // ─── Пометка на удаление ─────────────────────────────────────────────────

  const openLocalFile = (file: File, filename: string) => {
    const url = URL.createObjectURL(file);
    if (filename.toLowerCase().endsWith('.pdf')) {
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } else {
      setFilePreview({ url, name: filename });
    }
  };

  const currentFormFile = fileList[0] ?? null;

  const openFormFile = async () => {
    const localFile = currentFormFile?.originFileObj;
    if (localFile instanceof File) {
      openLocalFile(localFile, currentFormFile.name || localFile.name);
      return;
    }
    if (editingRequest?.id && editingRequest?.file_path) {
      await openFile(editingRequest.id, editingRequest.file_path);
      return;
    }
    messageApi.info('Файл ещё не прикреплён');
  };

  const handleMarkDeletion = async (id: string, currentMark: boolean) => {
    try {
      await apiClient.patch(`/requests/${id}/mark_deletion`);
      messageApi.success(currentMark ? 'Пометка снята' : 'Заявка помечена на удаление');
      fetchRequests();
    } catch (error: unknown) {
      messageApi.error(getErrorMessage(error, 'Ошибка'));
    }
  };

  // ─── Отправка на согласование ────────────────────────────────────────────
  const handleSubmit = async (id: string) => {
    try {
      const r = await apiClient.post(`/requests/${id}/submit`);
      const status = r.data.approval_status;
      if (status === 'PENDING_GATE') {
        messageApi.warning(`Заявка требует исключения из регламента: ${r.data.gate_reason}`);
      } else {
        messageApi.success('Заявка отправлена на согласование');
      }
      fetchRequests();
    } catch (error: unknown) {
      messageApi.error(getErrorMessage(error, 'Ошибка при отправке'));
    }
  };

  // ─── Бюджет (tristate inline) ─────────────────────────────────────────────
  const handleSetBudget = async (id: string, value: boolean | null) => {
    setRequests(prev => prev.map(r => r.id === id ? { ...r, is_budgeted: value } : r));
    try {
      const response = await apiClient.patch(`/requests/${id}/budget`, { is_budgeted: value });
      mergeRequest(response.data);
    } catch (error: unknown) {
      messageApi.error(getErrorMessage(error, 'Ошибка'));
      fetchRequests();
    }
  };

  // ─── Договор (tristate inline) ────────────────────────────────────────────
  const handleSetContract = async (id: string, value: boolean | null) => {
    // Оптимистичное обновление
    setRequests(prev => prev.map(r => r.id === id ? { ...r, contract_status: value } : r));
    try {
      await apiClient.patch(`/requests/${id}/contract`, { contract_status: value });
    } catch (error: unknown) {
      messageApi.error(getErrorMessage(error, 'Ошибка'));
      fetchRequests();
    }
  };

  // ─── Исключение из регламента (PENDING_GATE) ─────────────────────────────
  const handleApproveGate = async (id: string, reason: string) => {
    try {
      await apiClient.post(`/requests/${id}/approve_gate`, { reason });
      messageApi.success('Исключение разрешено');
      fetchRequests();
    } catch (error: unknown) {
      messageApi.error(getErrorMessage(error, 'Ошибка'));
    }
  };

  const handleRejectGate = async (id: string, reason: string) => {
    try {
      await apiClient.post(`/requests/${id}/reject_gate`, { reason });
      messageApi.success('Запрос отклонён');
      fetchRequests();
    } catch (error: unknown) {
      messageApi.error(getErrorMessage(error, 'Ошибка'));
    }
  };

  // ─── Suspend / Unsuspend ─────────────────────────────────────────────────
  const canSuspend = hasUiPerm('req_suspend');
  const [unsuspendModal, setUnsuspendModal] = useState<{ open: boolean; requestId: string }>({ open: false, requestId: '' });
  const [unsuspendDate, setUnsuspendDate] = useState<any>(null);

  const handleSuspend = async (id: string, reason: string) => {
    try {
      await apiClient.post(`/requests/${id}/suspend`, { reason });
      messageApi.success('Заявка отложена');
      fetchRequests();
    } catch (error: unknown) {
      messageApi.error(getErrorMessage(error, 'Ошибка'));
    }
  };

  const handleUnsuspend = async () => {
    if (!unsuspendDate) { messageApi.warning('Укажите новую дату'); return; }
    try {
      await apiClient.post(`/requests/${unsuspendModal.requestId}/unsuspend`, {
        payment_date: unsuspendDate.format('YYYY-MM-DD'),
      });
      messageApi.success('Заявка перенесена, передана на согласование');
      setUnsuspendModal({ open: false, requestId: '' });
      setUnsuspendDate(null);
      fetchRequests();
    } catch (error: unknown) {
      messageApi.error(getErrorMessage(error, 'Ошибка'));
    }
  };

  const [suspendModal, setSuspendModal] = useState<{ open: boolean; requestId: string }>({ open: false, requestId: '' });

  // ─── PENDING_MEMO ─────────────────────────────────────────────────────────
  const handleApproveMemo = async (id: string) => {
    try {
      await apiClient.post(`/requests/${id}/approve_memo`);
      messageApi.success('Внебюджетный платёж утверждён');
      fetchRequests();
    } catch (error: unknown) {
      messageApi.error(getErrorMessage(error, 'Ошибка'));
    }
  };

  const handleRejectMemo = async (id: string, reason: string) => {
    try {
      await apiClient.post(`/requests/${id}/reject_memo`, { reason });
      messageApi.success('Заявка отклонена');
      fetchRequests();
    } catch (error: unknown) {
      messageApi.error(getErrorMessage(error, 'Ошибка'));
    }
  };

  const handleMoveToDraft = async () => {
    if (!moveDraftDate) { messageApi.warning('Укажите новую дату'); return; }
    try {
      await apiClient.post(`/requests/${moveDraftModal.requestId}/move_to_draft`, {
        payment_date: moveDraftDate.format('YYYY-MM-DD'),
      });
      messageApi.success('Заявка перенесена в черновик');
      setMoveDraftModal({ open: false, requestId: '' });
      setMoveDraftDate(null);
      fetchRequests();
    } catch (error: unknown) {
      messageApi.error(getErrorMessage(error, 'Ошибка'));
    }
  };

  const handlePostpone = async () => {
    if (!postponeReason.trim()) { messageApi.warning('Укажите причину переноса'); return; }
    try {
      await apiClient.post(`/requests/${postponeModal.requestId}/postpone`, {
        reason: postponeReason,
        payment_date: postponeDate ? postponeDate.format('YYYY-MM-DD') : undefined,
      });
      messageApi.success('Заявка перенесена');
      setPostponeModal({ open: false, requestId: '' });
      setPostponeDate(null);
      setPostponeReason('');
      fetchRequests();
    } catch (error: unknown) {
      messageApi.error(getErrorMessage(error, 'Ошибка'));
    }
  };

  // ─── Согласование (inline) ────────────────────────────────────────────────
  // ─── Действия со статусами ────────────────────────────────────────────────
  const handleAction = async (action: string, requestId: string, reason = '') => {
    try {
      let response;
      if (action === 'pay') {
        response = await apiClient.post(`/requests/${requestId}/pay`);
      } else {
        response = await apiClient.post(`/requests/${requestId}/${action}`, { reason });
      }
      mergeRequest(response.data);
      messageApi.success('Статус обновлён');
    } catch (error: unknown) {
      messageApi.error(getErrorMessage(error, 'Ошибка'));
    }
  };

  const openReasonModal = (action: string, requestId: string, title: string) => {
    setReasonModal({ open: true, title, action, requestId });
  };

  type WorkflowAction = {
    key: RegistryActionKey;
    label: string;
    icon?: React.ReactNode;
    danger?: boolean;
    color?: string;
    run: () => void;
    confirmTitle?: string;
    confirmDescription?: React.ReactNode;
    confirmOkText?: string;
  };

  const runWorkflowAction = (action: WorkflowAction) => {
    if (!action.confirmTitle) {
      action.run();
      return;
    }
    modal.confirm({
      title: action.confirmTitle,
      content: action.confirmDescription,
      okText: action.confirmOkText ?? action.label,
      cancelText: 'Отмена',
      okButtonProps: { danger: action.danger },
      onOk: action.run,
    });
  };

  const renderPrimaryAction = (action?: WorkflowAction) => {
    if (!action) return null;
    const button = (
      <Button
        size="small"
        type="primary"
        danger={action.danger}
        icon={action.icon}
        style={action.color ? { background: action.color, borderColor: action.color } : undefined}
        onClick={(event) => {
          event.stopPropagation();
          if (!action.confirmTitle) action.run();
        }}
      >
        {action.label}
      </Button>
    );
    return action.confirmTitle ? (
      <Popconfirm
        title={action.confirmTitle}
        description={action.confirmDescription}
        okText={action.confirmOkText ?? action.label}
        cancelText="Отмена"
        okButtonProps={{ danger: action.danger }}
        onConfirm={action.run}
      >
        {button}
      </Popconfirm>
    ) : button;
  };

  const renderSecondaryActions = (actions: WorkflowAction[]) => {
    if (!actions.length) return null;
    const menu: MenuProps = {
      items: actions.map(action => ({
        key: action.key,
        label: action.label,
        icon: action.icon,
        danger: action.danger,
      })),
      onClick: ({ key, domEvent }) => {
        domEvent.stopPropagation();
        const action = actions.find(item => item.key === key);
        if (action) runWorkflowAction(action);
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

  // ─── Колонки таблицы ─────────────────────────────────────────────────────
  const isGroupRow = (row: unknown): row is RegistryGroupRow => {
    if (!row || typeof row !== 'object') return false;
    const rowType = (row as { _type?: unknown })._type;
    return rowType === 'org' || rowType === 'dircat' || rowType === 'category';
  };

  const getRegistryRowKey = (row: RegistryTableRow): string => {
    if (isGroupRow(row)) return row.key;
    if ('key' in row && typeof row.key === 'string') return row.key;
    return row.id;
  };
  const COLUMN_RENDERERS: Record<string, any> = {
    payment_date: {
      dataIndex: 'payment_date',
      sorter: (a: any, b: any) => (a.payment_date ?? '').localeCompare(b.payment_date ?? ''),
      render: (v: string, r: RegistryTableRow) => {
        if (isGroupRow(r) && r._type === 'org') return (
          <Text strong style={{ fontSize: 12 }}>
            {r._name}
            <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12, marginLeft: 8 }}>
              ({r._count} {r._count === 1 ? 'заявка' : r._count < 5 ? 'заявки' : 'заявок'})
            </Text>
          </Text>
        );
        if (isGroupRow(r) && r._type === 'dircat') return (
          <span>
            <Tag color="purple" style={{ marginRight: 4 }}>{r._name}</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>({r._count})</Text>
          </span>
        );
        if (isGroupRow(r) && r._type === 'category') {
          const cfg = CATEGORY_CONFIG[r._catKey];
          return (
            <span>
              <Tag color={cfg?.color ?? 'default'} style={{ marginRight: 4 }}>{cfg?.label ?? r._catKey}</Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>({r._count})</Text>
            </span>
          );
        }
        return v
          ? <span style={smallTextCellStyle}>{new Date(v + 'T00:00:00').toLocaleDateString('ru-RU')}</span>
          : <Text type="secondary">—</Text>;
      },
    },
    request_number: {
      dataIndex: 'request_number',
      sorter: (a: any, b: any) => (a.request_number ?? '').localeCompare(b.request_number ?? ''),
      render: (v: string, r: any) => {
        if (isGroupRow(r)) return null;
        return (
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
        );
      },
    },
    organization: {
      ellipsis: true,
      sorter: (a: any, b: any) => (a.organization?.name ?? '').localeCompare(b.organization?.name ?? ''),
      render: (_: any, r: any) => {
        if (isGroupRow(r)) return null;
        return nativeTitleText(r.organization?.name);
      },
    },
    direction: {
      ellipsis: true,
      sorter: (a: any, b: any) => (a.direction?.name ?? '').localeCompare(b.direction?.name ?? ''),
      render: (_: any, r: any) => {
        if (isGroupRow(r)) return null;
        return nativeTitleText(r.direction?.name, smallWrapTextCellStyle);
      },
    },
    counterparty: {
      dataIndex: 'counterparty',
      ellipsis: false,
      sorter: (a: any, b: any) => (a.counterparty ?? '').localeCompare(b.counterparty ?? ''),
      render: (v: string, r: any) => {
        if (isGroupRow(r)) return null;
        return nativeTitleText(v, smallWrapTextCellStyle);
      },
    },
    description: {
      dataIndex: 'description',
      ellipsis: false,
      render: (v: string, r: any) => {
        if (isGroupRow(r)) return null;
        return nativeTitleText(v, smallWrapTextCellStyle);
      },
    },
    note: {
      dataIndex: 'note',
      ellipsis: false,
      render: (v: string, r: any) => {
        if (isGroupRow(r)) return null;
        return nativeTitleText(v, smallWrapTextCellStyle);
      },
    },
    creator: {
      ellipsis: true,
      sorter: (a: any, b: any) => (a.creator?.full_name ?? '').localeCompare(b.creator?.full_name ?? ''),
      render: (_: any, r: any) => {
        if (isGroupRow(r)) return null;
        return r.creator
          ? nativeTitleText(r.creator.full_name, smallWrapTextCellStyle)
          : <Text type="secondary">—</Text>;
      },
    },
    budget_item: {
      ellipsis: true,
      sorter: (a: any, b: any) => (a.budget_item?.name ?? '').localeCompare(b.budget_item?.name ?? ''),
      render: (_: any, r: any) => {
        if (isGroupRow(r)) return null;
        const cfg = r.budget_item?.category ? CATEGORY_CONFIG[r.budget_item.category] : null;
        return r.budget_item
          ? statusTag(r.budget_item.name, cfg?.color ?? 'default')
          : '—';
      },
    },
    amount: {
      dataIndex: 'amount',
      align: 'right' as const,
      sorter: (a: any, b: any) => a.amount - b.amount,
      render: (v: number, r: RegistryTableRow) => {
        if (isGroupRow(r) && r._type === 'org') return (
          <Text strong style={{ color: '#1677ff', fontSize: 12 }}>
            {v.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽
          </Text>
        );
        if (isGroupRow(r) && r._type === 'dircat') return (
          <Text style={{ color: '#722ed1', fontSize: 12 }}>
            {v.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽
          </Text>
        );
        if (isGroupRow(r) && r._type === 'category') return (
          <Text style={{ color: '#389e0d', fontSize: 12 }}>
            {v.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽
          </Text>
        );
        return <Text strong style={smallCellStyle}>{v.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽</Text>;
      },
    },
    approval_status: {
      dataIndex: 'approval_status',
      sorter: (a: any, b: any) => (a.approval_status ?? '').localeCompare(b.approval_status ?? ''),
      render: (v: string, r: any) => {
        if (isGroupRow(r)) return null;
        const cfg = APPROVAL_CONFIG[v] ?? { label: v, color: 'default' };
        if (v === 'MEMO_REQUIRED') {
          return (
            <div style={statusCellStyle}>
              {statusTag('Вне бюджета', cfg.color)}
              <Tag color="orange" style={secondaryStatusStyle}>Требуется обоснование</Tag>
            </div>
          );
        }
        if (v === 'PENDING_MEMO') {
          return (
            <div style={statusCellStyle}>
              {statusTag(cfg.label, cfg.color)}
              <Tag color="geekblue" style={secondaryStatusStyle}>Ожидание согласования</Tag>
            </div>
          );
        }
        return statusTag(cfg.label, cfg.color);
      },
    },
    contract_status: {
      dataIndex: 'contract_status',
      sorter: (a: any, b: any) => CONTRACT_KEY(a.contract_status).localeCompare(CONTRACT_KEY(b.contract_status)),
      render: (v: boolean | null, r: any) => {
        if (isGroupRow(r)) return null;
        const key = CONTRACT_KEY(v);
        const cfg = CONTRACT_CONFIG[key];
        if (canContract) {
          return (
            <Select
              size="small"
              value={key}
              className="registry-status-select"
              style={statusSelectStyle}
              options={Object.entries(CONTRACT_CONFIG).map(([k, c]) => ({
                value: k,
                label: statusSelectLabel(c.label),
              }))}
              onChange={(newKey) => {
                const newVal = newKey === 'null' ? null : newKey === 'true';
                handleSetContract(r.id, newVal);
              }}
            />
          );
        }
        return statusTag(cfg.label, cfg.color, true);
      },
    },
    is_budgeted: {
      dataIndex: 'is_budgeted',
      sorter: (a: any, b: any) => CONTRACT_KEY(a.is_budgeted).localeCompare(CONTRACT_KEY(b.is_budgeted)),
      render: (v: boolean | null, r: any) => {
        if (isGroupRow(r)) return null;
        const key = CONTRACT_KEY(v);
        const cfg = CONTRACT_CONFIG[key];
        if (canApprove) {
          return (
            <Select
              size="small"
              value={key}
              className="registry-status-select"
              style={statusSelectStyle}
              options={Object.entries(CONTRACT_CONFIG).map(([k, c]) => ({
                value: k,
                label: statusSelectLabel(c.label),
              }))}
              onChange={(newKey) => {
                const newVal = newKey === 'null' ? null : newKey === 'true';
                handleSetBudget(r.id, newVal);
              }}
            />
          );
        }
        return statusTag(cfg.label, cfg.color, true);
      },
    },
    payment_status: {
      dataIndex: 'payment_status',
      sorter: (a: any, b: any) => (a.payment_status ?? '').localeCompare(b.payment_status ?? ''),
      render: (v: string, r: any) => {
        if (isGroupRow(r)) return null;
        const cfg = PAYMENT_CONFIG[v] ?? { label: v, color: 'default' };
        return statusTag(cfg.label, cfg.color);
      },
    },
    special_icon: {
      dataIndex: 'special_order',
      align: 'center' as const,
      render: (v: boolean, r: any) => {
        if (isGroupRow(r)) return null;
        if (r.approval_status === 'PENDING_GATE') {
          return (
            <Tooltip title={`Требует исключения из регламента: ${r.gate_reason || ''}`}>
              <ThunderboltOutlined style={{ color: '#722ed1' }} />
            </Tooltip>
          );
        }
        if (v) {
          return (
            <Tooltip title={`Исключение разрешено ФЭО${r.gate_reason ? `: ${r.gate_reason}` : ''}`}>
              <ThunderboltOutlined style={{ color: '#fa8c16' }} />
            </Tooltip>
          );
        }
        return null;
      },
    },
    actions: {
      align: 'center' as const,
      render: (_: any, r: any) => {
        if (isGroupRow(r)) return null;
        const decision = resolveRegistryActionDecision(
          r,
          {
            canCreate,
            canEditAll,
            canApprove,
            canGateApprove,
            canMemoApprove,
            canPay,
            canSuspend,
            canMarkDeletion,
          },
          {
            id: user?.id,
            isSuperadmin: !!user?.is_superadmin,
          },
        );
        const { primaryActionKey, secondaryActionKeys } = decision;
        const requestSummary = `${r.counterparty} — ${r.amount?.toLocaleString('ru-RU')} ₽`;
        const primaryAction: WorkflowAction | undefined = (() => {
          switch (primaryActionKey) {
            case 'submit':
              return {
                key: 'submit', label: 'Отправить', icon: <SendOutlined />,
                run: () => handleSubmit(r.id),
                confirmTitle: 'Отправить заявку на согласование?',
                confirmDescription: requestSummary,
                confirmOkText: 'Отправить',
              };
            case 'approve-exception':
              return {
                key: 'approve-exception', label: 'Разрешить исключение', icon: <CheckOutlined />, color: '#722ed1',
                run: () => setGateModal({ open: true, type: 'approve', requestId: r.id, violation: r.gate_reason || '' }),
              };
            case 'approve':
              return {
                key: 'approve', label: 'Согласовать', icon: <CheckOutlined />,
                run: () => handleAction('approve', r.id),
              };
            case 'memo-reason':
              return {
                key: 'memo-reason', label: 'Обосновать', icon: <CheckOutlined />, color: '#fa8c16',
                run: () => openReasonModal('memo_reason', r.id, 'Обоснование вне бюджета'),
              };
            case 'approve-memo':
              return {
                key: 'approve-memo', label: 'Утвердить вне бюджета', icon: <CheckOutlined />,
                run: () => handleApproveMemo(r.id),
                confirmTitle: 'Утвердить внебюджетный платёж?',
                confirmDescription: requestSummary,
                confirmOkText: 'Утвердить',
              };
            case 'pay':
              return {
                key: 'pay', label: 'Оплатить', icon: <DollarOutlined />, color: '#52c41a',
                run: () => handleAction('pay', r.id),
                confirmTitle: 'Отметить как оплаченную?',
                confirmDescription: requestSummary,
                confirmOkText: 'Оплатить',
              };
            case 'suspend':
              return {
                key: 'suspend', label: 'Отложить', icon: <ClockCircleOutlined />, color: '#eb2f96',
                run: () => setSuspendModal({ open: true, requestId: r.id }),
              };
            case 'unsuspend':
              return {
                key: 'unsuspend', label: 'Вернуть на согласование', icon: <ClockCircleOutlined />, color: '#fa8c16',
                run: () => setUnsuspendModal({ open: true, requestId: r.id }),
              };
            case 'move-to-draft':
              return {
                key: 'move-to-draft', label: 'Вернуть в черновик', icon: <ClockCircleOutlined />, color: '#fa8c16',
                run: () => setMoveDraftModal({ open: true, requestId: r.id }),
              };
            default:
              return undefined;
          }
        })();

        const secondaryActions: WorkflowAction[] = [];
        for (const actionKey of secondaryActionKeys) {
          switch (actionKey) {
            case 'file':
              if (!r.file_path) break;
              secondaryActions.push({ key: 'file', label: 'Открыть файл', icon: <PaperClipOutlined />, run: () => openFile(r.id, r.file_path) });
              break;
            case 'edit':
              secondaryActions.push({ key: 'edit', label: 'Редактировать', icon: <EditOutlined />, run: () => openEdit(r) });
              break;
            case 'copy':
              secondaryActions.push({ key: 'copy', label: 'Копировать', icon: <CopyOutlined />, run: () => openCopy(r) });
              break;
            case 'mark-deletion':
              secondaryActions.push({
                key: 'mark-deletion',
                label: r.is_marked_for_deletion ? 'Снять пометку на удаление' : 'Пометить на удаление',
                icon: <RestOutlined />,
                danger: !r.is_marked_for_deletion,
                run: () => handleMarkDeletion(r.id, r.is_marked_for_deletion),
                confirmTitle: r.is_marked_for_deletion ? 'Снять пометку на удаление?' : 'Пометить на удаление?',
                confirmDescription: r.is_marked_for_deletion ? 'Заявка будет восстановлена' : 'Заявка будет удалена администратором при очистке',
                confirmOkText: r.is_marked_for_deletion ? 'Снять' : 'Пометить',
              });
              break;
            case 'reject':
              secondaryActions.push({ key: 'reject', label: 'Отклонить', icon: <CloseOutlined />, danger: true, run: () => openReasonModal('reject', r.id, 'Причина отклонения') });
              break;
            case 'clarify':
              secondaryActions.push({ key: 'clarify', label: 'На уточнение', icon: <ClockCircleOutlined />, run: () => openReasonModal('clarify', r.id, 'Комментарий для уточнения') });
              break;
            case 'postpone':
              secondaryActions.push({ key: 'postpone', label: 'Перенести', icon: <ClockCircleOutlined />, run: () => setPostponeModal({ open: true, requestId: r.id }) });
              break;
            case 'suspend-pending':
              secondaryActions.push({ key: 'suspend-pending', label: 'Отложить', icon: <ClockCircleOutlined />, run: () => setSuspendModal({ open: true, requestId: r.id }) });
              break;
            case 'postpone-approved':
              secondaryActions.push({ key: 'postpone-approved', label: 'Перенести', icon: <ClockCircleOutlined />, run: () => setPostponeModal({ open: true, requestId: r.id }) });
              break;
            case 'reject-exception':
              secondaryActions.push({
                key: 'reject-exception', label: 'Отклонить исключение', icon: <CloseOutlined />, danger: true,
                run: () => setGateModal({ open: true, type: 'reject', requestId: r.id, violation: r.gate_reason || '' }),
              });
              break;
            case 'memo-reason':
              secondaryActions.push({
                key: 'memo-reason',
                label: 'Обосновать',
                icon: <CheckOutlined />,
                run: () => openReasonModal('memo_reason', r.id, 'Обоснование вне бюджета'),
              });
              break;
            case 'cancel-memo':
              secondaryActions.push({
                key: 'cancel-memo',
                label: 'Отменить',
                icon: <CloseOutlined />,
                danger: true,
                run: () => openReasonModal('cancel_memo', r.id, 'Причина отмены'),
              });
              break;
            case 'reject-memo':
              secondaryActions.push({
                key: 'reject-memo', label: 'Отклонить вне бюджета', icon: <CloseOutlined />, danger: true,
                run: () => setRejectMemoModal({ open: true, requestId: r.id }),
              });
              break;
            case 'suspend':
              secondaryActions.push({ key: 'suspend', label: 'Отложить', icon: <ClockCircleOutlined />, run: () => setSuspendModal({ open: true, requestId: r.id }) });
              break;
            case 'move-to-draft':
              secondaryActions.push({ key: 'move-to-draft', label: 'Вернуть в черновик', icon: <ClockCircleOutlined />, run: () => setMoveDraftModal({ open: true, requestId: r.id }) });
              break;
            default:
              break;
          }
        }

        return (
          <Space
            size={4}
            wrap={false}
            data-row-action="true"
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {renderPrimaryAction(primaryAction)}
            {renderSecondaryActions(secondaryActions)}
          </Space>
        );
      },
    },
  };
  const renderRequestActions = (r: RequestRow) => COLUMN_RENDERERS.actions.render(null, r);
  const columns = useMemo(
    () => buildColumns(colSettings, COLUMN_RENDERERS, isGrouped),
    [
      colSettings, isGrouped, fetchRequests, user?.id, user?.is_superadmin,
      canCreate, canEditAll, canApprove, canGateApprove, canContract,
      canMemoApprove, canPay, canSuspend, canMarkDeletion,
    ],
  );

  const registryTable = useMemo(() => (
    <Card styles={{ body: { padding: 0 } }}>
      <div>
        {isDayTabbed && (
          <div style={{ padding: '8px 12px 0' }}>
            <Tabs
              size="small"
              activeKey={activeMonthKey}
              onChange={(key) => {
                setActiveMonthKey(key);
                const month = dateTabbedMonths.find(m => m.key === key);
                setActiveDayKey(month?.days[0]?.key);
              }}
              items={dateTabbedMonths.map(month => ({
                key: month.key,
                label: `${month.label} (${month.count})`,
                children: (
                  <Tabs
                    size="small"
                    activeKey={activeDayKey}
                    onChange={setActiveDayKey}
                    items={month.days.map(day => ({
                      key: day.key,
                      label: `${day.label} (${day.count})`,
                    }))}
                  />
                ),
              }))}
            />
          </div>
        )}
        <Table
          dataSource={isGrouped ? groupedData : displayedRequests}
          columns={columns}
          rowKey={(r: RegistryTableRow) => getRegistryRowKey(r)}
          loading={loading}
          size="small"
          bordered
          tableLayout="fixed"
          sticky={{ offsetHeader: 0 }}
          pagination={false}
          rowClassName={(r: RegistryTableRow) => {
            if (isGroupRow(r)) {
              if (r._type === 'org') return 'row-group-org';
              if (r._type === 'dircat') return 'row-group-dircat';
              if (r._type === 'category') return 'row-group-cat';
              return '';
            }
            if (r.is_marked_for_deletion) return 'row-marked-deletion';
            if (r.approval_status === 'PENDING_GATE') return 'row-pending-gate';
            if (r.approval_status === 'MEMO_REQUIRED') return 'row-memo-required';
            if (r.approval_status === 'PENDING_MEMO') return 'row-pending-memo';
            if (r.approval_status === 'SUSPENDED') return 'row-suspended';
            return r.special_order ? 'row-special' : '';
          }}
          expandable={isGrouped ? {
            expandedRowKeys: expandedKeys,
            onExpand: (expanded, record: RegistryTableRow) => {
              const rowKey = getRegistryRowKey(record);
              setExpandedKeys(prev =>
                expanded ? [...prev, rowKey] : prev.filter((k: string) => k !== rowKey)
              );
            },
          } : undefined}
        />
      </div>
    </Card>
  ), [
    activeDayKey, activeMonthKey, columns, dateTabbedMonths, displayedRequests,
    expandedKeys, groupedData, isDayTabbed, isGrouped, loading,
  ]);

  // ─── Рендер ───────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 16 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
        <Title level={3} style={{ margin: 0 }}>Реестр платежных заявок</Title>
        <Space>
          <Space size={6}>
            <Text type="secondary" style={{ fontSize: 13 }}>Фильтры</Text>
            <Switch
              aria-label="Фильтры"
              checked={showFilters}
              onChange={v => {
                setShowFilters(v);
                localStorage.setItem('ui_registry_show_filters', String(v));
              }}
              size="small"
            />
          </Space>
          <Space size={6}>
            <Text type="secondary" style={{ fontSize: 13 }}>По дням</Text>
            <Switch
              aria-label="По дням"
              checked={isDayTabbed}
              onChange={v => {
                setIsDayTabbed(v);
                localStorage.setItem('ui_registry_day_tabs', String(v));
              }}
              size="small"
            />
          </Space>
          <Space size={6}>
            <Text type="secondary" style={{ fontSize: 13 }}>Группировка</Text>
            <Switch
              aria-label="Группировка"
              checked={isGrouped}
              onChange={v => { setIsGrouped(v); localStorage.setItem('ui_registry_grouped', String(v)); }}
              size="small"
            />
          </Space>
          {isGrouped && (
            <Segmented
              size="small"
              value={expandLevel}
              onChange={v => { const val = v as 'org' | 'dircat' | 'cat' | 'req'; setExpandLevel(val); localStorage.setItem('ui_registry_expand_level', val); }}
              options={[
                { label: 'Организации',  value: 'org' },
                { label: 'Кат. ЦФО',    value: 'dircat' },
                { label: 'Кат. ДДС',    value: 'cat' },
                { label: 'Заявки',       value: 'req' },
              ]}
            />
          )}
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Новая заявка
            </Button>
          )}
        </Space>
      </Row>

      {/* Фильтры */}
      {showFilters && (
      <Card size="small" style={{ marginBottom: 12 }}>
        <Row gutter={[8, 8]} align="middle" wrap>
          <Col>
            <RangePicker
              style={{ width: 230 }} format="DD.MM.YYYY"
              placeholder={['Дата оплаты с', 'по']}
              value={filterPaymentDates}
              onChange={handleFilterPaymentDatesChange}
              locale={DATE_PICKER_LOCALE}
            />
          </Col>
          {canViewAll && (
            <>
              <Col>
                <Select style={{ width: 180 }} placeholder="Организация" allowClear
                  value={filterOrg}
                  options={organizations.map(o => ({ value: o.id, label: o.name }))}
                  onChange={setFilterOrg}
                />
              </Col>
              <Col>
                <Select style={{ width: 180 }} placeholder="ЦФО" allowClear showSearch
                  value={filterDir}
                  filterOption={(i, o) => (o?.label ?? '').toString().toLowerCase().includes(i.toLowerCase())}
                  options={directions.map(d => ({ value: d.id, label: d.name }))}
                  onChange={setFilterDir}
                />
              </Col>
            </>
          )}
          <Col>
            <Input style={{ width: 160 }} placeholder="Контрагент"
              value={filterCounterparty}
              onChange={e => setFilterCounterparty(e.target.value)}
              allowClear
            />
          </Col>
          <Col>
            <Input style={{ width: 160 }} placeholder="Назначение / Описание"
              value={filterDescription}
              onChange={e => setFilterDescription(e.target.value)}
              allowClear
            />
          </Col>
          <Col>
            <Select style={{ width: 150 }} placeholder="Категория ДДС" allowClear
              value={filterCategory}
              options={Object.entries(CATEGORY_CONFIG).map(([k, v]) => ({
                value: k, label: <Tag color={v.color}>{v.label}</Tag>,
              }))}
              onChange={(v) => { setFilterCategory(v); setFilterBudgetItem(undefined); }}
            />
          </Col>
          <Col>
            <Select style={{ width: 160 }} placeholder="Статья ДДС" allowClear
              value={filterBudgetItem}
              options={budgetItems
                .filter(b => !filterCategory || b.category === filterCategory)
                .map(b => ({ value: b.id, label: b.name }))}
              onChange={setFilterBudgetItem}
            />
          </Col>
          <Col>
            <InputNumber style={{ width: 110 }} placeholder="Сумма от"
              value={filterAmountFrom}
              onChange={v => setFilterAmountFrom(v ?? undefined)}
              formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}
              min={0}
            />
          </Col>
          <Col>
            <InputNumber style={{ width: 110 }} placeholder="Сумма до"
              value={filterAmountTo}
              onChange={v => setFilterAmountTo(v ?? undefined)}
              formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}
              min={0}
            />
          </Col>
          <Col>
            <Select style={{ width: 170 }} placeholder="Согласование" allowClear
              value={filterApproval}
              options={Object.entries(APPROVAL_CONFIG).map(([k, v]) => ({
                value: k, label: <Tag color={v.color}>{v.label}</Tag>,
              }))}
              onChange={setFilterApproval}
            />
          </Col>
          <Col>
            <Select style={{ width: 140 }} placeholder="Оплата" allowClear
              value={filterPayment}
              options={Object.entries(PAYMENT_CONFIG).map(([k, v]) => ({
                value: k, label: <Tag color={v.color}>{v.label}</Tag>,
              }))}
              onChange={setFilterPayment}
            />
          </Col>
          <Col>
            <Select
              style={{ width: 190 }}
              value={filterMarked}
              onChange={setFilterMarked}
              options={[
                { value: 'all',      label: 'Все заявки' },
                { value: 'marked',   label: <span style={{ color: '#ff4d4f' }}><RestOutlined /> Помечены на удаление</span> },
                { value: 'unmarked', label: 'Не помечены' },
              ]}
            />
          </Col>
          <Col>
            <Tooltip title="Сбросить фильтры">
              <Button icon={<ClearOutlined />} onClick={resetFilters} />
            </Tooltip>
          </Col>
          {canExportExcel && (
            <Col>
              <Tooltip title="Выгрузить текущий вид в Excel">
                <Button icon={<DownloadOutlined />} onClick={exportCurrentView} disabled={!displayedRequests.length} />
              </Tooltip>
            </Col>
          )}
          <Col>
            <Tooltip title="Настройка колонок">
              <Button icon={<SettingOutlined />} onClick={() => setColDrawerOpen(true)} />
            </Tooltip>
          </Col>
        </Row>
      </Card>
      )}

      <div style={{ width: '100%' }}>
        <AccountBalancesPanel
          contextKey="dashboard"
          userId={user?.id}
          canView={canBalanceView}
          canManage={canBalanceManage}
          organizations={organizations}
          dateFrom={balanceDateFrom}
          dateTo={balanceDateTo}
          organizationId={filterOrg}
          daySelected={dashboardDaySelected}
          paymentTotalsByOrganization={paymentTotalsByOrganization}
          defaultExpanded={false}
        />
      </div>

      {/* Таблица */}
      {registryTable}

      {/* Модалка причины */}
      <ReasonModal
        open={reasonModal.open}
        title={reasonModal.title}
        onCancel={() => setReasonModal(p => ({ ...p, open: false }))}
        onOk={(reason) => {
          if (reasonModal.action === 'memo_reason' && !reason.trim()) {
            messageApi.warning('Укажите обоснование вне бюджета');
            return;
          }
          setReasonModal(p => ({ ...p, open: false }));
          handleAction(reasonModal.action, reasonModal.requestId, reason);
        }}
      />

      {/* Форма создания / редактирования */}
      <Modal
        title={
          <Space>
            {editingRequest ? 'Редактировать заявку' : isCopying ? 'Копия заявки' : 'Новая заявка'}
            <Tag color="default">Черновик</Tag>
          </Space>
        }
        open={isFormOpen}
        onCancel={() => setIsFormOpen(false)}
        onOk={() => form.submit()}
        okText="Сохранить"
        cancelText="Отменить"
        confirmLoading={formLoading}
        width={REQUEST_MODAL_WIDTH}
        style={MODAL_TOP_STYLE}
        forceRender
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleFormSubmit} style={{ marginTop: 8 }}>
          {editingRequest && (
            <div style={{ marginBottom: 12, color: '#8c8c8c', fontSize: 12 }}>
              Создана: {editingRequest.created_at ? new Date(editingRequest.created_at).toLocaleString('ru-RU') : '—'}
              {editingRequest.creator?.full_name && ` · ${editingRequest.creator.full_name}`}
            </div>
          )}
          {!editingRequest && (
            <div
              style={{
                marginBottom: 16,
                padding: 12,
                borderRadius: 8,
                border: '1px solid #91caff',
                background: '#e6f4ff',
              }}
            >
              <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                <Space wrap align="center" size={12}>
                  <Button
                    icon={<FileSearchOutlined />}
                    loading={ocrLoading}
                    disabled={!fileList.some(f => f.originFileObj)}
                    onClick={() => {
                      const attached = fileList.find(f => f.originFileObj)?.originFileObj;
                      if (!attached) {
                        messageApi.warning('Сначала прикрепите файл счёта в поле «Файл (скан счёта / акта)»');
                        return;
                      }
                      void handleOcrRecognize(attached as File);
                    }}
                  >
                    Распознать счёт
                  </Button>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Прикрепите файл счёта (поле «Файл» справа) и нажмите — поля заполнятся автоматически (до минуты)
                  </Text>
                </Space>
                {ocrResult && (
                  <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                    <Alert
                      showIcon
                      type="info"
                      title={`Уверенность распознавания: ${Math.round(ocrResult.confidence * 100)}%`}
                    />
                    {ocrResult.requirement && (
                      <Alert
                        showIcon
                        type="warning"
                        title={`Обязательно указать в назначении платежа: ${ocrResult.requirement}`}
                      />
                    )}
                    {!ocrResult.isInvoice && (
                      <Alert
                        showIcon
                        type="warning"
                        title="Документ не распознан как счёт — проверьте поля вручную"
                      />
                    )}
                    {ocrResult.warnings.map((w, i) => (
                      <Alert key={i} showIcon type="warning" title={w} />
                    ))}
                  </Space>
                )}
              </Space>
            </div>
          )}
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={8}>
              <div style={requestFormBlockStyle}>
                <Text type="secondary" style={requestFormBlockTitleStyle}>Реквизиты</Text>
                <Form.Item name="organization_id" label="Организация" rules={[{ required: true }]}>
                  <Select showSearch placeholder="Выберите организацию"
                    filterOption={(i, o) => (o?.label ?? '').toString().toLowerCase().includes(i.toLowerCase())}
                    options={organizations.map(o => ({ value: o.id, label: o.name }))}
                  />
                </Form.Item>
                <Form.Item name="direction_id" label="Направление" rules={[{ required: true }]}>
                  <Select showSearch placeholder="Выберите направление"
                    filterOption={(i, o) => (o?.label ?? '').toString().toLowerCase().includes(i.toLowerCase())}
                    options={directions.map(d => ({ value: d.id, label: d.name }))}
                  />
                </Form.Item>
                <Form.Item name="counterparty" label="Контрагент" rules={[{ required: true }]}>
                  <Input />
                </Form.Item>
                <Form.Item name="budget_item_id" label="Статья ДДС" rules={[{ required: true }]}>
                  <Select showSearch placeholder="Выберите статью"
                    filterOption={(i, o) => (o?.label ?? '').toString().toLowerCase().includes(i.toLowerCase())}
                    options={budgetItems.map(b => ({ value: b.id, label: b.name }))}
                  />
                </Form.Item>
              </div>
            </Col>

            <Col xs={24} lg={8}>
              <div style={requestFormBlockStyle}>
                <Text type="secondary" style={requestFormBlockTitleStyle}>Платеж</Text>
                <Row gutter={12}>
                  <Col span={12}>
                    <Form.Item name="amount" label="Сумма, ₽" rules={[{ required: true }]}>
                      <InputNumber style={{ width: '100%' }} min={0.01} precision={2}
                        formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="payment_date" label="Дата оплаты" rules={[{ required: true, message: 'Укажите дату' }]}>
                      <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" locale={DATE_PICKER_LOCALE} />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item
                  name="description"
                  label="Назначение платежа (для банка)"
                  rules={[
                    { required: true, message: 'Пожалуйста, введите назначение платежа (для банка)' },
                    {
                      validator: (_, value) => {
                        if (typeof value !== 'string' || value.trim().length === 0) {
                          return Promise.reject(new Error('Поле не может состоять только из пробелов'));
                        }
                        return Promise.resolve();
                      },
                    },
                  ]}
                >
                  <Input.TextArea rows={4} />
                </Form.Item>
                <Form.Item name="note" label="Описание (смысловое)">
                  <Input.TextArea rows={4} />
                </Form.Item>
              </div>
            </Col>

            <Col xs={24} lg={8}>
              <div style={requestFormBlockStyle}>
                <Text type="secondary" style={requestFormBlockTitleStyle}>Регламент и служебное</Text>
                {gatePreviewLoading && (
                  <Alert
                    showIcon
                    type="info"
                    title="Проверяем регламент оплаты..."
                    style={{ marginBottom: 12 }}
                  />
                )}
                {!gatePreviewLoading && gatePreview && (
                  <Alert
                    showIcon
                    type={gatePreview.allowed ? 'success' : 'warning'}
                    title={gatePreview.allowed ? 'Заявка разрешена' : 'Заявка требует дополнительного согласования'}
                    description={gatePreview.allowed
                      ? 'По выбранной организации, статье ДДС и дате оплаты ограничений нет.'
                      : gatePreview.reason}
                    style={{ marginBottom: 12 }}
                  />
                )}
                {!gatePreviewLoading && !gatePreview && (
                  <Alert
                    showIcon
                    type="info"
                    title="Проверка регламента"
                    description="Выберите организацию, статью ДДС и дату оплаты."
                    style={{ marginBottom: 12 }}
                  />
                )}
                <Form.Item name="feo_note" label="Примечание">
                  <Input.TextArea rows={4} placeholder="Необязательно" />
                </Form.Item>
                <Form.Item label="Файл (скан счёта / акта)">
                  <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                    <Upload maxCount={1} beforeUpload={() => false}
                      fileList={fileList}
                      onChange={({ fileList: fl }) => setFileList(fl)}
                      onPreview={async () => { await openFormFile(); }}
                      showUploadList={{ showPreviewIcon: true }}
                      accept=".pdf,.jpg,.jpeg,.png"
                    >
                      <Button icon={<UploadOutlined />}>Выбрать файл</Button>
                    </Upload>
                    {currentFormFile && (
                      <Button
                        type="link"
                        icon={<PaperClipOutlined />}
                        style={{ padding: 0, width: 'fit-content' }}
                        onClick={() => { void openFormFile(); }}
                      >
                        Открыть файл
                      </Button>
                    )}
                  </Space>
                </Form.Item>
              </div>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* Просмотр изображений */}
      <Modal
        open={!!filePreview}
        title={filePreview?.name}
        footer={null}
        onCancel={() => { URL.revokeObjectURL(filePreview?.url ?? ''); setFilePreview(null); }}
        width={REQUEST_MODAL_WIDTH}
        style={MODAL_TOP_STYLE}
        destroyOnHidden
      >
        {filePreview && (
          <img src={filePreview.url} alt={filePreview.name}
            style={{ width: '100%', maxHeight: '80vh', objectFit: 'contain' }} />
        )}
      </Modal>

      {/* Модалка отложения */}
      <ReasonModal
        open={suspendModal.open}
        title="Отложить заявку"
        onCancel={() => setSuspendModal({ open: false, requestId: '' })}
        onOk={(reason) => {
          handleSuspend(suspendModal.requestId, reason);
          setSuspendModal({ open: false, requestId: '' });
        }}
      />

      {/* Модалка переноса отложенной заявки */}
      <Modal
        open={unsuspendModal.open}
        title="Вернуть отложенную заявку на согласование"
        onCancel={() => { setUnsuspendModal({ open: false, requestId: '' }); setUnsuspendDate(null); }}
        onOk={handleUnsuspend}
        okText="Вернуть" cancelText="Отменить"
        width={REQUEST_SMALL_MODAL_WIDTH}
        style={MODAL_TOP_STYLE}
        destroyOnHidden
      >
        <div style={{ marginBottom: 8, color: '#8c8c8c' }}>
          Укажите новую дату оплаты. Заявка вернётся в статус «Черновик».
        </div>
        <DatePicker
          style={{ width: '100%' }} format="DD.MM.YYYY"
          locale={DATE_PICKER_LOCALE}
          value={unsuspendDate}
          onChange={setUnsuspendDate}
        />
      </Modal>

      {/* Модалка отклонения внебюджетного (Директор) */}
      <ReasonModal
        open={rejectMemoModal.open}
        title="Причина отклонения внебюджетного платежа"
        onCancel={() => setRejectMemoModal({ open: false, requestId: '' })}
        onOk={(reason) => {
          handleRejectMemo(rejectMemoModal.requestId, reason);
          setRejectMemoModal({ open: false, requestId: '' });
        }}
      />

      {/* Модалка переноса заявки в черновик */}
      <Modal
        open={moveDraftModal.open}
        title="Перенести заявку в черновик"
        onCancel={() => { setMoveDraftModal({ open: false, requestId: '' }); setMoveDraftDate(null); }}
        onOk={handleMoveToDraft}
        okText="Перенести" cancelText="Отменить"
        width={REQUEST_SMALL_MODAL_WIDTH}
        style={MODAL_TOP_STYLE}
        destroyOnHidden
      >
        <div style={{ marginBottom: 8, color: '#8c8c8c' }}>
          Укажите новую дату оплаты. Заявка вернётся в статус «Черновик».
        </div>
        <DatePicker
          style={{ width: '100%' }}
          format="DD.MM.YYYY"
          locale={DATE_PICKER_LOCALE}
          value={moveDraftDate}
          onChange={setMoveDraftDate}
        />
      </Modal>

      {/* Модалка переноса (ФЭО) — причина + дата */}
      <Modal
        open={postponeModal.open}
        title="Перенести заявку"
        onCancel={() => { setPostponeModal({ open: false, requestId: '' }); setPostponeDate(null); setPostponeReason(''); }}
        onOk={handlePostpone}
        okText="Перенести" cancelText="Отменить"
        width={REQUEST_SMALL_MODAL_WIDTH}
        style={MODAL_TOP_STYLE}
        destroyOnHidden
      >
        <div style={{ marginBottom: 12, color: '#8c8c8c' }}>
          Укажите причину переноса и при необходимости новую дату оплаты.
        </div>
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>Причина *</Text>
          <Input.TextArea rows={2} value={postponeReason}
            onChange={e => setPostponeReason(e.target.value)} style={{ marginTop: 4 }} />
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>Новая дата оплаты</Text>
          <DatePicker style={{ width: '100%', marginTop: 4 }} format="DD.MM.YYYY"
            locale={DATE_PICKER_LOCALE} value={postponeDate} onChange={setPostponeDate} />
        </div>
      </Modal>

      {/* Модалка разрешения/отклонения исключения */}
      <ReasonModal
        open={gateModal.open}
        title={
          gateModal.type === 'approve'
            ? `Разрешить исключение`
            : `Отклонить исключение`
        }
        onCancel={() => setGateModal(p => ({ ...p, open: false }))}
        onOk={(reason) => {
          setGateModal(p => ({ ...p, open: false }));
          if (gateModal.type === 'approve') {
            handleApproveGate(gateModal.requestId, reason);
          } else {
            handleRejectGate(gateModal.requestId, reason);
          }
        }}
      />

      {/* Модалка просмотра заявки */}
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
            onOpenFile={openFile}
            actions={renderRequestActions(viewingRequest)}
          />
        )}
      </Modal>

      {/* Настройка колонок */}
      <ColSettingsDrawer
        open={colDrawerOpen}
        onClose={() => setColDrawerOpen(false)}
        settings={colSettings}
        defs={COLUMN_DEFS}
        onChange={(s) => { setColSettings(s); saveColSettings(user?.id, s); }}
      />

      <style>{`
        .row-special td { background-color: #fff7e6 !important; }
        .row-group-org > td { background-color: #e6f4ff !important; }
        .row-group-org > td:first-child { font-weight: 600; }
        .row-group-dircat > td { background-color: #f9f0ff !important; }
        .row-group-cat > td { background-color: #f6ffed !important; }
        .row-pending-gate td { background-color: #f9f0ff !important; }
        .row-memo-required td { background-color: #fff7e6 !important; }
        .row-pending-memo td { background-color: #fff2e8 !important; }
        .row-suspended td { background-color: #fff1f0 !important; }
        .row-marked-deletion td { background-color: #fff0f0 !important; opacity: 0.65; text-decoration: line-through; }
        .row-marked-deletion td .ant-btn { text-decoration: none; }
        .ant-table-wrapper .ant-table-content { overflow-x: hidden !important; overflow-y: visible !important; }
        .ant-table-wrapper .ant-table-content::-webkit-scrollbar { display: none; }
        .registry-status-select .ant-select-selector {
          height: 24px !important;
          min-height: 24px !important;
          font-size: 12px !important;
          display: flex;
          align-items: center;
          max-width: 100%;
          overflow: hidden;
        }
        .registry-status-select .ant-select-selection-wrap {
          min-width: 0;
        }
        .registry-status-select .ant-select-selection-item {
          display: block !important;
          flex: 1 1 auto;
          width: 100%;
          font-size: 12px !important;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          text-align: left;
          padding-inline-end: 14px;
        }
        .registry-status-select .ant-select-selection-item .ant-tag {
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          display: block;
          vertical-align: middle;
          text-align: left;
        }
      `}</style>
    </div>
  );
};

export default PaymentRegistry;
