import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalizeColSettingWidth,
  buildUserScopedStorageKey,
  loadStoredColumnSettings,
  appendMissingColumnSettings,
  saveStoredColumnSettings,
  type ColumnSettingLike,
} from './columnSettings';

describe('normalizeColSettingWidth', () => {
  it('keeps small positive widths as-is (happy path)', () => {
    expect(normalizeColSettingWidth(8)).toBe(8);
    expect(normalizeColSettingWidth(40)).toBe(40);
  });

  it('rescales legacy pixel-ish widths > 40 into the flex-grid scale', () => {
    expect(normalizeColSettingWidth(120)).toBe(12);
    expect(normalizeColSettingWidth(45)).toBe(5); // round(4.5) -> 5
  });

  it('falls back to 10 for non-finite or non-positive widths (edge)', () => {
    expect(normalizeColSettingWidth(0)).toBe(10);
    expect(normalizeColSettingWidth(-5)).toBe(10);
    expect(normalizeColSettingWidth(Number.NaN)).toBe(10);
    expect(normalizeColSettingWidth(Number.POSITIVE_INFINITY)).toBe(10);
  });
});

describe('buildUserScopedStorageKey', () => {
  it('appends the user id to the prefix', () => {
    expect(buildUserScopedStorageKey('cols:', 'u42')).toBe('cols:u42');
  });

  it('uses "default" when no user id is given (edge)', () => {
    expect(buildUserScopedStorageKey('cols:')).toBe('cols:default');
  });
});

describe('loadStoredColumnSettings / saveStoredColumnSettings', () => {
  const fallback: ColumnSettingLike[] = [{ key: 'a', order: 0, width: 10 }];

  beforeEach(() => {
    localStorage.clear();
  });

  it('returns the fallback when nothing is stored (happy path)', () => {
    expect(loadStoredColumnSettings('missing', fallback)).toBe(fallback);
  });

  it('round-trips saved settings and normalizes widths on load', () => {
    saveStoredColumnSettings('k1', [{ key: 'a', order: 0, width: 120 }]);
    const loaded = loadStoredColumnSettings('k1', fallback);
    expect(loaded).toEqual([{ key: 'a', order: 0, width: 12 }]);
  });

  it('returns the fallback when stored JSON is corrupt (edge)', () => {
    localStorage.setItem('k2', '{not json');
    expect(loadStoredColumnSettings('k2', fallback)).toBe(fallback);
  });
});

describe('appendMissingColumnSettings', () => {
  it('appends defs that are not already present, ordering after the max order', () => {
    const saved: ColumnSettingLike[] = [{ key: 'a', order: 0, width: 10 }];
    const defs = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];

    const result = appendMissingColumnSettings(
      saved,
      defs,
      (def, order) => ({ key: def.key, order, width: 10 }),
    );

    expect(result.map((s) => s.key)).toEqual(['a', 'b', 'c']);
    expect(result.find((s) => s.key === 'b')?.order).toBe(1);
    expect(result.find((s) => s.key === 'c')?.order).toBe(2);
  });

  it('uses a custom resolveOrder when provided (edge)', () => {
    const saved: ColumnSettingLike[] = [];
    const defs = [{ key: 'x' }];

    const result = appendMissingColumnSettings(
      saved,
      defs,
      (def, order) => ({ key: def.key, order, width: 10 }),
      () => 99,
    );

    expect(result).toEqual([{ key: 'x', order: 99, width: 10 }]);
  });
});
