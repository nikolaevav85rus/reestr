import React from 'react';
import { Drawer, Button, Checkbox, InputNumber, Select, Space } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';

export interface ColDef {
  key: string;
  label: string;
  defaultWidth: number;
  defaultVisible: boolean;
  required?: boolean;
}

export interface ColSetting {
  key: string;
  visible: boolean;
  order: number;
  width: number;
  pairedWith?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  settings: ColSetting[];
  onChange: (settings: ColSetting[]) => void;
  defs: ColDef[];
}

const ColSettingsDrawer: React.FC<Props> = ({ open, onClose, settings, onChange, defs }) => {
  const sorted = [...settings].sort((a, b) => a.order - b.order);

  const secondaryKeys = new Set(
    settings.filter(s => s.pairedWith).map(s => s.pairedWith!)
  );

  const primaryKeyOf = new Map<string, string>();
  for (const s of settings) {
    if (s.pairedWith) primaryKeyOf.set(s.pairedWith, s.key);
  }

  const getDefaults = (): ColSetting[] =>
    defs.map((d, i) => ({
      key: d.key,
      visible: d.defaultVisible,
      order: i,
      width: d.defaultWidth,
    }));

  const update = (key: string, patch: Partial<ColSetting>) =>
    onChange(settings.map(s => (s.key === key ? { ...s, ...patch } : s)));

  const swap = (idxA: number, idxB: number) => {
    const a = sorted[idxA];
    const b = sorted[idxB];
    onChange(settings.map(s => {
      if (s.key === a.key) return { ...s, order: b.order };
      if (s.key === b.key) return { ...s, order: a.order };
      return s;
    }));
  };

  const getPairOptions = (key: string) => {
    const requiredKeys = new Set(defs.filter(d => d.required).map(d => d.key));
    const currentPaired = settings.find(s => s.key === key)?.pairedWith;
    const available = settings.filter(s =>
      s.key !== key &&
      !requiredKeys.has(s.key) &&
      s.visible &&
      !s.pairedWith &&
      // exclude secondaries except the currently selected one
      (!secondaryKeys.has(s.key) || s.key === currentPaired)
    );
    return [
      { value: '', label: '—' },
      ...available.map(s => ({
        value: s.key,
        label: defs.find(d => d.key === s.key)?.label ?? s.key,
      })),
    ];
  };

  return (
    <Drawer
      title={
        <Space>
          <span>Настройка колонок</span>
          <Button size="small" onClick={() => onChange(getDefaults())}>
            Сбросить
          </Button>
        </Space>
      }
      open={open}
      onClose={onClose}
      width={500}
    >
      {sorted.map((s, idx) => {
        const def = defs.find(d => d.key === s.key);
        if (!def) return null;
        const isSecondary = secondaryKeys.has(s.key);
        const primaryKey = primaryKeyOf.get(s.key);

        return (
          <div
            key={s.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 10,
              paddingLeft: isSecondary ? 24 : 0,
              opacity: isSecondary ? 0.65 : 1,
            }}
          >
            <Space size={2}>
              <Button
                size="small"
                icon={<ArrowUpOutlined />}
                disabled={idx === 0 || isSecondary}
                onClick={() => swap(idx, idx - 1)}
              />
              <Button
                size="small"
                icon={<ArrowDownOutlined />}
                disabled={idx === sorted.length - 1 || isSecondary}
                onClick={() => swap(idx, idx + 1)}
              />
            </Space>
            <Checkbox
              checked={s.visible}
              disabled={!!def.required}
              onChange={e => update(s.key, { visible: e.target.checked })}
            />
            <span style={{ flex: 1, fontSize: 13 }}>
              {def.label}
              {isSecondary && primaryKey && (
                <span style={{ color: '#8c8c8c', fontSize: 11, marginLeft: 4 }}>
                  (вложена в {defs.find(d => d.key === primaryKey)?.label})
                </span>
              )}
            </span>
            {!isSecondary && (
              <>
                <InputNumber
                  size="small"
                  style={{ width: 70 }}
                  value={s.width}
                  min={40}
                  max={500}
                  onChange={v => update(s.key, { width: v ?? s.width })}
                />
                {!def.required && (
                  <Select
                    size="small"
                    style={{ width: 140 }}
                    placeholder="2-я строка"
                    value={s.pairedWith ?? ''}
                    options={getPairOptions(s.key)}
                    onChange={v => update(s.key, { pairedWith: v || undefined })}
                  />
                )}
              </>
            )}
          </div>
        );
      })}
    </Drawer>
  );
};

export default ColSettingsDrawer;
