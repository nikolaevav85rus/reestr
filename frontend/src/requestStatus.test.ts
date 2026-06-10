import { describe, it, expect } from 'vitest';
import {
  contractStatusKey,
  REQUEST_APPROVAL_CONFIG,
  CASHIER_APPROVAL_CONFIG,
  REQUEST_PAYMENT_CONFIG,
  REQUEST_CONTRACT_CONFIG,
  REQUEST_HISTORY_COLOR,
} from './requestStatus';

describe('contractStatusKey', () => {
  it('maps null/true/false to their string keys (happy path)', () => {
    expect(contractStatusKey(null)).toBe('null');
    expect(contractStatusKey(true)).toBe('true');
    expect(contractStatusKey(false)).toBe('false');
  });

  it('produces keys that exist in REQUEST_CONTRACT_CONFIG (edge: key/config alignment)', () => {
    for (const value of [null, true, false] as const) {
      const key = contractStatusKey(value);
      expect(REQUEST_CONTRACT_CONFIG[key]).toBeDefined();
      expect(typeof REQUEST_CONTRACT_CONFIG[key].label).toBe('string');
      expect(typeof REQUEST_CONTRACT_CONFIG[key].color).toBe('string');
    }
  });
});

describe('status config maps', () => {
  it('exposes known approval statuses with label + color', () => {
    expect(REQUEST_APPROVAL_CONFIG.APPROVED).toEqual({ label: 'Согласовано', color: 'green' });
    expect(REQUEST_APPROVAL_CONFIG.REJECTED.color).toBe('red');
  });

  it('reuses the same config objects for the cashier subset (edge: shared references)', () => {
    expect(CASHIER_APPROVAL_CONFIG.APPROVED).toBe(REQUEST_APPROVAL_CONFIG.APPROVED);
    expect(CASHIER_APPROVAL_CONFIG.MEMO_REQUIRED).toBe(REQUEST_APPROVAL_CONFIG.MEMO_REQUIRED);
    // Cashier view is limited to the off-budget / approved subset.
    expect(Object.keys(CASHIER_APPROVAL_CONFIG).sort()).toEqual(
      ['APPROVED', 'MEMO_REQUIRED', 'PENDING_MEMO'].sort(),
    );
  });

  it('maps payment statuses and history colors', () => {
    expect(REQUEST_PAYMENT_CONFIG.PAID.color).toBe('green');
    expect(REQUEST_PAYMENT_CONFIG.UNPAID.color).toBe('default');
    expect(REQUEST_HISTORY_COLOR.APPROVED).toBe('green');
    expect(REQUEST_HISTORY_COLOR.DELETE).toBe('red');
    expect(REQUEST_HISTORY_COLOR.EOD_UNPAID).toBe('gray');
  });
});
