import React from 'react';
import { Button, Col, Empty, Row, Space, Tabs, Tag, Timeline, Typography } from 'antd';
import { PaperClipOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { formatDateRu } from '../utils/excelExport';

const { Text } = Typography;

type StatusConfig = Record<string, { label: string; color: string }>;

type RequestDetailsCardProps = {
  request: any;
  history: any[];
  approvalConfig: StatusConfig;
  paymentConfig: StatusConfig;
  contractConfig: StatusConfig;
  categoryConfig: Record<string, { label: string; color: string }>;
  historyColor: Record<string, string>;
  onOpenFile?: (id: string, path: string) => void;
  actions?: React.ReactNode;
};

const CONTRACT_KEY = (v: boolean | null) => v === null ? 'null' : String(v);

const cardBlockStyle: React.CSSProperties = {
  border: '1px solid #f0f0f0',
  borderRadius: 6,
  padding: 12,
  height: '100%',
  background: '#fff',
  fontSize: 14,
};

const blockTitleStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 10,
  fontSize: 14,
  textTransform: 'uppercase',
  letterSpacing: 0.2,
};

const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gap: 3,
  marginBottom: 10,
};

const longTextStyle: React.CSSProperties = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: 14,
};

function nextResponsible(r: any): string {
  if (r.approval_status === 'DRAFT') return 'Инициатор';
  if (r.approval_status === 'PENDING_GATE') return 'ФЭО';
  if (r.approval_status === 'PENDING') return 'ФЭО';
  if (r.approval_status === 'MEMO_REQUIRED') return 'Инициатор';
  if (r.approval_status === 'PENDING_MEMO') return 'Директор';
  if (r.approval_status === 'CLARIFICATION') return 'Инициатор';
  if (r.approval_status === 'POSTPONED') return 'ФЭО';
  if (r.approval_status === 'SUSPENDED') return 'ФЭО';
  if (r.approval_status === 'APPROVED' && r.payment_status !== 'PAID') return 'Казначей';
  if (r.payment_status === 'PAID') return 'Завершено';
  if (r.approval_status === 'REJECTED') return 'Завершено';
  return '—';
}

function nextResponsibleTagText(r: any): string {
  if (r.approval_status === 'MEMO_REQUIRED') return 'Требуется обоснование';
  if (r.approval_status === 'PENDING_MEMO') return 'Ожидание согласования';
  return `Ответственный: ${nextResponsible(r)}`;
}

function nextResponsibleTagColor(status: string): string {
  if (status === 'MEMO_REQUIRED') return 'orange';
  if (status === 'PENDING_MEMO') return 'geekblue';
  return 'blue';
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={fieldStyle}>
      <Text type="secondary" style={{ fontSize: 14 }}>{label}</Text>
      <div>{children}</div>
    </div>
  );
}

const RequestDetailsCard: React.FC<RequestDetailsCardProps> = ({
  request: r,
  history,
  approvalConfig,
  paymentConfig,
  contractConfig,
  categoryConfig,
  historyColor,
  onOpenFile,
  actions,
}) => {
  const approvalCfg = approvalConfig[r.approval_status] ?? { label: r.approval_status, color: 'default' };
  const paymentCfg = paymentConfig[r.payment_status] ?? { label: r.payment_status, color: 'default' };
  const contractCfg = contractConfig[CONTRACT_KEY(r.contract_status)] ?? { label: '—', color: 'default' };
  const budgetCfg = contractConfig[CONTRACT_KEY(r.is_budgeted)] ?? { label: '—', color: 'default' };
  const categoryCfg = r.budget_item?.category ? categoryConfig[r.budget_item.category] : null;
  const fileName = r.file_path ?? r.file?.filename ?? r.file?.name ?? null;
  const shouldShowReason = Boolean(r.rejection_reason) && ['REJECTED', 'CLARIFICATION'].includes(r.approval_status);
  const shouldShowOffBudgetReason = Boolean(r.rejection_reason) && ['MEMO_REQUIRED', 'PENDING_MEMO'].includes(r.approval_status);
  const shouldShowComments = shouldShowReason || shouldShowOffBudgetReason || r.gate_reason || r.feo_note || r.gate_approver;

  const dataTab = (
    <div style={{ paddingTop: 4, fontSize: 14 }}>
      <Space size={8} wrap style={{ marginBottom: 12 }}>
        <Tag color={approvalCfg.color}>{approvalCfg.label}</Tag>
        <Tag color={paymentCfg.color}>{paymentCfg.label}</Tag>
        <Tag color={nextResponsibleTagColor(r.approval_status)}>{nextResponsibleTagText(r)}</Tag>
        {r.special_order && <Tag icon={<ThunderboltOutlined />} color="orange">Исключение</Tag>}
      </Space>

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={8}>
          <div style={cardBlockStyle}>
            <Text type="secondary" style={blockTitleStyle}>Реквизиты</Text>
            <Field label="Организация"><Text strong>{r.organization?.name ?? '—'}</Text></Field>
            <Field label="ЦФО"><Text>{r.direction?.name ?? '—'}</Text></Field>
            <Field label="Контрагент"><Text style={longTextStyle}>{r.counterparty ?? '—'}</Text></Field>
            <Field label="Статья ДДС">
              {r.budget_item ? (
                <Space size={4} wrap>
                  <Tag color={categoryCfg?.color ?? 'default'}>{categoryCfg?.label ?? r.budget_item.category}</Tag>
                  <Text>{r.budget_item.name}</Text>
                </Space>
              ) : <Text type="secondary">—</Text>}
            </Field>
          </div>
        </Col>

        <Col xs={24} lg={8}>
          <div style={cardBlockStyle}>
            <Text type="secondary" style={blockTitleStyle}>Платеж</Text>
            <Field label="Сумма">
              <Text strong style={{ fontSize: 18 }}>
                {r.amount?.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽
              </Text>
            </Field>
            <Field label="Дата оплаты"><Text>{formatDateRu(r.payment_date)}</Text></Field>
            <Field label="Назначение платежа"><Text style={longTextStyle}>{r.description ?? '—'}</Text></Field>
            <Field label="Описание"><Text style={longTextStyle}>{r.note ?? '—'}</Text></Field>
          </div>
        </Col>

        <Col xs={24} lg={8}>
          <div style={cardBlockStyle}>
            <Text type="secondary" style={blockTitleStyle}>Статус и служебное</Text>
            <Field label="В бюджете"><Tag color={budgetCfg.color}>{budgetCfg.label}</Tag></Field>
            <Field label="Договор"><Tag color={contractCfg.color}>{contractCfg.label}</Tag></Field>
            <Field label="Создал"><Text>{r.creator?.full_name ?? '—'}</Text></Field>
            <Field label="Дата создания">
              <Text>{r.created_at ? new Date(r.created_at).toLocaleString('ru-RU') : '—'}</Text>
            </Field>
            <Field label="Файл счёта">
              {fileName ? (
                <Button
                  type="link"
                  icon={<PaperClipOutlined />}
                  style={{ padding: 0, height: 'auto', whiteSpace: 'normal', textAlign: 'left' }}
                  onClick={() => onOpenFile?.(r.id, fileName)}
                >
                  {fileName}
                </Button>
              ) : (
                <Text type="secondary">—</Text>
              )}
            </Field>
            {actions && <Field label="Доступные действия">{actions}</Field>}
          </div>
        </Col>
      </Row>

      {shouldShowComments && (
        <div style={{ ...cardBlockStyle, marginTop: 12 }}>
          <Text type="secondary" style={blockTitleStyle}>Комментарии</Text>
          <Row gutter={[12, 4]}>
            {shouldShowReason && (
              <Col xs={24} md={12}>
                <Field label="Причина отклонения"><Text type="danger">{r.rejection_reason}</Text></Field>
              </Col>
            )}
            {shouldShowOffBudgetReason && (
              <Col xs={24} md={12}>
                <Field label="Обоснование вне бюджета"><Text>{r.rejection_reason}</Text></Field>
              </Col>
            )}
            {r.gate_reason && (
              <Col xs={24} md={12}>
                <Field label="Исключение из регламента"><Text>{r.gate_reason}</Text></Field>
              </Col>
            )}
            {r.feo_note && (
              <Col xs={24} md={12}>
                <Field label="Примечание ФЭО"><Text>{r.feo_note}</Text></Field>
              </Col>
            )}
            {r.gate_approver && (
              <Col xs={24} md={12}>
                <Field label="Разрешил исключение"><Text>{r.gate_approver.full_name}</Text></Field>
              </Col>
            )}
          </Row>
        </div>
      )}
    </div>
  );

  const historyTab = history.length ? (
    <Timeline
      style={{ paddingTop: 8 }}
      items={history.map(h => ({
        color: historyColor[h.type] ?? 'gray',
        children: (
          <div>
            <Text type="secondary" style={{ fontSize: 14 }}>
              {new Date(h.created_at).toLocaleString('ru-RU')}
            </Text>
            <div><Text>{h.text}</Text></div>
          </div>
        ),
      }))}
    />
  ) : (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Истории по заявке пока нет" />
  );

  return (
    <Tabs
      size="small"
      items={[
        { key: 'data', label: 'Данные', children: dataTab },
        { key: 'history', label: `История (${history.length})`, children: historyTab },
      ]}
    />
  );
};

export default RequestDetailsCard;
