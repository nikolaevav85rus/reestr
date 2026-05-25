export type ColumnSettingLike = {
  key: string;
  order: number;
  width: number;
};

export type ColumnSettings<T extends ColumnSettingLike = ColumnSettingLike> = T[];
export type ColumnSettingsMap<T extends ColumnSettingLike = ColumnSettingLike> = Record<string, ColumnSettings<T>>;

export function normalizeColSettingWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 10;
  return width > 40 ? Math.max(1, Math.round(width / 10)) : width;
}

export function buildUserScopedStorageKey(prefix: string, userId?: string): string {
  return `${prefix}${userId ?? 'default'}`;
}

export function loadStoredColumnSettings<T extends ColumnSettingLike>(
  storageKey: string,
  fallback: T[],
  normalizeWidth: (width: number) => number = normalizeColSettingWidth,
): T[] {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return fallback;
  try {
    return (JSON.parse(raw) as T[]).map((setting) => ({
      ...setting,
      width: normalizeWidth(setting.width),
    }));
  } catch {
    return fallback;
  }
}

type MissingColumnOrderResolver<TDef extends { key: string }, TSetting extends ColumnSettingLike> = (params: {
  def: TDef;
  saved: TSetting[];
  fallbackOrder: number;
}) => number;

export function appendMissingColumnSettings<TDef extends { key: string }, TSetting extends ColumnSettingLike>(
  saved: TSetting[],
  defs: TDef[],
  createSetting: (def: TDef, order: number) => TSetting,
  resolveOrder?: MissingColumnOrderResolver<TDef, TSetting>,
): TSetting[] {
  const existingKeys = new Set(saved.map((setting) => setting.key));
  const maxOrder = saved.reduce((max, setting) => Math.max(max, setting.order), -1);
  let offset = 0;

  for (const def of defs) {
    if (existingKeys.has(def.key)) continue;
    const fallbackOrder = maxOrder + (++offset);
    const order = resolveOrder
      ? resolveOrder({ def, saved, fallbackOrder })
      : fallbackOrder;
    saved.push(createSetting(def, order));
    existingKeys.add(def.key);
  }

  return saved;
}

export function saveStoredColumnSettings<T>(storageKey: string, settings: T): void {
  localStorage.setItem(storageKey, JSON.stringify(settings));
}
