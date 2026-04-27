import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import dayjs from 'dayjs';
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
} from '@ant-design/icons';
import apiClient from '../api/apiClient';
import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { useSearchParams } from 'react-router-dom';
import { CATEGORY_CONFIG, DATE_PICKER_LOCALE } from '../constants';
import ColSettingsDrawer from './ColSettingsDrawer';
import type { ColDef, ColSetting } from './ColSettingsDrawer';
import RequestDetailsCard from '../components/RequestDetailsCard';
import { exportRowsToExcel, formatDateRu, formatMoney, type ExcelColumn } from '../utils/excelExport';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const currentMonthRange = () => [dayjs().startOf('month'), dayjs().endOf('month')];

type GatePreview = {
  allowed: boolean;
  reason?: string | null;
  reasons?: string[];
};

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

function normalizeColSettingWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 10;
  return width > 40 ? Math.max(1, Math.round(width / 10)) : width;
}

function loadColSettings(userId?: string): ColSetting[] {
  try {
    const storageKey = `ui_cols_${userId ?? 'default'}`;
    const versionKey = `${storageKey}_preset_version`;
    const raw = localStorage.getItem(storageKey);
    if (localStorage.getItem(versionKey) !== REGISTRY_COLS_PRESET_VERSION) {
      const defaults = getDefaultColSettings();
      localStorage.setItem(storageKey, JSON.stringify(defaults));
      localStorage.setItem(versionKey, REGISTRY_COLS_PRESET_VERSION);
      return defaults;
    }
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
        saved.push({
          key: d.key,
          visible: d.defaultVisible,
          order,
          width: normalizeColSettingWidth(d.defaultWidth),
          pairedWith: d.defaultPairedWith,
        });
      }
    }
    return saved;
  } catch {
    return getDefaultColSettings();
  }
}

function saveColSettings(userId: string | undefined, settings: ColSetting[]): void {
  const storageKey = `ui_cols_${userId ?? 'default'}`;
  localStorage.setItem(storageKey, JSON.stringify(settings));
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

// ─── Конфиги статусов ───────────────────────────────────────────────────────

const APPROVAL_CONFIG: Record<string, { label: string; color: string }> = {
  DRAFT:         { label: 'Черновик',          color: 'default'  },
  PENDING_GATE:  { label: 'Требует исключения', color: 'purple'  },
  PENDING:       { label: 'На согласовании',   color: 'blue'     },
  MEMO_REQUIRED: { label: 'Требует обоснования', color: 'orange' },
  PENDING_MEMO:  { label: 'Вне бюджета',       color: 'volcano'  },
  APPROVED:      { label: 'Согласовано',       color: 'green'    },
  REJECTED:      { label: 'Отклонено',         color: 'red'      },
  CLARIFICATION: { label: 'На уточнении',      color: 'orange'   },
  POSTPONED:     { label: 'Перенесено',        color: 'gold'     },
  SUSPENDED:     { label: 'Отложена',          color: 'magenta'  },
};

const PAYMENT_CONFIG: Record<string, { label: string; color: string }> = {
  UNPAID: { label: 'Не оплачено', color: 'default' },
  PAID:   { label: 'Оплачено',    color: 'green'   },
};

const HISTORY_COLOR: Record<string, string> = {
  APPROVED:      'green',
  PAID:          'green',
  SUSPENDED:     'red',
  RESCHEDULED:   'green',
  REJECTED:      'red',
  CLARIFICATION: 'blue',
  POSTPONED:     'orange',
  MEMO_REQUIRED: 'orange',
  GATE_REJECTED: 'purple',
  OFF_BUDGET:    'orange',
  EOD_UNPAID:    'gray',
};

// null → Необработано, true → Есть, false → Нет
const CONTRACT_KEY = (v: boolean | null) => v === null ? 'null' : String(v);
const CONTRACT_CONFIG: Record<string, { label: string; color: string }> = {
  'null':  { label: 'Необработано', color: 'default' },
  'true':  { label: 'Есть',         color: 'green'   },
  'false': { label: 'Нет',          color: 'red'     },
};
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

  // ─── Данные ─────────────────────────────────────────────────────────────
  const [requests, setRequests]         = useState<any[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [directions, setDirections]     = useState<any[]>([]);
  const [budgetItems, setBudgetItems]   = useState<any[]>([]);
  const [loading, setLoading]           = useState(false);
  const initialFilters = useMemo(() => loadRegistryFilters(user?.id), [user?.id]);

  // ─── Фильтры (сервер) ────────────────────────────────────────────────────
  const [filterOrg, setFilterOrg] = useState<string | undefined>(() => initialFilters.organization);
  const [filterDir, setFilterDir] = useState<string | undefined>(() => initialFilters.direction);

  // ─── Фильтры (клиент) ────────────────────────────────────────────────────
  const [filterPaymentDates, setFilterPaymentDates] = useState<any>(() => {
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
  const [editingRequest, setEditingRequest] = useState<any>(null);
  const [isCopying, setIsCopying]           = useState(false);
  const [formLoading, setFormLoading]       = useState(false);
  const [form] = Form.useForm();
  const [fileList, setFileList]             = useState<UploadFile[]>([]);
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
  const [viewingRequest, setViewingRequest] = useState<any>(null);
  const [requestHistory, setRequestHistory] = useState<any[]>([]);
  const mergeRequest = useCallback((request: any) => {
    setRequests(prev => prev.map(r => r.id === request.id ? { ...r, ...request } : r));
    setViewingRequest((current: any) => current?.id === request.id ? { ...current, ...request } : current);
  }, []);

  useEffect(() => {
    if (!viewingRequest) { setRequestHistory([]); return; }
    apiClient.get(`/requests/${viewingRequest.id}/history`)
      .then(r => setRequestHistory(r.data))
      .catch(() => setRequestHistory([]));
  }, [viewingRequest]);

  // ─── Загрузка справочников ───────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      apiClient.get('/dict/organizations'),
      apiClient.get('/dict/directions'),
      apiClient.get('/dict/budget_items?active_only=true'),
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
      const r = await apiClient.get(`/requests/all?${params}`);
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
    const found = requests.find((r: any) => r.id === viewId);
    if (found) {
      setViewingRequest(found);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, requests]);

  // ─── Клиентская фильтрация ───────────────────────────────────────────────
  const filteredRequests = useMemo(() => {
    return requests.filter(r => {
      if (filterPaymentDates?.[0] && r.payment_date && r.payment_date < filterPaymentDates[0].format('YYYY-MM-DD')) return false;
      if (filterPaymentDates?.[1] && r.payment_date && r.payment_date > filterPaymentDates[1].format('YYYY-MM-DD')) return false;
      if (filterCounterparty && !r.counterparty?.toLowerCase().includes(filterCounterparty.toLowerCase())) return false;
      if (filterDescription && !r.description?.toLowerCase().includes(filterDescription.toLowerCase()) && !r.note?.toLowerCase().includes(filterDescription.toLowerCase())) return false;
      if (filterCategory && r.budget_item?.category !== filterCategory) return false;
      if (filterBudgetItem && r.budget_item_id !== filterBudgetItem) return false;
      if (filterAmountFrom !== undefined && r.amount < filterAmountFrom) return false;
      if (filterAmountTo   !== undefined && r.amount > filterAmountTo)   return false;
      if (filterApproval && r.approval_status !== filterApproval) return false;
      if (filterPayment  && r.payment_status  !== filterPayment)  return false;
      if (filterMarked === 'marked'   && !r.is_marked_for_deletion)  return false;
      if (filterMarked === 'unmarked' &&  r.is_marked_for_deletion)  return false;
      return true;
    });
  }, [requests, filterPaymentDates, filterCounterparty, filterDescription,
      filterCategory, filterBudgetItem, filterAmountFrom, filterAmountTo, filterApproval, filterPayment, filterMarked]);

  const dateTabbedMonths = useMemo(() => {
    const byMonth = new Map<string, { key: string; label: string; count: number; days: Map<string, { key: string; label: string; count: number; rows: any[] }> }>();
    const sorted = [...filteredRequests].sort((a, b) => (a.payment_date ?? '').localeCompare(b.payment_date ?? ''));

    for (const r of sorted) {
      if (!r.payment_date) continue;
      const date = dayjs(r.payment_date);
      const monthKey = date.format('YYYY-MM');
      const dayKey = date.format('YYYY-MM-DD');
      const month = byMonth.get(monthKey) ?? {
        key: monthKey,
        label: new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(date.toDate()),
        count: 0,
        days: new Map(),
      };
      const day = month.days.get(dayKey) ?? {
        key: dayKey,
        label: date.format('DD.MM.YYYY'),
        count: 0,
        rows: [],
      };

      month.count += 1;
      day.count += 1;
      day.rows.push(r);
      month.days.set(dayKey, day);
      byMonth.set(monthKey, month);
    }

    return [...byMonth.values()].map(month => ({
      ...month,
      days: [...month.days.values()],
    }));
  }, [filteredRequests]);

  useEffect(() => {
    if (!isDayTabbed || !dateTabbedMonths.length) {
      setActiveMonthKey(undefined);
      setActiveDayKey(undefined);
      return;
    }

    const month = dateTabbedMonths.find(m => m.key === activeMonthKey) ?? dateTabbedMonths[0];
    const day = month.days.find(d => d.key === activeDayKey) ?? month.days[0];

    if (month.key !== activeMonthKey) setActiveMonthKey(month.key);
    if (day?.key !== activeDayKey) setActiveDayKey(day?.key);
  }, [isDayTabbed, dateTabbedMonths, activeMonthKey, activeDayKey]);

  const displayedRequests = useMemo(() => {
    if (!isDayTabbed) return filteredRequests;
    const month = dateTabbedMonths.find(m => m.key === activeMonthKey);
    const day = month?.days.find(d => d.key === activeDayKey);
    return day?.rows ?? [];
  }, [isDayTabbed, filteredRequests, dateTabbedMonths, activeMonthKey, activeDayKey]);

  const excelColumns: ExcelColumn[] = useMemo(() => {
    const secondaryKeys = new Set(colSettings.filter(s => s.pairedWith).map(s => s.pairedWith!));
    return colSettings
      .filter(s => s.key !== 'actions' && s.key !== 'special_icon')
      .filter(s => !secondaryKeys.has(s.key))
      .map(s => ({
        key: s.key,
        label: COLUMN_DEFS.find(d => d.key === s.key)?.label ?? s.key,
        visible: s.visible,
        order: s.order,
        value: (r: any) => {
          if (s.key === 'payment_date') return formatDateRu(r.payment_date);
          if (s.key === 'organization') return r.organization?.name;
          if (s.key === 'direction') return r.direction?.name;
          if (s.key === 'creator') return r.creator?.full_name;
          if (s.key === 'budget_item') return r.budget_item?.name;
          if (s.key === 'amount') return formatMoney(r.amount);
          if (s.key === 'approval_status') return approvalStatusLabel(r.approval_status);
          if (s.key === 'payment_status') return PAYMENT_CONFIG[r.payment_status]?.label ?? r.payment_status;
          if (s.key === 'contract_status') return CONTRACT_CONFIG[CONTRACT_KEY(r.contract_status)]?.label;
          if (s.key === 'is_budgeted') return CONTRACT_CONFIG[CONTRACT_KEY(r.is_budgeted)]?.label;
          return r[s.key];
        },
      }));
  }, [colSettings]);

  const exportCurrentView = () => {
    exportRowsToExcel(displayedRequests, excelColumns, `payment-registry-${dayjs().format('YYYYMMDD-HHmm')}`);
  };

  // ─── Группировка (org → dircat → ddsCat → request) ───────────────────────
  const groupedData = useMemo(() => {
    const byOrg = new Map<string, any>();
    for (const r of displayedRequests) {
      const orgId      = r.organization_id;
      const orgName    = r.organization?.name ?? '—';
      const dirCatId   = r.direction?.category?.id   ?? '__none__';
      const dirCatName = r.direction?.category?.name ?? 'Без категории ЦФО';
      const ddsCatKey  = r.budget_item?.category ?? 'OTHER';

      if (!byOrg.has(orgId)) {
        byOrg.set(orgId, { key: `org-${orgId}`, _type: 'org', _name: orgName, amount: 0, _count: 0, _dcMap: new Map() });
      }
      const orgRow = byOrg.get(orgId)!;
      orgRow.amount += r.amount;
      orgRow._count++;

      if (!orgRow._dcMap.has(dirCatId)) {
        orgRow._dcMap.set(dirCatId, { key: `org-${orgId}-dc-${dirCatId}`, _type: 'dircat', _name: dirCatName, amount: 0, _count: 0, _catMap: new Map() });
      }
      const dcRow = orgRow._dcMap.get(dirCatId)!;
      dcRow.amount += r.amount;
      dcRow._count++;

      if (!dcRow._catMap.has(ddsCatKey)) {
        dcRow._catMap.set(ddsCatKey, { key: `org-${orgId}-dc-${dirCatId}-cat-${ddsCatKey}`, _type: 'category', _catKey: ddsCatKey, amount: 0, _count: 0, children: [] });
      }
      const catRow = dcRow._catMap.get(ddsCatKey)!;
      catRow.amount += r.amount;
      catRow._count++;
      catRow.children.push({ ...r, key: r.id, _type: 'request' });
    }
    return Array.from(byOrg.values())
      .sort((a, b) => a._name.localeCompare(b._name, 'ru'))
      .map(org => ({
        ...org,
        children: Array.from(org._dcMap.values())
          .sort((a: any, b: any) => a._name.localeCompare(b._name, 'ru'))
          .map((dc: any) => ({
            ...dc,
            children: Array.from(dc._catMap.values())
              .sort((a: any, b: any) => (CATEGORY_CONFIG[a._catKey]?.label ?? a._catKey).localeCompare(CATEGORY_CONFIG[b._catKey]?.label ?? b._catKey, 'ru'))
              .map((cat: any) => ({
                ...cat,
                children: [...cat.children].sort((a: any, b: any) => (a.payment_date ?? '').localeCompare(b.payment_date ?? '')),
              })),
          })),
      }));
  }, [displayedRequests]);

  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  useEffect(() => {
    if (!isGrouped) { setExpandedKeys([]); return; }
    const orgKeys = groupedData.map((o: any) => o.key);
    if (expandLevel === 'org') { setExpandedKeys([]); return; }
    const dcKeys = groupedData.flatMap((o: any) => (o.children ?? []).map((dc: any) => dc.key));
    if (expandLevel === 'dircat') { setExpandedKeys(orgKeys); return; }
    if (expandLevel === 'cat') { setExpandedKeys([...orgKeys, ...dcKeys]); return; }
    const catKeys = groupedData.flatMap((o: any) =>
      (o.children ?? []).flatMap((dc: any) => (dc.children ?? []).map((c: any) => c.key))
    );
    setExpandedKeys([...orgKeys, ...dcKeys, ...catKeys]);
  }, [isGrouped, groupedData, expandLevel]);

  // ─── Сохранение формы ────────────────────────────────────────────────────
  const handleFormSubmit = async (values: any) => {
    setFormLoading(true);
    const pendingFile = fileList.find(f => f.originFileObj)?.originFileObj ?? null;
    try {
      const payload = {
        ...values,
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
        await axios.post(
          `http://127.0.0.1:8080/api/v1/requests/${requestId}/upload`,
          fd,
          { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }
        );
      }
      messageApi.success(editingRequest ? 'Заявка обновлена' : 'Заявка создана');
      setIsFormOpen(false);
      setFileList([]);
      fetchRequests();
    } catch (e: any) {
      const detail = e.response?.data?.detail;
      const msg = typeof detail === 'string' ? detail
        : Array.isArray(detail) ? detail.map((d: any) => d.msg).join('; ')
        : (e.message ?? 'Ошибка при сохранении');
      notification.error({ message: 'Ошибка', description: msg, duration: 8 });
    } finally {
      setFormLoading(false);
    }
  };

  const openEdit = (record: any) => {
    setIsCopying(false);
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
    form.resetFields();
    setFileList([]);
    setIsFormOpen(false);
    setTimeout(() => setIsFormOpen(true), 0);
  };

  const openCopy = (record: any) => {
    setEditingRequest(null);  // создаём новую, не редактируем
    setIsCopying(true);
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
  const handleMarkDeletion = async (id: string, currentMark: boolean) => {
    try {
      await apiClient.patch(`/requests/${id}/mark_deletion`);
      messageApi.success(currentMark ? 'Пометка снята' : 'Заявка помечена на удаление');
      fetchRequests();
    } catch (e: any) {
      messageApi.error(e.response?.data?.detail || 'Ошибка');
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
    } catch (e: any) {
      messageApi.error(e.response?.data?.detail || 'Ошибка при отправке');
    }
  };

  // ─── Бюджет (tristate inline) ─────────────────────────────────────────────
  const handleSetBudget = async (id: string, value: boolean | null) => {
    setRequests(prev => prev.map(r => r.id === id ? { ...r, is_budgeted: value } : r));
    try {
      const response = await apiClient.patch(`/requests/${id}/budget`, { is_budgeted: value });
      mergeRequest(response.data);
    } catch (e: any) {
      messageApi.error(e.response?.data?.detail || 'Ошибка');
      fetchRequests();
    }
  };

  // ─── Договор (tristate inline) ────────────────────────────────────────────
  const handleSetContract = async (id: string, value: boolean | null) => {
    // Оптимистичное обновление
    setRequests(prev => prev.map(r => r.id === id ? { ...r, contract_status: value } : r));
    try {
      await apiClient.patch(`/requests/${id}/contract`, { contract_status: value });
    } catch (e: any) {
      messageApi.error(e.response?.data?.detail || 'Ошибка');
      fetchRequests();
    }
  };

  // ─── Исключение из регламента (PENDING_GATE) ─────────────────────────────
  const handleApproveGate = async (id: string, reason: string) => {
    try {
      await apiClient.post(`/requests/${id}/approve_gate`, { reason });
      messageApi.success('Исключение разрешено');
      fetchRequests();
    } catch (e: any) {
      messageApi.error(e.response?.data?.detail || 'Ошибка');
    }
  };

  const handleRejectGate = async (id: string, reason: string) => {
    try {
      await apiClient.post(`/requests/${id}/reject_gate`, { reason });
      messageApi.success('Запрос отклонён');
      fetchRequests();
    } catch (e: any) {
      messageApi.error(e.response?.data?.detail || 'Ошибка');
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
    } catch (e: any) {
      messageApi.error(e.response?.data?.detail || 'Ошибка');
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
    } catch (e: any) {
      messageApi.error(e.response?.data?.detail || 'Ошибка');
    }
  };

  const [suspendModal, setSuspendModal] = useState<{ open: boolean; requestId: string }>({ open: false, requestId: '' });

  // ─── PENDING_MEMO ─────────────────────────────────────────────────────────
  const handleApproveMemo = async (id: string) => {
    try {
      await apiClient.post(`/requests/${id}/approve_memo`);
      messageApi.success('Внебюджетный платёж утверждён');
      fetchRequests();
    } catch (e: any) {
      messageApi.error(e.response?.data?.detail || 'Ошибка');
    }
  };

  const handleRejectMemo = async (id: string, reason: string) => {
    try {
      await apiClient.post(`/requests/${id}/reject_memo`, { reason });
      messageApi.success('Заявка отклонена');
      fetchRequests();
    } catch (e: any) {
      messageApi.error(e.response?.data?.detail || 'Ошибка');
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
    } catch (e: any) {
      messageApi.error(e.response?.data?.detail || 'Ошибка');
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
    } catch (e: any) {
      messageApi.error(e.response?.data?.detail || 'Ошибка');
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
    } catch (e: any) {
      messageApi.error(e.response?.data?.detail || 'Ошибка');
    }
  };

  const openReasonModal = (action: string, requestId: string, title: string) => {
    setReasonModal({ open: true, title, action, requestId });
  };

  type WorkflowAction = {
    key: string;
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
  const isGroupRow = (r: any) => r._type === 'org' || r._type === 'dircat' || r._type === 'category';
  const COLUMN_RENDERERS: Record<string, any> = {
    payment_date: {
      dataIndex: 'payment_date',
      sorter: (a: any, b: any) => (a.payment_date ?? '').localeCompare(b.payment_date ?? ''),
      render: (v: string, r: any) => {
        if (r._type === 'org') return (
          <Text strong style={{ fontSize: 12 }}>
            {r._name}
            <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12, marginLeft: 8 }}>
              ({r._count} {r._count === 1 ? 'заявка' : r._count < 5 ? 'заявки' : 'заявок'})
            </Text>
          </Text>
        );
        if (r._type === 'dircat') return (
          <span>
            <Tag color="purple" style={{ marginRight: 4 }}>{r._name}</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>({r._count})</Text>
          </span>
        );
        if (r._type === 'category') {
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
      render: (v: number, r: any) => {
        if (r._type === 'org') return (
          <Text strong style={{ color: '#1677ff', fontSize: 12 }}>
            {v.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽
          </Text>
        );
        if (r._type === 'dircat') return (
          <Text style={{ color: '#722ed1', fontSize: 12 }}>
            {v.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽
          </Text>
        );
        if (r._type === 'category') return (
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
        const isOwner    = r.creator_id === user?.id || !!user?.is_superadmin;
        const isDraft    = r.approval_status === 'DRAFT';
        const isApproved = r.approval_status === 'APPROVED';
        const isUnpaid   = r.payment_status  === 'UNPAID';
        const isMemoRequired = r.approval_status === 'MEMO_REQUIRED';
        const canResubmit = isOwner && ['DRAFT', 'CLARIFICATION', 'POSTPONED'].includes(r.approval_status);
        const canMoveToDraft = (isOwner && canCreate) || canEditAll;
        const requestSummary = `${r.counterparty} — ${r.amount?.toLocaleString('ru-RU')} ₽`;

        const primaryAction: WorkflowAction | undefined =
          canCreate && canResubmit ? {
            key: 'submit', label: 'Отправить', icon: <SendOutlined />,
            run: () => handleSubmit(r.id),
            confirmTitle: 'Отправить заявку на согласование?',
            confirmDescription: requestSummary,
            confirmOkText: 'Отправить',
          } : canGateApprove && r.approval_status === 'PENDING_GATE' ? {
            key: 'approve-exception', label: 'Разрешить исключение', icon: <CheckOutlined />, color: '#722ed1',
            run: () => setGateModal({ open: true, type: 'approve', requestId: r.id, violation: r.gate_reason || '' }),
          } : canApprove && r.approval_status === 'PENDING' ? {
            key: 'approve', label: 'Согласовать', icon: <CheckOutlined />,
            run: () => handleAction('approve', r.id),
          } : canCreate && isOwner && isMemoRequired ? {
            key: 'memo-reason', label: 'Обосновать', icon: <CheckOutlined />, color: '#fa8c16',
            run: () => openReasonModal('memo_reason', r.id, 'Обоснование вне бюджета'),
          } : canMemoApprove && r.approval_status === 'PENDING_MEMO' ? {
            key: 'approve-memo', label: 'Утвердить вне бюджета', icon: <CheckOutlined />,
            run: () => handleApproveMemo(r.id),
            confirmTitle: 'Утвердить внебюджетный платёж?',
            confirmDescription: requestSummary,
            confirmOkText: 'Утвердить',
          } : canPay && isApproved && isUnpaid ? {
            key: 'pay', label: 'Оплатить', icon: <DollarOutlined />, color: '#52c41a',
            run: () => handleAction('pay', r.id),
            confirmTitle: 'Отметить как оплаченную?',
            confirmDescription: requestSummary,
            confirmOkText: 'Оплатить',
          } : canSuspend && isApproved && isUnpaid ? {
            key: 'suspend', label: 'Отложить', icon: <ClockCircleOutlined />, color: '#eb2f96',
            run: () => setSuspendModal({ open: true, requestId: r.id }),
          } : canSuspend && r.approval_status === 'SUSPENDED' ? {
            key: 'unsuspend', label: 'Вернуть на согласование', icon: <ClockCircleOutlined />, color: '#fa8c16',
            run: () => setUnsuspendModal({ open: true, requestId: r.id }),
          } : canMoveToDraft && (isMemoRequired || r.approval_status === 'PENDING_MEMO' || r.approval_status === 'POSTPONED') ? {
            key: 'move-to-draft', label: 'Вернуть в черновик', icon: <ClockCircleOutlined />, color: '#fa8c16',
            run: () => setMoveDraftModal({ open: true, requestId: r.id }),
          } : undefined;

        const secondaryActions: WorkflowAction[] = [];
        if (r.file_path) {
          secondaryActions.push({ key: 'file', label: 'Открыть файл', icon: <PaperClipOutlined />, run: () => openFile(r.id, r.file_path) });
        }
        if ((canCreate || canEditAll) && isDraft && (isOwner || canEditAll)) {
          secondaryActions.push({ key: 'edit', label: 'Редактировать', icon: <EditOutlined />, run: () => openEdit(r) });
        }
        if (canCreate) {
          secondaryActions.push({ key: 'copy', label: 'Копировать', icon: <CopyOutlined />, run: () => openCopy(r) });
        }
        if (canMarkDeletion && (canEditAll || (isOwner && r.payment_status !== 'PAID'))) {
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
        }
        if (canApprove && r.approval_status === 'PENDING') {
          secondaryActions.push(
            { key: 'reject', label: 'Отклонить', icon: <CloseOutlined />, danger: true, run: () => openReasonModal('reject', r.id, 'Причина отклонения') },
            { key: 'clarify', label: 'На уточнение', icon: <ClockCircleOutlined />, run: () => openReasonModal('clarify', r.id, 'Комментарий для уточнения') },
            { key: 'postpone', label: 'Перенести', icon: <ClockCircleOutlined />, run: () => setPostponeModal({ open: true, requestId: r.id }) },
          );
          if (canSuspend) {
            secondaryActions.push({ key: 'suspend-pending', label: 'Отложить', icon: <ClockCircleOutlined />, run: () => setSuspendModal({ open: true, requestId: r.id }) });
          }
        }
        if (canApprove && isApproved && isUnpaid) {
          secondaryActions.push({ key: 'postpone-approved', label: 'Перенести', icon: <ClockCircleOutlined />, run: () => setPostponeModal({ open: true, requestId: r.id }) });
        }
        if (canGateApprove && r.approval_status === 'PENDING_GATE') {
          secondaryActions.push({
            key: 'reject-exception', label: 'Отклонить исключение', icon: <CloseOutlined />, danger: true,
            run: () => setGateModal({ open: true, type: 'reject', requestId: r.id, violation: r.gate_reason || '' }),
          });
        }
        if (isMemoRequired) {
          if (canCreate && isOwner && primaryAction?.key !== 'memo-reason') {
            secondaryActions.push({
              key: 'memo-reason',
              label: 'Обосновать',
              icon: <CheckOutlined />,
              run: () => openReasonModal('memo_reason', r.id, 'Обоснование вне бюджета'),
            });
          }
          if (canCreate && isOwner) {
            secondaryActions.push({
              key: 'cancel-memo',
              label: 'Отменить',
              icon: <CloseOutlined />,
              danger: true,
              run: () => openReasonModal('cancel_memo', r.id, 'Причина отмены'),
            });
          }
        }
        if (canMemoApprove && r.approval_status === 'PENDING_MEMO') {
          secondaryActions.push({
            key: 'reject-memo', label: 'Отклонить вне бюджета', icon: <CloseOutlined />, danger: true,
            run: () => setRejectMemoModal({ open: true, requestId: r.id }),
          });
        }
        if (canSuspend && isApproved && isUnpaid && primaryAction?.key !== 'suspend') {
          secondaryActions.push({ key: 'suspend', label: 'Отложить', icon: <ClockCircleOutlined />, run: () => setSuspendModal({ open: true, requestId: r.id }) });
        }
        if (canMoveToDraft && (isMemoRequired || r.approval_status === 'PENDING_MEMO' || r.approval_status === 'POSTPONED') && primaryAction?.key !== 'move-to-draft') {
          secondaryActions.push({ key: 'move-to-draft', label: 'Вернуть в черновик', icon: <ClockCircleOutlined />, run: () => setMoveDraftModal({ open: true, requestId: r.id }) });
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
  const renderRequestActions = (r: any) => COLUMN_RENDERERS.actions.render(null, r);
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
          rowKey={(r) => r.key ?? r.id}
          loading={loading}
          size="small"
          bordered
          tableLayout="fixed"
          sticky={{ offsetHeader: 0 }}
          pagination={false}
          rowClassName={(r) => {
            if (r._type === 'org')      return 'row-group-org';
            if (r._type === 'dircat')   return 'row-group-dircat';
            if (r._type === 'category') return 'row-group-cat';
            if (r.is_marked_for_deletion) return 'row-marked-deletion';
            if (r.approval_status === 'PENDING_GATE') return 'row-pending-gate';
            if (r.approval_status === 'MEMO_REQUIRED') return 'row-memo-required';
            if (r.approval_status === 'PENDING_MEMO') return 'row-pending-memo';
            if (r.approval_status === 'SUSPENDED') return 'row-suspended';
            return r.special_order ? 'row-special' : '';
          }}
          expandable={isGrouped ? {
            expandedRowKeys: expandedKeys,
            onExpand: (expanded, record) => {
              setExpandedKeys(prev =>
                expanded ? [...prev, record.key] : prev.filter((k: string) => k !== record.key)
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
              onChange={setFilterPaymentDates}
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
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleFormSubmit} style={{ marginTop: 8 }}>
          {editingRequest && (
            <div style={{ marginBottom: 12, color: '#8c8c8c', fontSize: 12 }}>
              Создана: {new Date(editingRequest.created_at).toLocaleString('ru-RU')}
              {editingRequest.creator?.full_name && ` · ${editingRequest.creator.full_name}`}
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
                <Form.Item name="description" label="Назначение платежа (для банка)" rules={[{ required: true }]}>
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
                    message="Проверяем регламент оплаты..."
                    style={{ marginBottom: 12 }}
                  />
                )}
                {!gatePreviewLoading && gatePreview && (
                  <Alert
                    showIcon
                    type={gatePreview.allowed ? 'success' : 'warning'}
                    message={gatePreview.allowed ? 'Заявка разрешена' : 'Заявка требует дополнительного согласования'}
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
                    message="Проверка регламента"
                    description="Выберите организацию, статью ДДС и дату оплаты."
                    style={{ marginBottom: 12 }}
                  />
                )}
                <Form.Item name="feo_note" label="Примечание">
                  <Input.TextArea rows={4} placeholder="Необязательно" />
                </Form.Item>
                <Form.Item label="Файл (скан счёта / акта)">
                  <Upload maxCount={1} beforeUpload={() => false}
                    fileList={fileList}
                    onChange={({ fileList: fl }) => setFileList(fl)}
                    accept=".pdf,.jpg,.jpeg,.png"
                  >
                    <Button icon={<UploadOutlined />}>Выбрать файл</Button>
                  </Upload>
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
