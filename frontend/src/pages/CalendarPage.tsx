import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Tabs, Select, Table, Tag, Typography, Space,
  Row, Col, Button, Checkbox, App as AntdApp, Empty, Spin, Tooltip, Popconfirm,
} from 'antd';
import { SyncOutlined } from '@ant-design/icons';
import apiClient from '../api/apiClient';
import HasPermission from '../components/HasPermission';
import {
  DAY_TYPE_CONFIG, DAY_TYPE_CYCLE,
  TEMPLATE_DAY_TYPE_CONFIG,
  DAY_NAMES, DAY_SHORT, CATEGORY_CONFIG, MONTH_NAMES,
} from '../constants';

const { Title, Text } = Typography;

const currentYear = new Date().getFullYear();
const YEARS = [currentYear - 1, currentYear, currentYear + 1];
const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 7]; // Пн–Вс

// ─── Утилиты ────────────────────────────────────────────────────────────────

function buildCalendarGrid(year: number, month: number, days: any[]): (any | null)[][] {
  const dayMap: Record<string, any> = {};
  days.forEach(d => { dayMap[d.date] = d; });

  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0).getDate();

  // ISO: Пн=1 … Вс=7
  const startDow = firstDay.getDay() === 0 ? 7 : firstDay.getDay();
  const cells: (any | null)[] = Array(startDow - 1).fill(null);

  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push(dayMap[dateStr] ?? { date: dateStr, day_type: null, id: null });
  }

  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (any | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// ─── Ячейка календаря ───────────────────────────────────────────────────────

interface DayCellProps {
  cell: any | null;
  canEdit: boolean;
  onCycle: (cell: any) => void;
}

const DayCell: React.FC<DayCellProps> = ({ cell, canEdit, onCycle }) => {
  if (!cell) return <div style={styles.cellEmpty} />;

  const day = parseInt(cell.date.split('-')[2], 10);
  const dow = new Date(cell.date + 'T00:00:00').getDay();
  const isWeekend = dow === 0 || dow === 6;
  const cfg = cell.day_type ? DAY_TYPE_CONFIG[cell.day_type] : null;

  const cellStyle: React.CSSProperties = {
    ...styles.cell,
    background: cfg ? cfg.bg : '#fff',
    cursor: canEdit && cell.id ? 'pointer' : 'default',
    border: isWeekend ? '1px solid #ffccc7' : '1px solid #d9d9d9',
  };

  const label = cfg ? (
    <span style={{ fontSize: 10, color: cfg.color === 'default' ? '#999' : cfg.color }}>
      {cfg.label}
    </span>
  ) : (
    <span style={{ fontSize: 10, color: '#ccc' }}>—</span>
  );

  const content = (
    <div style={cellStyle} onClick={() => canEdit && cell.id && onCycle(cell)}>
      <span style={{ fontSize: 13, fontWeight: 500, color: isWeekend ? '#ff4d4f' : '#262626' }}>
        {day}
      </span>
      {label}
    </div>
  );

  if (canEdit && cell.id) {
    return <Tooltip title={cfg ? `→ ${nextDayTypeLabel(cell.day_type)}` : undefined}>{content}</Tooltip>;
  }
  return content;
};

function nextDayTypeLabel(current: string): string {
  const idx = DAY_TYPE_CYCLE.indexOf(current);
  const next = DAY_TYPE_CYCLE[(idx + 1) % DAY_TYPE_CYCLE.length];
  return DAY_TYPE_CONFIG[next]?.label ?? next;
}

const styles: Record<string, React.CSSProperties> = {
  cell: {
    height: 64,
    padding: '6px 8px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    borderRadius: 4,
    userSelect: 'none',
    transition: 'filter 0.15s',
  },
  cellEmpty: {
    height: 64,
    background: '#f5f5f5',
    borderRadius: 4,
    border: '1px dashed #e0e0e0',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 4,
  },
  legend: {
    display: 'flex',
    gap: 12,
    flexWrap: 'wrap' as const,
    marginTop: 8,
  },
};

// ─── Основной компонент ─────────────────────────────────────────────────────

const CalendarPage: React.FC = () => {
  const [paymentGroups, setPaymentGroups] = useState<any[]>([]);

  // Вкладка 1: Шаблоны
  const [groupIdTemplates, setGroupIdTemplates] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Record<number, any>>({});
  const [savingDay, setSavingDay] = useState<number | null>(null);

  // Вкладка 2: Матрица
  const [rules, setRules] = useState<any[]>([]);
  const [matrixLoading, setMatrixLoading] = useState(false);

  // Вкладка 3: Календарь
  const [groupIdCal, setGroupIdCal] = useState<string | null>(null);
  const [calYear, setCalYear] = useState(currentYear);
  const [calMonth, setCalMonth] = useState(new Date().getMonth() + 1);
  const [calDays, setCalDays] = useState<any[]>([]);
  const [calLoading, setCalLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const { message: messageApi } = AntdApp.useApp();

  useEffect(() => {
    apiClient.get('/dict/payment_groups').then(r => setPaymentGroups(r.data));
    fetchRules();
  }, []);

  const fetchRules = async () => {
    setMatrixLoading(true);
    try {
      const r = await apiClient.get('/calendar/rules');
      setRules(r.data);
    } finally {
      setMatrixLoading(false);
    }
  };

  const fetchTemplates = useCallback(async (groupId: string) => {
    const r = await apiClient.get(`/calendar/templates?group_id=${groupId}`);
    const map: Record<number, any> = {};
    r.data.forEach((t: any) => { map[t.day_of_week] = t; });
    setTemplates(map);
  }, []);

  const fetchCalendar = useCallback(async (groupId: string, year: number, month: number) => {
    setCalLoading(true);
    try {
      const r = await apiClient.get(`/calendar/calendar?group_id=${groupId}&year=${year}&month=${month}`);
      setCalDays(r.data);
    } catch {
      setCalDays([]);
    } finally {
      setCalLoading(false);
    }
  }, []);

  const handleTemplateChange = async (dayOfWeek: number, dayType: string | null) => {
    if (!groupIdTemplates) return;
    setSavingDay(dayOfWeek);
    try {
      if (dayType) {
        await apiClient.put('/calendar/templates', {
          payment_group_id: groupIdTemplates,
          day_of_week: dayOfWeek,
          day_type: dayType,
        });
      } else {
        const existing = templates[dayOfWeek];
        if (existing) await apiClient.delete(`/calendar/templates/${existing.id}`);
      }
      await fetchTemplates(groupIdTemplates);
    } catch (e: any) {
      messageApi.error(e.response?.data?.detail || 'Ошибка сохранения');
    } finally {
      setSavingDay(null);
    }
  };

  const handleRuleToggle = async (dayType: string, category: string, hasRule: boolean, ruleId?: string) => {
    try {
      if (hasRule && ruleId) {
        await apiClient.delete(`/calendar/rules/${ruleId}`);
      } else if (!hasRule) {
        await apiClient.post('/calendar/rules', { day_type: dayType, allowed_category: category });
      }
      await fetchRules();
    } catch (e: any) {
      messageApi.error(e.response?.data?.detail || 'Ошибка');
    }
  };

  const handleGenerate = async () => {
    if (!groupIdCal) return;
    setGenerating(true);
    try {
      await apiClient.post(`/calendar/generate?group_id=${groupIdCal}&year=${calYear}&month=${calMonth}`);
      messageApi.success('Календарь успешно сгенерирован');
      await fetchCalendar(groupIdCal, calYear, calMonth);
    } catch (e: any) {
      messageApi.error(e.response?.data?.detail || 'Ошибка при генерации');
    } finally {
      setGenerating(false);
    }
  };

  // Клик по ячейке — переключение на следующий тип по циклу
  const handleDayCycle = async (cell: any) => {
    const idx = DAY_TYPE_CYCLE.indexOf(cell.day_type ?? 'NON_PAYMENT');
    const nextType = DAY_TYPE_CYCLE[(idx + 1) % DAY_TYPE_CYCLE.length];
    // Оптимистичное обновление
    setCalDays(prev => prev.map(d => d.id === cell.id ? { ...d, day_type: nextType } : d));
    try {
      await apiClient.put(`/calendar/calendar/${cell.id}`, { day_type: nextType });
    } catch (e: any) {
      messageApi.error(e.response?.data?.detail || 'Ошибка');
      // Откат при ошибке
      if (groupIdCal) fetchCalendar(groupIdCal, calYear, calMonth);
    }
  };

  // ─── Вкладка 1: Шаблоны ──────────────────────────────────────────────────

  const templateRows = WEEK_DAYS.map(dow => ({
    day_of_week: dow,
    day_name: DAY_NAMES[dow],
    day_type: templates[dow]?.day_type ?? null,
    id: templates[dow]?.id,
  }));

  const templateColumns = [
    {
      title: 'День недели', dataIndex: 'day_name', width: 160,
      render: (name: string, r: any) => (
        <Text strong={r.day_of_week <= 5} type={r.day_of_week >= 6 ? 'danger' : undefined}>{name}</Text>
      ),
    },
    {
      title: 'Базовый тип дня',
      render: (_: any, r: any) => (
        <HasPermission
          permission="cal_manage"
          fallback={
            r.day_type
              ? <Tag color={TEMPLATE_DAY_TYPE_CONFIG[r.day_type]?.color}>{TEMPLATE_DAY_TYPE_CONFIG[r.day_type]?.label}</Tag>
              : <Text type="secondary">—</Text>
          }
        >
          <Select
            style={{ width: 190 }}
            value={r.day_type}
            placeholder="Не задан"
            allowClear
            loading={savingDay === r.day_of_week}
            onChange={v => handleTemplateChange(r.day_of_week, v ?? null)}
            options={Object.entries(TEMPLATE_DAY_TYPE_CONFIG).map(([k, v]) => ({
              value: k,
              label: <Tag color={v.color}>{v.label}</Tag>,
            }))}
          />
        </HasPermission>
      ),
    },
  ];

  // ─── Вкладка 2: Матрица ──────────────────────────────────────────────────

  const dayTypes = Object.keys(DAY_TYPE_CONFIG);
  const categories = Object.keys(CATEGORY_CONFIG);

  const matrixColumns = [
    {
      title: 'Тип дня', dataIndex: 'day_type', width: 140,
      render: (dt: string) => <Tag color={DAY_TYPE_CONFIG[dt]?.color}>{DAY_TYPE_CONFIG[dt]?.label}</Tag>,
    },
    ...categories.map(cat => ({
      title: <Tag color={CATEGORY_CONFIG[cat]?.color}>{CATEGORY_CONFIG[cat]?.label}</Tag>,
      key: cat,
      align: 'center' as const,
      width: 110,
      render: (_: any, row: any) => {
        const rule = rules.find(r => r.day_type === row.day_type && r.allowed_category === cat);
        return (
          <HasPermission permission="cal_manage" fallback={<Checkbox checked={!!rule} disabled />}>
            <Checkbox checked={!!rule} onChange={() => handleRuleToggle(row.day_type, cat, !!rule, rule?.id)} />
          </HasPermission>
        );
      },
    })),
  ];

  // ─── Вкладка 3: Сетка календаря ──────────────────────────────────────────

  const weeks = buildCalendarGrid(calYear, calMonth, calDays);

  const CalendarGrid = () => (
    <HasPermission permission="cal_manage" fallback={
      <CalendarGridInner canEdit={false} />
    }>
      <CalendarGridInner canEdit={true} />
    </HasPermission>
  );

  const CalendarGridInner = ({ canEdit }: { canEdit: boolean }) => (
    <div>
      {/* Заголовок дней недели */}
      <div style={styles.grid}>
        {WEEK_DAYS.map(dow => (
          <div key={dow} style={{ textAlign: 'center', padding: '4px 0', fontSize: 12, fontWeight: 600, color: dow >= 6 ? '#ff4d4f' : '#595959' }}>
            {DAY_SHORT[dow]}
          </div>
        ))}
      </div>
      {/* Недели */}
      <div style={{ marginTop: 4 }}>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ ...styles.grid, marginBottom: 4 }}>
            {week.map((cell, ci) => (
              <DayCell key={ci} cell={cell} canEdit={canEdit} onCycle={handleDayCycle} />
            ))}
          </div>
        ))}
      </div>
      {/* Легенда */}
      <div style={styles.legend}>
        {Object.entries(DAY_TYPE_CONFIG).map(([k, v]) => (
          <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 12, height: 12, background: v.bg, border: '1px solid #d9d9d9', borderRadius: 2, display: 'inline-block' }} />
            <Text style={{ fontSize: 12 }}>{v.label}</Text>
          </span>
        ))}
        {canEdit && <Text type="secondary" style={{ fontSize: 12 }}>· клик по дню меняет тип</Text>}
      </div>
    </div>
  );

  // ─── Tabs ─────────────────────────────────────────────────────────────────

  const tabItems = [
    {
      key: 'templates',
      label: 'Шаблоны недели',
      children: (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Row align="middle" gutter={12}>
            <Col><Text>Группа оплаты:</Text></Col>
            <Col>
              <Select
                style={{ width: 230 }}
                placeholder="Выберите группу"
                options={paymentGroups.map(g => ({ value: g.id, label: g.name }))}
                onChange={v => { setGroupIdTemplates(v); fetchTemplates(v); }}
              />
            </Col>
          </Row>
          {groupIdTemplates
            ? <Table dataSource={templateRows} columns={templateColumns} rowKey="day_of_week" pagination={false} bordered size="small" style={{ maxWidth: 420 }} />
            : <Empty description="Выберите группу оплаты" />
          }
          <Text type="secondary" style={{ fontSize: 12 }}>
            Шаблон задаёт базовый ритм недели. Тип «День ЗП» назначается вручную на конкретные даты в разделе «Платёжный календарь».
          </Text>
        </Space>
      ),
    },
    {
      key: 'matrix',
      label: 'Матрица ДДС',
      children: (
        <Table
          dataSource={dayTypes.map(dt => ({ day_type: dt }))}
          columns={matrixColumns}
          rowKey="day_type"
          pagination={false}
          bordered
          loading={matrixLoading}
          size="small"
          scroll={{ x: 'max-content' }}
        />
      ),
    },
    {
      key: 'calendar',
      label: 'Платёжный календарь',
      children: (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Row align="middle" gutter={[12, 8]} wrap>
            <Col>
              <Select
                style={{ width: 230 }}
                placeholder="Группа оплаты"
                options={paymentGroups.map(g => ({ value: g.id, label: g.name }))}
                onChange={v => { setGroupIdCal(v); fetchCalendar(v, calYear, calMonth); }}
              />
            </Col>
            <Col>
              <Select
                style={{ width: 140 }}
                value={calMonth}
                options={MONTH_NAMES.map((m, i) => ({ value: i + 1, label: m }))}
                onChange={v => { setCalMonth(v); if (groupIdCal) fetchCalendar(groupIdCal, calYear, v); }}
              />
            </Col>
            <Col>
              <Select
                style={{ width: 90 }}
                value={calYear}
                options={YEARS.map(y => ({ value: y, label: String(y) }))}
                onChange={v => { setCalYear(v); if (groupIdCal) fetchCalendar(groupIdCal, v, calMonth); }}
              />
            </Col>
            <Col>
              <HasPermission permission="cal_manage">
                {calDays.length > 0 ? (
                  <Popconfirm
                    title="Календарь уже сформирован"
                    description={`Перегенерация перезапишет все изменения за ${MONTH_NAMES[calMonth - 1]} ${calYear} для группы «${paymentGroups.find(g => g.id === groupIdCal)?.name}». Продолжить?`}
                    onConfirm={handleGenerate}
                    okText="Да, перегенерировать"
                    cancelText="Отмена"
                    okButtonProps={{ danger: true }}
                  >
                    <Button type="default" icon={<SyncOutlined />} loading={generating} disabled={!groupIdCal}>
                      Сгенерировать
                    </Button>
                  </Popconfirm>
                ) : (
                  <Button type="primary" icon={<SyncOutlined />} loading={generating} disabled={!groupIdCal} onClick={handleGenerate}>
                    Сгенерировать
                  </Button>
                )}
              </HasPermission>
            </Col>
          </Row>

          {!groupIdCal && <Empty description="Выберите группу оплаты" />}
          {groupIdCal && calLoading && <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>}
          {groupIdCal && !calLoading && calDays.length === 0 && (
            <Empty description="Календарь не сгенерирован. Нажмите «Сгенерировать»." />
          )}
          {groupIdCal && !calLoading && calDays.length > 0 && <CalendarGrid />}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: '16px', width: '100%', maxWidth: '100%' }}>
      <Title level={3} style={{ marginTop: 0 }}>Платёжный календарь</Title>
      <Card style={{ width: '100%' }} styles={{ body: { padding: '16px' } }}>
        <Tabs items={tabItems} />
      </Card>
    </div>
  );
};

export default CalendarPage;
