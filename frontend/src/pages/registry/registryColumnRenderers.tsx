import React from 'react';
import { Button, Dropdown, Popconfirm, Select, Space, Tag, Tooltip, Typography } from 'antd';
import type { MenuProps } from 'antd';
import {
  EditOutlined, CheckOutlined, CloseOutlined, ClockCircleOutlined,
  DollarOutlined, PaperClipOutlined, SendOutlined, ThunderboltOutlined,
  CopyOutlined, RestOutlined, MoreOutlined,
} from '@ant-design/icons';
import { CATEGORY_CONFIG } from '../../constants';
import {
  REQUEST_APPROVAL_CONFIG as APPROVAL_CONFIG,
  REQUEST_CONTRACT_CONFIG as CONTRACT_CONFIG,
  REQUEST_PAYMENT_CONFIG as PAYMENT_CONFIG,
  contractStatusKey as CONTRACT_KEY,
} from '../../requestStatus';
import {
  resolveRegistryActionDecision,
  type RegistryActionKey,
} from '../paymentRegistryActions';
import type {
  RegistryGroupRow as BaseRegistryGroupRow,
  RegistryTableRow as BaseRegistryTableRow,
  GroupingRequestBase,
} from '../paymentRegistryGrouping';
import {
  smallCellStyle,
  smallTextCellStyle,
  smallWrapTextCellStyle,
  smallLinkWrapTextCellStyle,
  statusCellStyle,
  secondaryStatusStyle,
  statusSelectStyle,
  nativeTitleText,
  statusTag,
  statusSelectLabel,
} from './registryCellStyles';

const { Text } = Typography;

// ─── Тип строки-заявки, на который опираются рендереры ───────────────────────
// Минимальный контракт строки реестра: расширяемый набор полей заявки.
export type RendererRequestRow = GroupingRequestBase & {
  id: string;
  request_number?: string | null;
  counterparty?: string | null;
  description?: string | null;
  note?: string | null;
  creator?: { full_name?: string } | null;
  budget_item?: { id?: string; name?: string; category?: string | null } | null;
  approval_status: string;
  payment_status: string;
  contract_status: boolean | null;
  is_budgeted?: boolean | null;
  special_order?: boolean;
  gate_reason?: string | null;
  is_marked_for_deletion?: boolean;
  file_path?: string | null;
  [key: string]: unknown;
};

type RegistryGroupRow = BaseRegistryGroupRow<RendererRequestRow>;
type RegistryTableRow = BaseRegistryTableRow<RendererRequestRow>;

export const isGroupRow = (row: unknown): row is RegistryGroupRow => {
  if (!row || typeof row !== 'object') return false;
  const rowType = (row as { _type?: unknown })._type;
  return rowType === 'org' || rowType === 'dircat' || rowType === 'category';
};

export type WorkflowAction = {
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

type ReasonModalSetter = (state: { open: boolean; requestId: string }) => void;

export type RegistryColumnRenderersDeps = {
  // Просмотр заявки. Рендереры работают со строками таблицы как с `any`
  // (смешанные строки-заявки и строки-группы), поэтому колбэки,
  // принимающие строку, типизированы максимально широко — как в исходном
  // инлайновом объекте рендереров.
  setViewingRequest: (row: any) => void;
  // Inline-изменение статусов
  canContract: boolean;
  canApprove: boolean;
  handleSetContract: (id: string, value: boolean | null) => void;
  handleSetBudget: (id: string, value: boolean | null) => void;
  // Права для блока действий
  canCreate: boolean;
  canEditAll: boolean;
  canGateApprove: boolean;
  canMemoApprove: boolean;
  canPay: boolean;
  canSuspend: boolean;
  canMarkDeletion: boolean;
  user: { id?: string; is_superadmin?: boolean } | null | undefined;
  // Обработчики действий
  handleSubmit: (id: string) => void;
  handleAction: (action: string, requestId: string, reason?: string) => void;
  handleApproveMemo: (id: string) => void;
  handleMarkDeletion: (id: string, currentMark: boolean) => void;
  openReasonModal: (action: string, requestId: string, title: string) => void;
  openFile: (requestId: string, filename: string) => void;
  openEdit: (record: any) => void;
  openCopy: (record: any) => void;
  setGateModal: (state: { open: boolean; type: 'approve' | 'reject'; requestId: string; violation: string }) => void;
  setSuspendModal: ReasonModalSetter;
  setUnsuspendModal: ReasonModalSetter;
  setMoveDraftModal: ReasonModalSetter;
  setPostponeModal: ReasonModalSetter;
  setRejectMemoModal: ReasonModalSetter;
  // Подтверждение через AntD modal.confirm
  confirmAction: (action: WorkflowAction) => void;
};

function renderPrimaryAction(action: WorkflowAction | undefined) {
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
}

function renderSecondaryActions(
  actions: WorkflowAction[],
  confirmAction: (action: WorkflowAction) => void,
) {
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
      if (action) confirmAction(action);
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
}

export function createRegistryColumnRenderers(
  deps: RegistryColumnRenderersDeps,
): Record<string, any> {
  const {
    setViewingRequest,
    canContract,
    canApprove,
    handleSetContract,
    handleSetBudget,
    canCreate,
    canEditAll,
    canGateApprove,
    canMemoApprove,
    canPay,
    canSuspend,
    canMarkDeletion,
    user,
    handleSubmit,
    handleAction,
    handleApproveMemo,
    handleMarkDeletion,
    openReasonModal,
    openFile,
    openEdit,
    openCopy,
    setGateModal,
    setSuspendModal,
    setUnsuspendModal,
    setMoveDraftModal,
    setPostponeModal,
    setRejectMemoModal,
    confirmAction,
  } = deps;

  return {
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
            {renderSecondaryActions(secondaryActions, confirmAction)}
          </Space>
        );
      },
    },
  };
}
