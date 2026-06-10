import React from 'react';
import { Tag, Typography } from 'antd';

const { Text } = Typography;

// ─── Стили ячеек таблицы реестра ─────────────────────────────────────────────
// Презентационные константы и мелкие хелперы рендера, разделяемые между
// PaymentRegistry (buildColumns) и фабрикой рендереров колонок.

export const textCellStyle: React.CSSProperties = {
  display: 'block',
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export const wrapTextCellStyle: React.CSSProperties = {
  display: 'block',
  maxWidth: '100%',
  whiteSpace: 'normal',
  overflowWrap: 'break-word',
  wordBreak: 'normal',
  lineHeight: 1.35,
};

export const smallCellStyle: React.CSSProperties = { fontSize: 12 };
export const smallWrapTextCellStyle: React.CSSProperties = { ...wrapTextCellStyle, ...smallCellStyle };
export const smallTextCellStyle: React.CSSProperties = { ...textCellStyle, ...smallCellStyle };
export const smallLinkWrapTextCellStyle: React.CSSProperties = {
  ...smallWrapTextCellStyle,
  padding: 0,
  height: 'auto',
  fontWeight: 600,
  textAlign: 'left',
};
export const nestedCellDividerStyle: React.CSSProperties = {
  borderTop: '1px solid #f0f0f0',
  marginTop: 5,
  paddingTop: 5,
};
export const SMALL_FONT_COLUMN_KEYS = new Set(['payment_date', 'request_number', 'creator', 'direction', 'counterparty', 'note', 'description', 'amount']);
export const STATUS_COLUMN_KEYS = new Set(['approval_status', 'contract_status', 'budget_item', 'is_budgeted', 'payment_status']);
export const statusCellStyle: React.CSSProperties = {
  minWidth: 0,
  display: 'grid',
  gap: 5,
  justifyItems: 'center',
  alignItems: 'center',
  textAlign: 'center',
  fontSize: 12,
};
export const pairedCellStyle: React.CSSProperties = {
  minWidth: 0,
  display: 'grid',
  gap: 4,
  justifyItems: 'start',
  alignItems: 'start',
  textAlign: 'left',
  fontSize: 12,
};
export const statusTagStyle: React.CSSProperties = {
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
export const secondaryStatusStyle: React.CSSProperties = {
  ...statusTagStyle,
};
export const statusSelectStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 128,
  fontSize: 12,
};

export const statusSelectLabelStyle: React.CSSProperties = {
  display: 'block',
  minWidth: 0,
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textAlign: 'left',
};

export const nativeTitleText = (value: string | null | undefined, style: React.CSSProperties = textCellStyle) => (
  value
    ? <span title={value} style={style}>{value}</span>
    : <Text type="secondary">—</Text>
);

export const statusTag = (label: React.ReactNode, color: string, secondary = false) => (
  <Tag color={color} style={secondary ? secondaryStatusStyle : statusTagStyle}>{label}</Tag>
);

export const statusSelectLabel = (label: React.ReactNode) => (
  <span style={statusSelectLabelStyle}>{label}</span>
);
