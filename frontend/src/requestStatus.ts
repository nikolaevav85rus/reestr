export type StatusConfig = Record<string, { label: string; color: string }>;
export type HistoryColorConfig = Record<string, string>;

export const REQUEST_APPROVAL_CONFIG: StatusConfig = {
  DRAFT: { label: 'Черновик', color: 'default' },
  PENDING_GATE: { label: 'Требует исключения', color: 'purple' },
  PENDING: { label: 'На согласовании', color: 'blue' },
  MEMO_REQUIRED: { label: 'Требует обоснования', color: 'orange' },
  PENDING_MEMO: { label: 'Вне бюджета', color: 'volcano' },
  APPROVED: { label: 'Согласовано', color: 'green' },
  REJECTED: { label: 'Отклонено', color: 'red' },
  CLARIFICATION: { label: 'На уточнении', color: 'orange' },
  POSTPONED: { label: 'Перенесено', color: 'gold' },
  SUSPENDED: { label: 'Отложена', color: 'magenta' },
};

export const CASHIER_APPROVAL_CONFIG: StatusConfig = {
  MEMO_REQUIRED: REQUEST_APPROVAL_CONFIG.MEMO_REQUIRED,
  PENDING_MEMO: REQUEST_APPROVAL_CONFIG.PENDING_MEMO,
  APPROVED: REQUEST_APPROVAL_CONFIG.APPROVED,
};

export const REQUEST_PAYMENT_CONFIG: StatusConfig = {
  UNPAID: { label: 'Не оплачено', color: 'default' },
  PAID: { label: 'Оплачено', color: 'green' },
};

export const REQUEST_CONTRACT_CONFIG: StatusConfig = {
  null: { label: 'Необработано', color: 'default' },
  true: { label: 'Есть', color: 'green' },
  false: { label: 'Нет', color: 'red' },
};

export const REQUEST_HISTORY_COLOR: HistoryColorConfig = {
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

export const contractStatusKey = (value: boolean | null): 'null' | 'true' | 'false' => (
  value === null ? 'null' : (String(value) as 'true' | 'false')
);
