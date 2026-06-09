import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Button, Typography, Space, Badge, Segmented, Pagination, Flex,
  App as AntdApp, Empty, Spin, Tooltip,
} from 'antd';
import { CheckOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/apiClient';
import { getErrorMessage } from '../utils/errorMessage';

const { Title, Text } = Typography;

// Тип уведомления (соответствует NotificationOut на бэкенде)
interface NotificationItem {
  id: string;
  request_id: string | null;
  text: string;
  type: string;
  is_read: boolean;
  created_at: string;
}

interface NotificationsSummary {
  total: number;
  unread: number;
}

type FilterMode = 'all' | 'unread';

const PAGE_SIZE = 50;

// Цвет индикатора по типу — общая идея с NotificationBell в App.tsx
const TYPE_COLORS: Record<string, string> = {
  REJECTED: '#ff4d4f',
  GATE_REJECTED: '#ff4d4f',
  CLARIFICATION: '#fa8c16',
  POSTPONED: '#faad14',
  SUSPENDED: '#eb2f96',
  MEMO_REQUIRED: '#fa8c16',
  EOD_UNPAID: '#8c8c8c',
  OFF_BUDGET: '#722ed1',
};

const typeColor = (type: string): string => TYPE_COLORS[type] ?? '#1677ff';

const NotificationsPage: React.FC = () => {
  const { message: messageApi } = AntdApp.useApp();
  const navigate = useNavigate();

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [summary, setSummary] = useState<NotificationsSummary>({ total: 0, unread: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<FilterMode>('all');

  const fetchSummary = useCallback(async () => {
    try {
      const r = await apiClient.get<NotificationsSummary>('/notifications/summary');
      setSummary(r.data);
    } catch (error: unknown) {
      messageApi.error(getErrorMessage(error, 'Ошибка загрузки счётчиков'));
    }
  }, [messageApi]);

  const fetchList = useCallback(async (targetPage: number) => {
    setLoading(true);
    try {
      const offset = (targetPage - 1) * PAGE_SIZE;
      const r = await apiClient.get<NotificationItem[]>('/notifications/', {
        params: { limit: PAGE_SIZE, offset },
      });
      setItems(r.data);
    } catch (error: unknown) {
      messageApi.error(getErrorMessage(error, 'Ошибка загрузки уведомлений'));
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    fetchSummary();
    fetchList(1);
  }, [fetchSummary, fetchList]);

  const handlePageChange = (next: number) => {
    setPage(next);
    fetchList(next);
  };

  const handleRefresh = () => {
    fetchSummary();
    fetchList(page);
  };

  const handleMarkRead = async (id: string) => {
    try {
      await apiClient.post(`/notifications/${id}/read`);
      // Локально помечаем строку прочитанной без полного перезапроса
      setItems(prev => prev.map(n => (n.id === id ? { ...n, is_read: true } : n)));
      setSummary(prev => ({ ...prev, unread: Math.max(0, prev.unread - 1) }));
    } catch (error: unknown) {
      messageApi.error(getErrorMessage(error, 'Не удалось отметить прочитанным'));
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await apiClient.post('/notifications/read_all');
      setItems(prev => prev.map(n => ({ ...n, is_read: true })));
      setSummary(prev => ({ ...prev, unread: 0 }));
      messageApi.success('Все уведомления отмечены прочитанными');
    } catch (error: unknown) {
      messageApi.error(getErrorMessage(error, 'Не удалось отметить все прочитанными'));
    }
  };

  const handleOpenRequest = (n: NotificationItem) => {
    if (n.request_id) {
      navigate(`/dashboard?view=${n.request_id}`);
    }
  };

  const visibleItems = filter === 'unread'
    ? items.filter(n => !n.is_read)
    : items;

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <Card>
        <Space
          style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap' }}
          align="center"
        >
          <Title level={4} style={{ margin: 0 }}>
            Мои уведомления{' '}
            <Text type="secondary" style={{ fontSize: 14, fontWeight: 'normal' }}>
              (всего {summary.total}, непрочитанных {summary.unread})
            </Text>
          </Title>
          <Space wrap>
            <Segmented<FilterMode>
              value={filter}
              onChange={(v) => setFilter(v)}
              options={[
                { label: 'Все', value: 'all' },
                { label: 'Только непрочитанные', value: 'unread' },
              ]}
            />
            <Tooltip title="Обновить">
              <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={loading} />
            </Tooltip>
            <Button
              icon={<CheckOutlined />}
              onClick={handleMarkAllRead}
              disabled={summary.unread === 0}
            >
              Отметить все прочитанными
            </Button>
          </Space>
        </Space>

        <Spin spinning={loading}>
          {visibleItems.length === 0 && !loading ? (
            <Empty description="Нет уведомлений" />
          ) : (
            <div>
              {visibleItems.map((n, idx) => (
                <Flex
                  key={n.id}
                  align="flex-start"
                  justify="space-between"
                  gap={12}
                  onClick={() => handleOpenRequest(n)}
                  style={{
                    background: n.is_read ? undefined : 'rgba(22, 119, 255, 0.06)',
                    borderLeft: `3px solid ${typeColor(n.type)}`,
                    borderTop: idx === 0 ? undefined : '1px solid #f0f0f0',
                    padding: '12px',
                    cursor: n.request_id ? 'pointer' : 'default',
                  }}
                >
                  <Flex gap={10} align="flex-start" style={{ minWidth: 0 }}>
                    <Badge dot={!n.is_read} offset={[-2, 2]}>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background: typeColor(n.type),
                          marginTop: 4,
                        }}
                      />
                    </Badge>
                    <div style={{ minWidth: 0 }}>
                      <Text strong={!n.is_read} style={{ fontSize: 13 }}>
                        {n.text}
                      </Text>
                      <div>
                        <Space size={8} wrap>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {new Date(n.created_at).toLocaleString('ru-RU')}
                          </Text>
                          {n.request_id && (
                            <Text style={{ fontSize: 12, color: '#1677ff' }}>
                              Нажмите для просмотра заявки →
                            </Text>
                          )}
                        </Space>
                      </div>
                    </div>
                  </Flex>
                  <div style={{ flexShrink: 0 }}>
                    {n.is_read ? (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Прочитано
                      </Text>
                    ) : (
                      <Button
                        type="link"
                        size="small"
                        icon={<CheckOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMarkRead(n.id);
                        }}
                      >
                        Отметить прочитанным
                      </Button>
                    )}
                  </div>
                </Flex>
              ))}
            </div>
          )}
        </Spin>

        {summary.total > PAGE_SIZE && (
          <div style={{ textAlign: 'right', marginTop: 16 }}>
            <Pagination
              current={page}
              pageSize={PAGE_SIZE}
              total={summary.total}
              showSizeChanger={false}
              onChange={handlePageChange}
            />
          </div>
        )}
      </Card>
    </div>
  );
};

export default NotificationsPage;
